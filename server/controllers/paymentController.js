const pool = require("../config/database");

const MOBILE_MONEY_NUMBER = "+256792363104";
const PAYEE_NAME = "Lizimas Senteza";

exports.getPaymentInstructions = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.userId;

        const orderResult = await pool.query(
            "SELECT id, total, status, user_id FROM orders WHERE id = $1",
            [orderId]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: "Order not found." });
        }

        const order = orderResult.rows[0];

        if (order.user_id !== userId) {
            return res.status(403).json({ error: "This order does not belong to you." });
        }

        res.json({
            orderId: order.id,
            amountDue: order.total,
            payTo: {
                name: PAYEE_NAME,
                mobileMoneyNumber: MOBILE_MONEY_NUMBER
            },
            instructions: `Send UGX ${order.total} via Mobile Money to ${MOBILE_MONEY_NUMBER} (${PAYEE_NAME}). After sending, submit your transaction reference/SMS code so we can confirm your payment.`
        });

    } catch (error) {
        console.error("Get payment instructions error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.createPayment = async (req, res) => {
    try {
        const { order_id, amount, method, transaction_id } = req.body;
        const userId = req.user.userId;

        if (!order_id || !amount || !method || !transaction_id) {
            return res.status(400).json({ error: "order_id, amount, method, and transaction_id are all required." });
        }

        const orderResult = await pool.query(
            "SELECT id, total, user_id, status FROM orders WHERE id = $1",
            [order_id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: "Order not found." });
        }

        const order = orderResult.rows[0];

        if (order.user_id !== userId) {
            return res.status(403).json({ error: "This order does not belong to you." });
        }

        const amountMatches = Number(amount) === Number(order.total);

        const payment = await pool.query(
            `INSERT INTO payments (order_id, amount, method, transaction_id, status)
             VALUES ($1, $2, $3, $4, 'pending')
             RETURNING *`,
            [order_id, amount, method, transaction_id]
        );

        res.status(201).json({
            message: "Payment submitted. It will be verified shortly.",
            payment: payment.rows[0],
            amountMatchesOrderTotal: amountMatches
        });

    } catch (error) {
        console.error("Create payment error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getPayments = async (req, res) => {
    try {
        const payments = await pool.query(
            `SELECT payments.*, orders.customer_name, orders.phone
             FROM payments
             JOIN orders ON payments.order_id = orders.id
             ORDER BY payments.created_at DESC`
        );

        res.json(payments.rows);

    } catch (error) {
        console.error("Get payments error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.verifyPayment = async (req, res) => {
    const client = await pool.connect();

    try {
        const { id } = req.params;

        await client.query("BEGIN");

        const paymentResult = await client.query(
            "SELECT * FROM payments WHERE id = $1",
            [id]
        );

        if (paymentResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Payment not found." });
        }

        const payment = paymentResult.rows[0];

        await client.query(
            "UPDATE payments SET status = 'verified' WHERE id = $1",
            [id]
        );

        await client.query(
            "UPDATE orders SET status = 'paid' WHERE id = $1",
            [payment.order_id]
        );

        await client.query("COMMIT");

        res.json({ message: "Payment verified and order marked as paid." });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Verify payment error:", error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};
