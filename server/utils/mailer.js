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

module.exports = { sendAdminLoginAlert };
