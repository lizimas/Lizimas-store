const test = require("node:test");
const assert = require("node:assert/strict");
const {
    MAX_VENDOR_DISCOUNT_PERCENT,
    computeDiscountPercent,
    validateProposedPrice,
    isValidPromotionWindow,
    deriveVendorPromotionStatus,
    isSponsoredAndActive
} = require("../server/utils/vendorPromotions.js");

test("computeDiscountPercent: basic percentages", () => {
    assert.equal(computeDiscountPercent(100, 75), 25);
    assert.equal(computeDiscountPercent(100, 50), 50);
    assert.equal(computeDiscountPercent(200, 180), 10);
});

test("computeDiscountPercent: zero/invalid original price returns 0", () => {
    assert.equal(computeDiscountPercent(0, 10), 0);
});

test("validateProposedPrice: rejects zero or negative sale price", () => {
    assert.equal(validateProposedPrice(100, 0).allowed, false);
    assert.equal(validateProposedPrice(100, -5).allowed, false);
});

test("validateProposedPrice: rejects a sale price that isn't actually a discount", () => {
    assert.equal(validateProposedPrice(100, 100).allowed, false);
    assert.equal(validateProposedPrice(100, 150).allowed, false);
});

test("validateProposedPrice: rejects a discount over the ceiling", () => {
    const result = validateProposedPrice(100, 40, 50); // 60% off > 50% ceiling
    assert.equal(result.allowed, false);
    assert.match(result.reason, /cannot exceed 50%/);
});

test("validateProposedPrice: allows a discount at or under the ceiling", () => {
    const atCeiling = validateProposedPrice(100, 50, 50); // exactly 50% off
    assert.equal(atCeiling.allowed, true);
    assert.equal(atCeiling.discountPercent, 50);

    const underCeiling = validateProposedPrice(100, 90, MAX_VENDOR_DISCOUNT_PERCENT); // 10% off
    assert.equal(underCeiling.allowed, true);
    assert.equal(underCeiling.discountPercent, 10);
});

test("isValidPromotionWindow: rejects invalid dates", () => {
    assert.equal(isValidPromotionWindow("not-a-date", "2026-01-01").allowed, false);
});

test("isValidPromotionWindow: rejects ends_at at or before starts_at", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const sameTime = isValidPromotionWindow("2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z", now);
    assert.equal(sameTime.allowed, false);
    assert.match(sameTime.reason, /after starts_at/);

    const reversed = isValidPromotionWindow("2026-02-05T00:00:00Z", "2026-02-01T00:00:00Z", now);
    assert.equal(reversed.allowed, false);
});

test("isValidPromotionWindow: rejects a window that already ended", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const result = isValidPromotionWindow("2026-01-01T00:00:00Z", "2026-01-15T00:00:00Z", now);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /future/);
});

test("isValidPromotionWindow: allows a sensible future window", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const result = isValidPromotionWindow("2026-02-01T00:00:00Z", "2026-02-10T00:00:00Z", now);
    assert.equal(result.allowed, true);
});

test("deriveVendorPromotionStatus: pending/rejected pass through regardless of window", () => {
    assert.equal(
        deriveVendorPromotionStatus({ status: "pending", startsAt: "2020-01-01", endsAt: "2020-01-02" }),
        "pending"
    );
    assert.equal(
        deriveVendorPromotionStatus({ status: "rejected", startsAt: "2099-01-01", endsAt: "2099-01-02" }),
        "rejected"
    );
});

test("deriveVendorPromotionStatus: approved + before window is scheduled", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    assert.equal(
        deriveVendorPromotionStatus({ status: "approved", startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, now),
        "scheduled"
    );
});

test("deriveVendorPromotionStatus: approved + within window is active", () => {
    const now = new Date("2026-02-05T00:00:00Z");
    assert.equal(
        deriveVendorPromotionStatus({ status: "approved", startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, now),
        "active"
    );
});

test("deriveVendorPromotionStatus: approved + after window is expired", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    assert.equal(
        deriveVendorPromotionStatus({ status: "approved", startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, now),
        "expired"
    );
});

test("isSponsoredAndActive: false when sponsored flag is off, even if active", () => {
    const now = new Date("2026-02-05T00:00:00Z");
    assert.equal(
        isSponsoredAndActive({ status: "approved", sponsored: false, startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, now),
        false
    );
});

test("isSponsoredAndActive: true when sponsored and within an approved window", () => {
    const now = new Date("2026-02-05T00:00:00Z");
    assert.equal(
        isSponsoredAndActive({ status: "approved", sponsored: true, startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, now),
        true
    );
});

test("isSponsoredAndActive: false when sponsored but pending, scheduled, or expired", () => {
    const now = new Date("2026-02-05T00:00:00Z");
    assert.equal(isSponsoredAndActive({ status: "pending", sponsored: true, startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-02-10T00:00:00Z" }, now), false);
    assert.equal(isSponsoredAndActive({ status: "approved", sponsored: true, startsAt: "2026-03-01T00:00:00Z", endsAt: "2026-03-10T00:00:00Z" }, now), false);
    assert.equal(isSponsoredAndActive({ status: "approved", sponsored: true, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-10T00:00:00Z" }, now), false);
});

