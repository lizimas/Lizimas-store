// Advertise Your Products (Jumia Vendor Center comparison, Sept 2026) -
// public read/tracking API for sponsored products. See migrations/
// 112_vendor_ad_campaigns.sql's header. GET /sponsored-products backs the
// homepage "Sponsored" row (client/js/products.js's loadSponsoredRow, see
// client/index.html's #ls-sponsored) - the storefront ad-slot injection
// that migration deliberately left as a follow-up. Ad-campaign products
// are also folded into the regular is_sponsored ranking on the main
// catalogue and vendor storefront pages (see productController.js's
// getProducts and vendorController.js's getPublicStorefront) via the same
// vendor_ad_campaign_products/vendor_ad_campaigns tables - this file is
// specifically the dedicated "Sponsored" showcase row's data source.

const pool = require("../config/database");

// Random selection among currently-active, unexhausted campaigns' products,
// shaped exactly like a card in buildProductCard()/stBuildProductCard() so
// the storefront can drop these straight into the same card renderer as
// everything else - same is_sponsored badge, same "Sponsored" label, plus
// ad_sponsored so a click fires the CPC billing beacon (POST /track-click)
// that a vendor_promotions-sponsored card does not. Excludes products
// whose vendor currently has their shop deactivated or on Holiday Mode,
// same rule the public catalogue applies. Each returned product gets one
// impression logged immediately.
exports.getSponsoredProducts = async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 10, 30);

        const { rows: candidates } = await pool.query(
            `SELECT p.id, p.name, p.sku, p.price, p.stock,
                    COALESCE(
                      (SELECT pi.image_path FROM product_images pi
                       WHERE pi.product_id = p.id
                       ORDER BY COALESCE(pi.display_order, 999999) ASC, pi.id ASC
                       LIMIT 1),
                      p.image
                    ) AS card_image,
                    (SELECT pi.image_path FROM product_images pi
                     WHERE pi.product_id = p.id
                     ORDER BY COALESCE(pi.display_order, 999999) ASC, pi.id ASC
                     OFFSET 1 LIMIT 1
                    ) AS hover_image,
                    cp.id AS campaign_product_id
             FROM vendor_ad_campaign_products cp
             JOIN vendor_ad_campaigns c ON c.id = cp.campaign_id
             JOIN products p ON p.id = cp.product_id
             LEFT JOIN vendors v ON v.id = p.vendor_id
             WHERE c.status = 'active'
               AND c.budget_spent < c.total_budget
               AND (c.start_date IS NULL OR c.start_date <= CURRENT_DATE)
               AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
               AND p.deleted_at IS NULL AND p.status = 'approved' AND p.is_active = true AND p.admin_restricted = false
               AND (p.vendor_id IS NULL OR (
                    v.shop_active = true
                    AND (v.holiday_mode_active = false
                         OR CURRENT_DATE < v.holiday_mode_start_date
                         OR CURRENT_DATE > v.holiday_mode_end_date)
               ))
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
            id: c.id,
            name: c.name,
            sku: c.sku,
            price: c.price,
            stock: c.stock,
            card_image: c.card_image,
            image: c.card_image,
            hover_image: c.hover_image || undefined,
            is_sponsored: true,
            ad_sponsored: true
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A click on a sponsored product: logs it, charges the campaign cpc_rate,
// and auto-pauses the campaign the moment its budget is exhausted. Called
// from the storefront (buildProductCard()/stBuildProductCard()'s onclick)
// only for a card carrying ad_sponsored: true - a plain vendor_promotions
// "sponsored" card never fires this, since that mechanism isn't CPC-billed.
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
