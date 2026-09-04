// Slot 3 is the announcement strip. strip_text scrolls and carries no link;
// strip_link is a static tile. Kept in sync with migration 034's constraints.
// Slot 4 is a tile pinned inside a category product rail (migration 047).
const PROMO_SLOTS = [1, 2, 3, 4];
const PROMO_LAYOUTS = ["image", "text", "strip_text", "strip_link", "row_tile"];

const LINK_ERROR = "Link must be an https:// address, a site path starting " +
    "with /, or a mailto: or tel: link.";

// The value reaches a live href, so this is an allowlist rather than a
// blocklist: anything unrecognised is refused instead of guessed at.
function isSafeLink(value) {
    const v = String(value || "").trim();
    if (!v) return false;
    // "//example.com" is protocol-relative and resolves off-site, so a leading
    // slash on its own does not make a link internal.
    if (v.startsWith("/") && !v.startsWith("//")) return true;
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return true;
    if (/^tel:\+?[0-9\s-]{6,20}$/i.test(v)) return true;
    try {
        // Bare http:// is refused too: a tile should not drop a customer onto
        // an unencrypted page.
        return new URL(v).protocol === "https:";
    } catch (error) {
        return false;
    }
}

const pool = require("../config/database");
const cloudinary = require("../config/cloudinary");
const { logActivity } = require("../utils/activityLog");

// The transform lives in the delivery URL rather than in an eager
// derivative. Every clip is under the 30MB upload cap, which is inside
// Cloudinary's on-the-fly video ceiling, so the compressed file is built on
// first request and there is never a window where the URL points at nothing.
function promoVideoUrls(secureUrl) {
    if (!secureUrl) return { url: null, poster: null };
    const url = secureUrl.replace("/upload/",
        "/upload/w_720,c_limit,q_auto,f_auto/");
    // Cloudinary derives a still from any frame of a video, so the poster
    // costs no second upload. so_0 takes the opening frame.
    const poster = secureUrl
        .replace("/upload/", "/upload/so_0,w_720,c_limit,q_auto/")
        .replace(/\.[a-z0-9]+$/i, ".jpg");
    return { url, poster };
}

// resource_type must be "video" or Cloudinary tries to parse the buffer as an
// image and rejects it outright.
function uploadBufferToCloudinary(fileBuffer, kind) {
    const isVideo = kind === "video";
    const options = isVideo
        ? { folder: "lizimas-store/promotions", resource_type: "video" }
        : { folder: "lizimas-store/promotions" };

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            options,
            (error, result) => {
                if (error) return reject(error);
                if (!isVideo) return resolve({ url: result.secure_url, poster: null });
                resolve(promoVideoUrls(result.secure_url));
            }
        );
        stream.end(fileBuffer);
    });
}

// Public: active promotions for the homepage carousels
exports.listPromotions = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, image_url, link_url, title, slot, display_order,
                    headline, subtext, cta_label, bg_color, text_color, layout,
                    category_id, media_type, video_url, poster_url
             FROM promotions
             WHERE is_active = true
             ORDER BY slot ASC, display_order ASC, id ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List promotions error:", error);
        res.status(500).json({ message: "Failed to load promotions" });
    }
};

// Admin: everything, including hidden
exports.listAllPromotions = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, image_url, link_url, title, slot, display_order, is_active, created_at,
                    headline, subtext, cta_label, bg_color, text_color, layout,
                    category_id, media_type, video_url, poster_url
             FROM promotions
             ORDER BY slot ASC, display_order ASC, id ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List all promotions error:", error);
        res.status(500).json({ message: "Failed to load promotions" });
    }
};

exports.createPromotion = async (req, res) => {
    try {
        // No blanket image check here: whether a file is required depends on
        // the layout, and that is validated below once layout is known.
        const requestedSlot = parseInt(req.body.slot, 10);
        const slot = PROMO_SLOTS.includes(requestedSlot) ? requestedSlot : 1;
        const displayOrder = parseInt(req.body.display_order, 10) || 0;
        const title = (req.body.title || "").trim() || null;
        const linkUrl = (req.body.link_url || "").trim() || null;

        if (linkUrl && !isSafeLink(linkUrl)) {
            return res.status(400).json({ message: LINK_ERROR });
        }

        const layout = PROMO_LAYOUTS.includes(req.body.layout)
            ? req.body.layout : "image";
        // Only a row tile pins to a category; anything else stores null so
        // a stale field left in the form cannot bind an unrelated slot.
        const parsedCategory = parseInt(req.body.category_id, 10);
        const categoryId = layout === "row_tile" && Number.isInteger(parsedCategory)
            ? parsedCategory : null;
        const headline = (req.body.headline || "").trim() || null;
        const subtext = (req.body.subtext || "").trim() || null;
        const ctaLabel = (req.body.cta_label || "").trim() || null;
        const bgColor = /^#[0-9a-fA-F]{3,8}$/.test((req.body.bg_color || "").trim())
            ? req.body.bg_color.trim() : "#ffffff";
        // Left null when unset: null means "derive it from the background",
        // which is not the same as any particular colour.
        const textColor = /^#[0-9a-fA-F]{3,8}$/.test((req.body.text_color || "").trim())
            ? req.body.text_color.trim() : null;

        if ((layout === "text" || layout === "strip_text") && !headline) {
            return res.status(400).json({ message: "A text promotion needs a headline." });
        }
        if (layout === "image" && !req.file) {
            return res.status(400).json({ message: "An image promotion needs an image." });
        }
        // A tile with no destination is just an inert box on the homepage.
        if (layout === "strip_link" && !linkUrl) {
            return res.status(400).json({ message: "A strip link needs a link URL." });
        }
        if (layout === "strip_link" && !title && !req.file) {
            return res.status(400).json({ message: "A strip link needs a label or an icon." });
        }
        if (layout === "row_tile" && !categoryId) {
            return res.status(400).json({ message: "A row tile needs a category." });
        }
        if (layout === "row_tile" && !req.file) {
            return res.status(400).json({ message: "A row tile needs an image or a video." });
        }

        // The middleware has already vetted the type; this only decides which
        // Cloudinary path the buffer takes.
        const isVideo = !!req.file && /^video\//i.test(req.file.mimetype || "");
        // Only a row tile is built to play anything. A banner or strip would
        // render a video into a layout that has no timing logic for it.
        if (isVideo && layout !== "row_tile") {
            return res.status(400).json({
                message: "Only a category row tile can use a video."
            });
        }

        const mediaType = isVideo ? "video" : "image";
        const uploaded = req.file
            ? await uploadBufferToCloudinary(req.file.buffer, mediaType)
            : null;
        const imageUrl = uploaded && !isVideo ? uploaded.url : null;
        const videoUrl = uploaded && isVideo ? uploaded.url : null;
        const posterUrl = uploaded && isVideo ? uploaded.poster : null;

        const result = await pool.query(
            `INSERT INTO promotions (image_url, link_url, title, slot, display_order,
                                     headline, subtext, cta_label, bg_color, layout,
                                     text_color, category_id,
                                     media_type, video_url, poster_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, $15)
             RETURNING id, image_url, link_url, title, slot, display_order, is_active,
                       headline, subtext, cta_label, bg_color, text_color, layout,
                       category_id, media_type, video_url, poster_url`,
            [imageUrl, linkUrl, title, slot, displayOrder,
                headline, subtext, ctaLabel, bgColor, layout, textColor, categoryId,
                mediaType, videoUrl, posterUrl]
        );

        await logActivity(req.user.id, "create_promotion", "promotion",
            result.rows[0].id, `Added promotion to slot ${slot}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Create promotion error:", error);
        res.status(500).json({ message: "Failed to save promotion" });
    }
};

// Image is only replaced when a new file is sent
exports.updatePromotion = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query("SELECT * FROM promotions WHERE id = $1", [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: "Promotion not found" });
        }
        const current = existing.rows[0];

        const slot = req.body.slot !== undefined
            ? (PROMO_SLOTS.includes(parseInt(req.body.slot, 10))
                ? parseInt(req.body.slot, 10) : 1)
            : current.slot;
        const displayOrder = req.body.display_order !== undefined
            ? (parseInt(req.body.display_order, 10) || 0)
            : current.display_order;
        const title = req.body.title !== undefined
            ? ((req.body.title || "").trim() || null)
            : current.title;
        const linkUrl = req.body.link_url !== undefined
            ? ((req.body.link_url || "").trim() || null)
            : current.link_url;

        // Only checked when the field was sent. An existing row saved before
        // this rule is left alone unless someone edits the link itself.
        if (req.body.link_url !== undefined && linkUrl && !isSafeLink(linkUrl)) {
            return res.status(400).json({ message: LINK_ERROR });
        }

        const layout = req.body.layout !== undefined
            ? (PROMO_LAYOUTS.includes(req.body.layout)
                ? req.body.layout : "image")
            : current.layout;
        // Switching away from row_tile clears the pin, so an old category
        // cannot linger on a row that no longer renders in a rail.
        const sentCategory = parseInt(req.body.category_id, 10);
        const categoryId = layout !== "row_tile"
            ? null
            : (req.body.category_id !== undefined
                ? (Number.isInteger(sentCategory) ? sentCategory : null)
                : current.category_id);
        const headline = req.body.headline !== undefined
            ? ((req.body.headline || "").trim() || null) : current.headline;
        const subtext = req.body.subtext !== undefined
            ? ((req.body.subtext || "").trim() || null) : current.subtext;
        const ctaLabel = req.body.cta_label !== undefined
            ? ((req.body.cta_label || "").trim() || null) : current.cta_label;
        const bgColor = /^#[0-9a-fA-F]{3,8}$/.test((req.body.bg_color || "").trim())
            ? req.body.bg_color.trim() : current.bg_color;
        // An empty string sent deliberately clears the override back to auto;
        // the field being absent leaves whatever is already stored.
        const textColor = req.body.text_color !== undefined
            ? (/^#[0-9a-fA-F]{3,8}$/.test((req.body.text_color || "").trim())
                ? req.body.text_color.trim() : null)
            : current.text_color;

        if ((layout === "text" || layout === "strip_text") && !headline) {
            return res.status(400).json({ message: "A text promotion needs a headline." });
        }
        if (layout === "strip_link" && !linkUrl) {
            return res.status(400).json({ message: "A strip link needs a link URL." });
        }
        if (layout === "row_tile" && !categoryId) {
            return res.status(400).json({ message: "A row tile needs a category." });
        }

        let imageUrl = current.image_url;
        let videoUrl = current.video_url;
        let posterUrl = current.poster_url;
        let mediaType = current.media_type || "image";

        if (req.file) {
            const isVideo = /^video\//i.test(req.file.mimetype || "");
            if (isVideo && layout !== "row_tile") {
                return res.status(400).json({
                    message: "Only a category row tile can use a video."
                });
            }
            const uploaded = await uploadBufferToCloudinary(
                req.file.buffer, isVideo ? "video" : "image");
            mediaType = isVideo ? "video" : "image";
            // Swapping one kind for the other clears the old source, so a
            // leftover image cannot outrank the new video in the renderer.
            imageUrl = isVideo ? null : uploaded.url;
            videoUrl = isVideo ? uploaded.url : null;
            posterUrl = isVideo ? uploaded.poster : null;
        }

        // Moving a tile off row_tile takes its video with it: no other layout
        // knows how to play one, and the check constraint would reject a
        // video row with no source anyway.
        if (mediaType === "video" && layout !== "row_tile") {
            mediaType = "image";
            videoUrl = null;
            posterUrl = null;
        }

        const result = await pool.query(
            `UPDATE promotions
             SET image_url = $1, link_url = $2, title = $3, slot = $4, display_order = $5,
                     headline = $7, subtext = $8, cta_label = $9,
                     bg_color = $10, layout = $11, text_color = $12,
                     category_id = $13, media_type = $14, video_url = $15,
                     poster_url = $16
             WHERE id = $6
             RETURNING id, image_url, link_url, title, slot, display_order, is_active,
                       headline, subtext, cta_label, bg_color, text_color, layout,
                       category_id, media_type, video_url, poster_url`,
            [imageUrl, linkUrl, title, slot, displayOrder, id,
                headline, subtext, ctaLabel, bgColor, layout, textColor, categoryId,
                mediaType, videoUrl, posterUrl]
        );

        await logActivity(req.user.id, "update_promotion", "promotion", id, "Updated promotion");
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Update promotion error:", error);
        res.status(500).json({ message: "Failed to update promotion" });
    }
};

exports.setPromotionStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const isActive = req.body.is_active === true || req.body.is_active === "true";

        const result = await pool.query(
            "UPDATE promotions SET is_active = $1 WHERE id = $2 RETURNING id, is_active",
            [isActive, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Promotion not found" });
        }

        await logActivity(req.user.id, isActive ? "restore_promotion" : "hide_promotion",
            "promotion", id, `${isActive ? "Showed" : "Hid"} promotion`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Set promotion status error:", error);
        res.status(500).json({ message: "Failed to update status" });
    }
};

exports.deletePromotion = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query("DELETE FROM promotions WHERE id = $1 RETURNING id", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Promotion not found" });
        }

        await logActivity(req.user.id, "delete_promotion", "promotion", id, "Deleted promotion");
        res.json({ message: "Promotion deleted" });
    } catch (error) {
        console.error("Delete promotion error:", error);
        res.status(500).json({ message: "Failed to delete promotion" });
    }
};
