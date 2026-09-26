const test = require("node:test");
const assert = require("node:assert/strict");
const { nextWindow } = require("../server/utils/flashSaleRecurrence");

const H = 3600 * 1000;
test("no rerun when not recurring or still running", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    assert.equal(nextWindow({ ends_at: "2026-09-26T10:00:00Z", recurs_every_hours: null }, now), null);
    assert.equal(nextWindow({ ends_at: "2026-09-26T13:00:00Z", recurs_every_hours: 72 }, now), null);
});

test("ended 1 hour ago with a 72h rerun moves forward one period", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    const w = nextWindow({ starts_at: "2026-09-23T11:00:00Z", ends_at: "2026-09-26T11:00:00Z", recurs_every_hours: 72 }, now);
    assert.equal(w.periods, 1);
    assert.equal(w.starts_at.toISOString(), "2026-09-26T11:00:00.000Z");
    assert.equal(w.ends_at.toISOString(), "2026-09-29T11:00:00.000Z");
});

test("several missed periods catch up in one step and keep the countdown length", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const w = nextWindow({ starts_at: "2026-09-26T00:00:00Z", ends_at: "2026-09-27T00:00:00Z", recurs_every_hours: 48 }, now);
    assert.ok(w.ends_at.getTime() > now.getTime());
    assert.ok(w.ends_at.getTime() - now.getTime() <= 48 * H);
    assert.equal(w.ends_at.getTime() - w.starts_at.getTime(), 24 * H);
});

test("no start time: countdown just runs the full period", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    const w = nextWindow({ starts_at: null, ends_at: "2026-09-26T11:30:00Z", recurs_every_hours: 24 }, now);
    assert.equal(w.starts_at, null);
    assert.equal(w.ends_at.toISOString(), "2026-09-27T11:30:00.000Z");
});
