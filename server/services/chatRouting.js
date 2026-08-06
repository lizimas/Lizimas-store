"use strict";

/**
 * Chat routing engine.
 *
 * One assignment function, called from three places: escalation, an agent
 * going available, and a conversation closing. Duplicating this logic per
 * call site is how queues start disagreeing with themselves.
 *
 * Takes a pool rather than importing one, so this module has no opinion about
 * where the database config lives.
 */

// An agent who closed their laptop without toggling off still has
// is_available = true. Only a recent heartbeat proves someone is watching.
const HEARTBEAT_TIMEOUT_SECONDS = 90;

const ESCALATION_REASONS = ["said_no", "asked_for_agent", "no_match", "other"];

/**
 * Append to chat_events.
 *
 * Deliberately does NOT swallow errors. Inside a transaction a failed insert
 * aborts the whole transaction anyway, so hiding it would only turn a clear
 * error into a confusing COMMIT failure. Callers running outside a
 * transaction should wrap this themselves if the event is non-critical.
 *
 * @param db  a pool or a checked-out client
 */
async function logEvent(db, {
    conversationId = null,
    eventType,
    actorType = null,
    actorStaffId = null,
    meta = null
}) {
    await db.query(
        `INSERT INTO chat_events
             (conversation_id, event_type, actor_type, actor_staff_id, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [
            conversationId,
            eventType,
            actorType,
            actorStaffId,
            meta ? JSON.stringify(meta) : null
        ]
    );
}

/**
 * Assign waiting conversations to the least-busy available agent.
 *
 * With no conversationId, drains the queue oldest-first until either no
 * waiting chats remain or no agent is on duty. With a conversationId,
 * attempts that one conversation only.
 *
 * Each assignment is its own transaction. A failure partway through a drain
 * leaves the already-assigned chats assigned rather than rolling back work
 * that was correct.
 *
 * @returns array of { conversation_id, staff_id }
 */
async function assignWaiting(pool, { conversationId = null, maxAssignments = 500 } = {}) {
    const assigned = [];
    const client = await pool.connect();

    try {
        for (let i = 0; i < maxAssignments; i++) {
            await client.query("BEGIN");

            try {
                // SKIP LOCKED so two workers draining at once take different
                // conversations instead of one waiting on the other.
                const conv = conversationId
                    ? await client.query(
                        `SELECT id FROM chat_conversations
                         WHERE id = $1 AND status = 'waiting'
                         FOR UPDATE SKIP LOCKED`,
                        [conversationId]
                    )
                    : await client.query(
                        `SELECT id FROM chat_conversations
                         WHERE status = 'waiting'
                         ORDER BY escalated_at ASC NULLS FIRST, id ASC
                         LIMIT 1
                         FOR UPDATE SKIP LOCKED`
                    );

                if (!conv.rows[0]) {
                    await client.query("ROLLBACK");
                    break;
                }
                const convId = conv.rows[0].id;

                // Least-busy pick. Ties broken by who has been available
                // longest, which spreads load rather than always hitting
                // whichever row the planner returns first.
                const candidate = await client.query(
                    `SELECT sa.staff_id
                       FROM staff_availability sa
                       LEFT JOIN chat_conversations c
                         ON c.assigned_staff_id = sa.staff_id
                        AND c.status IN ('open', 'pending')
                      WHERE sa.is_available = TRUE
                        AND sa.last_heartbeat IS NOT NULL
                        AND sa.last_heartbeat >
                            CURRENT_TIMESTAMP - INTERVAL '${HEARTBEAT_TIMEOUT_SECONDS} seconds'
                      GROUP BY sa.staff_id, sa.went_available_at
                      ORDER BY COUNT(c.id) ASC, sa.went_available_at ASC NULLS FIRST
                      LIMIT 1`
                );

                if (!candidate.rows[0]) {
                    // Nobody is on duty. The chat stays waiting, and the next
                    // availability toggle drains it. This is now the only way
                    // a conversation can sit in the queue, which makes queue
                    // depth a direct signal that no agent is online.
                    await client.query("ROLLBACK");
                    break;
                }
                const staffId = candidate.rows[0].staff_id;

                await client.query(
                    `UPDATE chat_conversations
                        SET assigned_staff_id = $2,
                            assigned_at = CURRENT_TIMESTAMP,
                            status = 'open'
                      WHERE id = $1`,
                    [convId, staffId]
                );

                await logEvent(client, {
                    conversationId: convId,
                    eventType: "assigned",
                    actorType: "system",
                    actorStaffId: staffId,
                    meta: { via: conversationId ? "escalation" : "queue_drain" }
                });

                await client.query("COMMIT");
                assigned.push({ conversation_id: convId, staff_id: staffId });

                if (conversationId) break;
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            }
        }
    } finally {
        client.release();
    }

    return assigned;
}

module.exports = {
    assignWaiting,
    logEvent,
    ESCALATION_REASONS,
    HEARTBEAT_TIMEOUT_SECONDS
};
