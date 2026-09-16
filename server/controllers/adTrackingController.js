// Advertise Your Products (Jumia Vendor Center comparison, Sept 2026) -
// public read/tracking API for sponsored products. See migrations/
// 112_vendor_ad_campaigns.sql's header: this is the API layer the
// storefront can call whenever sponsored-slot injection is built - it is
// not wired into any storefront page yet.

const pool = require("../config/database");

// Random selection among currently-active, unexhausted campaigns' products.
// Each returned product gets one impression logged immediately.
exports.getSponsoredProducts = async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 10, 30);

        const { rows: candidates } = await pool.query(
            `SELECT cp.id AS campaign_product_id, cp.product_id, p.name, p.sku, p.price
             FROM vendor_ad_campaign_products cp
             JOIN vendor_ad_campaigns c ON c.id = cp.campaign_id
             JOIN products p ON p.id = cp.product_id
             WHERE c.status = 'active'
               AND c.budget_spent < c.total_budget
               AND (c.start_date IS NULL OR c.start_date <= CURRENT_DATE)
               AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
               AND p.deleted_at IS NULL AND p.status = 'approved' AND p.is_active = true AND p.admin_restricted = false
             ORDER BY random()
             LIMIT $1`,
            [limit]
        );

        if (candidates.length > 0) {
            const ids = candidates.map((c) => c.campaign_product_id);
            pool.query(
                `UPDATE vendor_ad_campaign_products SET impressions = impressions + 1 WHERE id = ANY($1::int[])`,
                [ids]
            ).catch(() => {});
        }

        res.json(candidates.map((c) => ({
            productId: c.product_id, name: c.name, sku: c.sku, price: c.price, sponsored: true
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A click on a sponsored product: logs it, charges the campaign cpc_rate,
// and auto-pauses the campaign the moment its budget is exhausted.
exports.trackAdClick = async (req, res) => {
    try {
        const { productId } = req.body;
        if (!productId) return res.status(400).json({ error: "productId is required." });

        const { rows } = await pool.query(
            `SELECT cp.id AS campaign_product_id, c.id AS campaign_id, c.cpc_rate, c.budget_spent, c.total_budget
             FROM vendor_ad_campaign_products cp
             JOIN vendor_ad_campaigns c ON c.id = cp.campaign_id
             WHERE cp.product_id = $1 AND c.status = 'active' AND c.budget_spent < c.total_budget
             ORDER BY c.created_at ASC
             LIMIT 1`,
            [productId]
        );
        if (rows.length === 0) return res.json({ tracked: false });

        const row = rows[0];
        const newSpent = Number(row.budget_spent) + Number(row.cpc_rate);
        const exhausted = newSpent >= Number(row.total_budget);

        await pool.query(
            `UPDATE vendor_ad_campaign_products SET clicks = clicks + 1 WHERE id = $1`,
            [row.campaign_product_id]
        );
        await pool.query(
            `UPDATE vendor_ad_campaigns SET budget_spent = $1, status = $2, updated_at = now() WHERE id = $3`,
            [newSpent, exhausted ? "budget_exhausted" : "active", row.campaign_id]
        );

        res.json({ tracked: true, budgetExhausted: exhausted });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
