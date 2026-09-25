// Admin Discount Promotions (migration 132, Ryan Sept 2026).
// Percent-only discounts on many products at once; see utils/productDiscounts.js.
const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { discountedPrice, resolvePercent } = require("../utils/productDiscounts");

function statusOf(row) {
    const now = Date.now();
    if (!row.is_active) return "ended";
    if (row.ends_at && new Date(row.ends_at).getTime() <= now) return "expired";
    if (new Date(row.starts_at).getTime() > now) return "scheduled";
    return "running";
}

function shape(row) {
    const price = Number(row.price);
    const percent = Number(row.percent);
    return {
        id: row.id,
        product_id: row.product_id,
        name: row.name,
        sku: row.sku,
        image: row.image,
        vendor: row.vendor_name || "Lizimas",
        price,
        percent,
        sale_price: discountedPrice(price, percent),
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        label: row.label,
        status: statusOf(row),
        overridden_by: row.flash_price != null ? "flash sale" : row.promo_price != null ? "vendor promotion" : null,
        created_at: row.created_at
    };
}

const OVERRIDE_SQL = `
    (SELECT fsi.sale_price FROM flash_sale_items fsi JOIN flash_sales fs ON fs.id = fsi.flash_sale_id
      WHERE fsi.product_id = p.id AND fs.is_active = true AND fs.ends_at >= now()
        AND (fs.starts_at IS NULL OR fs.starts_at <= now()) LIMIT 1) AS flash_price,
    (SELECT vp.proposed_sale_price FROM vendor_promotions vp
      WHERE vp.product_id = p.id AND vp.status = 'approved'
        AND vp.starts_at <= now() AND vp.ends_at >= now() LIMIT 1) AS promo_price`;

// GET /api/admin/product-discounts?show=current|ended
exports.listProductDiscounts = async (req, res) => {
    try {
        const ended = req.query.show === "ended";
        const r = await pool.query(
            `SELECT d.*, p.name, p.sku, p.price, p.image, v.business_name AS vendor_name, ${OVERRIDE_SQL}
             FROM product_discounts d
             JOIN products p ON p.id = d.product_id
             LEFT JOIN vendors v ON v.id = p.vendor_id
             WHERE ${ended
                ? "(d.is_active = false OR (d.ends_at IS NOT NULL AND d.ends_at <= now()))"
                : "d.is_active = true AND (d.ends_at IS NULL OR d.ends_at > now())"}
               AND p.deleted_at IS NULL
             ORDER BY ${ended ? "d.updated_at DESC" : "d.created_at DESC"}
             LIMIT 500`
        );
        res.json(r.rows.map(shape));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET /api/admin/product-discounts/products?q=  - product picker
exports.searchDiscountProducts = async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        const params = [];
        let where = "p.deleted_at IS NULL AND p.price > 0";
        if (q) {
            params.push(`%${q}%`);
            where += ` AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.brand ILIKE $1 OR v.business_name ILIKE $1 OR c.name ILIKE $1)`;
        }
        const r = await pool.query(
            `SELECT p.id, p.name, p.sku, p.price, p.image, p.status, p.is_active, c.name AS category,
                    v.business_name AS vendor_name,
                    (SELECT d.percent FROM product_discounts d
                      WHERE d.product_id = p.id AND d.is_active = true
                        AND (d.ends_at IS NULL OR d.ends_at > now()) LIMIT 1) AS current_percent,
                    ${OVERRIDE_SQL}
             FROM products p
             LEFT JOIN vendors v ON v.id = p.vendor_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE ${where}
             ORDER BY (p.status = 'approved' AND p.is_active) DESC, p.id DESC
             LIMIT 60`,
            params
        );
        res.json(r.rows.map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            price: Number(row.price),
            image: row.image,
            category: row.category,
            vendor: row.vendor_name || "Lizimas",
            live: row.status === "approved" && row.is_active,
            current_percent: row.current_percent != null ? Number(row.current_percent) : null,
            overridden_by: row.flash_price != null ? "flash sale" : row.promo_price != null ? "vendor promotion" : null
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST /api/admin/product-discounts
// { items: [{ product_id, percent } | { product_id, target_price }], starts_at?, ends_at?, label? }
// All-or-nothing: any bad row rejects the whole save with per-row errors.
exports.saveProductDiscounts = async (req, res) => {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "Pick at least one product" });
    if (items.length > 500) return res.status(400).json({ error: "At most 500 products per save" });

    const startsAt = req.body.starts_at ? new Date(req.body.starts_at) : new Date();
    const endsAt = req.body.ends_at ? new Date(req.body.ends_at) : null;
    if (isNaN(startsAt.getTime()) || (endsAt && isNaN(endsAt.getTime()))) {
        return res.status(400).json({ error: "Invalid start or end date" });
    }
    if (endsAt && endsAt <= startsAt) return res.status(400).json({ error: "End must be after start" });
    if (endsAt && endsAt <= new Date()) return res.status(400).json({ error: "End date is already in the past" });
    const label = req.body.label ? String(req.body.label).slice(0, 120) : null;

    const ids = [...new Set(items.map((i) => Number(i.product_id)).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length !== items.length) return res.status(400).json({ error: "Each product can only appear once" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const pr = await client.query("SELECT id, name, price FROM products WHERE id = ANY($1::int[]) AND deleted_at IS NULL FOR UPDATE", [ids]);
        const byId = new Map(pr.rows.map((r) => [r.id, r]));
        const errors = [];
        const resolved = items.map((it) => {
            const pid = Number(it.product_id);
            const prod = byId.get(pid);
            if (!prod) { errors.push({ product_id: pid, error: "Product not found" }); return null; }
            const out = resolvePercent(prod.price, it);
            if (out.error) { errors.push({ product_id: pid, name: prod.name, error: out.error }); return null; }
            return { pid, prod, percent: out.percent };
        });
        if (errors.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Some rows need fixing", errors });
        }
        await client.query(
            "UPDATE product_discounts SET is_active = false, updated_at = now() WHERE product_id = ANY($1::int[]) AND is_active = true",
            [ids]
        );
        const saved = [];
        for (const r of resolved) {
            const ins = await client.query(
                `INSERT INTO product_discounts (product_id, percent, starts_at, ends_at, label, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [r.pid, r.percent, startsAt, endsAt, label, req.user && req.user.userId || null]
            );
            saved.push({
                id: ins.rows[0].id, product_id: r.pid, name: r.prod.name,
                price: Number(r.prod.price), percent: r.percent,
                sale_price: discountedPrice(r.prod.price, r.percent)
            });
        }
        await client.query("COMMIT");
        await logActivity(req.user && req.user.userId, "save_product_discounts", "product_discount", null,
            `${saved.length} product(s): ` + saved.slice(0, 20).map((s) => `#${s.product_id} ${Number(s.percent.toFixed(2))}%`).join(", "));
        res.status(201).json({ saved });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// PATCH /api/admin/product-discounts/end  { ids: [..] }  - stop discounts now
exports.endProductDiscounts = async (req, res) => {
    try {
        const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : [req.params.id])
            .map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!ids.length) return res.status(400).json({ error: "Nothing to end" });
        const r = await pool.query(
            "UPDATE product_discounts SET is_active = false, updated_at = now() WHERE id = ANY($1::int[]) AND is_active = true RETURNING id, product_id",
            [ids]
        );
        await logActivity(req.user && req.user.userId, "end_product_discounts", "product_discount", null,
            `Ended ${r.rowCount}: ` + r.rows.map((x) => `#${x.product_id}`).join(", "));
        res.json({ ended: r.rowCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
