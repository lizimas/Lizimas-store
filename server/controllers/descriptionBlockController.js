const pool = require("../config/database");
const { uploadBuffer } = require("../utils/cloudinaryUpload");

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

    for (const [i, b] of blocks.entries()) {
        if (!["image", "text", "heading", "grid"].includes(b.type)) {
            return res.status(400).json({ message: `Block ${i}: bad type` });
        }
        if (b.type === "image" && !b.image_url) {
            return res.status(400).json({ message: `Block ${i}: image needs image_url` });
        }
        if (b.type === "text") b.body = sanitizeBlockHtml(b.body || "");
        if (b.type === "heading") b.body = stripTags(b.body || "").trim();

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
        } else if (b.type !== "image" && !stripTags(b.body || "").trim()) {
            return res.status(400).json({ message: `Block ${i}: ${b.type} needs body` });
        }

        if (b.alt_text && String(b.alt_text).length > 255) {
            return res.status(400).json({
                message: `Block ${i}: alt text is ${String(b.alt_text).length} characters, limit is 255. ` +
                         `Alt text should briefly describe the image, not repeat the product description.`
            });
        }
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const owned = await client.query("SELECT id FROM products WHERE id = $1", [productId]);
        if (owned.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Product not found" });
        }

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
                    b.type === "grid" ? JSON.stringify(b.payload || {}) : null
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
