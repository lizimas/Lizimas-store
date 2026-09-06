const pool = require("../config/database");
const mailer = require("../utils/mailer");

// ---------------------------------------------------------------------------
// Internal staff <-> admin messaging. Separate from the customer-facing live
// chat (chatController.js / conversations table): this is a private, 1:1
// thread per staff member and "admin" as a role, not a specific admin user -
// any admin can read/reply to any staff member's thread. Gated end-to-end by
// app_settings.staff_messaging_enabled so only an admin can turn it on; the
// staff-side widget itself checks this flag before even rendering.

const STAFF_ROLES = ["product_staff", "store_manager", "customer_support"];

function canUseStaffSide(role) {
    return STAFF_ROLES.includes(role) || role === "admin";
}

async function isMessagingEnabled() {
    const result = await pool.query(
        `SELECT value FROM app_settings WHERE key = 'staff_messaging_enabled'`
    );
    return result.rows.length > 0 && result.rows[0].value === "true";
}

// ---------------------------------------------------------------------------
// Staff side: GET/POST /api/staff-messages/mine - always scoped to the
// caller's own thread (req.user.id), so a staff member can never read or post
// into someone else's conversation with admin.

// Cheap poll target for the floating widget - just the enabled flag and an
// unread count, with NO side effects. getMyThread (below) marks admin's
// messages as read as soon as it's called, so the widget must never poll
// that endpoint in the background or opening the panel would stop meaning
// anything.
exports.getMyStatus = async (req, res) => {
    try {
        if (!canUseStaffSide(req.user.role)) {
            return res.status(403).json({ error: "Staff access required." });
        }

        const enabled = await isMessagingEnabled();
        const unreadResult = await pool.query(
            `SELECT COUNT(*) AS unread_count FROM staff_messages
             WHERE staff_user_id = $1 AND is_from_admin = true AND read_by_staff = false`,
            [req.user.id]
        );

        res.json({ enabled, unreadCount: Number(unreadResult.rows[0].unread_count) });
    } catch (error) {
        console.error("getMyStatus error:", error);
        res.status(500).json({ error: "Failed to load status." });
    }
};

exports.getMyThread = async (req, res) => {
    try {
        if (!canUseStaffSide(req.user.role)) {
            return res.status(403).json({ error: "Staff access required." });
        }

        const enabled = await isMessagingEnabled();

        const messagesResult = await pool.query(
            `SELECT id, sender_id, sender_role, is_from_admin, body, created_at
             FROM staff_messages
             WHERE staff_user_id = $1
             ORDER BY created_at ASC
             LIMIT 500`,
            [req.user.id]
        );

        // Viewing the thread marks admin's messages in it as read.
        await pool.query(
            `UPDATE staff_messages SET read_by_staff = true
             WHERE staff_user_id = $1 AND is_from_admin = true AND read_by_staff = false`,
            [req.user.id]
        );

        res.json({ enabled, messages: messagesResult.rows });
    } catch (error) {
        console.error("getMyThread error:", error);
        res.status(500).json({ error: "Failed to load messages." });
    }
};

exports.sendMyMessage = async (req, res) => {
    try {
        if (!canUseStaffSide(req.user.role)) {
            return res.status(403).json({ error: "Staff access required." });
        }

        const enabled = await isMessagingEnabled();
        if (!enabled) {
            return res.status(403).json({ error: "Messaging to admin is currently turned off." });
        }

        const body = (req.body.body || "").trim();
        if (!body) return res.status(400).json({ error: "Message cannot be empty." });
        if (body.length > 2000) return res.status(400).json({ error: "Message is too long (max 2000 characters)." });

        const result = await pool.query(
            `INSERT INTO staff_messages (staff_user_id, sender_id, sender_role, is_from_admin, body)
             VALUES ($1, $1, $2, false, $3)
             RETURNING id, sender_id, sender_role, is_from_admin, body, created_at`,
            [req.user.id, req.user.role, body]
        );

        // Best-effort email so admin finds out even away from the dashboard -
        // never let a mail hiccup fail the message the staff member just sent.
        pool.query(`SELECT name FROM users WHERE id = $1`, [req.user.id])
            .then(r => {
                const senderName = r.rows[0]?.name || "A staff member";
                return mailer.sendStaffMessageAlert({
                    senderName,
                    senderRole: req.user.role,
                    body,
                    time: new Date().toLocaleString("en-GB")
                });
            })
            .catch(err => console.error("sendStaffMessageAlert error:", err));

        res.json(result.rows[0]);
    } catch (error) {
        console.error("sendMyMessage error:", error);
        res.status(500).json({ error: "Failed to send message." });
    }
};

// ---------------------------------------------------------------------------
// Admin side

exports.getStaffMessagingEnabled = async (req, res) => {
    try {
        res.json({ enabled: await isMessagingEnabled() });
    } catch (error) {
        console.error("getStaffMessagingEnabled error:", error);
        res.status(500).json({ error: "Failed to load setting." });
    }
};

exports.setStaffMessagingEnabled = async (req, res) => {
    try {
        const enabled = !!req.body.enabled;
        await pool.query(
            `INSERT INTO app_settings (key, value, updated_at, updated_by)
             VALUES ('staff_messaging_enabled', $1, now(), $2)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now(), updated_by = $2`,
            [String(enabled), req.user.id]
        );
        res.json({ enabled });
    } catch (error) {
        console.error("setStaffMessagingEnabled error:", error);
        res.status(500).json({ error: "Failed to update setting." });
    }
};

// Lists every staff member (not just ones who have already messaged in) so
// admin can start a thread too, most recently active first.
exports.listThreadsForAdmin = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id AS staff_user_id, u.name, u.role,
                    lm.body AS last_message,
                    lm.created_at AS last_message_at,
                    COALESCE(uc.unread_count, 0) AS unread_count
             FROM users u
             LEFT JOIN LATERAL (
                 SELECT body, created_at FROM staff_messages sm
                 WHERE sm.staff_user_id = u.id
                 ORDER BY sm.created_at DESC LIMIT 1
             ) lm ON true
             LEFT JOIN (
                 SELECT staff_user_id, COUNT(*) AS unread_count
                 FROM staff_messages
                 WHERE is_from_admin = false AND read_by_admin = false
                 GROUP BY staff_user_id
             ) uc ON uc.staff_user_id = u.id
             WHERE u.role IN ('product_staff', 'store_manager', 'customer_support')
               AND u.deleted_at IS NULL
             ORDER BY lm.created_at DESC NULLS LAST, u.name ASC`
        );
        res.json(result.rows.map(r => ({
            staffUserId: r.staff_user_id,
            name: r.name,
            role: r.role,
            lastMessage: r.last_message,
            lastMessageAt: r.last_message_at,
            unreadCount: Number(r.unread_count)
        })));
    } catch (error) {
        console.error("listThreadsForAdmin error:", error);
        res.status(500).json({ error: "Failed to load message threads." });
    }
};

exports.getThreadForAdmin = async (req, res) => {
    try {
        const staffUserId = parseInt(req.params.staffUserId, 10);
        if (!Number.isInteger(staffUserId)) return res.status(400).json({ error: "Invalid staff id." });

        const staffResult = await pool.query(
            `SELECT id, name, role FROM users WHERE id = $1 AND deleted_at IS NULL`,
            [staffUserId]
        );
        if (!staffResult.rows.length) return res.status(404).json({ error: "Staff member not found." });

        const messagesResult = await pool.query(
            `SELECT id, sender_id, sender_role, is_from_admin, body, created_at
             FROM staff_messages
             WHERE staff_user_id = $1
             ORDER BY created_at ASC
             LIMIT 500`,
            [staffUserId]
        );

        await pool.query(
            `UPDATE staff_messages SET read_by_admin = true
             WHERE staff_user_id = $1 AND is_from_admin = false AND read_by_admin = false`,
            [staffUserId]
        );

        res.json({ staff: staffResult.rows[0], messages: messagesResult.rows });
    } catch (error) {
        console.error("getThreadForAdmin error:", error);
        res.status(500).json({ error: "Failed to load thread." });
    }
};

exports.replyToThread = async (req, res) => {
    try {
        const staffUserId = parseInt(req.params.staffUserId, 10);
        if (!Number.isInteger(staffUserId)) return res.status(400).json({ error: "Invalid staff id." });

        const staffResult = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`,
            [staffUserId]
        );
        if (!staffResult.rows.length) return res.status(404).json({ error: "Staff member not found." });

        const body = (req.body.body || "").trim();
        if (!body) return res.status(400).json({ error: "Message cannot be empty." });
        if (body.length > 2000) return res.status(400).json({ error: "Message is too long (max 2000 characters)." });

        const result = await pool.query(
            `INSERT INTO staff_messages (staff_user_id, sender_id, sender_role, is_from_admin, body)
             VALUES ($1, $2, 'admin', true, $3)
             RETURNING id, sender_id, sender_role, is_from_admin, body, created_at`,
            [staffUserId, req.user.id, body]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error("replyToThread error:", error);
        res.status(500).json({ error: "Failed to send reply." });
    }
};
