// Phase 7 - Vendor Brand Authorization state machine. Mirrors the shape
// of test/vendorKyc.test.js for the equivalent KYC workflow.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    BRAND_AUTH_TIERS,
    isValidBrandAuthTier,
    BRAND_AUTH_STATUSES,
    isValidBrandAuthStatus,
    isValidAdminBrandAuthTransition,
    canVendorEditBrandAuth,
    requiredDocumentsForTier,
    hasRequiredDocuments,
    BRAND_AUTH_TIER_LABELS
} = require("../server/utils/vendorBrandAuth.js");

test("BRAND_AUTH_TIERS has exactly the two tiers", () => {
    assert.deepEqual(BRAND_AUTH_TIERS, ["official_store", "authorized_distributor"]);
});

test("isValidBrandAuthTier accepts both tiers, rejects anything else", () => {
    for (const tier of BRAND_AUTH_TIERS) {
        assert.equal(isValidBrandAuthTier(tier), true);
    }
    assert.equal(isValidBrandAuthTier("brand_owner"), false);
    assert.equal(isValidBrandAuthTier(""), false);
    assert.equal(isValidBrandAuthTier(undefined), false);
});

test("every tier has a human label", () => {
    for (const tier of BRAND_AUTH_TIERS) {
        assert.ok(BRAND_AUTH_TIER_LABELS[tier], `missing label for ${tier}`);
    }
});

test("BRAND_AUTH_STATUSES has exactly the seven states, same shape as vendor KYC", () => {
    assert.deepEqual(BRAND_AUTH_STATUSES, [
        "not_started", "submitted", "under_review", "action_required",
        "verified", "rejected", "suspended"
    ]);
    for (const status of BRAND_AUTH_STATUSES) {
        assert.equal(isValidBrandAuthStatus(status), true);
    }
    assert.equal(isValidBrandAuthStatus("approved"), false);
});

test("isValidAdminBrandAuthTransition: not_started can't be moved to directly by admin", () => {
    assert.equal(isValidAdminBrandAuthTransition("not_started", "verified"), false);
    assert.equal(isValidAdminBrandAuthTransition("not_started", "submitted"), false);
});

test("isValidAdminBrandAuthTransition: submitted can go to under_review, verified, rejected, or action_required", () => {
    assert.equal(isValidAdminBrandAuthTransition("submitted", "under_review"), true);
    assert.equal(isValidAdminBrandAuthTransition("submitted", "verified"), true);
    assert.equal(isValidAdminBrandAuthTransition("submitted", "rejected"), true);
    assert.equal(isValidAdminBrandAuthTransition("submitted", "action_required"), true);
    assert.equal(isValidAdminBrandAuthTransition("submitted", "suspended"), false);
});

test("isValidAdminBrandAuthTransition: verified can only be suspended", () => {
    assert.equal(isValidAdminBrandAuthTransition("verified", "suspended"), true);
    assert.equal(isValidAdminBrandAuthTransition("verified", "rejected"), false);
    assert.equal(isValidAdminBrandAuthTransition("verified", "not_started"), false);
});

test("isValidAdminBrandAuthTransition: suspended can go back to verified or rejected", () => {
    assert.equal(isValidAdminBrandAuthTransition("suspended", "verified"), true);
    assert.equal(isValidAdminBrandAuthTransition("suspended", "rejected"), true);
    assert.equal(isValidAdminBrandAuthTransition("suspended", "under_review"), false);
});

test("canVendorEditBrandAuth: only not_started/action_required/rejected are vendor-editable", () => {
    assert.equal(canVendorEditBrandAuth("not_started"), true);
    assert.equal(canVendorEditBrandAuth("action_required"), true);
    assert.equal(canVendorEditBrandAuth("rejected"), true);
    assert.equal(canVendorEditBrandAuth("submitted"), false);
    assert.equal(canVendorEditBrandAuth("under_review"), false);
    assert.equal(canVendorEditBrandAuth("verified"), false);
    assert.equal(canVendorEditBrandAuth("suspended"), false);
});

test("official_store requires the full Jumia-style documentary bar", () => {
    const required = requiredDocumentsForTier("official_store");
    assert.deepEqual(required.slice().sort(), [
        "authorization_letter",
        "business_registration",
        "distributor_agreement",
        "manufacturer_authorization",
        "relationship_proof",
        "sourcing_proof",
        "tax_documentation",
        "warranty_information"
    ]);
});

test("authorized_distributor requires a lighter bar than official_store", () => {
    const distributor = requiredDocumentsForTier("authorized_distributor");
    const official = requiredDocumentsForTier("official_store");
    assert.deepEqual(distributor.slice().sort(), ["business_registration", "relationship_proof"]);
    assert.ok(distributor.length < official.length);
    // Every distributor requirement is also part of the official bar - the
    // distributor tier isn't asking for something unrelated, just less of it.
    for (const doc of distributor) {
        assert.ok(official.includes(doc), `${doc} should also be part of the official_store bar`);
    }
});

test("hasRequiredDocuments: true only once every required doc type is present", () => {
    assert.equal(hasRequiredDocuments("authorized_distributor", ["relationship_proof"]), false);
    assert.equal(hasRequiredDocuments("authorized_distributor", ["relationship_proof", "business_registration"]), true);
    // Extra unrelated docs don't hurt.
    assert.equal(
        hasRequiredDocuments("authorized_distributor", ["relationship_proof", "business_registration", "warranty_information"]),
        true
    );
    assert.equal(hasRequiredDocuments("official_store", ["relationship_proof", "business_registration"]), false);
});

test("hasRequiredDocuments: empty/undefined upload list is never sufficient", () => {
    assert.equal(hasRequiredDocuments("authorized_distributor", []), false);
    assert.equal(hasRequiredDocuments("authorized_distributor", undefined), false);
});
