const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

const BRAND = {
    name: "Lizimas Store",
    tagline: "Excellence in Every Order",
    logo: "https://res.cloudinary.com/ag407tk0/image/upload/whatsapp-gold.jpg",
    site: "https://lizimasstore.com",
    phone: "+256 792 363 104",
    email: "support@lizimasstore.com",
    facebook: "https://www.facebook.com/Lizimas.store",
    navy: "#0f1b3d",
    gold: "#f5c518"
};

function ugxFmt(n) {
    return "UGX " + Math.round(Number(n) || 0).toLocaleString("en-UG");
}

function escHtml(v) {
    return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Shared wrapper for every customer-facing email. Individual senders supply
 * only their own content; the header, CTA and footer live here so the brand
 * stays consistent and only needs changing in one place.
 *
 * Table-based layout on purpose - Gmail, Outlook and most mobile clients
 * strip or ignore flexbox and grid.
 */
function renderCustomerEmail(opts) {
    const title = opts.title || "";
    const body = opts.bodyHtml || "";
    const cta = opts.ctaUrl && opts.ctaText
        ? `<tr><td style="padding:6px 0 20px"><a href="${opts.ctaUrl}" style="display:inline-block;background:${BRAND.navy};color:${BRAND.gold};padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">${escHtml(opts.ctaText)}</a></td></tr>`
        : "";

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:18px 10px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">

  <tr><td style="background:${BRAND.gold};padding:20px;text-align:center">
    <img src="${BRAND.logo}" alt="${BRAND.name}" width="76" style="width:76px;height:76px;border-radius:6px;display:inline-block">
    <div style="margin-top:8px;font-size:19px;font-weight:800;color:${BRAND.navy};letter-spacing:.5px">LIZIMAS STORE</div>
    <div style="font-size:12px;color:${BRAND.navy};opacity:.75">${BRAND.tagline}</div>
  </td></tr>

  <tr><td style="padding:26px 24px 4px">
    ${title ? `<h2 style="margin:0 0 16px;color:${BRAND.navy};font-size:21px">${title}</h2>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="font-size:15px;line-height:1.6;color:#333">
      <tr><td>${body}</td></tr>
      ${cta}
    </table>
  </td></tr>

  <tr><td style="padding:16px 24px 22px;border-top:1px dashed #ddd;font-size:12.5px;color:#666;line-height:1.7">
    <strong style="color:${BRAND.navy}">${BRAND.name}</strong> &nbsp;&middot;&nbsp; ${BRAND.tagline}<br>
    <a href="${BRAND.site}/faq.html" style="color:${BRAND.navy};text-decoration:none;font-weight:600">FAQ</a> &middot;
    <a href="${BRAND.site}/returns.html" style="color:${BRAND.navy};text-decoration:none;font-weight:600">Returns</a> &middot;
    <a href="${BRAND.site}/privacy.html" style="color:${BRAND.navy};text-decoration:none;font-weight:600">Privacy</a> &middot;
    <a href="${BRAND.facebook}" style="color:${BRAND.navy};text-decoration:none;font-weight:600">Facebook</a><br>
    ${BRAND.phone} &nbsp;&middot;&nbsp; ${BRAND.email} &nbsp;&middot;&nbsp; www.lizimasstore.com
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function renderCustomerText(lines) {
    return lines.concat([
        "",
        "--",
        BRAND.name + " - " + BRAND.tagline,
        BRAND.phone + " | " + BRAND.email,
        BRAND.site
    ]).join("\n");
}

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

/**
 * Sent once, when an order is placed. Status changes use sendOrderStatusEmail.
 * Never throws - a mail failure must not affect an order that already exists.
 */
async function sendOrderConfirmationEmail(email, order, items, receiptUrl) {
    if (!email) return;

    const rows = (items || []).map(function (i) {
        return `<tr>
          <td style="padding:9px 0;border-bottom:1px solid #eee">
            <div style="font-weight:600;color:${BRAND.navy}">${escHtml(i.product_name)}</div>
            <div style="font-size:12px;color:#888">Qty ${Number(i.quantity)}</div>
          </td>
          <td style="padding:9px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;color:${BRAND.navy};font-weight:600">
            ${ugxFmt(Number(i.price) * Number(i.quantity))}
          </td>
        </tr>`;
    }).join("");

    const body = `
<p style="margin:0 0 12px">Hi ${escHtml(order.customer_name)},</p>
<p style="margin:0 0 12px">Thank you for shopping with Lizimas Store.</p>
<p style="margin:0 0 12px">We're pleased to confirm that we've received your order successfully. Your order is now being reviewed and processed by our team.</p>

<h3 style="color:${BRAND.navy};font-size:13px;letter-spacing:.6px;border-bottom:2px solid ${BRAND.gold};padding-bottom:4px;display:inline-block;margin:18px 0 10px">ORDER DETAILS</h3>
<p style="margin:3px 0"><strong>Order Number:</strong> #${order.id}</p>
<p style="margin:3px 0"><strong>Order Total:</strong> ${ugxFmt(order.total)}</p>

${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px;font-size:14px">${rows}</table>` : ""}

<p style="margin:16px 0 12px">We'll keep you updated as your order moves through the next stage. Once your order has been approved and prepared, you'll receive another notification with the relevant delivery or collection information.</p>
<p style="margin:0 0 12px">If you have any questions regarding your order, please contact our support team and have your order number <strong>#${order.id}</strong> ready.</p>
<p style="margin:0 0 4px">Thank you for choosing Lizimas Store. We truly appreciate your business and look forward to serving you again.</p>`;

    const html = renderCustomerEmail({
        title: "Order Confirmed &#127881;",
        bodyHtml: body,
        ctaText: receiptUrl ? "View Your Receipt" : null,
        ctaUrl: receiptUrl || null
    });

    const text = renderCustomerText([
        "Order Confirmed", "",
        `Hi ${order.customer_name},`, "",
        "Thank you for shopping with Lizimas Store.",
        "We've received your order successfully and it is being reviewed.", "",
        `Order Number: #${order.id}`,
        `Order Total: ${ugxFmt(order.total)}`,
        receiptUrl ? `` : null,
        receiptUrl ? `View your receipt: ${receiptUrl}` : null,
        "",
        "We'll notify you as your order progresses."
    ].filter(function (l) { return l !== null; }));

    try {
        await transporter.sendMail({
            from: `"Lizimas Store" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
            to: email,
            subject: `Order #${order.id} Confirmed - Lizimas Store`,
            text: text,
            html: html
        });
    } catch (error) {
        console.error("Order confirmation email error:", error);
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

async function sendStaffInviteEmail(email, name, setupLink, validMinutes) {
    const body = [
        `Welcome to Lizimas Store!`,
        ``,
        `Hi ${name},`,
        ``,
        `We're delighted to welcome you to the Lizimas Store team.`,
        ``,
        `Your staff account has been created. To keep your login secure, you`,
        `will need to create your own password before you can sign in.`,
        ``,
        `Set your password:`,
        setupLink,
        ``,
        `This link expires in ${validMinutes} minutes. If it expires, ask the`,
        `administrator to send you a new one.`,
        ``,
        `For your security:`,
        `  - Create a strong, unique password that you do not use elsewhere.`,
        `  - Keep your login details private and do not share them with anyone.`,
        `  - This setup link is personal to you and should not be forwarded.`,
        ``,
        `We're happy to have you with us, and we look forward to working`,
        `together to make Lizimas Store even better.`,
        ``,
        `Welcome to the team!`,
        ``,
        `Warm regards,`,
        `Admin`,
        `Lizimas Store`
    ].join("\n");

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Welcome to Lizimas Store - Set Up Your Staff Account",
            text: body
        });
        return true;
    } catch (error) {
        console.error("Staff invite email error:", error);
        return false;
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

module.exports = { sendOrderConfirmationEmail, sendStaffInviteEmail, sendDeviceApprovalRequest, sendAdminLoginAlert, sendOrderStatusEmail, sendPasswordResetEmail, sendStaffActivationEmail, sendAccountBlockedEmail, sendAdminBlockAlert, sendTwoFactorCodeEmail, sendScopeViolationAlert, sendSecurityLockAlert, sendAccountReportAlert };
