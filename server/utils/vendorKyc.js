// Pure logic for the vendor KYC status workflow (no DB/network here) -
// see server/controllers/vendorKycController.js for the wrapper that
// reads/writes vendor_kyc and vendor_kyc_audit_log.
//
// Seven states, modelled on Jumia's KYC lifecycle (Ryan, Sept 2026): a
// vendor starts at not_started, submits their ID/registration number
// (submitted), admin reviews it (under_review is optional to pass
// through - a small team can jump straight from submitted to verified/
// rejected/action_required), and a verified vendor can later be
// suspended for a compliance issue or bumped back if something needs
// correcting.
const KYC_STATUSES = [
    "not_started", "submitted", "under_review", "action_required",
    "verified", "rejected", "suspended"
];

function isValidKycStatus(status) {
    return KYC_STATUSES.includes(status);
}

// Which admin-driven transitions are allowed from each current status.
// Deliberately not a strict linear chain - a small compliance team needs
// to move a case back a step (e.g. action_required -> rejected if the
// vendor never fixes it) without the app getting in the way.
const ADMIN_TRANSITIONS = {
    not_started: [],
    submitted: ["under_review", "verified", "rejected", "action_required"],
    under_review: ["verified", "rejected", "action_required"],
    action_required: ["under_review", "verified", "rejected"],
    verified: ["suspended"],
    rejected: ["under_review"],
    suspended: ["verified", "rejected"]
};

function isValidAdminKycTransition(from, to) {
    if (!isValidKycStatus(from) || !isValidKycStatus(to)) return false;
    return (ADMIN_TRANSITIONS[from] || []).includes(to);
}

// A vendor can (re)submit their own info from: not_started (first time),
// action_required (admin asked for a fix), or rejected (try again). Not
// from submitted/under_review (already in the queue) or verified/
// suspended (locked - contact support instead of silently changing a
// verified ID number).
const VENDOR_EDITABLE_STATUSES = ["not_started", "action_required", "rejected"];

function canVendorEditKyc(status) {
    return VENDOR_EDITABLE_STATUSES.includes(status);
}

const KYC_STATUS_LABELS = {
    not_started: "Not started",
    submitted: "Submitted - awaiting review",
    under_review: "Under review",
    action_required: "Action required",
    verified: "Verified",
    rejected: "Rejected",
    suspended: "Suspended"
};

module.exports = {
    KYC_STATUSES,
    isValidKycStatus,
    ADMIN_TRANSITIONS,
    isValidAdminKycTransition,
    VENDOR_EDITABLE_STATUSES,
    canVendorEditKyc,
    KYC_STATUS_LABELS
};
