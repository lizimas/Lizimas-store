'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickAgentForRouting, decideOverflow } = require('../server/lib/routing');
const { computeSlaBreaches } = require('../server/lib/sla');
const { aggregatePerformance } = require('../server/lib/performance');
const { isValidDepartment, DEPARTMENT_KEYS } = require('../server/lib/departments');
const { isWithinShift } = require('../server/lib/schedule');
const { findBestAgent } = require('../server/lib/autoAssign');
const {
  validateAgentInput,
  validateDepartmentParam,
  validateQueueRuleInput,
  validateCannedResponseInput,
  validateSlaPolicyInput,
} = require('../server/lib/validation');
const createSupportAdminController = require('../server/controllers/supportAdminController').createSupportAdminController;

// ---------- routing.js ----------

test('pickAgentForRouting: least_busy picks the agent with the lowest load ratio', () => {
  const agents = [
    { id: 1, department: 'general', status: 'online', active: true, current_load: 2, max_concurrent_chats: 3 },
    { id: 2, department: 'general', status: 'online', active: true, current_load: 1, max_concurrent_chats: 4 },
    { id: 3, department: 'general', status: 'offline', active: true, current_load: 0, max_concurrent_chats: 3 },
  ];
  const picked = pickAgentForRouting(agents, { mode: 'least_busy', department: 'general' });
  assert.equal(picked.id, 2); // 1/4 < 2/3, agent 3 excluded (offline)
});

test('pickAgentForRouting: agents at full capacity are excluded', () => {
  const agents = [
    { id: 1, department: 'general', status: 'online', active: true, current_load: 3, max_concurrent_chats: 3 },
  ];
  const picked = pickAgentForRouting(agents, { mode: 'least_busy', department: 'general' });
  assert.equal(picked, null);
});

test('pickAgentForRouting: round_robin rotates past the last-picked agent id', () => {
  const agents = [
    { id: 1, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3 },
    { id: 2, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3 },
    { id: 3, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3 },
  ];
  assert.equal(pickAgentForRouting(agents, { mode: 'round_robin', lastRoundRobinAgentId: 1 }).id, 2);
  assert.equal(pickAgentForRouting(agents, { mode: 'round_robin', lastRoundRobinAgentId: 3 }).id, 1); // wraps
  assert.equal(pickAgentForRouting(agents, { mode: 'round_robin', lastRoundRobinAgentId: null }).id, 1);
});

test('pickAgentForRouting: skill_based prefers agents with the required skill', () => {
  const agents = [
    { id: 1, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3, skills: [] },
    { id: 2, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3, skills: ['refunds'] },
  ];
  const picked = pickAgentForRouting(agents, { mode: 'skill_based', department: 'general', requiredSkill: 'refunds' });
  assert.equal(picked.id, 2);
});

test('pickAgentForRouting: skill_based falls back to the department pool if nobody has the skill', () => {
  const agents = [
    { id: 1, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3, skills: [] },
  ];
  const picked = pickAgentForRouting(agents, { mode: 'skill_based', department: 'general', requiredSkill: 'refunds' });
  assert.equal(picked.id, 1);
});

test('pickAgentForRouting: department filter includes agents whose home department differs but who have it in skills', () => {
  const agents = [
    { id: 1, department: 'general', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3, skills: ['orders_payments'] },
    { id: 2, department: 'technical', status: 'online', active: true, current_load: 0, max_concurrent_chats: 3, skills: [] },
  ];
  const picked = pickAgentForRouting(agents, { mode: 'least_busy', department: 'orders_payments' });
  assert.equal(picked.id, 1); // agent 2 has neither home dept nor skill match
});

test('decideOverflow: respects business hours before queue wait', () => {
  const rule = { business_hours_enabled: true, max_queue_wait_seconds: 120, overflow_action: 'escalate' };
  assert.equal(decideOverflow(rule, 5, false), 'offline_message');
  assert.equal(decideOverflow(rule, 5, true), 'keep_queued');
  assert.equal(decideOverflow(rule, 200, true), 'escalate');
});

// ---------- sla.js ----------

test('computeSlaBreaches: flags a first-response breach', () => {
  const now = new Date('2026-09-21T12:05:00Z');
  const chats = [
    { id: 1, department: 'general', status: 'queued', started_at: '2026-09-21T12:00:00Z', first_response_at: null, agent_id: 7 },
  ];
  const policies = { general: { first_response_target_seconds: 60, resolution_target_seconds: 1800 } };
  const breaches = computeSlaBreaches(chats, policies, now);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].type, 'first_response');
  assert.equal(breaches[0].secondsOver, 240);
});

test('computeSlaBreaches: flags a resolution breach only after first response exists', () => {
  const now = new Date('2026-09-21T12:40:00Z');
  const chats = [
    {
      id: 2,
      department: 'general',
      status: 'active',
      started_at: '2026-09-21T12:00:00Z',
      first_response_at: '2026-09-21T12:01:00Z',
      agent_id: 7,
    },
  ];
  const policies = { general: { first_response_target_seconds: 60, resolution_target_seconds: 1800 } };
  const breaches = computeSlaBreaches(chats, policies, now);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].type, 'resolution');
});

test('computeSlaBreaches: closed chats never breach', () => {
  const now = new Date('2026-09-21T20:00:00Z');
  const chats = [
    { id: 3, department: 'general', status: 'closed', started_at: '2026-09-21T12:00:00Z', first_response_at: null },
  ];
  const policies = { general: { first_response_target_seconds: 60, resolution_target_seconds: 1800 } };
  assert.equal(computeSlaBreaches(chats, policies, now).length, 0);
});

// ---------- performance.js ----------

test('aggregatePerformance: computes per-agent averages and sorts by volume', () => {
  const rows = [
    { agent_id: 1, agent_name: 'Leticia', started_at: '2026-09-21T10:00:00Z', first_response_at: '2026-09-21T10:01:00Z', closed_at: '2026-09-21T10:10:00Z', escalated: false, csat_score: 5 },
    { agent_id: 1, agent_name: 'Leticia', started_at: '2026-09-21T11:00:00Z', first_response_at: '2026-09-21T11:02:00Z', closed_at: '2026-09-21T11:20:00Z', escalated: true, csat_score: 3 },
    { agent_id: 2, agent_name: 'Talent', started_at: '2026-09-21T09:00:00Z', first_response_at: '2026-09-21T09:00:30Z', closed_at: '2026-09-21T09:05:00Z', escalated: false, csat_score: null },
  ];
  const report = aggregatePerformance(rows);
  assert.equal(report.length, 2);
  assert.equal(report[0].agentId, 1); // 2 chats > 1 chat
  assert.equal(report[0].chatsHandled, 2);
  assert.equal(report[0].avgFirstResponseSeconds, 90); // (60 + 120) / 2
  assert.equal(report[0].escalationRate, 0.5);
  assert.equal(report[0].avgCsat, 4);
  assert.equal(report[1].avgCsat, null);
});

// ---------- validation.js ----------

test('validateAgentInput: requires staff_id, rejects bad role, rejects non-array skills', () => {
  assert.equal(validateAgentInput({}).length, 1);
  assert.equal(validateAgentInput({ staff_id: 5, role: 'manager' }).length, 1);
  assert.equal(validateAgentInput({ staff_id: 5, skills: 'delivery' }).length, 1);
  assert.equal(validateAgentInput({ staff_id: 5, role: 'supervisor', skills: ['delivery'] }).length, 0);
});

test('validateAgentInput: rejects unknown department keys in skills or department', () => {
  assert.equal(validateAgentInput({ staff_id: 5, skills: ['not_a_real_department'] }).length, 1);
  assert.equal(validateAgentInput({ staff_id: 5, department: 'not_a_real_department' }).length, 1);
  assert.equal(validateAgentInput({ staff_id: 5, department: 'technical', role: 'senior_agent' }).length, 0);
});

test('validateQueueRuleInput: rejects unknown routing_mode/overflow_action', () => {
  assert.equal(validateQueueRuleInput({ routing_mode: 'random' }).length, 1);
  assert.equal(validateQueueRuleInput({ overflow_action: 'shrug' }).length, 1);
  assert.equal(validateQueueRuleInput({ routing_mode: 'round_robin', max_queue_wait_seconds: 60 }).length, 0);
});

test('validateDepartmentParam: accepts only the 7 real department keys', () => {
  assert.equal(validateDepartmentParam('delivery').length, 0);
  assert.equal(validateDepartmentParam('made_up').length, 1);
});

// ---------- departments.js ----------

test('isValidDepartment: matches exactly the 7 keys used in migration 121', () => {
  assert.equal(DEPARTMENT_KEYS.length, 7);
  for (const key of [
    'orders_payments', 'delivery', 'product_info', 'returns_refunds',
    'account_login', 'technical', 'general',
  ]) {
    assert.ok(isValidDepartment(key), `expected ${key} to be valid`);
  }
  assert.equal(isValidDepartment('shipping'), false);
});

// ---------- schedule.js ----------

test('isWithinShift: an agent with no shifts configured is always eligible', () => {
  assert.equal(isWithinShift([], new Date('2026-09-21T12:00:00Z')), true);
  assert.equal(isWithinShift(null, new Date('2026-09-21T12:00:00Z')), true);
});

test('isWithinShift: matches a same-day shift in EAT (UTC+3)', () => {
  // Monday 2026-09-21 09:00 EAT = 06:00 UTC
  const monday9amEAT = new Date('2026-09-21T06:00:00Z');
  const shifts = [{ day_of_week: 1, start_time: '08:00:00', end_time: '17:00:00' }]; // Monday
  assert.equal(isWithinShift(shifts, monday9amEAT), true);

  // Same shift, but 19:00 EAT (16:00 UTC) - after hours
  const monday7pmEAT = new Date('2026-09-21T16:00:00Z');
  assert.equal(isWithinShift(shifts, monday7pmEAT), false);
});

test('isWithinShift: an overnight shift wraps past midnight correctly', () => {
  const shifts = [{ day_of_week: 1, start_time: '22:00:00', end_time: '06:00:00' }]; // Monday night
  // Monday 23:00 EAT = Monday 20:00 UTC
  assert.equal(isWithinShift(shifts, new Date('2026-09-21T20:00:00Z')), true);
});

// ---------- autoAssign.js ----------

test('findBestAgent: returns rule=null when the department has no queue rule', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const { rule, agent } = await findBestAgent(db, 'delivery');
  assert.equal(rule, null);
  assert.equal(agent, null);
});

test('findBestAgent: picks the least-busy eligible agent for the department', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push(sql);
      if (sql.includes('support_queue_rules')) {
        return { rows: [{ department: 'delivery', routing_mode: 'least_busy' }] };
      }
      if (sql.includes('FROM support_agents')) {
        return {
          rows: [
            { id: 1, staff_id: 10, department: 'delivery', skills: [], active: true, is_available: true, last_heartbeat: new Date(), max_concurrent_chats: 3, current_load: 2 },
            { id: 2, staff_id: 11, department: 'delivery', skills: [], active: true, is_available: true, last_heartbeat: new Date(), max_concurrent_chats: 3, current_load: 0 },
          ],
        };
      }
      if (sql.includes('support_shifts')) {
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
  const { rule, agent } = await findBestAgent(db, 'delivery');
  assert.equal(rule.routing_mode, 'least_busy');
  assert.equal(agent.staff_id, 11); // lower current_load
});

test('validateCannedResponseInput: requires title and body', () => {
  assert.equal(validateCannedResponseInput({}).length, 2);
  assert.equal(validateCannedResponseInput({ title: 'Hi', body: 'Hello there' }).length, 0);
});

test('validateSlaPolicyInput: resolution target must exceed first-response target', () => {
  const errors = validateSlaPolicyInput({ first_response_target_seconds: 100, resolution_target_seconds: 50 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'resolution_target_seconds');
});

// ---------- controller (with a fake db) ----------

function makeFakeDb(script) {
  // `script` is an array of { match: (sql) => bool, result: {rows:[...]} }
  // consumed in order for a deterministic, readable test double.
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const step = script.shift();
      if (!step) throw new Error('Unexpected extra db.query call: ' + sql);
      return step.result;
    },
  };
}

function fakeReqRes(overrides = {}) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const req = { params: {}, query: {}, body: {}, user: { id: 1 }, ...overrides };
  return { req, res };
}

test('controller.createAgent: 400s on invalid input without touching the db', async () => {
  const db = makeFakeDb([]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ body: { role: 'manager' } }); // missing staff_id, bad role
  await controller.createAgent(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.length, 0);
});

test('controller.createAgent: inserts and writes an audit log entry on success', async () => {
  const db = makeFakeDb([
    { result: { rows: [{ id: 9, staff_id: 5, role: 'agent', department: 'general' }] } }, // INSERT support_agents
    { result: { rows: [] } }, // INSERT support_audit_log
  ]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ body: { staff_id: 5 } });
  await controller.createAgent(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.agent.id, 9);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[1].sql, /support_audit_log/);
});

test('controller.createAgent: 409s cleanly on a duplicate staff_id', async () => {
  const db = {
    calls: [],
    query: async () => {
      const e = new Error('duplicate key value violates unique constraint');
      e.code = '23505';
      throw e;
    },
  };
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ body: { staff_id: 5 } });
  await controller.createAgent(req, res);
  assert.equal(res.statusCode, 409);
});

test('controller.listEscalations: returns waiting conversations ordered by escalated_at', async () => {
  const db = makeFakeDb([
    { result: { rows: [{ id: 3, escalated_at: '2026-09-21T10:00:00Z', escalation_reason: 'no_match' }] } },
  ]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes();
  await controller.listEscalations(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.escalations.length, 1);
  assert.match(db.calls[0].sql, /status = 'waiting'/);
});

test('controller.updateQueueRules: 400s on invalid routing_mode', async () => {
  const db = makeFakeDb([]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ params: { department: 'general' }, body: { routing_mode: 'psychic' } });
  await controller.updateQueueRules(req, res);
  assert.equal(res.statusCode, 400);
});

test('controller.getPerformanceReport: 400s when start/end are missing', async () => {
  const db = makeFakeDb([]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ query: {} });
  await controller.getPerformanceReport(req, res);
  assert.equal(res.statusCode, 400);
});

test('controller.getPerformanceReport: aggregates rows returned from the db', async () => {
  const db = makeFakeDb([
    {
      result: {
        rows: [
          { agent_id: 1, agent_name: 'Leticia', started_at: '2026-09-21T10:00:00Z', first_response_at: '2026-09-21T10:01:00Z', closed_at: '2026-09-21T10:05:00Z', escalated: false, csat_score: 4 },
        ],
      },
    },
  ]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ query: { start: '2026-09-01', end: '2026-09-30' } });
  await controller.getPerformanceReport(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report[0].agentId, 1);
  assert.equal(res.body.report[0].chatsHandled, 1);
});

test('controller.listAgents: returns whatever the db gives back, joined shape untouched', async () => {
  const db = makeFakeDb([{ result: { rows: [{ id: 1, staff_name: 'Leticia' }] } }]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes();
  await controller.listAgents(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agents.length, 1);
});
