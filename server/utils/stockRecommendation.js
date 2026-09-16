// Stock Recommendation (Jumia Vendor Center comparison, Sept 2026): flags
// products likely to run out soon and suggests a reorder quantity, from
// trailing 30-day delivered sales velocity. Computed on demand, same spirit
// as vendorProductTier.js's GMV ladder - no caching, no new columns.

const pool = require("../config/database");

const VELOCITY_WINDOW_DAYS = 30;
const TARGET_COVER_DAYS = 30; // reorder up to ~30 days of cover
const REORDER_NOW_THRESHOLD_DAYS = 7;
const REORDER_SOON_THRESHOLD_DAYS = 14;

// Pure math, kept separate from the DB call above it so it can be unit
// tested without a database connection (see test/stockRecommendation.test.js).
function computeStockRecommendation({ stock, unitsSoldWindow }) {
    stock = Number(stock) || 0;
    unitsSoldWindow = Number(unitsSoldWindow) || 0;
    const dailyVelocity = unitsSoldWindow / VELOCITY_WINDOW_DAYS;
    const daysOfStockRemaining = dailyVelocity > 0 ? stock / dailyVelocity : (stock > 0 ? null : 0);

    let urgency = "ok";
    if (dailyVelocity > 0 && daysOfStockRemaining !== null) {
        if (daysOfStockRemaining <= REORDER_NOW_THRESHOLD_DAYS) urgency = "reorder_now";
        else if (daysOfStockRemaining <= REORDER_SOON_THRESHOLD_DAYS) urgency = "reorder_soon";
    } else if (dailyVelocity === 0 && stock <= 0) {
        urgency = "no_recent_sales";
    }

    const targetStock = Math.ceil(dailyVelocity * TARGET_COVER_DAYS);
    const recommendedReorderQty = urgency === "reorder_now" || urgency === "reorder_soon"
        ? Math.max(targetStock - stock, 0)
        : 0;

    return {
        stock,
        unitsSoldWindow,
        dailyVelocity: Math.round(dailyVelocity * 100) / 100,
        daysOfStockRemaining: daysOfStockRemaining === null ? null : Math.round(daysOfStockRemaining),
        urgency,
        recommendedReorderQty
    };
}

async function getVendorStockRecommendations(vendorId) {
    const { rows } = await pool.query(
        `SELECT p.id, p.name, p.sku, p.stock,
                COALESCE(SUM(oi.quantity) FILTER (
                    WHERE o.status = 'delivered' AND o.created_at >= now() - INTERVAL '${VELOCITY_WINDOW_DAYS} days'
                ), 0) AS units_sold_window
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON o.id = oi.order_id
         WHERE p.vendor_id = $1 AND p.deleted_at IS NULL
         GROUP BY p.id, p.name, p.sku, p.stock
         ORDER BY p.name ASC`,
        [vendorId]
    );

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        ...computeStockRecommendation({ stock: row.stock, unitsSoldWindow: row.units_sold_window })
    }));
}

module.exports = {
    getVendorStockRecommendations,
    computeStockRecommendation,
    VELOCITY_WINDOW_DAYS,
    TARGET_COVER_DAYS
};
