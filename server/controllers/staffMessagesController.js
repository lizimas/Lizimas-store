const pool = require("../config/database");
const mailer = require("../utils/mailer");
const { uploadChatAttachment } = require("../utils/cloudinaryUpload");

// ---------------------------------------------------------------------------
// Internal staff <-> admin messaging. Separate from the customer-facing live
// chat (chatController.js / conversations table): this is a private, 1:1
// thread per staff member and "admin" as a role, not a specific admin user -
// any admin can read/reply to any staff member's thread. Gated end-to-end by
// app_settings.staff_messaging_enabled so only an admin can turn it on; the
// staff-side widget itself checks this flag before even rendering.
//
// Messages carry a message_type ('text' | 'sticker' | 'file') so the chat
// window can render a Messenger-style mix of plain bubbles, big-emoji
// stickers, and file/document attachments (migrations/060).

const STAFF_ROLES = ["product_staff", "store_manager", "customer_support"];
const MESSAGE_COLUMNS =
    "id, sender_id, sender_role, is_from_admin, body, message_type, attachment_url, attachment_name, attachment_bytes, created_at";
// A heartbeat older than this no longer counts as "online" - the header
// falls back to showing when that last heartbeat actually was.
const ONLINE_WINDOW = "90 seconds";

function canUseStaffSide(role) {
    return STAFF_ROLES.includes(role) || role === "admin";
}

async function isMessagingEnabled() {
    const result = await pool.query(
        `SELECT value FROM app_settings WHERE key = 'staff_messaging_enabled'`
    );
    return result.rows.length > 0 && result.rows[0].value === "true";
}

// Presence shown to staff is "is any admin online right now" - there's no
// single admin account, so the most recent heartbeat across all of them is
// what the staff-side chat window displays as "Admin".
async function getAdminPresence() {
    const result = await pool.query(
        `SELECT MAX(smp.last_seen_at) AS last_seen_at
         FROM staff_message_presence smp
         JOIN users u ON u.id = smp.user_id
         WHERE u.role = 'admin'`
    );
    return result.rows[0]?.last_seen_at || null;
}

async function getUserPresence(userId) {
    const result = await pool.query(
        `SELECT last_seen_at FROM staff_message_presence WHERE user_id = $1`,
        [userId]
    );
    return result.rows[0]?.last_seen_at || null;
}

function resolveMessageType(raw) {
    return raw === "sticker" ? "sticker" : "text";
}

// Shared by both send endpoints (staff -> admin, admin -> staff). Stickers
// are just an emoji string rendered large client-side, so they get a much
// smaller length cap than a real message.
function validateBody(body, messageType) {
    if (!body) return "Message cannot be empty.";
    if (messageType === "sticker" && body.length > 16) return "That doesn't look like a sticker.";
    if (messageType === "text" && body.length > 2000) return "Message is too long (max 2000 characters).";
    return null;
}

// ---------------------------------------------------------------------------
// Presence heartbeat - called every ~20-30s by the chat window (either side)
// while it's open, so "Active now" / "Active Xm ago" stays meaningful. Any
// staff or admin account may call it; it only ever touches the caller's own
// row.
exports.heartbeat = async (req, res) => {
    try {
        if (!canUseStaffSide(req.user.role)) {
            return res.status(403).json({ error: "Staff access required." });
        }
        await pool.query(
            `INSERT INTO staff_message_presence (user_id, last_seen_at)
             VALUES ($1, now())
             ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
            [req.user.id]
        );
        res.json({ ok: true });
    } catch (error) {
        console.error("heartbeat error:", error);
        res.status(500).json({ error: "Failed to record presence." });
    }
};

// ---------------------------------------------------------------------------
// Staff side: GET/POST /api/staff-messages/mine - always scoped to the
// caller's own thread (req.user.id), so a staff member can never read or post
// into someone else's conversation with admin.

// Cheap poll target for the chat window - just the enabled flag, an unread
// count and admin's presence, with NO side effects. getMyThread (below)
// marks admin's messages as read as soon as it's called, so this must never
// be swapped in for that in the background or opening the window would stop
// meaning anything.
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
        const adminPresence = await getAdminPresence();

        res.json({
            enabled,
            unreadCount: Number(unreadResult.rows[0].unread_count),
            adminPresence
        });
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
            `SELECT ${MESSAGE_COLUMNS}
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

        const adminPresence = await getAdminPresence();

        res.json({ enabled, messages: messagesResult.rows, adminPresence });
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

        const messageType = resolveMessageType(req.body.messageType);
        const body = (req.body.body || "").trim();
        const validationError = validateBody(body, messageType);
        if (validationError) return res.status(400).json({ error: validationError });

        const result = await pool.query(
            `INSERT INTO staff_messages (staff_user_id, sender_id, sender_role, is_from_admin, body, message_type)
             VALUES ($1, $1, $2, false, $3, $4)
             RETURNING ${MESSAGE_COLUMNS}`,
            [req.user.id, req.user.role, body, messageType]
        );

        sendStaffMessageAlertBestEffort(req.user, body, messageType);

        res.json(result.rows[0]);
    } catch (error) {
        console.error("sendMyMessage error:", error);
        res.status(500).json({ error: "Failed to send message." });
    }
};

// Attachment upload, staff -> admin. Separate from sendMyMessage because it's
// multipart/form-data (a file), not JSON - multer hands the buffer to
// Cloudinary, then the same staff_messages row shape gets an attachment
// instead of a typed body.
exports.uploadMyAttachment = async (req, res) => {
    try {
        if (!canUseStaffSide(req.user.role)) {
            return res.status(403).json({ error: "Staff access required." });
        }

        const enabled = await isMessagingEnabled();
        if (!enabled) {
            return res.status(403).json({ error: "Messaging to admin is currently turned off." });
        }

        if (!req.file) return res.status(400).json({ error: "No file was attached." });

        const uploaded = await uploadChatAttachment(req.file.buffer, req.file.originalname);
        const caption = (req.body.caption || "").trim();
        const body = caption || req.file.originalname;

        const result = await pool.query(
            `INSERT INTO staff_messages
                (staff_user_id, sender_id, sender_role, is_from_admin, body, message_type,
                 attachment_url, attachment_name, attachment_bytes)
             VALUES ($1, $1, $2, false, $3, 'file', $4, $5, $6)
             RETURNING ${MESSAGE_COLUMNS}`,
            [req.user.id, req.user.role, body, uploaded.url, req.file.originalname, req.file.size]
        );

        sendStaffMessageAlertBestEffort(req.user, `📎 ${req.file.originalname}`, "file");

        res.json(result.rows[0]);
    } catch (error) {
        console.error("uploadMyAttachment error:", error);
        res.status(500).json({ error: "Failed to send attachment." });
    }
};

function sendStaffMessageAlertBestEffort(user, body, messageType) {
    // Best-effort email so admin finds out even away from the dashboard -
    // never let a mail hiccup fail the message the staff member just sent.
    pool.query(`SELECT name FROM users WHERE id = $1`, [user.id])
        .then(r => {
            const senderName = r.rows[0]?.name || "A staff member";
            return mailer.sendStaffMessageAlert({
                senderName,
                senderRole: user.role,
                body: messageType === "sticker" ? `${body} (sticker)` : body,
                time: new Date().toLocaleString("en-GB")
            });
        })
        .catch(err => console.error("sendStaffMessageAlert error:", err));
}

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
                    lm.message_type AS last_message_type,
                    lm.created_at AS last_message_at,
                    COALESCE(uc.unread_count, 0) AS unread_count,
                    smp.last_seen_at
             FROM users u
             LEFT JOIN LATERAL (
                 SELECT body, message_type, created_at FROM staff_messages sm
                 WHERE sm.staff_user_id = u.id
                 ORDER BY sm.created_at DESC LIMIT 1
             ) lm ON true
             LEFT JOIN (
                 SELECT staff_user_id, COUNT(*) AS unread_count
                 FROM staff_messages
                 WHERE is_from_admin = false AND read_by_admin = false
                 GROUP BY staff_user_id
             ) uc ON uc.staff_user_id = u.id
             LEFT JOIN staff_message_presence smp ON smp.user_id = u.id
             WHERE u.role IN ('product_staff', 'store_manager', 'customer_support')
               AND u.deleted_at IS NULL
             ORDER BY lm.created_at DESC NULLS LAST, u.name ASC`
        );
        res.json(result.rows.map(r => ({
            staffUserId: r.staff_user_id,
            name: r.name,
            role: r.role,
            lastMessage: r.last_message_type === "file" ? `📎 ${r.last_message}` : r.last_message,
            lastMessageAt: r.last_message_at,
            unreadCount: Number(r.unread_count),
            lastSeenAt: r.last_seen_at
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
            `SELECT ${MESSAGE_COLUMNS}
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

        const lastSeenAt = await getUserPresence(staffUserId);

        res.json({
            staff: { ...staffResult.rows[0], lastSeenAt },
            messages: messagesResult.rows
        });
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

        const messageType = resolveMessageType(req.body.messageType);
        const body = (req.body.body || "").trim();
        const validationError = validateBody(body, messageType);
        if (validationError) return res.status(400).json({ error: validationError });

        const result = await pool.query(
            `INSERT INTO staff_messages (staff_user_id, sender_id, sender_role, is_from_admin, body, message_type)
             VALUES ($1, $2, 'admin', true, $3, $4)
             RETURNING ${MESSAGE_COLUMNS}`,
            [staffUserId, req.user.id, body, messageType]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error("replyToThread error:", error);
        res.status(500).json({ error: "Failed to send reply." });
    }
};

// Attachment upload, admin -> staff. Mirrors uploadMyAttachment above.
exports.uploadThreadAttachment = async (req, res) => {
    try {
        const staffUserId = parseInt(req.params.staffUserId, 10);
        if (!Number.isInteger(staffUserId)) return res.status(400).json({ error: "Invalid staff id." });
        if (!req.file) return res.status(400).json({ error: "No file was attached." });

        const staffResult = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`,
            [staffUserId]
        );
        if (!staffResult.rows.length) return res.status(404).json({ error: "Staff member not found." });

        const uploaded = await uploadChatAttachment(req.file.buffer, req.file.originalname);
        const caption = (req.body.caption || "").trim();
        const body = caption || req.file.originalname;

        const result = await pool.query(
            `INSERT INTO staff_messages
                (staff_user_id, sender_id, sender_role, is_from_admin, body, message_type,
                 attachment_url, attachment_name, attachment_bytes)
             VALUES ($1, $2, 'admin', true, $3, 'file', $4, $5, $6)
             RETURNING ${MESSAGE_COLUMNS}`,
            [staffUserId, req.user.id, body, uploaded.url, req.file.originalname, req.file.size]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error("uploadThreadAttachment error:", error);
        res.status(500).json({ error: "Failed to send attachment." });
    }
};
