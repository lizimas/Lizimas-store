// Vendor Center home page: the Business metrics period and change figures.
const test = require("node:test");
const assert = require("node:assert");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://liz:liz@localhost:5432/liz2";
process.env.DB_SSL = "false";
const { rangeDays, changePct } = require("../server/controllers/vendorHomeController");

test("only 7, 30 and 90 days are offered; anything else is 7", () => {
    assert.equal(rangeDays("30"), 30);
    assert.equal(rangeDays(90), 90);
    assert.equal(rangeDays("365"), 7);
    assert.equal(rangeDays(undefined), 7);
    assert.equal(rangeDays("7; DROP TABLE"), 7);
});

test("change against the period before, to one decimal; nothing to compare gives null", () => {
    assert.equal(changePct(150, 100), 50);
    assert.equal(changePct(0, 100), -100);
    assert.equal(changePct(100, 300), -66.7);
    assert.equal(changePct(100, 0), null);
    assert.equal(changePct("12", "8"), 50);
});
