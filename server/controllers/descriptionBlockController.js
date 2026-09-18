const pool = require("../config/database");
const { uploadBuffer } = require("../utils/cloudinaryUpload");
const { canEditProduct } = require("./productController");

// Public: ordered blocks for one product. Empty array is a valid answer —
// the storefront falls back to products.description when nothing is here.
const getDescriptionBlocks = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, "position", type, body, image_url,
                    image_width, image_height, alt_text, payload
             FROM product_description_blocks b
             WHERE b.product_id = $1
               AND EXISTS (
                   SELECT 1 FROM products p
                   WHERE p.id = b.product_id AND p.deleted_at IS NULL
               )
             ORDER BY "position" ASC, id ASC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error("getDescriptionBlocks:", err);
        res.status(500).json({ message: "Failed to load description blocks" });
    }
};

// Pasted paragraphs arrive as HTML so Word/Docs lists keep their numbering,
// ticks and levels. Staff-authored, but never trusted: tags are allow-listed
// and every attribute is dropped bar the tick-list marker class.
const BLOCK_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "span"];

function stripTags(html) {
    return String(html || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ");
}

function sanitizeBlockHtml(html) {
    return String(html || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (m, close, tag, attrs) => {
            const t = tag.toLowerCase();
            if (BLOCK_TAGS.indexOf(t) === -1) return "";
            if (close) return "</" + t + ">";
            if (t === "br") return "<br>";
            if (t === "ul" && /lzbe-check/.test(attrs)) return '<ul class="lzbe-check">';
            if (t === "span") return /\btick\b/.test(attrs) ? '<span class="tick">' : "<span>";
            return "<" + t + ">";
        })
        .trim();
}

// Staff/admin: replace the whole set in one transaction. Position is taken
// from array order, so the client never has to renumber by hand.
const saveDescriptionBlocks = async (req, res) => {
    const productId = req.params.id;
    const blocks = Array.isArray(req.body.blocks) ? req.body.blocks : null;

    if (!blocks) {
        return res.status(400).json({ message: "blocks must be an array" });
    }

    // Recognized hosts for a "video" block's URL - kept narrow (YouTube,
    // Vimeo, or a direct video file) rather than accepting any URL, since
    // the renderer has to know how to embed each one (iframe vs <video>).
    const VIDEO_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|vimeo\.com\/|player\.vimeo\.com\/video\/)|\.(mp4|webm|mov)(\?|$)/i;
    const LINK_URL_RE = /^https?:\/\//i;

    for (const [i, b] of blocks.entries()) {
        if (!["image", "text", "heading", "grid", "video", "link"].includes(b.type)) {
            return res.status(400).json({ message: `Block ${i}: bad type` });
        }
        if (b.type === "image" && !b.image_url) {
            return res.status(400).json({ message: `Block ${i}: image needs image_url` });
        }
        if (b.type === "video") {
            if (!b.image_url || !VIDEO_URL_RE.test(String(b.image_url).trim())) {
                return res.status(400).json({
                    message: `Block ${i}: video needs a YouTube, Vimeo, or direct .mp4/.webm/.mov URL`
                });
            }
            b.image_url = String(b.image_url).trim();
        }
        if (b.type === "link") {
            if (!b.image_url || !LINK_URL_RE.test(String(b.image_url).trim())) {
                return res.status(400).json({ message: `Block ${i}: link needs a valid http(s) URL` });
            }
            b.image_url = String(b.image_url).trim();
            b.body = stripTags(b.body || "").trim();
            if (!b.body) {
                return res.status(400).json({ message: `Block ${i}: link needs label text` });
            }
        }
        if (b.type === "text") b.body = sanitizeBlockHtml(b.body || "");
        if (b.type === "heading") b.body = stripTags(b.body || "").trim();
        // Image and video blocks reuse the same "body" column for an
        // optional caption shown under the photo/player on the storefront
        // (unlike alt_text, which never renders) - plain text only, same
        // treatment as a heading.
        if (b.type === "image" || b.type === "video") b.body = stripTags(b.body || "").trim() || null;
        // Full-width (edge-to-edge) display toggle, Lulu-style - reuses the
        // payload column grid blocks already use rather than adding one.
        if (b.type === "image") b.payload = { full_width: !!(b.payload && b.payload.full_width) };

        if (b.type === "grid") {
            // Mirrors the DB's pdb_grid_needs_items check constraint, so a
            // bad payload is rejected here with a useful message instead of
            // failing later as an opaque constraint-violation 500.
            const items = b.payload && Array.isArray(b.payload.items) ? b.payload.items : null;
            if (!items || items.length === 0) {
                return res.status(400).json({ message: `Block ${i}: grid needs at least one column` });
            }
            for (const [j, it] of items.entries()) {
                if (it && it.body) it.body = sanitizeBlockHtml(it.body);
                const hasContent = it && (
                    it.image_url ||
                    stripTags(it.caption || "").trim() ||
                    stripTags(it.body || "").trim()
                );
                if (!hasContent) {
                    return res.status(400).json({ message: `Block ${i}, column ${j}: empty` });
                }
            }
        } else if (!["image", "video", "link"].includes(b.type) && !stripTags(b.body || "").trim()) {
            return res.status(400).json({ message: `Block ${i}: ${b.type} needs body` });
        }

        if (b.alt_text && String(b.alt_text).length > 255) {
            return res.status(400).json({
                message: `Block ${i}: alt text is ${String(b.alt_text).length} characters, limit is 255. ` +
                         `Alt text should briefly describe the image, not repeat the product description.`
            });
        }

        if ((b.type === "image" || b.type === "video") && b.body && String(b.body).length > 300) {
            return res.status(400).json({
                message: `Block ${i}: caption is ${String(b.body).length} characters, limit is 300.`
            });
        }

        if (b.type === "link" && String(b.body).length > 100) {
            return res.status(400).json({
                message: `Block ${i}: link label is ${String(b.body).length} characters, limit is 100.`
            });
        }
    }

    // This endpoint is shared by the admin/staff route (requireStaffOrAdmin,
    // no per-product check needed - staff can edit any listing) and the
    // vendor route (requireAuth+requireVendor only) - canEditProduct is what
    // stops one vendor from overwriting another vendor's description blocks
    // by guessing a product id, exactly like updateProduct() above enforces
    // for the rest of a product's fields.
    const permission = await canEditProduct(req.user, productId);
    if (!permission.allowed) {
        return res.status(permission.status).json({ message: permission.error });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        await client.query(
            "DELETE FROM product_description_blocks WHERE product_id = $1",
            [productId]
        );

        for (const [i, b] of blocks.entries()) {
            await client.query(
                `INSERT INTO product_description_blocks
                   (product_id, "position", type, body, image_url,
                    image_width, image_height, alt_text, payload)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    productId, i, b.type,
                    b.body || null,
                    b.image_url || null,
                    b.image_width || null,
                    b.image_height || null,
                    b.alt_text || null,
                    ["grid", "image"].includes(b.type) ? JSON.stringify(b.payload || {}) : null
                ]
            );
        }

        await client.query("COMMIT");
        res.json({ message: "Description blocks saved", count: blocks.length });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("saveDescriptionBlocks:", err);
        res.status(500).json({
            message: "Failed to save description blocks",
            detail: process.env.NODE_ENV === "production" ? undefined : err.message
        });
    } finally {
        client.release();
    }
};


// Immediate upload: one image in, URL and true dimensions out. The editor
// calls this on file selection so blocks always carry correct dimensions.
const uploadBlockImage = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
    }
    try {
        const r = await uploadBuffer(req.file.buffer, "lizimas-store/description-blocks");
        res.json({ image_url: r.url, image_width: r.width, image_height: r.height });
    } catch (err) {
        console.error("uploadBlockImage:", err);
        res.status(500).json({ message: "Upload failed" });
    }
};

module.exports = { getDescriptionBlocks, saveDescriptionBlocks, uploadBlockImage };
