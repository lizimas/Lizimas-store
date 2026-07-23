const pool = require("../config/database");
const { sendOrderStatusSms } = require("../utils/sms");
const { sendOrderStatusEmail } = require("../utils/mailer");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");

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
            `SELECT COUNT(*) AS pending_payments FROM payments WHERE status = 'pending'`
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

        if (updatedOrder.user_id) {
            pool.query("SELECT email FROM users WHERE id = $1", [updatedOrder.user_id])
                .then(userResult => {
                    if (userResult.rows.length > 0) {
                        sendOrderStatusEmail(userResult.rows[0].email, updatedOrder, status)
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

            const rowErrors = [];
            if (!name) rowErrors.push("name is required");
            if (row.price === "" || row.price === undefined || isNaN(price) || price < 0) {
                rowErrors.push("price must be a non-negative number");
            }
            if (isNaN(stock) || stock < 0) rowErrors.push("stock must be a non-negative number");

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

            if (existingId) {
                const updateResult = await client.query(
                    `UPDATE products
                     SET name = $1, description = $2, price = $3, stock = $4, category_id = $5
                     WHERE id = $6
                     RETURNING id`,
                    [name, description, price, stock, categoryId, existingId]
                );

                if (updateResult.rows.length) {
                    results.updated++;
                } else {
                    results.skipped++;
                    results.errors.push({ row: rowNum, name, errors: [`No product with id ${existingId} found`] });
                }
            } else {
                await client.query(
                    `INSERT INTO products (name, description, price, stock, category_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [name, description, price, stock, categoryId]
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
             WHERE u.role IN ('product_staff', 'store_manager')
             ORDER BY s.created_at DESC
             LIMIT 200`
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Get staff sessions error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};
