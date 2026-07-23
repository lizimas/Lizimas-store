const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

async function sendAdminLoginAlert(details) {
    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_ALERT_EMAIL,
        subject: "Admin Login - Lizimas Store",
        text: `Admin login detected.\nName: ${details.name}\nEmail: ${details.email}\nTime: ${details.time}\nIP: ${details.ip}`
    });
}

const ORDER_STATUS_MESSAGES = {
    pending: "We've received your order and it's being reviewed.",
    paid: "Your payment has been confirmed. We're preparing your order.",
    shipped: "Your order is on its way!",
    delivered: "Your order has been delivered. Thank you for shopping with us!",
    cancelled: "Your order has been cancelled. Contact us if you have any questions."
};

/**
 * Sends an order status update email to a logged-in customer's account email.
 * Guest orders have no email on file, so callers should skip this for guests.
 * @param {string} email - recipient email address
 * @param {object} order - order row (needs id, customer_name, total)
 * @param {string} status - one of pending/paid/shipped/delivered/cancelled
 */
async function sendOrderStatusEmail(email, order, status) {
    if (!email) return;

    const statusMessage = ORDER_STATUS_MESSAGES[status] || `Your order status is now: ${status}`;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Order #${order.id} Update - Lizimas Store`,
            text: `Hi ${order.customer_name},\n\n${statusMessage}\n\nOrder ID: ${order.id}\nTotal: UGX ${order.total}\n\nThank you for shopping with Lizimas Store.`
        });
    } catch (error) {
        console.error("Order status email error:", error);
        // Don't throw - a failed email should never block an order or status update
    }
}

module.exports = { sendAdminLoginAlert, sendOrderStatusEmail };
