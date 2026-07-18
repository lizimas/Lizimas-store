const pool = require("../config/database");
const { requestToPay, checkPaymentStatus } = require("../services/momoService");

exports.initiateMomoPayment = async (req, res) => {
    try {
        const { orderId, phoneNumber } = req.body;
        const userId = req.user.userId;

        if (!orderId || !phoneNumber) {
            return res.status(400).json({ error: "orderId and phoneNumber are required." });
        }

        const orderResult = await pool.query(
            "SELECT id, total, user_id, status FROM orders WHERE id = $1",
            [orderId]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: "Order not found." });
        }

        const order = orderResult.rows[0];

        if (order.user_id !== userId) {
            return res.status(403).json({ error: "This order does not belong to you." });
        }

        if (order.status === "paid") {
            return res.status(409).json({ error: "This order has already been paid." });
        }

        const referenceId = await requestToPay({
            amount: order.total,
            phoneNumber,
            payerMessage: `Payment for order #${order.id}`,
            payeeNote: `Lizimas Store order #${order.id}`
        });

        const payment = await pool.query(
            `INSERT INTO payments (order_id, amount, method, transaction_id, status)
             VALUES ($1, $2, 'mtn_momo_api', $3, 'pending')
             RETURNING *`,
            [orderId, order.total, referenceId]
        );

        res.status(202).json({
            message: "Payment request sent. Check your phone to approve.",
            referenceId,
            payment: payment.rows[0]
        });

    } catch (error) {
        console.error("Initiate MoMo payment error:", error);
        res.status(500).json({ error: "Something went wrong while requesting payment." });
    }
};

exports.getMomoPaymentStatus = async (req, res) => {
    try {
        const { referenceId } = req.params;

        let statusResult = null;
        let lastError = null;
        const maxAttempts = 5;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                statusResult = await checkPaymentStatus(referenceId);
                break;
            } catch (error) {
                lastError = error;
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        if (!statusResult) {
            throw lastError;
        }

        if (statusResult.status === "SUCCESSFUL") {
            const paymentResult = await pool.query(
                "SELECT * FROM payments WHERE transaction_id = $1",
                [referenceId]
            );

            if (paymentResult.rows.length > 0) {
                const payment = paymentResult.rows[0];

                await pool.query(
                    "UPDATE payments SET status = 'verified' WHERE id = $1",
                    [payment.id]
                );

                await pool.query(
                    "UPDATE orders SET status = 'paid' WHERE id = $1",
                    [payment.order_id]
                );
            }
        }

        if (statusResult.status === "FAILED") {
            await pool.query(
                "UPDATE payments SET status = 'failed' WHERE transaction_id = $1",
                [referenceId]
            );
        }

        res.json(statusResult);

    } catch (error) {
        console.error("Get MoMo payment status error:", error);
        res.status(500).json({ error: "Something went wrong while checking payment status.", details: error.message });
    }
};
