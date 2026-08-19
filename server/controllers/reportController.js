const pool = require("../config/database");
const { sendAccountReportAlert } = require("../utils/mailer");

const VALID_TYPES = ["blocked", "compromised", "no_email", "other"];
const MAX_MESSAGE = 2000;

// POST /api/reports/account
// Public, unauthenticated. The response is identical in every case: it must
// never reveal whether an email corresponds to an account. user_id is resolved
// server-side only so the admin panel can offer an unlock on the report row.
exports.createAccountReport = async (req, res) => {
    try {
        const body = req.body || {};

        // Honeypot: a real browser leaves this empty. Bots fill every field.
        // Respond with the normal acknowledgement so the bot learns nothing.
        if (String(body.website || "").trim() !== "") {
            return res.json({ ok: true });
        }

        const email = String(body.email || "").trim().toLowerCase();
        const reportType = String(body.report_type || "").trim();
        const message = String(body.message || "").trim().slice(0, MAX_MESSAGE);

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
            return res.status(400).json({ error: "Please enter a valid email address." });
        }
        if (!VALID_TYPES.includes(reportType)) {
            return res.status(400).json({ error: "Please choose what the problem is." });
        }

        const found = await pool.query(
            "SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1",
            [email]
        );
        const userId = found.rows.length ? found.rows[0].id : null;

        const ip = req.headers["cf-connecting-ip"] || req.ip || null;
        const userAgent = String(req.headers["user-agent"] || "").slice(0, 500);

        const inserted = await pool.query(
            `INSERT INTO account_reports (report_type, email, user_id, message, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
            [reportType, email, userId, message || null, ip, userAgent]
        );

        // Alert is best-effort: the row is already committed, so a mailer
        // failure must not surface to the reporter or lose the report.
        sendAccountReportAlert({
            id: inserted.rows[0].id,
            reportType,
            email,
            hasAccount: Boolean(userId),
            message: message || "(none)",
            ip: ip || "unknown",
            time: new Date().toISOString(),
        }).catch((err) => console.error("Account report alert email error:", err));

        return res.json({ ok: true });
    } catch (error) {
        console.error("createAccountReport error:", error);
        return res.status(500).json({ error: "Could not submit your report. Please try again later." });
    }
};
