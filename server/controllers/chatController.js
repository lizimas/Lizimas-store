const crypto = require("crypto");
const pool = require("../config/database");

// Guests are identified by a random token returned once at chat start and
// held in the browser. It is sent back on every subsequent request via the
// X-Chat-Token header. Anyone holding the token can read that thread, which
// is why guest_name and guest_phone are captured up front.
function newGuestToken() {
    return crypto.randomBytes(32).toString("hex");
}

function chatToken(req) {
    return req.get("X-Chat-Token") || req.query.token || null;
}

// The JWT payload uses userId. Accept id too, so this survives any future
// normalisation of the token shape.
function currentUserId(req) {
    if (!req.user) return null;
    return req.user.userId != null ? req.user.userId : req.user.id;
}

// Resolves a conversation the caller is actually entitled to see. Logged-in
// customers match on customer_id; guests match on the token. Returns null
// rather than throwing so callers can decide between 403 and 404.
async function loadOwnedConversation(conversationId, req) {
    const result = await pool.query(
        `SELECT * FROM chat_conversations WHERE id = $1`,
        [conversationId]
    );
    const conv = result.rows[0];
    if (!conv) return null;

    if (req.user && conv.customer_id === currentUserId(req)) return conv;

    const token = chatToken(req);
    if (token && conv.guest_token && conv.guest_token === token) return conv;

    return null;
}

// Public: open a thread and post the first message in one transaction.
exports.startConversation = async (req, res) => {
    const { name, phone, email, subject, message } = req.body;

    if (!message || !String(message).trim()) {
        return res.status(400).json({ message: "A first message is required" });
    }
    if (!req.user && (!name || !String(name).trim())) {
        return res.status(400).json({ message: "Please tell us your name" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const isGuest = !req.user;
        const token = isGuest ? newGuestToken() : null;

        const conv = await client.query(
            `INSERT INTO chat_conversations
                 (customer_id, guest_token, guest_name, guest_phone, guest_email,
                  subject, status, staff_unread, last_message_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'open', 1, CURRENT_TIMESTAMP)
             RETURNING id, status, created_at`,
            [
                req.user ? currentUserId(req) : null,
                token,
                isGuest ? String(name).trim() : null,
                isGuest && phone ? String(phone).trim() : null,
                isGuest && email ? String(email).trim().slice(0, 255) : null,
                subject ? String(subject).trim().slice(0, 160) : null
            ]
        );

        const conversationId = conv.rows[0].id;

        const msg = await client.query(
            `INSERT INTO chat_messages (conversation_id, sender_type, body)
             VALUES ($1, 'customer', $2)
             RETURNING id, sender_type, body, created_at`,
            [conversationId, String(message).trim()]
        );

        await client.query("COMMIT");

        res.status(201).json({
            conversation_id: conversationId,
            guest_token: token,
            status: conv.rows[0].status,
            messages: msg.rows
        });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Start conversation error:", error);
        res.status(500).json({ message: "Failed to start the chat" });
    } finally {
        client.release();
    }
};

// Public: poll for messages after a cursor. The cursor is a message id, not a
// timestamp - two messages in the same second would be indistinguishable.
exports.getMessages = async (req, res) => {
    try {
        const conv = await loadOwnedConversation(req.params.id, req);
        if (!conv) return res.status(404).json({ message: "Conversation not found" });

        const after = Number.parseInt(req.query.after, 10) || 0;

        const result = await pool.query(
            `SELECT id, sender_type, sender_staff_id, body, attachment_url, created_at
             FROM chat_messages
             WHERE conversation_id = $1 AND id > $2
             ORDER BY id ASC
             LIMIT 100`,
            [conv.id, after]
        );

        res.json({
            status: conv.status,
            customer_unread: conv.customer_unread,
            messages: result.rows
        });
    } catch (error) {
        console.error("Get chat messages error:", error);
        res.status(500).json({ message: "Failed to load messages" });
    }
};

// Public: customer posts a reply.
exports.postMessage = async (req, res) => {
    const { body } = req.body;

    if (!body || !String(body).trim()) {
        return res.status(400).json({ message: "Message cannot be empty" });
    }

    const client = await pool.connect();
    try {
        const conv = await loadOwnedConversation(req.params.id, req);
        if (!conv) return res.status(404).json({ message: "Conversation not found" });
        if (conv.status === "closed") {
            return res.status(409).json({ message: "This chat has been closed" });
        }

        await client.query("BEGIN");

        const msg = await client.query(
            `INSERT INTO chat_messages (conversation_id, sender_type, body)
             VALUES ($1, 'customer', $2)
             RETURNING id, sender_type, body, created_at`,
            [conv.id, String(body).trim()]
        );

        // Counters are denormalised so the staff badge never scans messages.
        await client.query(
            `UPDATE chat_conversations
             SET staff_unread = staff_unread + 1,
                 last_message_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [conv.id]
        );

        await client.query("COMMIT");
        res.status(201).json(msg.rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Post chat message error:", error);
        res.status(500).json({ message: "Failed to send the message" });
    } finally {
        client.release();
    }
};

// Public: customer has seen staff replies.
exports.markCustomerRead = async (req, res) => {
    try {
        const conv = await loadOwnedConversation(req.params.id, req);
        if (!conv) return res.status(404).json({ message: "Conversation not found" });

        await pool.query(
            `UPDATE chat_conversations SET customer_unread = 0 WHERE id = $1`,
            [conv.id]
        );
        res.json({ message: "Marked as read" });
    } catch (error) {
        console.error("Mark chat read error:", error);
        res.status(500).json({ message: "Failed to update the conversation" });
    }
};

// Support/admin: the inbox. Defaults to threads that still need a reply.
exports.listConversations = async (req, res) => {
    try {
        const status = req.query.status || "open";
        const mine = req.query.mine === "true";
        const unassigned = req.query.unassigned === "true";
        const search = (req.query.search || "").trim();

        const params = [];
        const where = [];

        if (status !== "all") {
            params.push(status);
            where.push(`c.status = $${params.length}`);
        }
        if (mine) {
            params.push(currentUserId(req));
            where.push(`c.assigned_staff_id = $${params.length}`);
        }
        if (unassigned) {
            where.push("c.assigned_staff_id IS NULL");
        }
        if (search) {
            // One parameter reused across four columns, so an agent can paste
            // a phone number or type a partial name and get the same result.
            params.push(`%${search}%`);
            const p = `$${params.length}`;
            where.push(`(u.name ILIKE ${p} OR c.guest_name ILIKE ${p}
                      OR u.phone ILIKE ${p} OR c.guest_phone ILIKE ${p}
                      OR c.subject ILIKE ${p})`);
        }

        const result = await pool.query(
            `SELECT c.id, c.subject, c.status, c.staff_unread, c.last_message_at,
                    c.created_at, c.assigned_staff_id,
                    COALESCE(u.name, c.guest_name) AS display_name,
                    COALESCE(u.phone, c.guest_phone) AS display_phone,
                    (c.customer_id IS NULL) AS is_guest,
                    s.name AS assigned_staff_name,
                    (SELECT body FROM chat_messages m
                      WHERE m.conversation_id = c.id
                      ORDER BY m.id DESC LIMIT 1) AS last_message
             FROM chat_conversations c
             LEFT JOIN users u ON u.id = c.customer_id
             LEFT JOIN users s ON s.id = c.assigned_staff_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
             LIMIT 100`,
            params
        );

        res.json(result.rows);
    } catch (error) {
        console.error("List conversations error:", error);
        res.status(500).json({ message: "Failed to load conversations" });
    }
};

// Support/admin: read a thread. Clears the staff unread badge.
exports.getConversationForStaff = async (req, res) => {
    try {
        const after = Number.parseInt(req.query.after, 10) || 0;

        const conv = await pool.query(
            `SELECT c.*, COALESCE(u.name, c.guest_name) AS display_name,
                    COALESCE(u.phone, c.guest_phone) AS display_phone
             FROM chat_conversations c
             LEFT JOIN users u ON u.id = c.customer_id
             WHERE c.id = $1`,
            [req.params.id]
        );
        if (!conv.rows[0]) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const messages = await pool.query(
            `SELECT id, sender_type, sender_staff_id, body, attachment_url, created_at
             FROM chat_messages
             WHERE conversation_id = $1 AND id > $2
             ORDER BY id ASC
             LIMIT 200`,
            [req.params.id, after]
        );

        if (after === 0) {
            await pool.query(
                `UPDATE chat_conversations SET staff_unread = 0 WHERE id = $1`,
                [req.params.id]
            );
        }

        res.json({ conversation: conv.rows[0], messages: messages.rows });
    } catch (error) {
        console.error("Get conversation error:", error);
        res.status(500).json({ message: "Failed to load the conversation" });
    }
};

// Support/admin: reply.
exports.postStaffMessage = async (req, res) => {
    const { body } = req.body;

    if (!body || !String(body).trim()) {
        return res.status(400).json({ message: "Message cannot be empty" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const msg = await client.query(
            `INSERT INTO chat_messages
                 (conversation_id, sender_type, sender_staff_id, body)
             VALUES ($1, 'staff', $2, $3)
             RETURNING id, sender_type, sender_staff_id, body, created_at`,
            [req.params.id, currentUserId(req), String(body).trim()]
        );

        // Claim the thread on first reply if nobody owns it yet.
        await client.query(
            `UPDATE chat_conversations
             SET customer_unread = customer_unread + 1,
                 staff_unread = 0,
                 last_message_at = CURRENT_TIMESTAMP,
                 assigned_staff_id = COALESCE(assigned_staff_id, $2),
                 status = CASE WHEN status = 'closed' THEN 'open' ELSE status END
             WHERE id = $1`,
            [req.params.id, currentUserId(req)]
        );

        await client.query("COMMIT");
        res.status(201).json(msg.rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Post staff message error:", error);
        res.status(500).json({ message: "Failed to send the reply" });
    } finally {
        client.release();
    }
};

// Support/admin: change status or reassign.
exports.updateConversation = async (req, res) => {
    const { status, assigned_staff_id } = req.body;
    const allowed = ["open", "pending", "closed"];

    if (status && !allowed.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
    }

    try {
        const result = await pool.query(
            `UPDATE chat_conversations
             SET status = COALESCE($2, status),
                 assigned_staff_id = COALESCE($3, assigned_staff_id),
                 closed_at = CASE WHEN $2 = 'closed' THEN CURRENT_TIMESTAMP
                                  ELSE closed_at END
             WHERE id = $1
             RETURNING id, status, assigned_staff_id, closed_at`,
            [req.params.id, status || null, assigned_staff_id || null]
        );

        if (!result.rows[0]) {
            return res.status(404).json({ message: "Conversation not found" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Update conversation error:", error);
        res.status(500).json({ message: "Failed to update the conversation" });
    }
};
