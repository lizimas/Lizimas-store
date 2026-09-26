const test = require("node:test");
const assert = require("node:assert/strict");
const t = require("../server/lib/supportTier");

test("isSenior", () => {
    assert.equal(t.isSenior("agent"), false);
    assert.equal(t.isSenior("senior_agent"), true);
    assert.equal(t.isSenior("supervisor"), true);
    assert.equal(t.isSenior("admin"), true);
    assert.equal(t.isSenior(null), false);
});

test("canActOn: agents only their own or unassigned chats", () => {
    assert.equal(t.canActOn("agent", 5, { assigned_staff_id: null }), true);
    assert.equal(t.canActOn("agent", 5, { assigned_staff_id: 5 }), true);
    assert.equal(t.canActOn("agent", 5, { assigned_staff_id: "5" }), true);
    assert.equal(t.canActOn("agent", 5, { assigned_staff_id: 9 }), false);
    assert.equal(t.canActOn("senior_agent", 5, { assigned_staff_id: 9 }), true);
    assert.equal(t.canActOn("admin", 5, { assigned_staff_id: 9 }), true);
});

test("needsSenior: difficult chats", () => {
    assert.equal(t.needsSenior({ priority: "normal", escalation_level: 0, department: "general" }), false);
    assert.equal(t.needsSenior({ priority: "high", escalation_level: 0 }), true);
    assert.equal(t.needsSenior({ priority: "critical" }), true);
    assert.equal(t.needsSenior({ priority: "normal", escalation_level: 1 }), true);
    assert.equal(t.needsSenior({ priority: "normal", department: "returns_refunds" }), true);
});

test("escalatedPriority never lowers", () => {
    assert.equal(t.escalatedPriority("low"), "high");
    assert.equal(t.escalatedPriority("normal"), "high");
    assert.equal(t.escalatedPriority("high"), "high");
    assert.equal(t.escalatedPriority("critical"), "critical");
});

test("getTier", async () => {
    const db = (role) => ({ query: async () => ({ rows: role ? [{ role }] : [] }) });
    assert.equal(await t.getTier(db(null), { role: "admin", userId: 1 }), "admin");
    assert.equal(await t.getTier(db("senior_agent"), { role: "customer_support", userId: 2 }), "senior_agent");
    assert.equal(await t.getTier(db(null), { role: "customer_support", userId: 3 }), "agent");
});
