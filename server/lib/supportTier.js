'use strict';

/**
 * Support team tiers (Ryan, Sept 2026 - "Senior Agent" role).
 *
 *   agent         handles their own chats and new (unassigned) ones; passes
 *                 difficult cases up with "Escalate to senior".
 *   senior_agent  the experienced problem-solver and team lead: sees every
 *                 chat, takes over or transfers any of them, receives
 *                 escalations and difficult cases (high/critical priority,
 *                 escalated, Returns & Refunds) first, leaves coaching notes
 *                 for agents, and sees the team's live load and today's
 *                 performance.
 *   supervisor    everything a senior agent can do (plus the admin panel's
 *                 Support Team settings when they also have admin access).
 *   admin         the store owner / admin users: same as supervisor.
 *
 * A customer_support user who hasn't been enrolled in support_agents yet is
 * treated as a plain agent.
 */

const TIER_RANK = { agent: 1, senior_agent: 2, supervisor: 3, admin: 4 };
const TIER_LABELS = { agent: 'Agent', senior_agent: 'Senior Agent', supervisor: 'Supervisor', admin: 'Admin' };

// Departments whose chats are complaints/refunds/disputes by nature and go to
// a senior agent first when one is on duty.
const SENIOR_FIRST_DEPARTMENTS = ['returns_refunds'];

function isSenior(tier) {
  return (TIER_RANK[tier] || 0) >= TIER_RANK.senior_agent;
}

function staffIdOf(user) {
  if (!user) return null;
  return Number(user.userId != null ? user.userId : user.id);
}

async function getTier(db, user) {
  if (!user) return null;
  if (user.role === 'admin') return 'admin';
  const r = await db.query(
    'SELECT role FROM support_agents WHERE staff_id = $1 AND active = true',
    [staffIdOf(user)]
  );
  return r.rows[0] ? r.rows[0].role : 'agent';
}

// Can this tier read/reply/change this conversation?
function canActOn(tier, staffId, conv) {
  if (isSenior(tier)) return true;
  if (!conv) return false;
  return conv.assigned_staff_id == null || Number(conv.assigned_staff_id) === Number(staffId);
}

// Does this conversation belong with a senior agent first?
function needsSenior(conv) {
  if (!conv) return false;
  return ['critical', 'high'].includes(conv.priority) ||
    Number(conv.escalation_level || 0) > 0 ||
    SENIOR_FIRST_DEPARTMENTS.includes(conv.department);
}

// Escalating raises the priority to at least 'high' (critical stays critical).
function escalatedPriority(current) {
  return current === 'critical' ? 'critical' : 'high';
}

module.exports = { TIER_RANK, TIER_LABELS, SENIOR_FIRST_DEPARTMENTS, isSenior, staffIdOf, getTier, canActOn, needsSenior, escalatedPriority };
