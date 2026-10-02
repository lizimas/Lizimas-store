// Vendor Center home page (Ryan, Oct 2026): the Business metrics boxes with
// their 7 / 30 / 90 days switch. Revenue and items sold are compared with the
// period just before, and the daily revenue feeds the small chart.
const pool = require("../config/database");
const { pendingOrderStatus } = require("../utils/vendorHold");

const RANGES = [7, 30, 90];
function rangeDays(value) {
    const n = Number(value);
    return RANGES.includes(n) ? n : 7;
}
// -> percentage change, null when there is nothing to compare with.
function changePct(now, before) {
    now = Number(now) || 0; before = Number(before) || 0;
    if (!before) return null;
    return Math.round((now - before) / before * 1000) / 10;
}

// GET /api/vendors/me/business-metrics?days=7|30|90
exports.getBusinessMetrics = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });
        const days = rangeDays(req.query.days);
        const [totals, daily, live] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE o.created_at >= now() - ($2 || ' days')::interval), 0)::numeric AS revenue,
                        COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE o.created_at < now() - ($2 || ' days')::interval), 0)::numeric AS revenue_before,
                        COALESCE(SUM(oi.quantity) FILTER (WHERE o.created_at >= now() - ($2 || ' days')::interval), 0)::int AS items,
                        COALESCE(SUM(oi.quantity) FILTER (WHERE o.created_at < now() - ($2 || ' days')::interval), 0)::int AS items_before,
                        COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= now() - ($2 || ' days')::interval)::int AS orders
                   FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                  WHERE p.vendor_id = $1 AND o.status <> 'cancelled' AND o.created_at >= now() - ($3 || ' days')::interval`,
                [vendorId, String(days), String(days * 2)]),
            pool.query(
                `SELECT o.created_at::date AS day, COALESCE(SUM(oi.price * oi.quantity), 0)::numeric AS revenue
                   FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                  WHERE p.vendor_id = $1 AND o.status <> 'cancelled' AND o.created_at >= now() - ($2 || ' days')::interval
                  GROUP BY o.created_at::date ORDER BY day ASC`,
                [vendorId, String(days)]),
            pool.query(
                `SELECT COUNT(*) FILTER (WHERE status = 'approved' AND is_active = true AND admin_restricted = false)::int AS live,
                        COUNT(*) FILTER (WHERE status = 'approved' AND is_active = true AND admin_restricted = false
                                          AND created_at < now() - ($2 || ' days')::interval)::int AS live_before,
                        COUNT(*)::int AS total
                   FROM products WHERE vendor_id = $1 AND deleted_at IS NULL`,
                [vendorId, String(days)])
        ]);
        // Order limit: at the limit the shop's products are off the store until an order is handed over.
        let orderLimit = null;
        try { orderLimit = await pendingOrderStatus(pool, vendorId); } catch (e) { console.warn("Order limit:", e.message); }
        const t = totals.rows[0], l = live.rows[0];
        res.json({
            days,
            revenue: Number(t.revenue), revenue_change: changePct(t.revenue, t.revenue_before),
            items_sold: t.items, items_change: changePct(t.items, t.items_before),
            orders: t.orders,
            live: l.live, live_change: changePct(l.live, l.live_before), total_products: l.total,
            order_limit: orderLimit,
            daily: daily.rows.map((r) => ({ day: r.day, revenue: Number(r.revenue) }))
        });
    } catch (error) {
        console.error("getBusinessMetrics error:", error.message);
        res.status(500).json({ error: "Could not load the business metrics." });
    }
};
exports.rangeDays = rangeDays;
exports.changePct = changePct;
