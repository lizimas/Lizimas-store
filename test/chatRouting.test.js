'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { _findDepartmentMatchedStaffId } = require('../server/services/chatRouting');

function makeFakeClient(script) {
  // `script` is an array consumed in order, one entry per client.query call.
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const step = script.shift();
      if (!step) throw new Error('Unexpected extra client.query call: ' + sql);
      return step;
    },
  };
}

test('_findDepartmentMatchedStaffId: returns null when nobody in support_agents matches the department', async () => {
  const client = makeFakeClient([{ rows: [] }]); // candidates query
  const staffId = await _findDepartmentMatchedStaffId(client, 'delivery');
  assert.equal(staffId, null);
  assert.equal(client.calls.length, 1); // never queries shifts if there are no candidates
});

test('_findDepartmentMatchedStaffId: picks the least-busy candidate when nobody has shifts configured', async () => {
  const client = makeFakeClient([
    { rows: [
      { staff_id: 10, went_available_at: '2026-09-21T05:00:00Z', support_agent_id: 1 },
      { staff_id: 11, went_available_at: '2026-09-21T06:00:00Z', support_agent_id: 2 },
    ] }, // candidates query, already ordered least-busy first
    { rows: [] }, // no shifts configured for either
  ]);
  const staffId = await _findDepartmentMatchedStaffId(client, 'delivery');
  assert.equal(staffId, 10); // first in the already-ordered list
});

test('_findDepartmentMatchedStaffId: skips a candidate outside their shift, picks the next eligible one', async () => {
  const client = makeFakeClient([
    { rows: [
      { staff_id: 10, went_available_at: '2026-09-21T05:00:00Z', support_agent_id: 1 },
      { staff_id: 11, went_available_at: '2026-09-21T06:00:00Z', support_agent_id: 2 },
    ] },
    { rows: [
      // agent 1 (staff 10) has a Monday 08:00-17:00 EAT shift only
      { agent_id: 1, day_of_week: 1, start_time: '08:00:00', end_time: '17:00:00' },
      // agent 2 (staff 11) has no shift row at all -> always eligible
    ] },
  ]);

  // Saturday 2026-09-19 noon UTC: outside agent 1's Monday-only shift, but
  // agent 2 has no shifts configured -> always eligible regardless of day.
  const saturday = new Date('2026-09-19T12:00:00Z');
  const staffId = await _findDepartmentMatchedStaffId(client, 'delivery', saturday);
  assert.equal(staffId, 11);
});

test('_findDepartmentMatchedStaffId: the least-busy candidate wins when they ARE inside their shift', async () => {
  const client = makeFakeClient([
    { rows: [
      { staff_id: 10, went_available_at: '2026-09-21T05:00:00Z', support_agent_id: 1 },
    ] },
    { rows: [
      { agent_id: 1, day_of_week: 1, start_time: '08:00:00', end_time: '17:00:00' }, // Monday
    ] },
  ]);
  // Monday 2026-09-21, 10:00 EAT = 07:00 UTC -> inside the shift
  const mondayMorning = new Date('2026-09-21T07:00:00Z');
  const staffId = await _findDepartmentMatchedStaffId(client, 'delivery', mondayMorning);
  assert.equal(staffId, 10);
});
