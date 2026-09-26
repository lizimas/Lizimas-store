const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { rollForwardDue } = require("../utils/flashSaleRecurrence");

// Optional auto-rerun period in hours (migration 136). Blank = no rerun.
function parseRecurs(raw) {
    if (raw === undefined || raw === null || raw === "") return { value: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 8760) return { error: "Auto-rerun must be a whole number of hours between 1 and 8760, or left blank." };
    return { value: n };
}

// Shared shape for a validated item coming from the admin form: a product id
// plus the special price it sells for during the campaign.
function parseItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error("At least one product is required.");
    }
    const seen = new Set();
    return rawItems.map((raw, index) => {
        const productId = parseInt(raw.product_id, 10);
        const salePrice = Number(raw.sale_price);
        if (!Number.isInteger(productId) || productId <= 0) {
            throw new Error(`Item ${index + 1}: a product must be selected.`);
        }
        if (!Number.isFinite(salePrice) || salePrice < 0) {
            throw new Error(`Item ${index + 1}: sale price must be zero or more.`);
        }
        // The DB's unique constraint would catch this too, but as a generic
        // 500 rather than a message the admin can act on.
        if (seen.has(productId)) {
            throw new Error(`Item ${index + 1}: that product is already in this campaign.`);
        }
        seen.add(productId);
        return { productId, salePrice, displayOrder: index };
    });
}

// Admin: every campaign, newest first, with a quick item count so the list
// view doesn't need a second round trip per row.
exports.listFlashSales = async (req, res) => {
    try {
        await rollForwardDue(pool).catch(() => {});
        const result = await pool.query(
            `SELECT fs.id, fs.title, fs.subtitle, fs.starts_at, fs.ends_at, fs.is_active, fs.created_at,
                    fs.recurs_every_hours, fs.share_token,
                    COUNT(fsi.id)::int AS item_count
             FROM flash_sales fs
             LEFT JOIN flash_sale_items fsi ON fsi.flash_sale_id = fs.id
             GROUP BY fs.id
             ORDER BY fs.created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List flash sales error:", error);
        res.status(500).json({ error: "Failed to load flash sales." });
    }
};

// Admin: one campaign with its items joined to product info, for the edit form.
exports.getFlashSale = async (req, res) => {
    try {
        const { id } = req.params;
        const sale = await pool.query(
            "SELECT id, title, subtitle, starts_at, ends_at, is_active, created_at, recurs_every_hours, share_token FROM flash_sales WHERE id = $1",
            [id]
        );
        if (sale.rows.length === 0) {
            return res.status(404).json({ error: "Flash sale not found." });
        }
        const items = await pool.query(
            `SELECT fsi.id, fsi.product_id, fsi.sale_price, fsi.display_order,
                    p.name, p.price AS original_price, p.image
             FROM flash_sale_items fsi
             JOIN products p ON p.id = fsi.product_id
             WHERE fsi.flash_sale_id = $1
             ORDER BY fsi.display_order ASC, fsi.id ASC`,
            [id]
        );
        res.json({ ...sale.rows[0], items: items.rows });
    } catch (error) {
        console.error("Get flash sale error:", error);
        res.status(500).json({ error: "Failed to load flash sale." });
    }
};

exports.createFlashSale = async (req, res) => {
    const client = await pool.connect();
    try {
        const title = (req.body.title || "").trim();
        const subtitle = (req.body.subtitle || "").trim() || null;
        const startsAt = req.body.starts_at || null;
        const endsAt = req.body.ends_at || null;

        if (!title) {
            return res.status(400).json({ error: "A title is required." });
        }
        if (!endsAt) {
            return res.status(400).json({ error: "An end time is required to drive the countdown." });
        }
        const recurs = parseRecurs(req.body.recurs_every_hours);
        if (recurs.error) return res.status(400).json({ error: recurs.error });

        let items;
        try {
            items = parseItems(req.body.items);
        } catch (validationError) {
            return res.status(400).json({ error: validationError.message });
        }

        await client.query("BEGIN");

        const saleResult = await client.query(
            `INSERT INTO flash_sales (title, subtitle, starts_at, ends_at, created_by, recurs_every_hours)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, subtitle, starts_at, ends_at, is_active, created_at, recurs_every_hours, share_token`,
            [title, subtitle, startsAt, endsAt, req.user.userId, recurs.value]
        );
        const sale = saleResult.rows[0];

        for (const item of items) {
            const product = await client.query(
                "SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL",
                [item.productId]
            );
            if (product.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: `Product ${item.productId} not found.` });
            }
            await client.query(
                `INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_price, display_order)
                 VALUES ($1, $2, $3, $4)`,
                [sale.id, item.productId, item.salePrice, item.displayOrder]
            );
        }

        await client.query("COMMIT");
        await logActivity(req.user.userId, "create_flash_sale", "flash_sale", sale.id, `Created "${title}"`);
        res.status(201).json(sale);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Create flash sale error:", error);
        res.status(500).json({ error: "Failed to create flash sale." });
    } finally {
        client.release();
    }
};

// Replaces the campaign's fields and its full item list in one go - simpler
// and less error-prone than diffing adds/removes against an editable table.
exports.updateFlashSale = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const title = (req.body.title || "").trim();
        const subtitle = (req.body.subtitle || "").trim() || null;
        const startsAt = req.body.starts_at || null;
        const endsAt = req.body.ends_at || null;

        if (!title) {
            return res.status(400).json({ error: "A title is required." });
        }
        if (!endsAt) {
            return res.status(400).json({ error: "An end time is required to drive the countdown." });
        }
        const recurs = parseRecurs(req.body.recurs_every_hours);
        if (recurs.error) return res.status(400).json({ error: recurs.error });

        let items;
        try {
            items = parseItems(req.body.items);
        } catch (validationError) {
            return res.status(400).json({ error: validationError.message });
        }

        await client.query("BEGIN");

        const existing = await client.query("SELECT id FROM flash_sales WHERE id = $1", [id]);
        if (existing.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Flash sale not found." });
        }

        const saleResult = await client.query(
            `UPDATE flash_sales SET title = $1, subtitle = $2, starts_at = $3, ends_at = $4, recurs_every_hours = $6
             WHERE id = $5
             RETURNING id, title, subtitle, starts_at, ends_at, is_active, created_at, recurs_every_hours, share_token`,
            [title, subtitle, startsAt, endsAt, id, recurs.value]
        );

        await client.query("DELETE FROM flash_sale_items WHERE flash_sale_id = $1", [id]);

        for (const item of items) {
            const product = await client.query(
                "SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL",
                [item.productId]
            );
            if (product.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: `Product ${item.productId} not found.` });
            }
            await client.query(
                `INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_price, display_order)
                 VALUES ($1, $2, $3, $4)`,
                [id, item.productId, item.salePrice, item.displayOrder]
            );
        }

        await client.query("COMMIT");
        await logActivity(req.user.userId, "update_flash_sale", "flash_sale", id, `Updated "${title}"`);
        res.json(saleResult.rows[0]);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Update flash sale error:", error);
        res.status(500).json({ error: "Failed to update flash sale." });
    } finally {
        client.release();
    }
};

exports.setFlashSaleActive = async (req, res) => {
    try {
        const { id } = req.params;
        const isActive = req.body.is_active === true || req.body.is_active === "true";
        const result = await pool.query(
            "UPDATE flash_sales SET is_active = $1 WHERE id = $2 RETURNING id, is_active",
            [isActive, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Flash sale not found." });
        }
        await logActivity(req.user.userId, isActive ? "restore_flash_sale" : "disable_flash_sale",
            "flash_sale", id, `${isActive ? "Enabled" : "Disabled"} flash sale`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Set flash sale active error:", error);
        res.status(500).json({ error: "Failed to update flash sale." });
    }
};

exports.deleteFlashSale = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query("DELETE FROM flash_sales WHERE id = $1 RETURNING id", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Flash sale not found." });
        }
        await logActivity(req.user.userId, "delete_flash_sale", "flash_sale", id, "Deleted flash sale");
        res.json({ message: "Flash sale deleted." });
    } catch (error) {
        console.error("Delete flash sale error:", error);
        res.status(500).json({ error: "Failed to delete flash sale." });
    }
};

// Public (no auth): the homepage countdown section. Only one campaign is
// shown at a time - the active one ending soonest - matching a single
// "Grab Or Gone!" style countdown rather than juggling several timers.
exports.getActiveFlashSalePublic = async (req, res) => {
    try {
        await rollForwardDue(pool).catch(() => {});
        const sale = await pool.query(
            `SELECT id, title, subtitle, starts_at, ends_at
             FROM flash_sales
             WHERE is_active = true
               AND ends_at >= now()
               AND (starts_at IS NULL OR starts_at <= now())
             ORDER BY ends_at ASC
             LIMIT 1`
        );
        if (sale.rows.length === 0) {
            return res.json(null);
        }

        const items = await pool.query(
            `SELECT p.id, p.name,
                    COALESCE(
                      (SELECT pi.image_path FROM product_images pi
                       WHERE pi.product_id = p.id
                       ORDER BY COALESCE(pi.display_order, 999999) ASC, pi.id ASC
                       LIMIT 1),
                      p.image
                    ) AS image,
                    fsi.sale_price, p.price AS original_price, p.stock
             FROM flash_sale_items fsi
             JOIN products p ON p.id = fsi.product_id
             WHERE fsi.flash_sale_id = $1
               AND p.deleted_at IS NULL
               AND p.status = 'approved'
             ORDER BY fsi.display_order ASC, fsi.id ASC`,
            [sale.rows[0].id]
        );

        res.json({ ...sale.rows[0], items: items.rows });
    } catch (error) {
        console.error("Get active flash sale error:", error);
        res.status(500).json({ error: "Failed to load the current flash sale." });
    }
};


// Public: a campaign opened from its share link (the link itself is only
// shown in the admin panel). Returns that campaign while it is running; a
// link to one that has ended or not started yet answers with ended/upcoming
// and no items, so the page can say so.
exports.getSharedFlashSale = async (req, res) => {
    try {
        const token = String(req.params.token || "").trim();
        if (!/^[a-z0-9]{8,32}$/i.test(token)) return res.status(404).json({ error: "This link is not valid." });
        await rollForwardDue(pool).catch(() => {});
        const sale = await pool.query(
            `SELECT id, title, subtitle, starts_at, ends_at, is_active FROM flash_sales WHERE share_token = $1`,
            [token]
        );
        const s0 = sale.rows[0];
        if (!s0) return res.status(404).json({ error: "This link is not valid." });
        const now = Date.now();
        const upcoming = s0.starts_at && new Date(s0.starts_at).getTime() > now;
        const ended = !s0.is_active || new Date(s0.ends_at).getTime() < now;
        const base = { id: s0.id, title: s0.title, subtitle: s0.subtitle, starts_at: s0.starts_at, ends_at: s0.ends_at };
        if (ended || upcoming) return res.json({ ...base, ended: !!ended, upcoming: !!upcoming && !ended, items: [] });
        const items = await pool.query(
            `SELECT p.id, p.name,
                    COALESCE(
                      (SELECT pi.image_path FROM product_images pi
                       WHERE pi.product_id = p.id
                       ORDER BY COALESCE(pi.display_order, 999999) ASC, pi.id ASC
                       LIMIT 1),
                      p.image
                    ) AS image,
                    fsi.sale_price, p.price AS original_price, p.stock
             FROM flash_sale_items fsi
             JOIN products p ON p.id = fsi.product_id
             WHERE fsi.flash_sale_id = $1
               AND p.deleted_at IS NULL
               AND p.status = 'approved'
             ORDER BY fsi.display_order ASC, fsi.id ASC`,
            [s0.id]
        );
        res.json({ ...base, items: items.rows });
    } catch (error) {
        console.error("Get shared flash sale error:", error);
        res.status(500).json({ error: "Failed to load this deal." });
    }
};
