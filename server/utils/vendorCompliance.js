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
    "freeze_payout", "unfreeze_payout",
    "request_documents"
];

const COMPLIANCE_ACTION_LABELS = {
    warn: "Warning",
    suspend: "Account suspended",
    reinstate: "Account reinstated",
    restrict_product: "Product restricted",
    unrestrict_product: "Product restriction lifted",
    freeze_payout: "Payouts frozen",
    unfreeze_payout: "Payouts unfrozen",
    request_documents: "Documents requested"
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
        case "request_documents":
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

// Compliance column of the admin Vendor Compliance table (Oct 2026).
// `documents` are the vendor's vendor_kyc_documents rows ({ document_type,
// review_status }); `required` is requiredDocumentTypesForKyc() for them.
// Each required document gets a status:
//   missing   - not uploaded
//   submitted - uploaded, waiting for admin review (review_status pending)
//   approved  - accepted
//   rejected  - rejected or action_required (vendor must upload again)
// and the vendor gets one overall state:
//   restricted        - suspended, or has products hidden by admin
//   compliant         - every required document approved
//   under_review      - all uploaded, at least one still waiting for review
//   documents_pending - something missing or rejected
function documentStatus(row) {
    if (!row) return "missing";
    if (row.review_status === "accepted") return "approved";
    if (row.review_status === "rejected" || row.review_status === "action_required") return "rejected";
    return "submitted";
}

function complianceSummary({ vendorStatus, required, documents, restrictedProducts }) {
    const byType = new Map((documents || []).map(d => [d.document_type, d]));
    const docs = (required || []).map(type => ({ type, status: documentStatus(byType.get(type)) }));
    const needed = docs.filter(d => d.status === "missing" || d.status === "rejected").map(d => d.type);
    let state;
    if (vendorStatus === "suspended" || Number(restrictedProducts) > 0) state = "restricted";
    else if (needed.length) state = "documents_pending";
    else if (docs.some(d => d.status === "submitted")) state = "under_review";
    else state = "compliant";
    return { state, documents: docs, needed };
}

module.exports = {
    documentStatus,
    complianceSummary,
    COMPLIANCE_ACTION_TYPES,
    COMPLIANCE_ACTION_LABELS,
    isValidComplianceAction,
    canApplyComplianceAction
};
