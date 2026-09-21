import shutil, datetime, sys

path = "test/supportAdmin.test.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''test('controller.listAgents: returns whatever the db gives back, joined shape untouched', async () => {
  const db = makeFakeDb([{ result: { rows: [{ id: 1, staff_name: 'Leticia' }] } }]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes();
  await controller.listAgents(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agents.length, 1);
});'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

new_tests = anchor + '''

test('controller.listShifts: returns whatever the db gives back for that agent', async () => {
  const db = makeFakeDb([{ result: { rows: [{ id: 1, day_of_week: 1, start_time: '08:00:00', end_time: '17:00:00' }] } }]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ params: { agentId: '7' } });
  await controller.listShifts(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.shifts.length, 1);
  assert.match(db.calls[0].sql, /support_shifts WHERE agent_id/);
  assert.equal(db.calls[0].params[0], 7);
});

test('controller.setShifts: rejects a shift with day_of_week out of range', async () => {
  const db = makeFakeDb([]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({
    params: { agentId: '7' },
    body: { shifts: [{ day_of_week: 9, start_time: '08:00', end_time: '17:00' }] },
  });
  await controller.setShifts(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.length, 0);
});

test('controller.setShifts: rejects a shift missing start_time or end_time', async () => {
  const db = makeFakeDb([]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({
    params: { agentId: '7' },
    body: { shifts: [{ day_of_week: 1, start_time: '08:00' }] },
  });
  await controller.setShifts(req, res);
  assert.equal(res.statusCode, 400);
});

test('controller.setShifts: replaces all shifts for the agent (delete then insert each)', async () => {
  const db = makeFakeDb([
    { result: { rows: [] } },
    { result: { rows: [] } },
    { result: { rows: [] } },
    { result: { rows: [] } },
  ]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({
    params: { agentId: '7' },
    body: { shifts: [
      { day_of_week: 1, start_time: '08:00', end_time: '17:00' },
      { day_of_week: 3, start_time: '09:00', end_time: '18:00' },
    ] },
  });
  await controller.setShifts(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 2);
  assert.match(db.calls[0].sql, /DELETE FROM support_shifts/);
  assert.equal(db.calls.length, 4);
  assert.match(db.calls[1].sql, /INSERT INTO support_shifts/);
});

test('controller.setShifts: an empty shifts array clears all shifts for the agent', async () => {
  const db = makeFakeDb([
    { result: { rows: [] } },
    { result: { rows: [] } },
  ]);
  const controller = createSupportAdminController(db);
  const { req, res } = fakeReqRes({ params: { agentId: '7' }, body: { shifts: [] } });
  await controller.setShifts(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 0);
  assert.equal(db.calls.length, 2);
});'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, new_tests, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
