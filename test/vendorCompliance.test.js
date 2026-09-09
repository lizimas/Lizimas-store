const test = require("node:test");
const assert = require("node:assert/strict");
const {
    COMPLIANCE_ACTION_TYPES,
    COMPLIANCE_ACTION_LABELS,
    isValidComplianceAction,
    canApplyComplianceAction
} = require("../server/utils/vendorCompliance.js");

test("COMPLIANCE_ACTION_TYPES has exactly the seven known actions", () => {
    assert.deepEqual(COMPLIANCE_ACTION_TYPES, [
        "warn", "suspend", "reinstate",
        "restrict_product", "unrestrict_product",
        "freeze_payout", "unfreeze_payout"
    ]);
});

test("every action type has a label", () => {
    for (const type of COMPLIANCE_ACTION_TYPES) {
        assert.equal(typeof COMPLIANCE_ACTION_LABELS[type], "string");
        assert.ok(COMPLIANCE_ACTION_LABELS[type].length > 0);
    }
});

test("isValidComplianceAction accepts only known types", () => {
    assert.equal(isValidComplianceAction("suspend"), true);
    assert.equal(isValidComplianceAction("warn"), true);
    assert.equal(isValidComplianceAction("delete_vendor"), false);
    assert.equal(isValidComplianceAction(""), false);
    assert.equal(isValidComplianceAction(null), false);
});

test("canApplyComplianceAction: warn is always allowed", () => {
    assert.equal(canApplyComplianceAction("warn", {}).allowed, true);
});

test("canApplyComplianceAction: suspend blocked if already suspended", () => {
    assert.equal(canApplyComplianceAction("suspend", { vendorStatus: "approved" }).allowed, true);
    const blocked = canApplyComplianceAction("suspend", { vendorStatus: "suspended" });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /already suspended/);
});

test("canApplyComplianceAction: reinstate requires currently suspended", () => {
    assert.equal(canApplyComplianceAction("reinstate", { vendorStatus: "suspended" }).allowed, true);
    const blocked = canApplyComplianceAction("reinstate", { vendorStatus: "approved" });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /not currently suspended/);
});

test("canApplyComplianceAction: freeze_payout blocked if already frozen", () => {
    assert.equal(canApplyComplianceAction("freeze_payout", { payoutFrozen: false }).allowed, true);
    const blocked = canApplyComplianceAction("freeze_payout", { payoutFrozen: true });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /already frozen/);
});

test("canApplyComplianceAction: unfreeze_payout requires currently frozen", () => {
    assert.equal(canApplyComplianceAction("unfreeze_payout", { payoutFrozen: true }).allowed, true);
    const blocked = canApplyComplianceAction("unfreeze_payout", { payoutFrozen: false });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /not currently frozen/);
});

test("canApplyComplianceAction: restrict_product blocked if already restricted", () => {
    assert.equal(canApplyComplianceAction("restrict_product", { productAdminRestricted: false }).allowed, true);
    const blocked = canApplyComplianceAction("restrict_product", { productAdminRestricted: true });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /already restricted/);
});

test("canApplyComplianceAction: unrestrict_product requires currently restricted", () => {
    assert.equal(canApplyComplianceAction("unrestrict_product", { productAdminRestricted: true }).allowed, true);
    const blocked = canApplyComplianceAction("unrestrict_product", { productAdminRestricted: false });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /not currently restricted/);
});

test("canApplyComplianceAction: unknown action type is never allowed", () => {
    const result = canApplyComplianceAction("delete_vendor", {});
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Unknown compliance action/);
});
