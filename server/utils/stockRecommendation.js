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

// Fulfilment-view figures for the Jumia-style Stock Recommendation page
// (Sept 2026). "Available" is everything sellable right now - the vendor's
// own stock plus units Lizimas holds for them at a hub (consigned_stock).
// "In transit" is units on consignment orders that are still open
// (requested or shipped, not yet counted in). Target stock is ~30 days of
// cover at the trailing sales rate; the suggested replenish quantity is
// Target - Available - In transit (never negative).
//
// Status (the page's filter pills):
//   sales_issue  - the listing can't sell (not approved, restricted, or
//                  switched off) - checked first, stock is moot
//   out_of_stock - nothing available
//   low_stock    - selling and under 14 days of cover left
//   ok           - everything else
// missedUnits estimates sales lost over the next 30 days on out-of-stock
// SKUs that were selling ("Potential Missed Business").
function computeReplenishment({ stock, consignedStock, inTransit, unitsSoldWindow, sellable }) {
    const available = Math.max(0, Number(stock) || 0) + Math.max(0, Number(consignedStock) || 0);
    inTransit = Math.max(0, Number(inTransit) || 0);
    unitsSoldWindow = Math.max(0, Number(unitsSoldWindow) || 0);
    const dailyVelocity = unitsSoldWindow / VELOCITY_WINDOW_DAYS;
    const targetStock = Math.ceil(dailyVelocity * TARGET_COVER_DAYS);
    const suggestedQty = Math.max(targetStock - available - inTransit, 0);
    const daysOfCover = dailyVelocity > 0 ? Math.round(available / dailyVelocity) : null;

    let status = "ok";
    if (!sellable) status = "sales_issue";
    else if (available <= 0) status = "out_of_stock";
    else if (dailyVelocity > 0 && daysOfCover !== null && daysOfCover <= REORDER_SOON_THRESHOLD_DAYS) status = "low_stock";

    const missedUnits = available <= 0 ? Math.round(dailyVelocity * TARGET_COVER_DAYS) : 0;
    return { available, inTransit, unitsSoldWindow, targetStock, suggestedQty, daysOfCover, status, missedUnits };
}

function summarizeReplenishment(rows) {
    const summary = { potentialMissed: 0, totalSkus: rows.length, inTransit: 0, available: 0, suggestedQty: 0 };
    const counts = { all: rows.length, ok: 0, out_of_stock: 0, low_stock: 0, sales_issue: 0 };
    for (const r of rows) {
        summary.potentialMissed += r.missedUnits;
        summary.inTransit += r.inTransit;
        summary.available += r.available;
        summary.suggestedQty += r.suggestedQty;
        counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return { summary, counts };
}

async function getVendorStockOverview(vendorId) {
    const { rows } = await pool.query(
        `SELECT p.id, p.name, p.sku, p.lizimas_sku, p.stock, p.consigned_stock, p.fulfillment_type, p.image,
                p.status, COALESCE(p.admin_restricted, false) AS admin_restricted, COALESCE(p.is_active, true) AS is_active,
                COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                          WHERE oi.product_id = p.id AND o.status = 'delivered'
                            AND o.created_at >= now() - INTERVAL '${VELOCITY_WINDOW_DAYS} days'), 0) AS units_sold_window,
                COALESCE((SELECT SUM(ci.quantity_requested) FROM vendor_consignment_items ci
                          JOIN vendor_consignments c ON c.id = ci.consignment_id
                          WHERE ci.product_id = p.id AND c.status IN ('requested', 'in_transit')), 0) AS in_transit
         FROM products p
         WHERE p.vendor_id = $1 AND p.deleted_at IS NULL
         ORDER BY p.name ASC`,
        [vendorId]
    );
    const items = rows.map((row) => ({
        id: row.id,
        name: row.name,
        sku: row.sku,
        lizimasSku: row.lizimas_sku || null,
        image: row.image,
        fulfillmentType: row.fulfillment_type,
        ...computeReplenishment({
            stock: row.stock,
            consignedStock: row.consigned_stock,
            inTransit: row.in_transit,
            unitsSoldWindow: row.units_sold_window,
            sellable: row.status === "approved" && !row.admin_restricted && row.is_active
        })
    }));
    return { items, ...summarizeReplenishment(items) };
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
    getVendorStockOverview,
    computeReplenishment,
    summarizeReplenishment,
    computeStockRecommendation,
    VELOCITY_WINDOW_DAYS,
    TARGET_COVER_DAYS
};
