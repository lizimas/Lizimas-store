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
const {
    assignWaiting,
    logEvent,
    ESCALATION_REASONS
} = require("../services/chatRouting");

exports.startConversation = async (req, res) => {
    const { name, phone, email, subject, message } = req.body;

    // The widget's FAQ tier runs client-side, so everything the customer was
    // already shown is lost at handoff unless it travels with the escalation.
    // Without it the agent's first move is to repeat an answer the customer
    // has read and rejected.
    const trail = Array.isArray(req.body.faq_trail)
        ? req.body.faq_trail.slice(0, 12)
        : [];

    const reason = ESCALATION_REASONS.includes(req.body.escalation_reason)
        ? req.body.escalation_reason
        : "asked_for_agent";

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
                  subject, status, staff_unread, last_message_at,
                  escalated_at, escalation_reason, last_customer_message_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'waiting', 1, CURRENT_TIMESTAMP,
                     CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP)
             RETURNING id, status, created_at`,
            [
                req.user ? currentUserId(req) : null,
                token,
                isGuest ? String(name).trim() : null,
                isGuest && phone ? String(phone).trim() : null,
                isGuest && email ? String(email).trim().slice(0, 255) : null,
                subject ? String(subject).trim().slice(0, 160) : null,
                reason
            ]
        );

        const conversationId = conv.rows[0].id;

        // Replay the FAQ exchange into the transcript first, so message ids
        // stay in true chronological order ahead of the customer's message.
        for (const step of trail) {
            const question = step && step.question
                ? String(step.question).trim().slice(0, 300)
                : null;
            const answer = step && step.answer
                ? String(step.answer).trim().slice(0, 2000)
                : null;

            if (question) {
                await client.query(
                    `INSERT INTO chat_messages (conversation_id, sender_type, body)
                     VALUES ($1, 'customer', $2)`,
                    [conversationId, question]
                );
            }
            if (answer) {
                await client.query(
                    `INSERT INTO chat_messages (conversation_id, sender_type, body)
                     VALUES ($1, 'ai', $2)`,
                    [conversationId, answer]
                );
            }

            await logEvent(client, {
                conversationId,
                eventType: "faq_answer_shown",
                actorType: "ai",
                meta: {
                    topic: step && step.topic ? String(step.topic).slice(0, 60) : null,
                    helpful: step && step.helpful === true
                }
            });
        }

        await logEvent(client, {
            conversationId,
            eventType: "escalated",
            actorType: "customer",
            meta: { reason, faq_steps: trail.length }
        });

        const msg = await client.query(
            `INSERT INTO chat_messages (conversation_id, sender_type, body)
             VALUES ($1, 'customer', $2)
             RETURNING id, sender_type, body, created_at`,
            [conversationId, String(message).trim()]
        );

        await client.query("COMMIT");

        let assigned = [];
        try {
            assigned = await assignWaiting(pool, { conversationId });
        } catch (routingError) {
            console.error("Assign on escalation failed:", routingError);
        }

        res.status(201).json({
            conversation_id: conversationId,
            guest_token: token,
            status: assigned.length ? "open" : "waiting",
            assigned: assigned.length > 0,
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

        // Primary-key lookup plus a primary-key join, so this stays
        // cheap enough to sit on the poll path.
        const owner = await pool.query(
            `SELECT c.status, u.name AS assigned_staff_name
             FROM chat_conversations c
             LEFT JOIN users u ON u.id = c.assigned_staff_id
             WHERE c.id = $1`,
            [conv.id]
        );

        res.json({
            status: owner.rows[0] ? owner.rows[0].status : conv.status,
            customer_unread: conv.customer_unread,
            assigned_staff_name: owner.rows[0]
                ? owner.rows[0].assigned_staff_name
                : null,
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
                 last_message_at = CURRENT_TIMESTAMP,
                 last_customer_message_at = CURRENT_TIMESTAMP
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
        const status = req.query.status || "active";
        const mine = req.query.mine === "true";
        const unassigned = req.query.unassigned === "true";
        const search = (req.query.search || "").trim();

        const params = [];
        const where = [];

        if (status === "active") {
            where.push("c.status IN ('waiting', 'open', 'pending')");
        } else if (status !== "all") {
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
                    c.escalated_at, c.assigned_at, c.first_response_at,
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

        // Admin monitoring passes peek=true: observing a thread must not clear
        // the assigned agent's unread badge on their behalf.
        const peek = req.query.peek === "true";

        if (after === 0 && !peek) {
            await pool.query(
                `UPDATE chat_conversations SET staff_unread = 0 WHERE id = $1`,
                [req.params.id]
            );
        }

        const events = await pool.query(
            `SELECT e.id, e.event_type, e.created_at, e.actor_staff_id,
                    e.actor_type, e.meta,
                    s.name AS actor_name
             FROM chat_events e
             LEFT JOIN users s ON s.id = e.actor_staff_id
             WHERE e.conversation_id = $1
             ORDER BY e.id ASC
             LIMIT 100`,
            [req.params.id]
        );

        res.json({
            conversation: conv.rows[0],
            messages: messages.rows,
            events: events.rows
        });
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

        // Read the prior state under lock so first_response_at can be
        // recorded exactly once, and only for a genuine first human reply.
        const prior = await client.query(
            `SELECT status, first_response_at
             FROM chat_conversations
             WHERE id = $1
             FOR UPDATE`,
            [req.params.id]
        );

        if (!prior.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Conversation not found" });
        }

        const isFirstResponse = !prior.rows[0].first_response_at;

        const msg = await client.query(
            `INSERT INTO chat_messages
                 (conversation_id, sender_type, sender_staff_id, body)
             VALUES ($1, 'staff', $2, $3)
             RETURNING id, sender_type, sender_staff_id, body, created_at`,
            [req.params.id, currentUserId(req), String(body).trim()]
        );

        // Claim the thread on first reply if nobody owns it yet. A reply to a
        // queued chat is itself an assignment, so 'waiting' resolves here too.
        await client.query(
            `UPDATE chat_conversations
             SET customer_unread = customer_unread + 1,
                 staff_unread = 0,
                 last_message_at = CURRENT_TIMESTAMP,
                 assigned_staff_id = COALESCE(assigned_staff_id, $2),
                 assigned_at = COALESCE(assigned_at, CURRENT_TIMESTAMP),
                 first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP),
                 status = CASE WHEN status IN ('closed', 'waiting') THEN 'open'
                               ELSE status END
             WHERE id = $1`,
            [req.params.id, currentUserId(req)]
        );

        if (isFirstResponse) {
            await logEvent(client, {
                conversationId: Number(req.params.id),
                eventType: "first_response",
                actorType: "staff",
                actorStaffId: currentUserId(req)
            });
        }

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
    const { status, assigned_staff_id, resolved } = req.body;
    const allowed = ["waiting", "open", "pending", "closed"];

    if (status && !allowed.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
    }

    const staffId = currentUserId(req);
    const client = await pool.connect();
    let freedCapacity = false;

    try {
        await client.query("BEGIN");

        const current = await client.query(
            `SELECT status FROM chat_conversations WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );

        if (!current.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Conversation not found" });
        }

        const before = current.rows[0].status;
        const next = status || before;
        const closing = next === "closed" && before !== "closed";
        const reopening = before === "closed" && next !== "closed";

        // Closed and resolved are not the same thing. An agent closing a chat
        // the customer abandoned should be able to say so, or the resolution
        // rate flatters itself.
        const markResolved = closing && resolved !== false;
        freedCapacity = closing;

        const result = await client.query(
            `UPDATE chat_conversations
             SET status = $2,
                 assigned_staff_id = COALESCE($3, assigned_staff_id),
                 assigned_at = CASE WHEN $3 IS NOT NULL THEN CURRENT_TIMESTAMP
                                    ELSE assigned_at END,
                 closed_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP
                                  WHEN $5 THEN NULL
                                  ELSE closed_at END,
                 closed_by_type = CASE WHEN $4 THEN 'agent'
                                       WHEN $5 THEN NULL
                                       ELSE closed_by_type END,
                 closed_by_staff_id = CASE WHEN $4 THEN $6
                                           WHEN $5 THEN NULL
                                           ELSE closed_by_staff_id END,
                 resolved_at = CASE WHEN $7 THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
                                    WHEN $5 THEN NULL
                                    ELSE resolved_at END,
                 reopened_count = CASE WHEN $5 THEN reopened_count + 1
                                       ELSE reopened_count END
             WHERE id = $1
             RETURNING id, status, assigned_staff_id, assigned_at, closed_at,
                       closed_by_type, resolved_at, reopened_count`,
            [
                req.params.id,
                next,
                assigned_staff_id || null,
                closing,
                reopening,
                staffId,
                markResolved
            ]
        );

        let eventType = null;
        if (closing) eventType = "closed";
        else if (reopening) eventType = "reopened";
        else if (assigned_staff_id) eventType = "reassigned";
        else if (next !== before) eventType = "status_changed";

        if (eventType) {
            await logEvent(client, {
                conversationId: Number(req.params.id),
                eventType,
                actorType: "staff",
                actorStaffId: staffId,
                meta: { from: before, to: next, resolved: markResolved }
            });
        }

        await client.query("COMMIT");

        // Closing frees a slot, so the queue gets a chance to drain into it.
        if (freedCapacity) {
            try {
                await assignWaiting(pool, {});
            } catch (routingError) {
                console.error("Queue drain after close failed:", routingError);
            }
        }

        res.json(result.rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Update conversation error:", error);
        res.status(500).json({ message: "Failed to update the conversation" });
    } finally {
        client.release();
    }
};

// Support/admin: availability toggle. Going available drains the queue
// immediately - a background sweeper would not run reliably on Render, and a
// customer should not wait for a timer that may never fire.
// Admin: aggregate counts for the live operations dashboard.
// Single round trip - this endpoint is polled, so eight separate
// queries would multiply load for no benefit.
exports.getLiveOverview = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM chat_conversations
                   WHERE status = 'waiting') AS customers_waiting,

                (SELECT COUNT(*) FROM chat_conversations
                   WHERE status = 'open' AND assigned_staff_id IS NOT NULL) AS active_agent_chats,

                (SELECT COUNT(*) FROM chat_conversations
                   WHERE status = 'open' AND assigned_staff_id IS NULL) AS unassigned_open,

                (SELECT COUNT(*) FROM staff_availability
                   WHERE is_available = true
                     AND last_heartbeat > NOW() - INTERVAL '2 minutes') AS agents_online,

                (SELECT COUNT(*) FROM chat_conversations
                   WHERE created_at >= CURRENT_DATE) AS chats_today,

                (SELECT COUNT(*) FROM chat_conversations
                   WHERE resolved_at IS NOT NULL
                     AND resolved_at >= CURRENT_DATE) AS resolved_today,

                (SELECT COUNT(*) FROM chat_conversations
                   WHERE status = 'open'
                     AND assigned_staff_id IS NOT NULL
                     AND first_response_at IS NULL) AS awaiting_first_reply
        `);

        res.json({ overview: result.rows[0] });

    } catch (error) {
        console.error("Live overview error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.setAvailability = async (req, res) => {
    const raw = req.body.is_available !== undefined
        ? req.body.is_available
        : req.query.is_available;
    const isAvailable = raw === true || raw === "true";
    const staffId = currentUserId(req);

    try {
        await pool.query(
            `INSERT INTO staff_availability
                 (staff_id, is_available, last_heartbeat, went_available_at, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP,
                     CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE NULL END,
                     CURRENT_TIMESTAMP)
             ON CONFLICT (staff_id) DO UPDATE
                SET is_available = EXCLUDED.is_available,
                    last_heartbeat = CURRENT_TIMESTAMP,
                    went_available_at =
                        CASE WHEN EXCLUDED.is_available
                                  AND staff_availability.is_available = FALSE
                             THEN CURRENT_TIMESTAMP
                             WHEN EXCLUDED.is_available
                             THEN staff_availability.went_available_at
                             ELSE NULL END,
                    updated_at = CURRENT_TIMESTAMP`,
            [staffId, isAvailable]
        );

        try {
            await logEvent(pool, {
                eventType: isAvailable ? "agent_available" : "agent_unavailable",
                actorType: "staff",
                actorStaffId: staffId
            });
        } catch (logError) {
            console.error("Availability event log failed:", logError);
        }

        const assigned = isAvailable ? await assignWaiting(pool, {}) : [];

        res.json({ is_available: isAvailable, assigned });
    } catch (error) {
        console.error("Set availability error:", error);
        res.status(500).json({ message: "Failed to update availability" });
    }
};

// Support/admin: keep-alive. is_available alone lies once a tab is closed,
// so presence is availability plus a fresh heartbeat.
exports.heartbeat = async (req, res) => {
    const staffId = currentUserId(req);

    try {
        const beat = await pool.query(
            `UPDATE staff_availability
             SET last_heartbeat = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE staff_id = $1
             RETURNING is_available`,
            [staffId]
        );

        const counts = await pool.query(
            `SELECT
                 COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
                 COUNT(*) FILTER (WHERE status IN ('open', 'pending')
                                    AND assigned_staff_id = $1)::int AS mine
             FROM chat_conversations`,
            [staffId]
        );

        res.json({
            is_available: beat.rows[0] ? beat.rows[0].is_available : false,
            waiting: counts.rows[0].waiting,
            mine: counts.rows[0].mine
        });
    } catch (error) {
        console.error("Heartbeat error:", error);
        res.status(500).json({ message: "Heartbeat failed" });
    }
};

// Support/admin: who is actually on duty right now.
exports.getAvailability = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT sa.staff_id,
                    u.name AS staff_name,
                    sa.is_available,
                    sa.max_concurrent,
                    sa.last_heartbeat,
                    sa.went_available_at,
                    (sa.last_heartbeat IS NOT NULL
                     AND sa.last_heartbeat >
                         CURRENT_TIMESTAMP - INTERVAL '90 seconds') AS is_online,
                    COUNT(c.id)::int AS active_chats
               FROM staff_availability sa
               LEFT JOIN users u ON u.id = sa.staff_id
               LEFT JOIN chat_conversations c
                 ON c.assigned_staff_id = sa.staff_id
                AND c.status IN ('open', 'pending')
              GROUP BY sa.staff_id, u.name, sa.is_available, sa.max_concurrent,
                       sa.last_heartbeat, sa.went_available_at
              ORDER BY sa.staff_id`
        );

        res.json({ agents: result.rows });
    } catch (error) {
        console.error("Get availability error:", error);
        res.status(500).json({ message: "Failed to load availability" });
    }
};
