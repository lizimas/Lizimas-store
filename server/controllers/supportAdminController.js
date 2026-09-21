'use strict';

/**
 * Support Control Center — admin controller.
 *
 * Built against your real schema (migrations 012-015):
 *   - chat_conversations: id, customer_id, assigned_staff_id, status
 *     ('open'|'waiting'|'pending'|'closed'), escalated_at, assigned_at,
 *     first_response_at, closed_at, closed_by_type, closed_by_staff_id,
 *     escalation_reason, order_id
 *   - users: staff and customers share this table
 *   - staff_availability: staff_id, is_available, last_heartbeat,
 *     max_concurrent — this is the LIVE capacity/online-status source.
 *     This controller only READS it; nothing here writes to it, since your
 *     chat client's heartbeat owns those columns and a write from here
 *     could just get raced/overwritten. If you want a real admin
 *     "force this agent offline right now" control, that's a follow-up
 *     once I've seen chatRouting.js's heartbeat write pattern.
 *   - chat_conversations writes (reassign, force-close) are NOT done here —
 *     your existing chatController.exports.updateConversation already does
 *     this correctly (row locking, reopened_count, chat_events logging).
 *     The Live Monitor tab's admin panel calls that endpoint directly
 *     (PATCH /api/chat/conversations/:id) instead of duplicating it.
 *
 * No department/category column exists on chat_conversations yet, so
 * getLiveOverview/getPerformanceReport always use the 'general' queue/SLA
 * policy — the admin UI's per-department fields are there for when you add
 * one, they just don't split live data today.
 *
 * Usage — matches how your other controllers are required (adminController.js
 * style): plain functions, already wired to server/config/database.js.
 *   const { listAgents, createAgent, ... } = require('../controllers/supportAdminController');
 *   router.get('/agents', listAgents);
 * (No requireAdmin needed per-route here — admin.js's `router.use(requireAuth,
 * requireAdmin)` on line 209 already gates everything mounted after it.)
 *
 * The database connection is required LAZILY (only on the first actual
 * query), so requiring this file never touches server/config/database.js
 * by itself — that's what keeps `node --test test/supportAdmin.test.js`
 * runnable with no live database, using the named createSupportAdminController
 * export and a fake db instead.
 */

const { findBestAgent } = require('../lib/autoAssign');
const { computeSlaBreaches } = require('../lib/sla');
const { aggregatePerformance } = require('../lib/performance');
const {
  validateAgentInput,
  validateDepartmentParam,
  validateQueueRuleInput,
  validateCannedResponseInput,
  validateSlaPolicyInput,
} = require('../lib/validation');

const HEARTBEAT_FRESH_SECONDS = 90; // matches the comment in 014_chat_operations.sql

function isHeartbeatFresh(lastHeartbeat) {
  if (!lastHeartbeat) return false;
  return (Date.now() - new Date(lastHeartbeat).getTime()) / 1000 < HEARTBEAT_FRESH_SECONDS;
}

function createSupportAdminController(db) {
  async function logAction(actorStaffId, action, targetType, targetId, details) {
    await db.query(
      `INSERT INTO support_audit_log (actor_staff_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorStaffId || null, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null]
    );
  }

  function actorId(req) {
    return (req.user && req.user.id) || null;
  }

  // ---------- Agent roster ----------

  async function listAgents(req, res) {
    const { rows } = await db.query(
      `SELECT a.*, u.name AS staff_name, u.email AS staff_email,
              COALESCE(sa.is_available, false) AS is_available,
              sa.last_heartbeat,
              COALESCE(sa.max_concurrent, 4) AS max_concurrent,
              COALESCE(load.current_load, 0) AS current_load
       FROM support_agents a
       LEFT JOIN users u ON u.id = a.staff_id
       LEFT JOIN staff_availability sa ON sa.staff_id = a.staff_id
       LEFT JOIN (
         SELECT assigned_staff_id, COUNT(*) AS current_load
         FROM chat_conversations
         WHERE status IN ('open', 'pending')
         GROUP BY assigned_staff_id
       ) load ON load.assigned_staff_id = a.staff_id
       ORDER BY a.active DESC, a.department, staff_name`
    );
    res.json({ agents: rows });
  }

  async function createAgent(req, res) {
    const errors = validateAgentInput(req.body);
    if (errors.length) return res.status(400).json({ errors });

    const { staff_id, role = 'agent', department = 'general', skills = [] } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO support_agents (staff_id, role, department, skills)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [staff_id, role, department, skills]
      );
      await logAction(actorId(req), 'agent_created', 'support_agent', rows[0].id, { staff_id, role, department });
      res.status(201).json({ agent: rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That staff member is already a support agent' });
      if (e.code === '23503') return res.status(400).json({ error: 'staff_id does not match an existing user' });
      throw e;
    }
  }

  async function updateAgent(req, res) {
    const agentId = Number(req.params.id);
    const errors = validateAgentInput({ staff_id: 1, ...req.body }).filter((e) => e.field !== 'staff_id');
    if (errors.length) return res.status(400).json({ errors });

    const fields = ['role', 'department', 'skills'];
    const updates = fields.filter((f) => req.body[f] !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    const setClause = updates.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = updates.map((f) => req.body[f]);
    const { rows } = await db.query(
      `UPDATE support_agents SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
      [agentId, ...values]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });

    await logAction(actorId(req), 'agent_updated', 'support_agent', agentId, req.body);
    res.json({ agent: rows[0] });
  }

  async function setAgentActive(req, res) {
    const agentId = Number(req.params.id);
    const active = !!req.body.active;
    const { rows } = await db.query(
      `UPDATE support_agents SET active = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [agentId, active]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });

    // Suspending removes them from routing regardless of staff_availability —
    // pickAgentForRouting always filters on support_agents.active first.
    await logAction(actorId(req), active ? 'agent_reactivated' : 'agent_suspended', 'support_agent', agentId, null);
    res.json({ agent: rows[0] });
  }

  // ---------- Shifts ----------

  async function listShifts(req, res) {
    const agentId = Number(req.params.agentId);
    const { rows } = await db.query(
      `SELECT * FROM support_shifts WHERE agent_id = $1 ORDER BY day_of_week, start_time`,
      [agentId]
    );
    res.json({ shifts: rows });
  }

  async function setShifts(req, res) {
    const agentId = Number(req.params.agentId);
    const shifts = Array.isArray(req.body.shifts) ? req.body.shifts : [];
    for (const s of shifts) {
      if (s.day_of_week < 0 || s.day_of_week > 6 || !s.start_time || !s.end_time) {
        return res.status(400).json({ error: 'Each shift needs day_of_week (0-6), start_time, end_time' });
      }
    }

    await db.query('DELETE FROM support_shifts WHERE agent_id = $1', [agentId]);
    for (const s of shifts) {
      await db.query(
        `INSERT INTO support_shifts (agent_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)`,
        [agentId, s.day_of_week, s.start_time, s.end_time]
      );
    }
    await logAction(actorId(req), 'agent_shifts_updated', 'support_agent', agentId, { count: shifts.length });
    res.json({ ok: true, count: shifts.length });
  }

  // ---------- Queue / routing rules ----------

  async function listQueueRules(req, res) {
    const { rows } = await db.query(`SELECT * FROM support_queue_rules ORDER BY department`);
    res.json({ rules: rows });
  }

  async function updateQueueRules(req, res) {
    const department = req.params.department;
    const errors = [...validateDepartmentParam(department), ...validateQueueRuleInput(req.body)];
    if (errors.length) return res.status(400).json({ errors });

    const fields = [
      'routing_mode',
      'max_queue_wait_seconds',
      'overflow_action',
      'business_hours_enabled',
      'business_hours_start',
      'business_hours_end',
      'offline_message',
    ];
    const updates = fields.filter((f) => req.body[f] !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    const setClause = updates.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = updates.map((f) => req.body[f]);
    const { rows } = await db.query(
      `INSERT INTO support_queue_rules (department, ${updates.join(', ')})
       VALUES ($1, ${updates.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (department) DO UPDATE SET ${setClause}, updated_at = now()
       RETURNING *`,
      [department, ...values]
    );
    await logAction(actorId(req), 'queue_rules_updated', 'support_queue_rules', rows[0].id, req.body);
    res.json({ rule: rows[0] });
  }

  /** Preview only — who would the next chat route to right now, given the
   *  saved routing_mode. Reads live capacity from staff_availability. */
  async function previewRouting(req, res) {
    const department = req.params.department;
    const deptErrors = validateDepartmentParam(department);
    if (deptErrors.length) return res.status(400).json({ errors: deptErrors });

    const { rule, agent } = await findBestAgent(db, department, { requiredSkill: req.query.skill });
    if (!rule) return res.status(404).json({ error: 'No queue rule for that department' });

    res.json({ wouldRouteTo: agent ? { id: agent.id, staff_id: agent.staff_id } : null });
  }

  // ---------- Canned responses ----------

  async function listCannedResponses(req, res) {
    const { category } = req.query;
    const params = [];
    let where = 'WHERE active = true';
    if (category) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    const { rows } = await db.query(
      `SELECT * FROM support_canned_responses ${where} ORDER BY category, title`,
      params
    );
    res.json({ cannedResponses: rows });
  }

  async function createCannedResponse(req, res) {
    const errors = validateCannedResponseInput(req.body);
    if (errors.length) return res.status(400).json({ errors });

    const { title, body, category = 'general', shared = true } = req.body;
    const { rows } = await db.query(
      `INSERT INTO support_canned_responses (title, body, category, shared, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, body, category, shared, req.body.created_by || null]
    );
    await logAction(actorId(req), 'canned_response_created', 'support_canned_response', rows[0].id, { title });
    res.status(201).json({ cannedResponse: rows[0] });
  }

  async function updateCannedResponse(req, res) {
    const id = Number(req.params.id);
    const fields = ['title', 'body', 'category', 'shared', 'active'];
    const updates = fields.filter((f) => req.body[f] !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    const merged = { title: req.body.title || 'x', body: req.body.body || 'x' };
    const errors = validateCannedResponseInput(merged).filter((e) => req.body[e.field] !== undefined);
    if (errors.length) return res.status(400).json({ errors });

    const setClause = updates.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = updates.map((f) => req.body[f]);
    const { rows } = await db.query(
      `UPDATE support_canned_responses SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Canned response not found' });
    res.json({ cannedResponse: rows[0] });
  }

  async function deleteCannedResponse(req, res) {
    const id = Number(req.params.id);
    const { rows } = await db.query(
      `UPDATE support_canned_responses SET active = false, updated_at = now() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Canned response not found' });
    await logAction(actorId(req), 'canned_response_deleted', 'support_canned_response', id, null);
    res.json({ ok: true });
  }

  // ---------- SLA policies ----------

  async function listSlaPolicies(req, res) {
    const { rows } = await db.query(`SELECT * FROM support_sla_policies ORDER BY department`);
    res.json({ policies: rows });
  }

  async function updateSlaPolicy(req, res) {
    const department = req.params.department;
    const errors = [...validateDepartmentParam(department), ...validateSlaPolicyInput(req.body)];
    if (errors.length) return res.status(400).json({ errors });

    const fields = ['first_response_target_seconds', 'resolution_target_seconds', 'breach_alert_enabled'];
    const updates = fields.filter((f) => req.body[f] !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    const setClause = updates.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = updates.map((f) => req.body[f]);
    const { rows } = await db.query(
      `INSERT INTO support_sla_policies (department, ${updates.join(', ')})
       VALUES ($1, ${updates.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (department) DO UPDATE SET ${setClause}, updated_at = now()
       RETURNING *`,
      [department, ...values]
    );
    await logAction(actorId(req), 'sla_policy_updated', 'support_sla_policies', rows[0].id, req.body);
    res.json({ policy: rows[0] });
  }

  // ---------- Live monitoring ----------

  async function getLiveOverview(req, res) {
    const { rows: rawAgents } = await db.query(
      `SELECT a.*, u.name AS staff_name,
              COALESCE(sa.is_available, false) AS is_available, sa.last_heartbeat,
              COALESCE(sa.max_concurrent, 4) AS max_concurrent,
              COALESCE(load.current_load, 0) AS current_load
       FROM support_agents a
       LEFT JOIN users u ON u.id = a.staff_id
       LEFT JOIN staff_availability sa ON sa.staff_id = a.staff_id
       LEFT JOIN (
         SELECT assigned_staff_id, COUNT(*) AS current_load
         FROM chat_conversations WHERE status IN ('open', 'pending') GROUP BY assigned_staff_id
       ) load ON load.assigned_staff_id = a.staff_id
       WHERE a.active = true
       ORDER BY a.department, staff_name`
    );
    const agents = rawAgents.map((a) => ({
      ...a,
      status: isHeartbeatFresh(a.last_heartbeat) && a.is_available ? 'online' : 'offline',
    }));

    // 'waiting' = escalated and unassigned (the actual queue); 'open'/'pending'
    // with an assignee = actively being worked.
    const { rows: chats } = await db.query(
      `SELECT id, customer_id, assigned_staff_id, status, escalated_at,
              first_response_at, escalation_reason
       FROM chat_conversations
       WHERE status IN ('waiting', 'open', 'pending')
       ORDER BY COALESCE(escalated_at, created_at) ASC`
    );

    const { rows: policies } = await db.query(`SELECT * FROM support_sla_policies WHERE department = 'general'`);
    const policyByDept = { general: policies[0] };
    // Map to the shape lib/sla.js expects: started_at = the SLA clock, which
    // for you is escalated_at, not created_at (see 014's comments).
    const slaInput = chats
      .filter((c) => c.escalated_at) // nothing to breach before escalation starts the clock
      .map((c) => ({
        id: c.id,
        department: 'general',
        status: c.status === 'waiting' ? 'queued' : c.status === 'closed' ? 'closed' : 'active',
        started_at: c.escalated_at,
        first_response_at: c.first_response_at,
        agent_id: c.assigned_staff_id,
      }));
    const breaches = computeSlaBreaches(slaInput, policyByDept, new Date());

    res.json({
      agents,
      queued: chats.filter((c) => c.status === 'waiting'),
      active: chats.filter((c) => c.status === 'open' && c.assigned_staff_id),
      pending: chats.filter((c) => c.status === 'pending'),
      slaBreaches: breaches,
    });
  }

  async function listEscalations(req, res) {
    const { rows } = await db.query(
      `SELECT id, customer_id, assigned_staff_id, escalated_at, escalation_reason
       FROM chat_conversations WHERE status = 'waiting' ORDER BY escalated_at ASC`
    );
    res.json({ escalations: rows });
  }

  // Reassign and force-close were removed from here on purpose. Your
  // existing chatController.exports.updateConversation (PATCH
  // /api/chat/conversations/:id) already handles this correctly — row
  // locking (FOR UPDATE), reopened_count, resolved_at vs closed_at, and
  // proper chat_events logging via logEvent. Duplicating that logic here
  // with plain UPDATEs would have been a real correctness risk (a
  // force-close from this panel could have left a conversation in a state
  // the rest of your chat system doesn't expect). The Live Monitor tab
  // calls that endpoint directly instead — see
  // admin-support-control-center.partial.html.

  // ---------- Performance reporting ----------

  async function getPerformanceReport(req, res) {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params (ISO dates) are required' });

    // escalated_at is the fairest "started" point for agent metrics — time
    // spent reading FAQ answers before escalation isn't the agent's to own.
    // No csat_score column exists yet, so that's always null for now.
    const { rows } = await db.query(
      `SELECT c.assigned_staff_id AS agent_id, u.name AS agent_name,
              c.escalated_at AS started_at, c.first_response_at, c.closed_at,
              (c.escalation_reason IS NOT NULL) AS escalated,
              NULL::INTEGER AS csat_score
       FROM chat_conversations c
       LEFT JOIN users u ON u.id = c.assigned_staff_id
       WHERE c.status = 'closed' AND c.escalated_at IS NOT NULL
         AND c.escalated_at BETWEEN $1 AND $2 AND c.assigned_staff_id IS NOT NULL`,
      [start, end]
    );
    res.json({ report: aggregatePerformance(rows) });
  }

  // ---------- Audit log ----------

  async function listAuditLog(req, res) {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await db.query(
      `SELECT l.*, u.name AS actor_name
       FROM support_audit_log l
       LEFT JOIN users u ON u.id = l.actor_staff_id
       ORDER BY l.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ log: rows });
  }

  return {
    listAgents,
    createAgent,
    updateAgent,
    setAgentActive,
    listShifts,
    setShifts,
    listQueueRules,
    updateQueueRules,
    previewRouting,
    listCannedResponses,
    createCannedResponse,
    updateCannedResponse,
    deleteCannedResponse,
    listSlaPolicies,
    updateSlaPolicy,
    getLiveOverview,
    listEscalations,
    getPerformanceReport,
    listAuditLog,
    _logAction: logAction,
  };
}

// Lazy pool wrapper: server/config/database.js is only require()'d the first
// time a query actually runs, not when this file is loaded. That's what lets
// the test suite import createSupportAdminController below with zero risk of
// this module reaching for a real database connection on its own.
let _pool;
const lazyDb = {
  query: (...args) => {
    if (!_pool) _pool = require('../config/database');
    return _pool.query(...args);
  },
};

// Default export: plain, already-wired handlers — require and use directly,
// same as your other controllers.
module.exports = createSupportAdminController(lazyDb);
// Named export: the factory itself, for tests (or anything else) that wants
// to inject a fake db instead of the real pool.
module.exports.createSupportAdminController = createSupportAdminController;
