// Slot 3 is the announcement strip. strip_text scrolls and carries no link;
// strip_link is a static tile. Kept in sync with migration 034's constraints.
const PROMO_SLOTS = [1, 2, 3];
const PROMO_LAYOUTS = ["image", "text", "strip_text", "strip_link"];

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

function uploadBufferToCloudinary(fileBuffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "lizimas-store/promotions" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
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
                    headline, subtext, cta_label, bg_color, text_color, layout
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
                    headline, subtext, cta_label, bg_color, text_color, layout
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
        if (!req.file) {
            return res.status(400).json({ message: "An image is required" });
        }

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

        const imageUrl = req.file
            ? await uploadBufferToCloudinary(req.file.buffer)
            : null;

        const result = await pool.query(
            `INSERT INTO promotions (image_url, link_url, title, slot, display_order,
                                     headline, subtext, cta_label, bg_color, layout,
                                     text_color)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, image_url, link_url, title, slot, display_order, is_active,
                       headline, subtext, cta_label, bg_color, text_color, layout`,
            [imageUrl, linkUrl, title, slot, displayOrder,
                headline, subtext, ctaLabel, bgColor, layout, textColor]
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

        let imageUrl = current.image_url;
        if (req.file) imageUrl = await uploadBufferToCloudinary(req.file.buffer);

        const result = await pool.query(
            `UPDATE promotions
             SET image_url = $1, link_url = $2, title = $3, slot = $4, display_order = $5,
                     headline = $7, subtext = $8, cta_label = $9,
                     bg_color = $10, layout = $11, text_color = $12
             WHERE id = $6
             RETURNING id, image_url, link_url, title, slot, display_order, is_active,
                       headline, subtext, cta_label, bg_color, text_color, layout`,
            [imageUrl, linkUrl, title, slot, displayOrder, id,
                headline, subtext, ctaLabel, bgColor, layout, textColor]
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
