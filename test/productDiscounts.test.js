const test = require("node:test");
const assert = require("node:assert");
const { discountedPrice, percentForTargetPrice, resolvePercent } = require("../server/utils/productDiscounts");

test("percent stays fixed when the price changes", () => {
    assert.strictEqual(discountedPrice(500000, 30), 350000);
    assert.strictEqual(discountedPrice(700000, 30), 490000);
});

test("typed final price comes back exactly", () => {
    for (const [price, target] of [[500000, 350000], [49999, 35000], [123457, 99999], [1000, 1], [9999999, 9999998]]) {
        const pct = percentForTargetPrice(price, target);
        assert.ok(pct > 0 && pct < 100, `${price}->${target}`);
        assert.strictEqual(discountedPrice(price, pct), target, `${price}->${target} via ${pct}`);
    }
});

test("target price then a price change keeps the same percent", () => {
    const pct = percentForTargetPrice(500000, 350000);
    assert.strictEqual(pct, 30);
    assert.strictEqual(discountedPrice(700000, pct), 490000);
});

test("resolvePercent validation", () => {
    assert.deepStrictEqual(resolvePercent(500000, { percent: 30 }), { percent: 30 });
    assert.deepStrictEqual(resolvePercent(500000, { target_price: 350000 }), { percent: 30 });
    assert.ok(resolvePercent(500000, { target_price: 500000 }).error);
    assert.ok(resolvePercent(500000, { target_price: 600000 }).error);
    assert.ok(resolvePercent(500000, { target_price: 0 }).error);
    assert.ok(resolvePercent(500000, { percent: 0 }).error);
    assert.ok(resolvePercent(500000, { percent: 100 }).error);
    assert.ok(resolvePercent(0, { percent: 10 }).error);
});
