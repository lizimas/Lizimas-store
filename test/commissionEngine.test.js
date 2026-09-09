const test = require("node:test");
const assert = require("node:assert/strict");
const { computePricing, roundToNearest } = require("../server/utils/commissionEngine");

test("matches the spec's worked example (no fixed fee)", () => {
    const result = computePricing({ vendorPayout: 100000, rate: 0.06 });
    // 100000 / 0.94 = 106382.97..., rounded to nearest 100 = 106400
    assert.equal(result.customerPrice, 106400);
    assert.equal(result.vendorPayout, 100000);
    // Vendor still receives exactly 100000: customerPrice - fixedFee - commission = payout
    assert.equal(result.customerPrice - result.fixedFee - result.commissionAmount, 100000);
});

test("matches the spec's worked example (with a fixed processing fee)", () => {
    const result = computePricing({ vendorPayout: 100000, rate: 0.06, fixedFee: 1000 });
    // (100000 + 1000) / 0.94 = 107446.8..., rounded to nearest 100 = 107400... spec says 107447
    // but the spec's own example rounds to the nearest 1, not 100 - reproduce with roundNearest: 1
    // to confirm the formula itself matches, independent of the rounding step.
    const unrounded = computePricing({ vendorPayout: 100000, rate: 0.06, fixedFee: 1000, roundNearest: 1 });
    assert.equal(unrounded.customerPrice, 107447);
});

test("vendor payout is exact after rounding, even when rounding moves the price down", () => {
    // 33333 / (1 - 0.15) = 39215.29..., which rounds DOWN to 39200 at nearest-100 -
    // the vendor must still walk away with exactly 33333, so Lizimas' commission
    // absorbs the shortfall rather than the vendor losing money to rounding.
    const result = computePricing({ vendorPayout: 33333, rate: 0.15 });
    assert.equal(result.customerPrice, 39200);
    assert.equal(result.customerPrice - result.fixedFee - result.commissionAmount, 33333);
});

test("rejects a non-positive or non-numeric desired payout", () => {
    assert.throws(() => computePricing({ vendorPayout: 0, rate: 0.1 }));
    assert.throws(() => computePricing({ vendorPayout: -500, rate: 0.1 }));
    assert.throws(() => computePricing({ vendorPayout: "not a number", rate: 0.1 }));
});

test("rejects a commission rate that is out of range", () => {
    assert.throws(() => computePricing({ vendorPayout: 1000, rate: 1 }));
    assert.throws(() => computePricing({ vendorPayout: 1000, rate: -0.1 }));
});

test("roundToNearest rounds to the given granularity", () => {
    assert.equal(roundToNearest(106383, 100), 106400);
    assert.equal(roundToNearest(106340, 100), 106300);
    assert.equal(roundToNearest(1234, 500), 1000);
    assert.equal(roundToNearest(1250, 500), 1500);
});
