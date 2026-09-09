// Pure logic for admin compliance actions against a vendor (Task #63). No
// DB access here - see server/controllers/vendorController.js for the
// DB-touching wrappers (warnVendor, suspendVendor, reinstateVendor,
// restrictVendorProduct, unrestrictVendorProduct, freezeVendorPayouts,
// unfreezeVendorPayouts), all of which also write a row to
// vendor_compliance_actions - the audit trail AND the vendor-visible
// notice feed in one table, since a 'warn' has no other schema effect.

const COMPLIANCE_ACTION_TYPES = [
    "warn", "suspend", "reinstate",
    "restrict_product", "unrestrict_product",
    "freeze_payout", "unfreeze_payout"
];

const COMPLIANCE_ACTION_LABELS = {
    warn: "Warning",
    suspend: "Account suspended",
    reinstate: "Account reinstated",
    restrict_product: "Product restricted",
    unrestrict_product: "Product restriction lifted",
    freeze_payout: "Payouts frozen",
    unfreeze_payout: "Payouts unfrozen"
};

function isValidComplianceAction(actionType) {
    return COMPLIANCE_ACTION_TYPES.includes(actionType);
}

// Whether an action makes sense against the vendor/product's CURRENT
// state - mostly a set of idempotency guards (can't suspend an already-
// suspended vendor, can't unfreeze payouts that aren't frozen) so two
// admins clicking the same button don't produce a confusing double
// audit trail. 'warn' has no state to conflict with, so it's always
// allowed. `current` is { vendorStatus, payoutFrozen, productAdminRestricted }
// - only the fields relevant to actionType need to be populated.
function canApplyComplianceAction(actionType, current) {
    switch (actionType) {
        case "warn":
            return { allowed: true };
        case "suspend":
            if (current.vendorStatus === "suspended") {
                return { allowed: false, reason: "Vendor is already suspended." };
            }
            return { allowed: true };
        case "reinstate":
            if (current.vendorStatus !== "suspended") {
                return { allowed: false, reason: "Vendor is not currently suspended." };
            }
            return { allowed: true };
        case "freeze_payout":
            if (current.payoutFrozen) {
                return { allowed: false, reason: "Payouts are already frozen for this vendor." };
            }
            return { allowed: true };
        case "unfreeze_payout":
            if (!current.payoutFrozen) {
                return { allowed: false, reason: "Payouts are not currently frozen for this vendor." };
            }
            return { allowed: true };
        case "restrict_product":
            if (current.productAdminRestricted) {
                return { allowed: false, reason: "This product is already restricted." };
            }
            return { allowed: true };
        case "unrestrict_product":
            if (!current.productAdminRestricted) {
                return { allowed: false, reason: "This product is not currently restricted." };
            }
            return { allowed: true };
        default:
            return { allowed: false, reason: "Unknown compliance action." };
    }
}

module.exports = {
    COMPLIANCE_ACTION_TYPES,
    COMPLIANCE_ACTION_LABELS,
    isValidComplianceAction,
    canApplyComplianceAction
};
