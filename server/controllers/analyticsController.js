const pool = require("../config/database");

// ---------------------------------------------------------------------------
// Shared date-range helpers. Every endpoint below accepts either an explicit
// ?start=&end= (ISO strings, used by the admin date-range picker's custom
// range) or a ?period= preset (used by the Weekly/Monthly/Annual toggle on
// the performance-report tables). Falls back to "last 30 days" so a bare
// request from a fresh page load still returns something sensible.
const PERIOD_DAYS = { week: 7, month: 30, year: 365 };

function resolveRange(req) {
    const { start, end, period } = req.query;
    const now = new Date();

    if (start && end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
            // Treat the end date as inclusive of its whole day when it arrives
            // as a bare "YYYY-MM-DD" (the calendar picker sends dates, not
            // instants), matching how Cloudflare's range picker behaves.
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(end))) {
                endDate.setHours(23, 59, 59, 999);
            }
            return { startDate, endDate };
        }
    }

    const days = PERIOD_DAYS[period] || 30;
    const endDate = now;
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}

// Regex used everywhere a page_visited path needs to resolve to a product id.
// Canonical product URLs are /product/<slugified-name>-<id>, and a bare
// /product/<id> 301-redirects to that form, so both shapes end in the id.
const PRODUCT_ID_FROM_PATH_SQL = `(regexp_match(split_part(page_visited, '?', 1), '(\\d+)$'))[1]::int`;

// ---------------------------------------------------------------------------
// Public: POST /api/track/cart-add
// Fired from cart.js addToCart() on every "add to cart" / quick-add click.
// The cart itself stays entirely client-side (localStorage) - this is only
// a fire-and-forget analytics beacon, so it must never block or fail the
// actual add-to-cart action the shopper is doing.
exports.trackCartAdd = async (req, res) => {
    try {
        const productId = parseInt(req.body.product_id, 10);
        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ error: "A valid product_id is required." });
        }

        const ip = req.headers["cf-connecting-ip"] || req.ip || null;
        let userId = null;
        const authHeader = req.headers["authorization"];
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const jwt = require("jsonwebtoken");
                const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
                userId = decoded.userId || decoded.id || null;
            } catch (e) {
                // Not logged in, or an expired/guest token - log the event anonymously.
            }
        }

        await pool.query(
            `INSERT INTO cart_events (product_id, user_id, ip_address) VALUES ($1, $2, $3)`,
            [productId, userId, ip]
        );
        res.json({ ok: true });
    } catch (error) {
        // A missed beacon must never surface to the shopper.
        console.error("trackCartAdd error:", error.message);
        res.json({ ok: true });
    }
};

// ---------------------------------------------------------------------------
// Admin: GET /api/admin/analytics/overview?start=&end=  (or ?period=week|month|year)
// The Cloudflare-style dashboard's headline numbers, daily time series for
// the chart, and the top-pages/countries/devices breakdown panels.
exports.getAnalyticsOverview = async (req, res) => {
    try {
        const { startDate, endDate } = resolveRange(req);

        const totalsResult = await pool.query(
            `WITH v AS (
                SELECT COUNT(*) AS total_visits, COUNT(DISTINCT ip_address) AS unique_visitors
                FROM visitor_logs WHERE visited_at >= $1 AND visited_at <= $2
             ),
             c AS (
                SELECT COUNT(*) AS cart_adds FROM cart_events
                WHERE created_at >= $1 AND created_at <= $2
             ),
             o AS (
                SELECT COUNT(*) AS orders_count,
                       COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS revenue
                FROM orders WHERE created_at >= $1 AND created_at <= $2
             )
             SELECT * FROM v, c, o`,
            [startDate, endDate]
        );

        const dailyVisitsResult = await pool.query(
            `SELECT to_char(date_trunc('day', visited_at), 'YYYY-MM-DD') AS day,
                    COUNT(*) AS visits, COUNT(DISTINCT ip_address) AS unique_visitors
             FROM visitor_logs WHERE visited_at >= $1 AND visited_at <= $2
             GROUP BY 1 ORDER BY 1`,
            [startDate, endDate]
        );

        const dailyCartAddsResult = await pool.query(
            `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*) AS cart_adds
             FROM cart_events WHERE created_at >= $1 AND created_at <= $2
             GROUP BY 1 ORDER BY 1`,
            [startDate, endDate]
        );

        const dailyOrdersResult = await pool.query(
            `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                    COUNT(*) AS orders,
                    COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS revenue
             FROM orders WHERE created_at >= $1 AND created_at <= $2
             GROUP BY 1 ORDER BY 1`,
            [startDate, endDate]
        );

        // Merge the three daily series into one row per day so the chart can
        // read a single array instead of joining three on the client.
        const byDay = new Map();
        const ensure = (day) => {
            if (!byDay.has(day)) {
                byDay.set(day, { day, visits: 0, uniqueVisitors: 0, cartAdds: 0, orders: 0, revenue: 0 });
            }
            return byDay.get(day);
        };
        dailyVisitsResult.rows.forEach(r => {
            const row = ensure(r.day);
            row.visits = Number(r.visits);
            row.uniqueVisitors = Number(r.unique_visitors);
        });
        dailyCartAddsResult.rows.forEach(r => { ensure(r.day).cartAdds = Number(r.cart_adds); });
        dailyOrdersResult.rows.forEach(r => {
            const row = ensure(r.day);
            row.orders = Number(r.orders);
            row.revenue = Number(r.revenue);
        });
        const dailySeries = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));

        const topPagesResult = await pool.query(
            `SELECT page_visited, COUNT(*) AS visits
             FROM visitor_logs WHERE visited_at >= $1 AND visited_at <= $2
             GROUP BY page_visited ORDER BY visits DESC LIMIT 10`,
            [startDate, endDate]
        );

        const topCountriesResult = await pool.query(
            `SELECT country, COUNT(*) AS visits
             FROM visitor_logs
             WHERE visited_at >= $1 AND visited_at <= $2 AND country IS NOT NULL
             GROUP BY country ORDER BY visits DESC LIMIT 8`,
            [startDate, endDate]
        );

        const deviceBreakdownResult = await pool.query(
            `SELECT COALESCE(NULLIF(split_part(browser, ' ', 1), ''), 'Unknown') AS browser,
                    COUNT(*) AS visits
             FROM visitor_logs WHERE visited_at >= $1 AND visited_at <= $2
             GROUP BY 1 ORDER BY visits DESC LIMIT 8`,
            [startDate, endDate]
        );

        const osBreakdownResult = await pool.query(
            `SELECT COALESCE(NULLIF(split_part(operating_system, ' ', 1), ''), 'Unknown') AS os,
                    COUNT(*) AS visits
             FROM visitor_logs WHERE visited_at >= $1 AND visited_at <= $2
             GROUP BY 1 ORDER BY visits DESC LIMIT 8`,
            [startDate, endDate]
        );

        const totals = totalsResult.rows[0];
        const totalVisits = Number(totals.total_visits);
        const ordersCount = Number(totals.orders_count);

        res.json({
            range: { start: startDate.toISOString(), end: endDate.toISOString() },
            totals: {
                totalVisits,
                uniqueVisitors: Number(totals.unique_visitors),
                cartAdds: Number(totals.cart_adds),
                ordersCount,
                revenue: Number(totals.revenue),
                conversionRate: totalVisits > 0 ? Number(((ordersCount / totalVisits) * 100).toFixed(2)) : 0
            },
            dailySeries,
            topPages: topPagesResult.rows.map(r => ({ page: r.page_visited, visits: Number(r.visits) })),
            topCountries: topCountriesResult.rows.map(r => ({ country: r.country, visits: Number(r.visits) })),
            deviceBreakdown: deviceBreakdownResult.rows.map(r => ({ browser: r.browser, visits: Number(r.visits) })),
            osBreakdown: osBreakdownResult.rows.map(r => ({ os: r.os, visits: Number(r.visits) }))
        });
    } catch (error) {
        console.error("getAnalyticsOverview error:", error);
        res.status(500).json({ error: "Failed to load analytics overview." });
    }
};

// ---------------------------------------------------------------------------
// Admin: GET /api/admin/analytics/products?start=&end=  (or ?period=)
// Per-product views (derived from visitor_logs), cart-adds, units sold and
// revenue (from paid orders) for the selected range - the "what are people
// actually browsing, clicking and buying" table.
exports.getProductAnalytics = async (req, res) => {
    try {
        const { startDate, endDate } = resolveRange(req);

        const result = await pool.query(
            `WITH views AS (
                SELECT ${PRODUCT_ID_FROM_PATH_SQL} AS product_id, COUNT(*) AS views
                FROM visitor_logs
                WHERE page_visited LIKE '/product/%'
                  AND visited_at >= $1 AND visited_at <= $2
                GROUP BY 1
             ),
             adds AS (
                SELECT product_id, COUNT(*) AS cart_adds
                FROM cart_events WHERE created_at >= $1 AND created_at <= $2
                GROUP BY product_id
             ),
             sales AS (
                SELECT oi.product_id,
                       SUM(oi.quantity) AS units_sold,
                       SUM(oi.quantity * oi.price) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                WHERE o.status = 'paid' AND o.created_at >= $1 AND o.created_at <= $2
                GROUP BY oi.product_id
             )
             SELECT p.id, p.name, p.image,
                    COALESCE(v.views, 0) AS views,
                    COALESCE(a.cart_adds, 0) AS cart_adds,
                    COALESCE(s.units_sold, 0) AS units_sold,
                    COALESCE(s.revenue, 0) AS revenue
             FROM products p
             LEFT JOIN views v ON v.product_id = p.id
             LEFT JOIN adds a ON a.product_id = p.id
             LEFT JOIN sales s ON s.product_id = p.id
             WHERE p.deleted_at IS NULL
               AND (v.views IS NOT NULL OR a.cart_adds IS NOT NULL OR s.units_sold IS NOT NULL)
             ORDER BY views DESC, cart_adds DESC
             LIMIT 200`,
            [startDate, endDate]
        );

        res.json(result.rows.map(r => {
            const views = Number(r.views);
            const cartAdds = Number(r.cart_adds);
            return {
                id: r.id,
                name: r.name,
                image: r.image,
                views,
                cartAdds,
                unitsSold: Number(r.units_sold),
                revenue: Number(r.revenue),
                viewToCartRate: views > 0 ? Number(((cartAdds / views) * 100).toFixed(2)) : 0
            };
        }));
    } catch (error) {
        console.error("getProductAnalytics error:", error);
        res.status(500).json({ error: "Failed to load product analytics." });
    }
};

// ---------------------------------------------------------------------------
// Shared by the two performance-report endpoints below: one row per product
// with its views/units-sold/revenue for the range already aggregated, so the
// vendor/staff-level GROUP BY only ever sums a single row per product and
// can't fan out (joining views/sales/orders as separate per-product-row
// tables at the vendor level would multiply totals by each other's row
// counts - this pre-aggregates per product first specifically to avoid that).
async function productMetricsForRange(startDate, endDate) {
    return pool.query(
        `SELECT p.id AS product_id, p.vendor_id, p.created_by,
                COALESCE(v.views, 0) AS views,
                COALESCE(s.units_sold, 0) AS units_sold,
                COALESCE(s.revenue, 0) AS revenue
         FROM products p
         LEFT JOIN (
             SELECT ${PRODUCT_ID_FROM_PATH_SQL} AS product_id, COUNT(*) AS views
             FROM visitor_logs
             WHERE page_visited LIKE '/product/%'
               AND visited_at >= $1 AND visited_at <= $2
             GROUP BY 1
         ) v ON v.product_id = p.id
         LEFT JOIN (
             SELECT oi.product_id,
                    SUM(oi.quantity) AS units_sold,
                    SUM(oi.quantity * oi.price) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.status = 'paid' AND o.created_at >= $1 AND o.created_at <= $2
             GROUP BY oi.product_id
         ) s ON s.product_id = p.id
         WHERE p.deleted_at IS NULL`,
        [startDate, endDate]
    );
}

// Admin: GET /api/admin/performance/vendors?period=week|month|year (or start=&end=)
exports.getVendorPerformanceReport = async (req, res) => {
    try {
        const { startDate, endDate } = resolveRange(req);

        const metricsResult = await productMetricsForRange(startDate, endDate);
        const byVendor = new Map();
        metricsResult.rows.forEach(r => {
            if (r.vendor_id == null) return;
            if (!byVendor.has(r.vendor_id)) {
                byVendor.set(r.vendor_id, { productCount: 0, views: 0, unitsSold: 0, revenue: 0 });
            }
            const agg = byVendor.get(r.vendor_id);
            agg.productCount += 1;
            agg.views += Number(r.views);
            agg.unitsSold += Number(r.units_sold);
            agg.revenue += Number(r.revenue);
        });

        // Distinct paid orders touching each vendor's products, computed
        // separately (already one row per vendor - safe to join 1-to-1).
        const ordersResult = await pool.query(
            `SELECT p.vendor_id, COUNT(DISTINCT o.id) AS orders_count
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             WHERE o.status = 'paid' AND o.created_at >= $1 AND o.created_at <= $2
               AND p.vendor_id IS NOT NULL
             GROUP BY p.vendor_id`,
            [startDate, endDate]
        );
        const ordersByVendor = new Map(ordersResult.rows.map(r => [r.vendor_id, Number(r.orders_count)]));

        const vendorsResult = await pool.query(
            `SELECT id, business_name, status FROM vendors WHERE status = 'approved' ORDER BY business_name ASC`
        );

        res.json(vendorsResult.rows.map(v => {
            const agg = byVendor.get(v.id) || { productCount: 0, views: 0, unitsSold: 0, revenue: 0 };
            return {
                vendorId: v.id,
                businessName: v.business_name,
                productCount: agg.productCount,
                productViews: agg.views,
                unitsSold: agg.unitsSold,
                revenue: agg.revenue,
                ordersCount: ordersByVendor.get(v.id) || 0
            };
        }).sort((a, b) => b.revenue - a.revenue));
    } catch (error) {
        console.error("getVendorPerformanceReport error:", error);
        res.status(500).json({ error: "Failed to load vendor performance report." });
    }
};

// Admin: GET /api/admin/performance/staff?period=week|month|year (or start=&end=)
// "Staff" = whoever a product's created_by resolves to, scoped to roles that
// actually manage the catalogue (product_staff, store_manager, admin).
exports.getStaffPerformanceReport = async (req, res) => {
    try {
        const { startDate, endDate } = resolveRange(req);

        const metricsResult = await productMetricsForRange(startDate, endDate);
        const byStaff = new Map();
        metricsResult.rows.forEach(r => {
            if (r.created_by == null) return;
            if (!byStaff.has(r.created_by)) {
                byStaff.set(r.created_by, { productCount: 0, views: 0, unitsSold: 0, revenue: 0 });
            }
            const agg = byStaff.get(r.created_by);
            agg.productCount += 1;
            agg.views += Number(r.views);
            agg.unitsSold += Number(r.units_sold);
            agg.revenue += Number(r.revenue);
        });

        const ordersResult = await pool.query(
            `SELECT p.created_by, COUNT(DISTINCT o.id) AS orders_count
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             WHERE o.status = 'paid' AND o.created_at >= $1 AND o.created_at <= $2
               AND p.created_by IS NOT NULL
             GROUP BY p.created_by`,
            [startDate, endDate]
        );
        const ordersByStaff = new Map(ordersResult.rows.map(r => [r.created_by, Number(r.orders_count)]));

        const staffResult = await pool.query(
            `SELECT id, name, role FROM users
             WHERE role IN ('product_staff', 'store_manager', 'admin') AND deleted_at IS NULL
             ORDER BY name ASC`
        );

        res.json(staffResult.rows.map(u => {
            const agg = byStaff.get(u.id) || { productCount: 0, views: 0, unitsSold: 0, revenue: 0 };
            return {
                staffId: u.id,
                name: u.name,
                role: u.role,
                productCount: agg.productCount,
                productViews: agg.views,
                unitsSold: agg.unitsSold,
                revenue: agg.revenue,
                ordersCount: ordersByStaff.get(u.id) || 0
            };
        }).sort((a, b) => b.revenue - a.revenue));
    } catch (error) {
        console.error("getStaffPerformanceReport error:", error);
        res.status(500).json({ error: "Failed to load staff performance report." });
    }
};
