// Phase 6 - Refund Tiers. Pure-logic tests for server/utils/refundTiers.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    REFUND_TIERS,
    tierForDaysSinceDelivery,
    resolveRefundTier,
    suggestedRefundAmount
} = require("../server/utils/refundTiers.js");

test("REFUND_TIERS percentages step down monotonically to zero", () => {
    const percentages = REFUND_TIERS.map((t) => t.percentage);
    assert.deepEqual(percentages, [100, 75, 50, 0]);
});

test("tierForDaysSinceDelivery: day 0-3 is full refund", () => {
    assert.equal(tierForDaysSinceDelivery(0).key, "full");
    assert.equal(tierForDaysSinceDelivery(3).key, "full");
});

test("tierForDaysSinceDelivery: day 4-7 is the 75% tier", () => {
    assert.equal(tierForDaysSinceDelivery(4).key, "partial_high");
    assert.equal(tierForDaysSinceDelivery(7).key, "partial_high");
});

test("tierForDaysSinceDelivery: day 8-14 is the 50% tier", () => {
    assert.equal(tierForDaysSinceDelivery(8).key, "partial_low");
    assert.equal(tierForDaysSinceDelivery(14).key, "partial_low");
});

test("tierForDaysSinceDelivery: day 15+ is ineligible (0%)", () => {
    assert.equal(tierForDaysSinceDelivery(15).key, "ineligible");
    assert.equal(tierForDaysSinceDelivery(9999).key, "ineligible");
});

test("tierForDaysSinceDelivery: a negative/invalid day count falls back to the most generous tier, never the harshest", () => {
    assert.equal(tierForDaysSinceDelivery(-5).key, "full");
    assert.equal(tierForDaysSinceDelivery(NaN).key, "full");
});

test("resolveRefundTier: computes days from delivered_at to the decision time", () => {
    const delivered = new Date("2026-09-01T00:00:00Z");
    const decided = new Date("2026-09-05T00:00:00Z"); // 4 days later
    const tier = resolveRefundTier(delivered, decided);
    assert.equal(tier.key, "partial_high");
    assert.equal(tier.daysSinceDelivery, 4);
});

test("resolveRefundTier: missing delivered_at falls back to the full-refund tier with a null day count", () => {
    const tier = resolveRefundTier(null, new Date());
    assert.equal(tier.key, "full");
    assert.equal(tier.daysSinceDelivery, null);
});

test("suggestedRefundAmount: applies the tier percentage to the sale amount", () => {
    const tier = { percentage: 75 };
    assert.equal(suggestedRefundAmount(100000, tier), 75000);
    assert.equal(suggestedRefundAmount(0, tier), 0);
});

test("suggestedRefundAmount: an ineligible (0%) tier suggests no refund", () => {
    assert.equal(suggestedRefundAmount(50000, { percentage: 0 }), 0);
});

test("suggestedRefundAmount: a full (100%) tier suggests the whole sale amount", () => {
    assert.equal(suggestedRefundAmount(37500, { percentage: 100 }), 37500);
});
