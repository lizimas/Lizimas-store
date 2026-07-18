const pool = require("../config/database");

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
            `SELECT COUNT(*) AS total_customers FROM users WHERE role = 'customer'`
        );

        const pendingPaymentsResult = await pool.query(
            `SELECT COUNT(*) AS pending_payments FROM payments WHERE status = 'pending'`
        );

        const lowStockResult = await pool.query(
            `SELECT id, name, stock FROM products WHERE stock < 10 ORDER BY stock ASC`
        );

        res.json({
            totalRevenue: totalRevenueResult.rows[0].total_revenue,
            totalOrders: Number(totalOrdersResult.rows[0].total_orders),
            pendingOrders: Number(pendingOrdersResult.rows[0].pending_orders),
            totalCustomers: Number(totalCustomersResult.rows[0].total_customers),
            pendingPayments: Number(pendingPaymentsResult.rows[0].pending_payments),
            lowStockProducts: lowStockResult.rows
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
        const customers = await pool.query(
            `SELECT id, name, email, phone, role, created_at
             FROM users
             ORDER BY created_at DESC`
        );

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

        res.json({ message: "Order status updated.", order: result.rows[0] });

    } catch (error) {
        console.error("Update order status error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};
