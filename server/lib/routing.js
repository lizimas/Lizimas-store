'use strict';

/**
 * Pure agent-selection logic for the live-chat queue. No DB access here on
 * purpose, so it can be unit-tested directly and reused by both the admin
 * "who would this go to right now" preview and the real routing job.
 *
 * @param {Array} agents - support_agents rows, each needs:
 *   { id, department, skills: string[], status, active, max_concurrent_chats, current_load }
 *   `skills` holds department keys this agent can ALSO handle beyond their
 *   home `department` (e.g. home 'general', skills ['orders_payments']).
 *   `current_load` = number of chats currently assigned to that agent right now
 *   (caller computes this from chat_conversations; not stored on the agent row).
 * @param {Object} options
 * @param {'round_robin'|'least_busy'|'skill_based'} options.mode
 * @param {string} [options.department] - required chat department/category
 * @param {string} [options.requiredSkill] - required skill tag, for skill_based mode
 * @param {number} [options.lastRoundRobinAgentId] - id of the agent who last
 *   received a chat under round_robin, so the next pick can rotate forward
 * @returns {Object|null} the chosen agent, or null if nobody has capacity
 */
function pickAgentForRouting(agents, options) {
  const { mode, department, requiredSkill, lastRoundRobinAgentId } = options;

  let pool = (agents || []).filter(
    (a) => a.active && a.status === 'online' && a.current_load < a.max_concurrent_chats
  );

  if (department) {
    // Eligible if it's the agent's home department OR listed in their
    // skills (support_agents.skills now holds department keys an agent
    // can additionally handle) — a primary-department-only filter would
    // wrongly exclude someone whose home is 'general' but who also
    // covers 'orders_payments'.
    pool = pool.filter((a) => a.department === department || (a.skills || []).includes(department));
  }

  if (mode === 'skill_based') {
    if (requiredSkill) {
      const skilled = pool.filter((a) => (a.skills || []).includes(requiredSkill));
      // Fall back to the department-only pool if nobody has the exact skill,
      // rather than leaving the customer completely unrouted.
      pool = skilled.length > 0 ? skilled : pool;
    }
    return pickLeastBusy(pool);
  }

  if (mode === 'round_robin') {
    return pickRoundRobin(pool, lastRoundRobinAgentId);
  }

  // default / 'least_busy'
  return pickLeastBusy(pool);
}

function pickLeastBusy(pool) {
  if (pool.length === 0) return null;
  return pool.reduce((best, a) => {
    const bestRatio = best.current_load / best.max_concurrent_chats;
    const aRatio = a.current_load / a.max_concurrent_chats;
    if (aRatio < bestRatio) return a;
    if (aRatio === bestRatio && a.id < best.id) return a; // stable tie-break
    return best;
  }, pool[0]);
}

function pickRoundRobin(pool, lastAgentId) {
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => a.id - b.id);
  if (lastAgentId == null) return sorted[0];
  const idx = sorted.findIndex((a) => a.id > lastAgentId);
  return idx === -1 ? sorted[0] : sorted[idx];
}

/**
 * Decide what should happen to an incoming chat when nobody has capacity,
 * per the department's support_queue_rules row.
 * @param {Object} rule - a support_queue_rules row
 * @param {number} queueWaitSeconds - how long the customer has already waited
 * @param {boolean} withinBusinessHours
 * @returns {'route'|'keep_queued'|'escalate'|'offline_message'}
 */
function decideOverflow(rule, queueWaitSeconds, withinBusinessHours) {
  if (rule.business_hours_enabled && !withinBusinessHours) {
    return 'offline_message';
  }
  if (queueWaitSeconds < rule.max_queue_wait_seconds) {
    return 'keep_queued';
  }
  return rule.overflow_action;
}

module.exports = { pickAgentForRouting, pickLeastBusy, pickRoundRobin, decideOverflow };
