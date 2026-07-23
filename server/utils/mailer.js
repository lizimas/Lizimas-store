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

async function sendPasswordResetEmail(email, resetLink) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Reset Your Password - Lizimas Store",
            text: `We received a request to reset your password.\n\nClick the link below to set a new password (valid for 15 minutes):\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email - your password will remain unchanged.`
        });
    } catch (error) {
        console.error("Password reset email error:", error);
        // Don't throw - a failed email should never crash the request
    }
}

async function sendStaffActivationEmail(email, name) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your Staff Account Has Been Approved - Lizimas Store",
            text: `Hi ${name},\n\nYour staff account has been approved and is now active. You can log in to the staff dashboard anytime.\n\nWelcome to the team!\n\nLizimas Store`
        });
    } catch (error) {
        console.error("Staff activation email error:", error);
    }
}

async function sendAccountBlockedEmail(email, name) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your Account Has Been Blocked - Lizimas Store",
            text: `Hi ${name},\n\nYour account has been blocked due to repeated unauthorized attempts to access the admin panel.\n\nPlease stop trying to log in and contact the administrator to have your account reviewed and reactivated.\n\nLizimas Store`
        });
    } catch (error) {
        console.error("Account blocked email error:", error);
    }
}

async function sendAdminBlockAlert(details) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_ALERT_EMAIL,
            subject: "Staff Account Auto-Blocked - Lizimas Store",
            text: `A staff account was automatically blocked after 3 unauthorized admin panel access attempts.\n\nName: ${details.name}\nEmail: ${details.email}\nTime: ${details.time}\n\nYou can review and reactivate this account from the Staff & Approvals tab in your admin dashboard.`
        });
    } catch (error) {
        console.error("Admin block alert email error:", error);
    }
}

module.exports = { sendAdminLoginAlert, sendOrderStatusEmail, sendPasswordResetEmail, sendStaffActivationEmail, sendAccountBlockedEmail, sendAdminBlockAlert };
