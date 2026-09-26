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
 *
 * --- Phase 1 update (Sept 2026): department/skill/shift-aware matching ---
 * A conversation with a department now prefers an agent enrolled in
 * support_agents whose home department OR skills list includes it, who is
 * also inside a configured shift (support_shifts) if they have one. If no
 * such agent is found -- including the day-one case where support_agents is
 * still empty -- this falls back to the ORIGINAL query below, unmodified,
 * so nothing regresses before agents are actually enrolled with
 * departments/skills. A conversation with no department (every conversation
 * before the category picker ships) skips straight to that original query,
 * byte-for-byte as it ran before this change.
 */

const { isWithinShift } = require("../lib/schedule");
const { needsSenior } = require("../lib/supportTier");

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
 * Finds the best department/skill/shift-matched staff_id for `department`,
 * or null if nobody enrolled in support_agents currently qualifies (empty
 * roster, nobody from that department online, or everyone who is online is
 * outside their shift). Candidates are pulled in priority order (least
 * busy, then longest-available) and the first that's also in-shift wins --
 * agents with no shifts configured are always eligible (see lib/schedule.js).
 *
 * @param client a checked-out pg client (already inside the caller's transaction)
 */
async function findDepartmentMatchedStaffId(client, department, now = new Date()) {
    const candidates = await client.query(
        `SELECT sa.staff_id, sa.went_available_at, agents.id AS support_agent_id
           FROM staff_availability sa
           JOIN support_agents agents
             ON agents.staff_id = sa.staff_id
            AND agents.active = TRUE
           LEFT JOIN chat_conversations c
             ON c.assigned_staff_id = sa.staff_id
            AND c.status IN ('open', 'pending')
          WHERE sa.is_available = TRUE
            AND sa.last_heartbeat IS NOT NULL
            AND sa.last_heartbeat >
                CURRENT_TIMESTAMP - INTERVAL '${HEARTBEAT_TIMEOUT_SECONDS} seconds'
            AND (agents.department = $1 OR $1 = ANY(agents.skills))
          GROUP BY sa.staff_id, sa.went_available_at, agents.id
          ORDER BY COUNT(c.id) ASC, sa.went_available_at ASC NULLS FIRST
          LIMIT 10`,
        [department]
    );

    if (candidates.rows.length === 0) return null;

    const shiftRows = await client.query(
        `SELECT agent_id, day_of_week, start_time, end_time
           FROM support_shifts
          WHERE agent_id = ANY($1::int[])`,
        [candidates.rows.map((c) => c.support_agent_id)]
    );
    const shiftsByAgent = {};
    for (const s of shiftRows.rows) {
        (shiftsByAgent[s.agent_id] = shiftsByAgent[s.agent_id] || []).push(s);
    }

    // .find(), not a re-sort: candidates are already ordered least-busy
    // first from the query above, so the first shift-eligible one is also
    // the best one.
    const match = candidates.rows.find((c) => isWithinShift(shiftsByAgent[c.support_agent_id], now));
    return match ? match.staff_id : null;
}

/**
 * Senior Agent routing (Sept 2026): the least-busy on-duty senior agent or
 * supervisor, preferring one whose department/skills match, inside their
 * shift if they have one. Used first for difficult chats (see
 * lib/supportTier.needsSenior) and by "Escalate to senior".
 *
 * @param client          pool or checked-out client
 * @param department      conversation department (may be null)
 * @param excludeStaffId  never pick this person (the agent escalating)
 * @returns staff_id or null when no senior is on duty
 */
async function findSeniorStaffId(client, department, excludeStaffId = null, now = new Date()) {
    const candidates = await client.query(
        `SELECT sa.staff_id, agents.id AS support_agent_id
           FROM staff_availability sa
           JOIN support_agents agents
             ON agents.staff_id = sa.staff_id
            AND agents.active = TRUE
            AND agents.role IN ('senior_agent', 'supervisor')
           LEFT JOIN chat_conversations c
             ON c.assigned_staff_id = sa.staff_id
            AND c.status IN ('open', 'pending')
          WHERE sa.is_available = TRUE
            AND sa.last_heartbeat IS NOT NULL
            AND sa.last_heartbeat >
                CURRENT_TIMESTAMP - INTERVAL '${HEARTBEAT_TIMEOUT_SECONDS} seconds'
            AND ($2::int IS NULL OR sa.staff_id <> $2::int)
          GROUP BY sa.staff_id, sa.went_available_at, agents.id, agents.department, agents.skills, agents.role
          ORDER BY (agents.department = $1 OR $1 = ANY(agents.skills)) DESC NULLS LAST,
                   (agents.role = 'senior_agent') DESC,
                   COUNT(c.id) ASC, sa.went_available_at ASC NULLS FIRST
          LIMIT 10`,
        [department || null, excludeStaffId]
    );
    if (candidates.rows.length === 0) return null;

    const shiftRows = await client.query(
        `SELECT agent_id, day_of_week, start_time, end_time
           FROM support_shifts
          WHERE agent_id = ANY($1::int[])`,
        [candidates.rows.map((c) => c.support_agent_id)]
    );
    const shiftsByAgent = {};
    for (const s of shiftRows.rows) {
        (shiftsByAgent[s.agent_id] = shiftsByAgent[s.agent_id] || []).push(s);
    }
    const match = candidates.rows.find((c) => isWithinShift(shiftsByAgent[c.support_agent_id], now));
    return match ? match.staff_id : null;
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
                        `SELECT id, department, priority, escalation_level FROM chat_conversations
                         WHERE id = $1 AND status = 'waiting'
                         FOR UPDATE SKIP LOCKED`,
                        [conversationId]
                    )
                    : await client.query(
                        `SELECT id, department, priority, escalation_level FROM chat_conversations
                         WHERE status = 'waiting'
                         ORDER BY (priority = 'critical') DESC, (priority = 'high') DESC,
                                  escalated_at ASC NULLS FIRST, id ASC
                         LIMIT 1
                         FOR UPDATE SKIP LOCKED`
                    );

                if (!conv.rows[0]) {
                    await client.query("ROLLBACK");
                    break;
                }
                const convId = conv.rows[0].id;
                const department = conv.rows[0].department;

                let staffId = null;
                let departmentMatched = false;
                let seniorMatched = false;

                // Difficult chats (high/critical, escalated, Returns &
                // Refunds) go to an on-duty senior agent first.
                if (needsSenior(conv.rows[0])) {
                    staffId = await findSeniorStaffId(client, department);
                    seniorMatched = staffId !== null;
                    departmentMatched = seniorMatched;
                }

                if (!staffId && department) {
                    staffId = await findDepartmentMatchedStaffId(client, department);
                    departmentMatched = staffId !== null;
                }

                if (!staffId) {
                    // No department, or nobody department-matched qualifies
                    // (including the day-one empty-roster case) -- fall back
                    // to the original, unmodified query: least-busy pick
                    // among ANY available agent, exactly as before this change.
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
                    staffId = candidate.rows[0] ? candidate.rows[0].staff_id : null;
                }

                if (!staffId) {
                    // Nobody is on duty. The chat stays waiting, and the next
                    // availability toggle drains it. This is now the only way
                    // a conversation can sit in the queue, which makes queue
                    // depth a direct signal that no agent is online.
                    await client.query("ROLLBACK");
                    break;
                }

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
                    meta: {
                        via: conversationId ? "escalation" : "queue_drain",
                        department: department || null,
                        department_matched: departmentMatched,
                        senior_matched: seniorMatched
                    }
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
    findSeniorStaffId,
    logEvent,
    ESCALATION_REASONS,
    HEARTBEAT_TIMEOUT_SECONDS,
    _findDepartmentMatchedStaffId: findDepartmentMatchedStaffId // exported for tests only
};
