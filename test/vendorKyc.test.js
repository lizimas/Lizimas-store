const test = require("node:test");
const assert = require("node:assert/strict");
const {
    KYC_STATUSES,
    isValidKycStatus,
    isValidAdminKycTransition,
    canVendorEditKyc,
    KYC_STATUS_LABELS
} = require("../server/utils/vendorKyc.js");

test("KYC_STATUSES has exactly the seven states", () => {
    assert.deepEqual(KYC_STATUSES, [
        "not_started", "submitted", "under_review", "action_required",
        "verified", "rejected", "suspended"
    ]);
});

test("isValidKycStatus: all seven states are valid, anything else isn't", () => {
    for (const status of KYC_STATUSES) {
        assert.equal(isValidKycStatus(status), true);
    }
    assert.equal(isValidKycStatus("pending"), false);
    assert.equal(isValidKycStatus(""), false);
    assert.equal(isValidKycStatus(undefined), false);
});

test("isValidAdminKycTransition: not_started can't be moved to directly by admin (vendor must submit first)", () => {
    assert.equal(isValidAdminKycTransition("not_started", "verified"), false);
    assert.equal(isValidAdminKycTransition("not_started", "submitted"), false);
});

test("isValidAdminKycTransition: submitted can go to under_review, verified, rejected, or action_required", () => {
    assert.equal(isValidAdminKycTransition("submitted", "under_review"), true);
    assert.equal(isValidAdminKycTransition("submitted", "verified"), true);
    assert.equal(isValidAdminKycTransition("submitted", "rejected"), true);
    assert.equal(isValidAdminKycTransition("submitted", "action_required"), true);
    assert.equal(isValidAdminKycTransition("submitted", "suspended"), false);
});

test("isValidAdminKycTransition: verified can only be suspended, not rejected or re-reviewed directly", () => {
    assert.equal(isValidAdminKycTransition("verified", "suspended"), true);
    assert.equal(isValidAdminKycTransition("verified", "rejected"), false);
    assert.equal(isValidAdminKycTransition("verified", "under_review"), false);
});

test("isValidAdminKycTransition: suspended can be re-verified or rejected", () => {
    assert.equal(isValidAdminKycTransition("suspended", "verified"), true);
    assert.equal(isValidAdminKycTransition("suspended", "rejected"), true);
});

test("isValidAdminKycTransition: rejected can only go back to under_review", () => {
    assert.equal(isValidAdminKycTransition("rejected", "under_review"), true);
    assert.equal(isValidAdminKycTransition("rejected", "verified"), false);
});

test("isValidAdminKycTransition: rejects an unknown status on either side", () => {
    assert.equal(isValidAdminKycTransition("bogus", "verified"), false);
    assert.equal(isValidAdminKycTransition("submitted", "bogus"), false);
});

test("canVendorEditKyc: editable from not_started, action_required, rejected", () => {
    assert.equal(canVendorEditKyc("not_started"), true);
    assert.equal(canVendorEditKyc("action_required"), true);
    assert.equal(canVendorEditKyc("rejected"), true);
});

test("canVendorEditKyc: locked while submitted, under_review, verified, or suspended", () => {
    assert.equal(canVendorEditKyc("submitted"), false);
    assert.equal(canVendorEditKyc("under_review"), false);
    assert.equal(canVendorEditKyc("verified"), false);
    assert.equal(canVendorEditKyc("suspended"), false);
});

test("KYC_STATUS_LABELS has a human label for every status", () => {
    for (const status of KYC_STATUSES) {
        assert.equal(typeof KYC_STATUS_LABELS[status], "string");
        assert.ok(KYC_STATUS_LABELS[status].length > 0);
    }
});
