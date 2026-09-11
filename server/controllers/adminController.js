const pool = require("../config/database");
const { sendOrderStatusSms } = require("../utils/sms");
const { sendOrderStatusEmail } = require("../utils/mailer");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const { safePackageSize } = require("./productController");

// Base URL for links that leave the app (emails, receipts). Hardcoding the
// production domain makes locally generated links unusable, since they resolve
// against production where the local order does not exist.
const PUBLIC_BASE_URL =
    String(process.env.PUBLIC_BASE_URL || "https://lizimasstore.com").replace(/\/+$/, "");

exports.getDashboardStats = async (req, res) => {
    try {
        const totalRevenueResult = await pool.query(
            `SELECT COALESCE(SUM(total), 0) AS total_revenue
             FROM orders
             WHERE status = 'paid'`
        );

        const totalOrdersResult = await pool.query(
            `SELECT COUNT(*) AS total_orders FROM orders`
        );

        const pendingOrdersResult = await pool.query(
            `SELECT COUNT(*) AS pending_orders FROM orders WHERE status = 'pending'`
        );

        const totalCustomersResult = await pool.query(
            `SELECT COUNT(*) AS total_customers FROM users WHERE role = 'customer' AND deleted_at IS NULL`
        );

        const deletedAccountsResult = await pool.query(
            `SELECT COUNT(*) AS deleted_accounts FROM users WHERE deleted_at IS NOT NULL`
        );

        const guestCustomersResult = await pool.query(
            `SELECT COUNT(DISTINCT phone) AS guest_customers FROM orders WHERE user_id IS NULL`
        );

        const pendingPaymentsResult = await pool.query(
            `SELECT COUNT(*) AS pending_payments FROM payments WHERE status IN ('pending', 'initiated')`
        );

        const lowStockResult = await pool.query(
            `SELECT id, name, stock FROM products WHERE stock < 10 ORDER BY stock ASC`
        );

        const totalVisitorsResult = await pool.query(
            `SELECT COUNT(*) AS total_visitors FROM visitor_logs`
        );

        const paidOrdersResult = await pool.query(
            `SELECT COUNT(*) AS paid_orders FROM orders WHERE status = 'paid'`
        );

        res.json({
            totalRevenue: totalRevenueResult.rows[0].total_revenue,
            totalOrders: Number(totalOrdersResult.rows[0].total_orders),
            pendingOrders: Number(pendingOrdersResult.rows[0].pending_orders),
            totalCustomers: Number(totalCustomersResult.rows[0].total_customers),
            pendingPayments: Number(pendingPaymentsResult.rows[0].pending_payments),
            lowStockProducts: lowStockResult.rows,
            totalVisitors: Number(totalVisitorsResult.rows[0].total_visitors),
            paidOrders: Number(paidOrdersResult.rows[0].paid_orders),
            totalDeletedAccounts: Number(deletedAccountsResult.rows[0].deleted_accounts),
            totalGuestCustomers: Number(guestCustomersResult.rows[0].guest_customers)
        });

    } catch (error) {
        console.error("Get dashboard stats error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getAllOrdersAdmin = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT orders.*, users.email AS customer_email
             FROM orders
             LEFT JOIN users ON orders.user_id = users.id
             ORDER BY orders.created_at DESC`
        );

        res.json(orders.rows);

    } catch (error) {
        console.error("Get all orders (admin) error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getOrderItems = async (req, res) => {
    try {
        const { id } = req.params;

        const items = await pool.query(
            `SELECT order_items.*, products.name AS product_name
             FROM order_items
             JOIN products ON order_items.product_id = products.id
             WHERE order_items.order_id = $1`,
            [id]
        );

        res.json(items.rows);

    } catch (error) {
        console.error("Get order items error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getReceiptLink = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Bad order id." });
        const { sign } = require("../routes/receipt");
        res.json({ url: `${PUBLIC_BASE_URL}/receipt/${id}?t=${sign(id)}` });
    } catch (error) {
        console.error("Receipt link error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getAllCustomers = async (req, res) => {
    try {
        const { search } = req.query;

        let query = `SELECT id, name, email, phone, role, created_at, deleted_at, is_active, blocked_at, failed_admin_attempts FROM users`;
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            query += ` WHERE (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1)`;
        }

        query += ` ORDER BY created_at DESC`;

        const customers = await pool.query(query, params);

        res.json(customers.rows);

    } catch (error) {
        console.error("Get all customers error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const allowedStatuses = ["pending", "paid", "shipped", "delivered", "cancelled"];

        if (!status || !allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: `Status must be one of: ${allowedStatuses.join(", ")}`
            });
        }

        const result = await pool.query(
            "UPDATE orders SET status = $1 WHERE id = $2 RETURNING *",
            [status, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Order not found." });
        }

        const updatedOrder = result.rows[0];

        // Status change notifications - best-effort, never block the response
        sendOrderStatusSms(updatedOrder.phone, updatedOrder, status).catch(err => console.error("SMS notify error:", err));

        // Delivered mail lists what arrived and links each item back to its
        // product page. Other statuses don't need the line items.
        let deliveredItems = [];
        if (status === "delivered") {
            try {
                // LEFT JOIN so a removed product still lists from the
                // order_items snapshot. product_live mirrors the condition in
                // routes/product-page.js - if it is false the page 404s, so
                // the mail must not link it.
                const itemsResult = await pool.query(
                    `SELECT oi.product_id,
                            oi.quantity,
                            COALESCE(oi.product_name, p.name) AS product_name,
                            (p.id IS NOT NULL
                             AND p.status = 'approved'
                             AND p.deleted_at IS NULL) AS product_live
                     FROM order_items oi
                     LEFT JOIN products p ON p.id = oi.product_id
                     WHERE oi.order_id = $1
                     ORDER BY oi.id`,
                    [updatedOrder.id]
                );
                deliveredItems = itemsResult.rows;
            } catch (itemsError) {
                // A missing item list must not stop the status update or the
                // email - the mail just goes out without the product section.
                console.error("Delivered items lookup error:", itemsError);
            }
        }

        if (updatedOrder.customer_email) {
            sendOrderStatusEmail(updatedOrder.customer_email, updatedOrder, status, deliveredItems)
                .catch(err => console.error("Email notify error:", err));
        } else if (updatedOrder.user_id) {
            pool.query("SELECT email FROM users WHERE id = $1", [updatedOrder.user_id])
                .then(userResult => {
                    if (userResult.rows.length > 0) {
                        sendOrderStatusEmail(userResult.rows[0].email, updatedOrder, status, deliveredItems)
                            .catch(err => console.error("Email notify error:", err));
                    }
                })
                .catch(err => console.error("User email lookup error:", err));
        }

        res.json({ message: "Order status updated.", order: updatedOrder });

    } catch (error) {
        console.error("Update order status error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

// Bulk product import from CSV/XLSX. Admin-only (this whole router is gated
// by requireAuth+requireAdmin above) - so, unlike the staff-facing product
// forms, every field here is directly writable including status: there is
// no "goes back to pending" safety net to preserve because product_staff
// can't reach this endpoint at all.
//
// Row matching: an `id` column (if present and non-empty) always wins as
// the target row for an UPDATE. Failing that, a non-empty `sku` that
// matches an existing product also updates it - this lets a re-import of a
// previously exported file (see exportProducts below) work without anyone
// having to look up database ids by hand. Otherwise the row is a CREATE.
//
// Kept transactional (BEGIN/COMMIT/ROLLBACK) exactly as this function
// already was before this pass: a genuinely unexpected failure (a DB error
// mid-loop) rolls back everything so a half-applied import can't corrupt
// the catalogue, while ordinary per-row validation problems are collected
// into results.errors and the row is skipped without aborting the batch.
exports.importProducts = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded (field name must be \"file\")." });
    }

    let rows;
    try {
        const isCsv = req.file.originalname.toLowerCase().endsWith(".csv");
        if (isCsv) {
            rows = parse(req.file.buffer.toString("utf-8"), {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } else {
            const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        }
    } catch (error) {
        return res.status(400).json({ error: `Could not parse file: ${error.message}` });
    }

    if (!rows.length) {
        return res.status(400).json({ error: "File contains no rows." });
    }

    if (rows.length > 5000) {
        return res.status(400).json({ error: `File has ${rows.length} rows - please split it into batches of 5000 or fewer.` });
    }

    const VALID_STATUSES = ["pending", "approved", "rejected"];

    const results = { created: 0, updated: 0, skipped: 0, errors: [] };
    const categoryCache = new Map();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (let i = 0; i < rows.length; i++) {
            const rowNum = i + 2;
            const row = rows[i];

            const name = String(row.name || "").trim();
            const price = Number(row.price);
            const stock = row.stock === "" || row.stock === undefined ? 0 : Number(row.stock);
            const description = String(row.description || "").trim();
            const categoryName = String(row.category || "").trim();
            const existingId = row.id ? Number(row.id) : null;
            const sku = row.sku !== undefined ? String(row.sku).trim() : "";

            const packageSizeRaw = row.package_size !== undefined ? String(row.package_size).trim() : "";
            const brand = row.brand !== undefined ? String(row.brand).trim() : "";
            const gtin = row.gtin !== undefined ? String(row.gtin).trim() : "";
            const mpn = row.mpn !== undefined ? String(row.mpn).trim() : "";
            const material = row.material !== undefined ? String(row.material).trim() : "";
            const color = row.color !== undefined ? String(row.color).trim() : "";
            const sleeve = row.sleeve !== undefined ? String(row.sleeve).trim() : "";
            const style = row.style !== undefined ? String(row.style).trim() : "";
            const length = row.length !== undefined ? String(row.length).trim() : "";
            const fit = row.fit !== undefined ? String(row.fit).trim() : "";
            const pattern = row.pattern !== undefined ? String(row.pattern).trim() : "";
            const careInstructions = row.care_instructions !== undefined ? String(row.care_instructions).trim() : "";
            const occasion = row.occasion !== undefined ? String(row.occasion).trim() : "";
            const warrantyMonthsRaw = row.warranty_months !== undefined ? String(row.warranty_months).trim() : "";
            const statusRaw = row.status !== undefined ? String(row.status).trim().toLowerCase() : "";
            const imageRaw = row.image !== undefined ? String(row.image).trim() : "";

            const rowErrors = [];
            if (!name) rowErrors.push("name is required");
            if (row.price === "" || row.price === undefined || isNaN(price) || price < 0) {
                rowErrors.push("price must be a non-negative number");
            }
            if (isNaN(stock) || stock < 0) rowErrors.push("stock must be a non-negative number");

            let warrantyMonths = null;
            if (warrantyMonthsRaw) {
                warrantyMonths = Number(warrantyMonthsRaw);
                if (isNaN(warrantyMonths) || warrantyMonths < 0) {
                    rowErrors.push("warranty_months must be a non-negative number");
                    warrantyMonths = null;
                }
            }

            if (statusRaw && !VALID_STATUSES.includes(statusRaw)) {
                rowErrors.push(`status must be one of ${VALID_STATUSES.join(", ")} (or left blank)`);
            }

            const packageSize = packageSizeRaw ? safePackageSize(packageSizeRaw) : null;

            if (rowErrors.length) {
                results.skipped++;
                results.errors.push({ row: rowNum, name: name || "(missing)", errors: rowErrors });
                continue;
            }

            let categoryId = null;
            if (categoryName) {
                const key = categoryName.toLowerCase();
                if (categoryCache.has(key)) {
                    categoryId = categoryCache.get(key);
                } else {
                    const existingCat = await client.query(
                        "SELECT id FROM categories WHERE LOWER(name) = LOWER($1)",
                        [categoryName]
                    );
                    if (existingCat.rows.length) {
                        categoryId = existingCat.rows[0].id;
                    } else {
                        const newCat = await client.query(
                            "INSERT INTO categories (name) VALUES ($1) RETURNING id",
                            [categoryName]
                        );
                        categoryId = newCat.rows[0].id;
                    }
                    categoryCache.set(key, categoryId);
                }
            }

            // Resolve which existing row (if any) this line targets: an
            // explicit id wins, otherwise fall back to a sku match so a
            // re-imported export file updates by sku alone.
            let targetId = existingId;
            if (!targetId && sku) {
                const bySku = await client.query(
                    "SELECT id FROM products WHERE sku = $1 AND deleted_at IS NULL",
                    [sku]
                );
                if (bySku.rows.length) targetId = bySku.rows[0].id;
            }

            if (targetId) {
                const setClauses = [
                    "name = $1", "description = $2", "price = $3", "stock = $4", "category_id = $5",
                    "sku = $6", "brand = $7", "gtin = $8", "mpn = $9", "material = $10", "color = $11",
                    "sleeve = $12", "style = $13", "length = $14", "fit = $15", "pattern = $16",
                    "care_instructions = $17", "occasion = $18", "warranty_months = $19"
                ];
                const params = [
                    name, description, price, stock, categoryId,
                    sku || null, brand || null, gtin || null, mpn || null, material || null, color || null,
                    sleeve || null, style || null, length || null, fit || null, pattern || null,
                    careInstructions || null, occasion || null, warrantyMonths
                ];

                if (packageSize) {
                    params.push(packageSize);
                    setClauses.push(`package_size = $${params.length}`);
                }
                if (statusRaw) {
                    params.push(statusRaw);
                    setClauses.push(`status = $${params.length}`);
                }
                if (imageRaw) {
                    params.push(imageRaw);
                    setClauses.push(`image = $${params.length}`);
                }

                params.push(targetId);
                const updateResult = await client.query(
                    `UPDATE products SET ${setClauses.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING id`,
                    params
                );

                if (updateResult.rows.length) {
                    results.updated++;
                } else {
                    results.skipped++;
                    results.errors.push({ row: rowNum, name, errors: [`No product with id ${targetId} found`] });
                }
            } else {
                await client.query(
                    `INSERT INTO products (
                        name, description, price, stock, category_id, created_by, status,
                        sku, brand, gtin, mpn, material, color, sleeve, style, length, fit, pattern,
                        care_instructions, occasion, warranty_months, package_size, image
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
                    [
                        name, description, price, stock, categoryId, req.user.userId, statusRaw || "approved",
                        sku || null, brand || null, gtin || null, mpn || null, material || null, color || null,
                        sleeve || null, style || null, length || null, fit || null, pattern || null,
                        careInstructions || null, occasion || null, warrantyMonths, packageSize || "Small",
                        imageRaw || null
                    ]
                );
                results.created++;
            }
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Import products error:", error);
        return res.status(500).json({ error: "Import failed and was rolled back." });
    } finally {
        client.release();
    }

    res.json({
        message: "Import complete",
        totalRows: rows.length,
        ...results
    });
};

// One CSV field, quoted and escaped per RFC 4180 (double quotes doubled,
// wrapped in quotes whenever the value contains a quote, comma, or newline
// so a comma or line break inside a description can't corrupt the column
// layout downstream).
function csvField(value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

const EXPORT_COLUMNS = [
    "id", "sku", "name", "category", "description", "price", "stock", "package_size",
    "brand", "gtin", "mpn", "material", "color", "sleeve", "style", "length", "fit", "pattern",
    "care_instructions", "occasion", "warranty_months", "status", "image", "created_at"
];

// GET /api/admin/products/export - the read side of the round-trip above:
// every column here is one importProducts understands, including `id` and
// `sku` (either can be re-uploaded to update these same rows) and `image`
// (already-hosted URLs pass straight through import unchanged). Optional
// ?status=pending|approved|rejected filters to one status; otherwise every
// non-deleted product is included.
exports.exportProducts = async (req, res) => {
    try {
        const statusFilter = String(req.query.status || "").trim().toLowerCase();
        const validStatuses = ["pending", "approved", "rejected"];
        const params = [];
        let whereClause = "WHERE p.deleted_at IS NULL";
        if (statusFilter) {
            if (!validStatuses.includes(statusFilter)) {
                return res.status(400).json({ error: `status must be one of ${validStatuses.join(", ")}` });
            }
            params.push(statusFilter);
            whereClause += ` AND p.status = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT p.id, p.sku, p.name, c.name AS category, p.description, p.price, p.stock,
                    p.package_size, p.brand, p.gtin, p.mpn, p.material, p.color, p.sleeve, p.style,
                    p.length, p.fit, p.pattern, p.care_instructions, p.occasion, p.warranty_months,
                    p.status, p.image, p.created_at
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             ${whereClause}
             ORDER BY p.id ASC`,
            params
        );

        const lines = [EXPORT_COLUMNS.join(",")];
        for (const row of result.rows) {
            lines.push(EXPORT_COLUMNS.map(col => csvField(row[col])).join(","));
        }
        const csv = lines.join("\r\n") + "\r\n";

        const datestamp = new Date().toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="products-export-${datestamp}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error("Export products error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getVisitorStats = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE visited_at >= CURRENT_DATE) AS visitors_today,
                COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', CURRENT_DATE)) AS visitors_this_week,
                COUNT(*) FILTER (WHERE visited_at >= date_trunc('month', CURRENT_DATE)) AS visitors_this_month,
                COUNT(*) FILTER (WHERE visited_at >= date_trunc('year', CURRENT_DATE)) AS visitors_this_year,
                COUNT(DISTINCT ip_address) FILTER (WHERE visited_at >= CURRENT_DATE) AS unique_visitors_today,
                COUNT(DISTINCT ip_address) AS unique_visitors_total
            FROM visitor_logs
        `);

        const row = result.rows[0];

        res.json({
            visitorsToday: Number(row.visitors_today),
            visitorsThisWeek: Number(row.visitors_this_week),
            visitorsThisMonth: Number(row.visitors_this_month),
            visitorsThisYear: Number(row.visitors_this_year),
            uniqueVisitorsToday: Number(row.unique_visitors_today),
            uniqueVisitorsTotal: Number(row.unique_visitors_total)
        });
    } catch (error) {
        console.error("Get visitor stats error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};


// DELETE /api/admin/customers/:id - soft delete (sets deleted_at, keeps order history intact)
exports.deleteCustomer = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Customer not found or already deleted." });
        }

        res.json({ message: "Account deleted." });

    } catch (error) {
        console.error("Delete customer error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};


// GET /api/admin/activity-log
exports.getActivityLog = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT al.id, al.action, al.target_type, al.target_id, al.details, al.created_at,
                    u.name AS user_name
             FROM activity_log al
             LEFT JOIN users u ON u.id = al.user_id
             ORDER BY al.created_at DESC
             LIMIT 200`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Get activity log error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};


// GET /api/admin/staff-sessions - login sessions for staff, for time tracking / salary settlement
exports.getStaffSessions = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.device_label, s.ip_address, s.created_at AS login_time, s.last_used_at,
                    u.id AS user_id, u.name, u.role
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE u.role IN ('product_staff', 'store_manager', 'customer_support')
             ORDER BY s.created_at DESC
             LIMIT 200`
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Get staff sessions error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};


// ---------------------------------------------------------------------------
// Security tab. Returns login attempts twice over: grouped by account for the
// summary rows, and as a flat recent list for the expanded detail view. One
// round trip rather than a second call per row.
//
//   GET /api/admin/security/logins?window=24h|7d|30d|all   (default 7d)
// ---------------------------------------------------------------------------
const SECURITY_WINDOWS = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

exports.getSecurityLogins = async (req, res) => {
    try {
        const key = String(req.query.window || "7d");
        // Anything not in the map, including "all", means no time filter.
        const interval = SECURITY_WINDOWS[key] || null;
        const params = interval ? [interval] : [];
        const where = interval ? "WHERE lh.logged_in_at >= NOW() - $1::interval" : "";

        const grouped = await pool.query(
            `SELECT
                COALESCE(lh.attempted_email, u.email, 'unknown') AS email,
                COALESCE(lh.surface, 'unknown') AS surface,
                u.role,
                MAX(lh.user_id) AS user_id,
                COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE lh.success = false)::int AS failures,
                COUNT(*) FILTER (WHERE lh.success = true)::int AS successes,
                COUNT(DISTINCT lh.ip_address)::int AS ip_count,
                MAX(lh.logged_in_at) AS last_attempt,
                ARRAY_AGG(DISTINCT lh.failure_reason)
                    FILTER (WHERE lh.failure_reason IS NOT NULL) AS reasons
             FROM login_history lh
             LEFT JOIN users u ON u.id = lh.user_id
             ${where}
             GROUP BY 1, 2, 3
             ORDER BY MAX(lh.logged_in_at) DESC
             LIMIT 200`,
            params
        );

        const recent = await pool.query(
            `SELECT
                lh.id,
                lh.user_id,
                COALESCE(lh.attempted_email, u.email, 'unknown') AS email,
                COALESCE(lh.surface, 'unknown') AS surface,
                u.role,
                lh.success,
                lh.failure_reason,
                lh.ip_address,
                lh.device_label,
                lh.logged_in_at
             FROM login_history lh
             LEFT JOIN users u ON u.id = lh.user_id
             ${where}
             ORDER BY lh.logged_in_at DESC
             LIMIT 300`,
            params
        );

        const locked = await pool.query(
            `SELECT id, name, email, role, security_locked_at, security_locked_reason
               FROM users
              WHERE security_locked_at IS NOT NULL
              ORDER BY security_locked_at DESC`
        );

        res.json({
            window: key,
            groups: grouped.rows,
            recent: recent.rows,
            locked: locked.rows
        });
    } catch (error) {
        console.error("getSecurityLogins error:", error);
        res.status(500).json({ error: "Failed to load security log." });
    }
};


// ---------------------------------------------------------------------------
// Clears a security lock. Also opens a one-hour window in which that account
// may enrol a device, without which the unlock would achieve nothing: the
// account has no trusted device by definition, so the next sign-in would lock
// it straight back up.
// ---------------------------------------------------------------------------
// GET /api/admin/security/reports?status=new|reviewed|resolved|all
// Joins users so the panel can offer an unlock inline where the reported
// address matches an account and that account is currently locked.
exports.getAccountReports = async (req, res) => {
    try {
        const status = String(req.query.status || "new");
        const params = [];
        let where = "";
        if (status !== "all") {
            params.push(status);
            where = "WHERE r.status = $1";
        }

        const result = await pool.query(
            `SELECT r.id, r.report_type, r.email, r.user_id, r.message, r.ip,
                    r.status, r.admin_note, r.created_at, r.reviewed_at,
                    u.name AS account_name, u.role AS account_role,
                    (u.security_locked_at IS NOT NULL) AS account_locked
               FROM account_reports r
               LEFT JOIN users u ON u.id = r.user_id
               ${where}
              ORDER BY r.created_at DESC
              LIMIT 200`,
            params
        );

        res.json({ reports: result.rows });
    } catch (error) {
        console.error("getAccountReports error:", error);
        res.status(500).json({ error: "Failed to load account reports." });
    }
};

// PATCH /api/admin/security/reports/:id
exports.updateAccountReport = async (req, res) => {
    try {
        const { id } = req.params;
        const status = String((req.body && req.body.status) || "");
        const note = req.body && req.body.admin_note ? String(req.body.admin_note).slice(0, 1000) : null;

        if (!["new", "reviewed", "resolved"].includes(status)) {
            return res.status(400).json({ error: "Invalid status." });
        }

        const result = await pool.query(
            `UPDATE account_reports
                SET status = $1,
                    admin_note = COALESCE($2, admin_note),
                    reviewed_by = $3,
                    reviewed_at = NOW()
              WHERE id = $4
              RETURNING id, status`,
            [status, note, req.user && req.user.userId ? req.user.userId : null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Report not found." });
        }

        res.json({ message: "Report updated.", report: result.rows[0] });
    } catch (error) {
        console.error("updateAccountReport error:", error);
        res.status(500).json({ error: "Failed to update report." });
    }
};

exports.unlockAccount = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `UPDATE users
                SET security_locked_at = NULL,
                    security_locked_reason = NULL,
                    device_grace_until = NOW() + INTERVAL '15 minutes'
              WHERE id = $1
              RETURNING id, email, role`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Account not found." });
        }

        res.json({
            message: "Account unlocked. The next completed sign-in within 15 minutes will register that one device.",
            account: result.rows[0]
        });
    } catch (error) {
        console.error("unlockAccount error:", error);
        res.status(500).json({ error: "Failed to unlock account." });
    }
};
