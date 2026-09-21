'use strict';

/**
 * Given active chats and the SLA policy for their department, work out
 * which ones have breached (or are about to breach) first-response or
 * resolution targets. Pure function — `now` is injected so it's testable
 * without faking the system clock.
 *
 * @param {Array} chats - each: { id, department, status, started_at,
 *   first_response_at, agent_id, customer_name }. Timestamps are Date
 *   objects or ISO strings; started_at is required, first_response_at may
 *   be null if nobody has replied yet.
 * @param {Object} policyByDepartment - map of department -> support_sla_policies row
 * @param {Date} now
 * @returns {Array} breach records: { chatId, type: 'first_response'|'resolution',
 *   secondsOver, agentId }
 */
function computeSlaBreaches(chats, policyByDepartment, now) {
  const breaches = [];
  for (const chat of chats) {
    if (chat.status === 'closed') continue;
    const policy = policyByDepartment[chat.department] || policyByDepartment.general;
    if (!policy) continue;

    const started = new Date(chat.started_at).getTime();
    const nowMs = now.getTime();

    if (!chat.first_response_at) {
      const waited = (nowMs - started) / 1000;
      if (waited > policy.first_response_target_seconds) {
        breaches.push({
          chatId: chat.id,
          type: 'first_response',
          secondsOver: Math.round(waited - policy.first_response_target_seconds),
          agentId: chat.agent_id || null,
        });
      }
      continue; // can't be a resolution breach before a first response
    }

    const open = (nowMs - started) / 1000;
    if (chat.status !== 'closed' && open > policy.resolution_target_seconds) {
      breaches.push({
        chatId: chat.id,
        type: 'resolution',
        secondsOver: Math.round(open - policy.resolution_target_seconds),
        agentId: chat.agent_id || null,
      });
    }
  }
  return breaches;
}

module.exports = { computeSlaBreaches };
