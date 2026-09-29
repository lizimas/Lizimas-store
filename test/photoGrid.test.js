// Photo rules (Sept 2026): vendors up to 8 photos, admin / Lizimas Store 20;
// the grid's reorder helper moves one photo without disturbing the rest.
const test = require("node:test");
const assert = require("node:assert");
const Checks = require("../client/js/lz-image-checks.js");
const Grid = require("../client/js/lz-photo-grid.js");

test("vendor photo count: at least 3, at most 8", () => {
    assert.match(Checks.countMessage(2), /at least 3/);
    assert.strictEqual(Checks.countMessage(3), null);
    assert.strictEqual(Checks.countMessage(8), null);
    assert.match(Checks.countMessage(9), /up to 8 photos/);
});

test("store limit is 20", () => {
    assert.strictEqual(Checks.RULES.MAX_IMAGES_STORE, 20);
    assert.strictEqual(Checks.RULES.MAX_IMAGES_VENDOR, 8);
    assert.strictEqual(Checks.countMessage(20, 20), null);
    assert.match(Checks.countMessage(21, 20), /up to 20/);
});

test("moveItem: set as main and drag", () => {
    assert.deepStrictEqual(Grid.moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
    assert.deepStrictEqual(Grid.moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
    assert.deepStrictEqual(Grid.moveItem(["a", "b"], 1, 1), ["a", "b"]);
    assert.deepStrictEqual(Grid.moveItem(["a", "b"], 0, 5), ["a", "b"]);
});
