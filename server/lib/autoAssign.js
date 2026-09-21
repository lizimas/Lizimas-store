'use strict';

/**
 * Finds the best eligible support_agents row for a department, given the
 * department's saved support_queue_rules.routing_mode. Read-only — this
 * never writes an assignment itself, so it's safe to use for both a
 * "preview" (admin panel) and the real trigger (chatController.js, once
 * wired in) without duplicating eligibility logic in two places.
 *
 * `db` just needs db.query(sql, params) -> { rows }.
 */

const { pickAgentForRouting } = require('./routing');
const { isWithinShift } = require('./schedule');

async function getEligibleAgentsForDepartment(db, department) {
  const { rows: rawAgents } = await db.query(
    `SELECT a.id, a.staff_id, a.department, a.skills, a.active,
            COALESCE(sa.is_available, false) AS is_available, sa.last_heartbeat,
            COALESCE(sa.max_concurrent, 4) AS max_concurrent_chats,
            COALESCE(load.current_load, 0) AS current_load
     FROM support_agents a
     LEFT JOIN staff_availability sa ON sa.staff_id = a.staff_id
     LEFT JOIN (
       SELECT assigned_staff_id, COUNT(*) AS current_load
       FROM chat_conversations WHERE status IN ('open', 'pending') GROUP BY assigned_staff_id
     ) load ON load.assigned_staff_id = a.staff_id
     WHERE a.active = true AND (a.department = $1 OR $1 = ANY(a.skills))`,
    [department]
  );
  if (rawAgents.length === 0) return [];

  const { rows: shiftRows } = await db.query(
    `SELECT agent_id, day_of_week, start_time, end_time FROM support_shifts WHERE agent_id = ANY($1::int[])`,
    [rawAgents.map((a) => a.id)]
  );
  const shiftsByAgent = {};
  for (const s of shiftRows) {
    (shiftsByAgent[s.agent_id] = shiftsByAgent[s.agent_id] || []).push(s);
  }

  const HEARTBEAT_FRESH_SECONDS = 90;
  const now = new Date();
  return rawAgents
    .filter((a) => isWithinShift(shiftsByAgent[a.id], now))
    .map((a) => ({
      ...a,
      status:
        a.last_heartbeat && (Date.now() - new Date(a.last_heartbeat).getTime()) / 1000 < HEARTBEAT_FRESH_SECONDS && a.is_available
          ? 'online'
          : 'offline',
    }));
}

/**
 * @returns {{ rule: object|null, agent: object|null }} rule is null if the
 *   department has no support_queue_rules row at all (shouldn't happen for
 *   the 7 seeded departments, but defensive); agent is null if nobody is
 *   currently eligible.
 */
async function findBestAgent(db, department, { requiredSkill, lastRoundRobinAgentId } = {}) {
  const { rows: ruleRows } = await db.query(`SELECT * FROM support_queue_rules WHERE department = $1`, [
    department,
  ]);
  const rule = ruleRows[0] || null;
  if (!rule) return { rule: null, agent: null };

  const agents = await getEligibleAgentsForDepartment(db, department);
  const agent = pickAgentForRouting(agents, {
    mode: rule.routing_mode,
    department,
    requiredSkill,
    lastRoundRobinAgentId,
  });
  return { rule, agent };
}

module.exports = { getEligibleAgentsForDepartment, findBestAgent };
