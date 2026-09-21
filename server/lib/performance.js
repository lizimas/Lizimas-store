'use strict';

/**
 * Turn a flat list of closed-chat rows into per-agent performance stats
 * for the admin reporting screen. Pure function so the aggregation math
 * can be unit-tested without a database.
 *
 * @param {Array} rows - one row per closed chat:
 *   { agent_id, agent_name, started_at, first_response_at, closed_at,
 *     escalated (bool), csat_score (1-5 or null) }
 * @returns {Array} one entry per agent, sorted by chats_handled desc:
 *   { agentId, agentName, chatsHandled, avgFirstResponseSeconds,
 *     avgResolutionSeconds, escalationRate, avgCsat }
 */
function aggregatePerformance(rows) {
  const byAgent = new Map();

  for (const row of rows) {
    if (!byAgent.has(row.agent_id)) {
      byAgent.set(row.agent_id, {
        agentId: row.agent_id,
        agentName: row.agent_name,
        chatsHandled: 0,
        firstResponseTotal: 0,
        firstResponseCount: 0,
        resolutionTotal: 0,
        resolutionCount: 0,
        escalations: 0,
        csatTotal: 0,
        csatCount: 0,
      });
    }
    const acc = byAgent.get(row.agent_id);
    acc.chatsHandled += 1;

    if (row.first_response_at) {
      acc.firstResponseTotal +=
        (new Date(row.first_response_at) - new Date(row.started_at)) / 1000;
      acc.firstResponseCount += 1;
    }
    if (row.closed_at) {
      acc.resolutionTotal += (new Date(row.closed_at) - new Date(row.started_at)) / 1000;
      acc.resolutionCount += 1;
    }
    if (row.escalated) acc.escalations += 1;
    if (row.csat_score != null) {
      acc.csatTotal += row.csat_score;
      acc.csatCount += 1;
    }
  }

  return Array.from(byAgent.values())
    .map((acc) => ({
      agentId: acc.agentId,
      agentName: acc.agentName,
      chatsHandled: acc.chatsHandled,
      avgFirstResponseSeconds: acc.firstResponseCount
        ? Math.round(acc.firstResponseTotal / acc.firstResponseCount)
        : null,
      avgResolutionSeconds: acc.resolutionCount
        ? Math.round(acc.resolutionTotal / acc.resolutionCount)
        : null,
      escalationRate: acc.chatsHandled ? +(acc.escalations / acc.chatsHandled).toFixed(3) : 0,
      avgCsat: acc.csatCount ? +(acc.csatTotal / acc.csatCount).toFixed(2) : null,
    }))
    .sort((a, b) => b.chatsHandled - a.chatsHandled);
}

module.exports = { aggregatePerformance };
