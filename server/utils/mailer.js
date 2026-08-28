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

function renderInternalEmail(opts) {
    const title = opts.title || "";
    const intro = opts.introHtml || "";
    const rows = (opts.rows || []).map(function (r) {
        return `<tr>
          <td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top">${escHtml(r[0])}</td>
          <td style="padding:6px 0;color:#111;word-break:break-word">${escHtml(r[1] == null ? "" : r[1])}</td>
        </tr>`;
    }).join("");
    const note = opts.noteHtml
        ? `<p style="margin:16px 0 0;font-size:13px;color:#555">${opts.noteHtml}</p>`
        : "";

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:18px 10px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">

  <tr><td style="background:${BRAND.navy};padding:14px 20px">
    <span style="color:${BRAND.gold};font-size:14px;font-weight:800;letter-spacing:.5px">LIZIMAS STORE</span>
    <span style="color:#8b93a7;font-size:12px;margin-left:8px">internal notification</span>
  </td></tr>

  <tr><td style="padding:22px 24px 6px">
    ${title ? `<h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:18px">${escHtml(title)}</h2>` : ""}
    ${intro ? `<div style="font-size:14.5px;line-height:1.6;color:#333;margin:0 0 14px">${intro}</div>` : ""}
    ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13.5px;border-top:1px solid #eee;margin-top:4px;width:100%">${rows}</table>` : ""}
    ${note}
  </td></tr>

  <tr><td style="padding:14px 24px 20px;border-top:1px dashed #ddd;font-size:12px;color:#888">
    Sent automatically by ${BRAND.name}. No action is required unless stated above.
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
        text: renderCustomerText([
            "Admin login detected.",
            "",
            `Name:  ${details.name}`,
            `Email: ${details.email}`,
            `Time:  ${details.time}`,
            `IP:    ${details.ip}`
        ]),
        html: renderInternalEmail({
            title: "Admin login detected",
            introHtml: "An administrator signed in to the dashboard.",
            rows: [
                ["Name", details.name],
                ["Email", details.email],
                ["Time", details.time],
                ["IP", details.ip]
            ]
        })
    });
}

const { slugify } = require("./slugify");

// Canonical product URL - must match the /product/:slug-:id route.
function productUrl(id, name) {
    return `${BRAND.site}/product/${slugify(name)}-${id}`;
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
async function sendOrderStatusEmail(email, order, status, items) {
    if (!email) return;

    const statusMessage = ORDER_STATUS_MESSAGES[status] || `Your order status is now: ${status}`;

    try {
        const name = order.customer_name || order.customer_email || "Customer";
        const orderUrl = `${BRAND.site}/orders.html`;
        const isDelivered = status === "delivered";
        const list = Array.isArray(items) ? items : [];

        // Delivered mail names what arrived and links each item back to its
        // product page. Reviews are written from the orders page, so the CTA
        // points there rather than at the product.
        const itemRowsHtml = (isDelivered && list.length)
            ? list.map(function (i) {
                return `<tr>
          <td style="padding:9px 0;border-bottom:1px solid #eee">
            <a href="${productUrl(i.product_id, i.product_name)}" style="font-weight:600;color:${BRAND.navy};text-decoration:none">${escHtml(i.product_name)}</a>
            <div style="font-size:12px;color:#888">Qty ${Number(i.quantity)}</div>
          </td>
        </tr>`;
              }).join("")
            : "";

        const itemLinesText = (isDelivered && list.length)
            ? [""].concat(list.map(function (i) {
                return `- ${i.product_name} (x${Number(i.quantity)})\n  ${productUrl(i.product_id, i.product_name)}`;
              }))
            : [];

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Order #${order.id} Update - Lizimas Store`,
            text: renderCustomerText([
                `Hi ${name},`,
                "",
                statusMessage,
                "",
                `Order Number: #${order.id}`,
                `Order Total:  ${ugxFmt(order.total)}`
            ].concat(itemLinesText).concat([
                "",
                isDelivered
                    ? `Tell other shoppers what you think - review your purchase: ${orderUrl}`
                    : `View your orders: ${orderUrl}`
            ])),
            html: renderCustomerEmail({
                title: `Order #${order.id} Update`,
                bodyHtml: `
<p style="margin:0 0 12px">Hi ${escHtml(name)},</p>
<p style="margin:0 0 12px">${escHtml(statusMessage)}</p>
<h3 style="color:${BRAND.navy};font-size:13px;letter-spacing:.6px;border-bottom:2px solid ${BRAND.gold};padding-bottom:4px;display:inline-block;margin:18px 0 10px">ORDER DETAILS</h3>
<p style="margin:3px 0"><strong>Order Number:</strong> #${order.id}</p>
<p style="margin:3px 0"><strong>Order Total:</strong> ${ugxFmt(order.total)}</p>
${itemRowsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px;font-size:14px">${itemRowsHtml}</table>` : ""}
${isDelivered ? `<p style="margin:16px 0 0">If everything arrived as expected, a short review helps other shoppers decide - and takes less than a minute.</p>` : ""}`,
                ctaUrl: orderUrl,
                ctaText: status === "delivered" ? "Review your purchase" : "View your order"
            })
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
async function sendOrderConfirmationEmail(email, order, items, receiptUrl, stage) {
    if (!email) return;

    // stage: "placed" (order received) or "paid" (payment settled).
    // Defaults to placed so the checkout call site needs no change.
    const isPaid = stage === "paid";

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
<p style="margin:0 0 12px">Hi ${escHtml(order.customer_name || order.customer_email || "Customer")},</p>
<p style="margin:0 0 12px">Thank you for shopping with Lizimas Store.</p>
${isPaid
  ? `<p style="margin:0 0 12px">We've received your payment in full. Your order is now confirmed and moving into preparation.</p>`
  : `<p style="margin:0 0 12px">We're pleased to confirm that we've received your order successfully. Your order is now being reviewed and processed by our team.</p>`}

<h3 style="color:${BRAND.navy};font-size:13px;letter-spacing:.6px;border-bottom:2px solid ${BRAND.gold};padding-bottom:4px;display:inline-block;margin:18px 0 10px">ORDER DETAILS</h3>
<p style="margin:3px 0"><strong>Order Number:</strong> #${order.id}</p>
<p style="margin:3px 0"><strong>Order Total:</strong> ${ugxFmt(order.total)}</p>
${isPaid ? `<p style="margin:3px 0"><strong>Amount Paid:</strong> ${ugxFmt(order.amount_paid || order.total)}</p>${order.receipt_number ? `<p style="margin:3px 0"><strong>Receipt Number:</strong> ${escHtml(order.receipt_number)}</p>` : ""}` : ""}

${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px;font-size:14px">${rows}</table>` : ""}

${isPaid
  ? `<p style="margin:16px 0 12px">Your payment is confirmed and nothing further is needed from you. We'll be in touch with delivery or collection details once your order has been prepared.</p>`
  : `<p style="margin:16px 0 12px">We'll keep you updated as your order moves through the next stage. Once your order has been approved and prepared, you'll receive another notification with the relevant delivery or collection information.</p>`}
<p style="margin:0 0 12px">If you have any questions regarding your order, please contact our support team and have your order number <strong>#${order.id}</strong> ready.</p>
<p style="margin:0 0 4px">Thank you for choosing Lizimas Store. We truly appreciate your business and look forward to serving you again.</p>`;

    const html = renderCustomerEmail({
        title: isPaid ? "Payment Received &#127881;" : "Order Confirmed &#127881;",
        bodyHtml: body,
        ctaText: receiptUrl ? "View Your Receipt" : null,
        ctaUrl: receiptUrl || null
    });

    const text = renderCustomerText([
        isPaid ? "Payment Received" : "Order Confirmed", "",
        `Hi ${order.customer_name || order.customer_email || "Customer"},`, "",
        "Thank you for shopping with Lizimas Store.",
        isPaid
            ? "We've received your payment in full. Your order is confirmed."
            : "We've received your order successfully and it is being reviewed.", "",
        `Order Number: #${order.id}`,
        `Order Total: ${ugxFmt(order.total)}`,
        isPaid ? `Amount Paid: ${ugxFmt(order.amount_paid || order.total)}` : null,
        isPaid && order.receipt_number ? `Receipt Number: ${order.receipt_number}` : null,
        receiptUrl ? `` : null,
        receiptUrl ? `View your receipt: ${receiptUrl}` : null,
        "",
        "We'll notify you as your order progresses."
    ].filter(function (l) { return l !== null; }));

    try {
        await transporter.sendMail({
            from: `"Lizimas Store" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
            to: email,
            subject: isPaid
                ? `Payment Received for Order #${order.id} - Lizimas Store`
                : `Order #${order.id} Confirmed - Lizimas Store`,
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
            text: renderCustomerText([
                "We received a request to reset your password.",
                "",
                `Open this link to set a new password (valid for ${validMinutes} minutes):`,
                resetLink,
                "",
                "This link can only be used once.",
                "",
                "If you didn't request this, you can safely ignore this email - your password will remain unchanged."
            ]),
            html: renderCustomerEmail({
                title: "Reset your password",
                bodyHtml: `
<p style="margin:0 0 12px">We received a request to reset your Lizimas Store password.</p>
<p style="margin:0 0 12px">Use the button below to set a new one. The link is valid for <strong>${validMinutes} minutes</strong> and can only be used once.</p>
<p style="margin:16px 0 0;font-size:13px;color:#666">If you didn't request this, you can safely ignore this email - your password will remain unchanged.</p>`,
                ctaUrl: resetLink,
                ctaText: "Set a new password"
            })
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
            text: renderCustomerText([
                "Your login verification code is:",
                "",
                String(code),
                "",
                "This code expires in 10 minutes and can only be used once.",
                "",
                "If you didn't try to log in, someone may have your password. Change it immediately."
            ]),
            html: renderCustomerEmail({
                title: "Your login code",
                bodyHtml: `
<p style="margin:0 0 14px">Enter this code to finish signing in:</p>
<p style="margin:0 0 14px;font-size:30px;font-weight:800;letter-spacing:7px;color:${BRAND.navy}">${escHtml(code)}</p>
<p style="margin:0 0 12px">The code expires in 10 minutes and can only be used once.</p>
<p style="margin:16px 0 0;font-size:13px;color:#b23b3b">If you didn't try to log in, someone may have your password. Change it immediately.</p>`
            })
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
            text: renderCustomerText([
                `Hi ${name},`,
                "",
                "Your staff account has been approved and is now active.",
                "You can log in to the staff dashboard anytime.",
                "",
                "Welcome to the team!"
            ]),
            html: renderCustomerEmail({
                title: "Your staff account is active",
                bodyHtml: `
<p style="margin:0 0 12px">Hi ${escHtml(name)},</p>
<p style="margin:0 0 12px">Your staff account has been approved and is now active. You can sign in to the staff dashboard at any time.</p>
<p style="margin:0 0 12px">Welcome to the team.</p>`,
                ctaUrl: `${BRAND.site}/staff-login.html`,
                ctaText: "Go to staff login"
            })
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
            text: renderCustomerText([
                `Hi ${name},`,
                "",
                "Your account has been blocked due to repeated unauthorized attempts to access the admin panel.",
                "",
                "Please stop trying to log in and contact the administrator to have your account reviewed and reactivated."
            ]),
            html: renderCustomerEmail({
                title: "Your account has been blocked",
                bodyHtml: `
<p style="margin:0 0 12px">Hi ${escHtml(name)},</p>
<p style="margin:0 0 12px">Your account has been blocked following repeated unauthorized attempts to access the admin panel.</p>
<p style="margin:0 0 12px">Please stop trying to sign in and contact the administrator to have your account reviewed and reactivated.</p>`
            })
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
            text: renderCustomerText([
                "A staff account was automatically blocked after 3 unauthorized admin panel access attempts.",
                "",
                `Name:  ${details.name}`,
                `Email: ${details.email}`,
                `Time:  ${details.time}`,
                "",
                "Review and reactivate from the Staff & Approvals tab in your admin dashboard."
            ]),
            html: renderInternalEmail({
                title: "Staff account auto-blocked",
                introHtml: "A staff account was automatically blocked after 3 unauthorized admin panel access attempts.",
                rows: [
                    ["Name", details.name],
                    ["Email", details.email],
                    ["Time", details.time]
                ],
                noteHtml: "Review and reactivate this account from the Staff &amp; Approvals tab in your admin dashboard."
            })
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
            text: renderCustomerText([
                "A login attempt with a CORRECT email and password was refused because it was made from the wrong login portal.",
                "",
                "No session was created. No token was issued. No two-factor enrolment was allowed.",
                "",
                `Account:     ${details.email}`,
                `Role:        ${details.role}`,
                `Portal used: ${details.surface}`,
                "Status:      BLOCKED",
                `IP:          ${details.ip}`,
                `Browser:     ${details.userAgent}`,
                `Time:        ${details.time}`,
                "",
                "If this was not the account holder, treat the password as compromised and reset it immediately."
            ]),
            html: renderInternalEmail({
                title: "Blocked login - wrong portal",
                introHtml: "A login attempt with a <strong>correct</strong> email and password was refused because it came from the wrong login portal.<br>No session was created, no token was issued, and no two-factor enrolment was allowed.",
                rows: [
                    ["Account", details.email],
                    ["Role", details.role],
                    ["Portal used", details.surface],
                    ["Status", "BLOCKED"],
                    ["IP", details.ip],
                    ["Browser", details.userAgent],
                    ["Time", details.time]
                ],
                noteHtml: "If this was not the account holder, treat the password as compromised and reset it immediately from the admin dashboard."
            })
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
            text: renderCustomerText(body.split("\n")),
            html: renderInternalEmail({
                title: "Account locked - unrecognised device",
                introHtml: "An attempt was made to sign in from a device that has not been used before. The sign-in was refused and the account has been locked pending review.",
                rows: [
                    ["Account", details.email],
                    ["Role", details.role],
                    ["Portal", details.surface],
                    ["IP", details.ip],
                    ["Device", details.userAgent],
                    ["Time", details.time]
                ],
                noteHtml: "If this was you, contact the administrator to unlock the account. If it was not, the password should be treated as compromised and changed once access is restored."
            })
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
            text: renderCustomerText([
                "A customer submitted an account issue report from the website footer.",
                "",
                `Report ID:          ${details.id}`,
                `Type:               ${details.reportType}`,
                `Email given:        ${details.email}`,
                `Matches an account: ${details.hasAccount ? "yes" : "no"}`,
                `IP:                 ${details.ip}`,
                `Time:               ${details.time}`,
                "",
                "Message:",
                details.message,
                "",
                "Review and action this from the Security tab in your admin dashboard."
            ]),
            html: renderInternalEmail({
                title: "Account issue report #" + escHtml(details.id),
                introHtml: "A customer submitted an account issue report from the website footer.",
                rows: [
                    ["Report ID", details.id],
                    ["Type", details.reportType],
                    ["Email given", details.email],
                    ["Matches an account", details.hasAccount ? "yes" : "no"],
                    ["IP", details.ip],
                    ["Time", details.time],
                    ["Message", details.message]
                ],
                noteHtml: "Review and action this from the Security tab in your admin dashboard."
            })
        });
    } catch (error) {
        console.error("Account report alert email error:", error);
    }
}

module.exports = { sendOrderConfirmationEmail, sendStaffInviteEmail, sendDeviceApprovalRequest, sendAdminLoginAlert, sendOrderStatusEmail, sendPasswordResetEmail, sendStaffActivationEmail, sendAccountBlockedEmail, sendAdminBlockAlert, sendTwoFactorCodeEmail, sendScopeViolationAlert, sendSecurityLockAlert, sendAccountReportAlert };
