// Vendor SKUs (Oct 2026): the vendor's own code plus the fixed -ULZMS suffix.
const test = require("node:test");
const assert = require("node:assert");
const { withSkuSuffix } = require("../server/utils/sku");

test("suffix is added once, whatever the vendor types", () => {
    assert.deepStrictEqual(withSkuSuffix("tv-55a"), { ok: true, sku: "TV-55A-ULZMS" });
    assert.strictEqual(withSkuSuffix("TV-55A-ULZMS").sku, "TV-55A-ULZMS");
    assert.strictEqual(withSkuSuffix("tv 55a ulzms").sku, "TV-55A-ULZMS");
    assert.strictEqual(withSkuSuffix("  ").sku, null);
    assert.strictEqual(withSkuSuffix(undefined).sku, null);
    assert.strictEqual(withSkuSuffix("ULZMS").sku, null);
    assert.strictEqual(withSkuSuffix("bad#code").ok, false);
});
