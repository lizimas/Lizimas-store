// Admin percent discounts (migration 132, Ryan Sept 2026).
//
// Only the percent is stored. The sale price is always
//   round(current price x (1 - percent / 100))
// so changing a product's price keeps the same percent off.
// An admin can type the price they want instead; percentForTargetPrice turns
// that into the percent (6 decimals, so the typed price comes back exactly).
//
// Priority at checkout and on product pages: a running flash sale, then an
// approved vendor promotion, then this percent discount.

function discountedPrice(price, percent) {
    const p = Number(price);
    const pct = Number(percent);
    if (!(p > 0) || !(pct > 0) || !(pct < 100)) return Math.round(p) || 0;
    return Math.round(p * (1 - pct / 100));
}

function percentForTargetPrice(price, target) {
    const p = Number(price);
    const t = Number(target);
    if (!(p > 0) || !(t > 0) || !(t < p)) return null;
    return Math.round((1 - t / p) * 100 * 1e6) / 1e6;
}

// Validates one requested row. Returns { percent } or { error }.
function resolvePercent(price, { percent, target_price }) {
    const p = Number(price);
    if (!(p > 0)) return { error: "Product has no price" };
    if (target_price !== undefined && target_price !== null && target_price !== "") {
        const pct = percentForTargetPrice(p, target_price);
        if (pct === null) return { error: `Final price must be above 0 and below the current price (UGX ${p.toLocaleString()})` };
        if (!(pct < 100) || !(pct > 0)) return { error: "Discount out of range" };
        return { percent: pct };
    }
    const pct = Number(percent);
    if (!(pct > 0) || !(pct < 100)) return { error: "Percent must be more than 0 and less than 100" };
    return { percent: Math.round(pct * 1e6) / 1e6 };
}

// SQL: the currently running discount for products.id, as a LATERAL join.
const ACTIVE_DISCOUNT_LATERAL = `LEFT JOIN LATERAL (
        SELECT pd_inner.percent
        FROM product_discounts pd_inner
        WHERE pd_inner.product_id = products.id
          AND pd_inner.is_active = true
          AND pd_inner.starts_at <= now()
          AND (pd_inner.ends_at IS NULL OR pd_inner.ends_at > now())
        LIMIT 1
    ) pd ON true`;

module.exports = { discountedPrice, percentForTargetPrice, resolvePercent, ACTIVE_DISCOUNT_LATERAL };
