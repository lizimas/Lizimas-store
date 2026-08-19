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

async function sendPasswordResetEmail(email, resetLink, validMinutes = 15) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Reset Your Password - Lizimas Store",
            text: `We received a request to reset your password.\n\nClick the link below to set a new password (valid for ${validMinutes} minutes):\n${resetLink}\n\nThis link can only be used once.\n\nIf you didn't request this, you can safely ignore this email - your password will remain unchanged.`
        });
        return true;
    } catch (error) {
        console.error("Password reset email error:", error);
        // Don't throw - a failed email should never crash the request.
        // Callers that care (forcePasswordReset) can check the return value.
        return false;
    }
}

async function sendTwoFactorCodeEmail(email, code) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your Login Code - Lizimas Store",
            text: `Your login verification code is:\n\n${code}\n\nThis code expires in 10 minutes and can only be used once.\n\nIf you didn't try to log in, someone may have your password. Change it immediately.`
        });
    } catch (error) {
        console.error("Two-factor code email error:", error);
        throw error;
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

async function sendScopeViolationAlert(details) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_ALERT_EMAIL,
            subject: "BLOCKED LOGIN - Wrong Portal - Lizimas Store",
            text: `A login attempt with a CORRECT email and password was refused because it was made from the wrong login portal.\n\nNo session was created. No token was issued. No two-factor enrolment was allowed.\n\nAccount: ${details.email}\nRole: ${details.role}\nPortal used: ${details.surface}\nStatus: BLOCKED\nReason: Account not permitted on this login portal\nIP: ${details.ip}\nBrowser: ${details.userAgent}\nTime: ${details.time}\n\nIf this was not the account holder, treat the password as compromised and reset it immediately from the admin dashboard.`
        });
    } catch (error) {
        console.error("Scope violation alert email error:", error);
    }
}

// Sent when an account is locked for signing in from an unrecognised device.
// Goes to the account owner and to the alert mailbox: the owner needs to know
// their account is locked, and the administrator needs to know why.
async function sendSecurityLockAlert(details) {
    const subject = "Lizimas Store: account locked - unrecognised device";
    const body = [
        "An attempt was made to sign in to a Lizimas Store account from a device that has not been used before.",
        "",
        "The sign-in was refused and the account has been locked pending review.",
        "",
        `Account:  ${details.email}`,
        `Role:     ${details.role}`,
        `Portal:   ${details.surface}`,
        `IP:       ${details.ip}`,
        `Device:   ${details.userAgent}`,
        `Time:     ${details.time}`,
        "",
        "If this was you, contact the administrator to unlock the account.",
        "If it was not, the password should be treated as compromised and changed once access is restored."
    ].join("\n");

    const recipients = [details.email, process.env.ADMIN_ALERT_EMAIL]
        .filter(Boolean)
        .join(",");

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: recipients,
            subject,
            text: body
        });
    } catch (error) {
        console.error("sendSecurityLockAlert failed:", error);
    }
}

async function sendDeviceApprovalRequest(details) {
    const { email, name, role, surface, ip, userAgent, time, approveUrl, denyUrl } = details;

    const html = `
        <h2>New sign-in needs your approval</h2>
        <p>Someone signed in with the correct password for <strong>${email}</strong> on a device we do not recognise. The sign-in is on hold until you decide.</p>
        <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
            <tr><td><strong>Account</strong></td><td>${email} (${role || "unknown"})</td></tr>
            <tr><td><strong>Portal</strong></td><td>${surface || "unknown"}</td></tr>
            <tr><td><strong>IP address</strong></td><td>${ip || "unknown"}</td></tr>
            <tr><td><strong>Device</strong></td><td>${userAgent || "unknown"}</td></tr>
            <tr><td><strong>Time</strong></td><td>${time}</td></tr>
        </table>
        <p style="margin:24px 0">
            <a href="${approveUrl}" style="background:#0d1b3e;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;margin-right:10px">This was me</a>
            <a href="${denyUrl}" style="background:#c0392b;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none">This was not me</a>
        </p>
        <p style="font-size:13px;color:#555">Approving opens a confirmation page — the sign-in still has to pass your authenticator afterwards. This request expires in 10 minutes.</p>
        <p style="font-size:13px;color:#c0392b"><strong>If this was not you, choose "This was not me".</strong> The account will be locked and your password reset.</p>
    `;

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: [email, process.env.ADMIN_ALERT_EMAIL].filter(Boolean).join(","),
        subject: `Approve sign-in for ${email}`,
        html
    });
}

async function sendAccountReportAlert(details) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_ALERT_EMAIL,
            subject: "Account Issue Report #" + details.id + " - Lizimas Store",
            text: `A customer submitted an account issue report from the website footer.\n\nReport ID: ${details.id}\nType: ${details.reportType}\nEmail given: ${details.email}\nMatches an account: ${details.hasAccount ? "yes" : "no"}\nIP: ${details.ip}\nTime: ${details.time}\n\nMessage:\n${details.message}\n\nReview and action this from the Security tab in your admin dashboard.`
        });
    } catch (error) {
        console.error("Account report alert email error:", error);
    }
}

module.exports = { sendDeviceApprovalRequest, sendAdminLoginAlert, sendOrderStatusEmail, sendPasswordResetEmail, sendStaffActivationEmail, sendAccountBlockedEmail, sendAdminBlockAlert, sendTwoFactorCodeEmail, sendScopeViolationAlert, sendSecurityLockAlert, sendAccountReportAlert };
