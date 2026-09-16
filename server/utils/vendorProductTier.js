// Product-count limit tiers (Jumia Vendor Center comparison, September
// 2026 - see migrations/109_vendor_product_tiers.sql's header for the full
// design). Computed on demand, same spirit as sellerScore.js - no caching
// or background job until that becomes a real load problem.

const pool = require("../config/database");

// Trailing 90-day delivered GMV for one vendor - same order_items/orders/
// products join pattern vendorController.js's getVendorDashboardSummary
// already uses for earnings.
async function getVendorGmv90d(vendorId) {
    const { rows } = await pool.query(
        `SELECT COALESCE(SUM(oi.price * oi.quantity), 0) AS gmv
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         WHERE p.vendor_id = $1 AND o.status = 'delivered' AND o.created_at >= now() - INTERVAL '90 days'`,
        [vendorId]
    );
    return Number(rows[0].gmv) || 0;
}

// The vendor's effective tier row: product_tier_override if the admin set
// one, otherwise the highest tier whose min_gmv_90d is at or below the
// vendor's own trailing GMV.
async function resolveVendorTier(vendorId) {
    const vendorRow = await pool.query("SELECT product_tier_override FROM vendors WHERE id = $1", [vendorId]);
    if (vendorRow.rows.length === 0) return null;

    const overrideCode = vendorRow.rows[0].product_tier_override;
    if (overrideCode) {
        const tierRow = await pool.query("SELECT * FROM vendor_product_tiers WHERE tier_code = $1", [overrideCode]);
        if (tierRow.rows.length > 0) return tierRow.rows[0];
        // Override points at a tier that no longer exists - fall through to the GMV ladder.
    }

    const gmv = await getVendorGmv90d(vendorId);
    const tierRow = await pool.query(
        `SELECT * FROM vendor_product_tiers WHERE min_gmv_90d <= $1 ORDER BY min_gmv_90d DESC LIMIT 1`,
        [gmv]
    );
    return tierRow.rows.length > 0 ? tierRow.rows[0] : null;
}

// Full picture for the vendor-facing UI and for the addProduct enforcement
// check: their tier, its cap, how many listings they already have, and how
// many more they can add (null = unlimited).
async function getVendorProductLimitStatus(vendorId) {
    const tier = await resolveVendorTier(vendorId);
    const countRow = await pool.query(
        "SELECT COUNT(*)::int AS n FROM products WHERE vendor_id = $1 AND deleted_at IS NULL",
        [vendorId]
    );
    const currentCount = countRow.rows[0].n;
    const maxAllowed = tier ? tier.max_active_products : null;
    const remaining = maxAllowed === null ? null : Math.max(0, maxAllowed - currentCount);

    return {
        tier: tier ? { code: tier.tier_code, name: tier.tier_name, minGmv90d: Number(tier.min_gmv_90d), maxActiveProducts: maxAllowed } : null,
        currentCount,
        maxAllowed,
        remaining,
        atLimit: maxAllowed !== null && currentCount >= maxAllowed
    };
}

module.exports = { getVendorGmv90d, resolveVendorTier, getVendorProductLimitStatus };
