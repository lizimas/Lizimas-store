// Pure logic for the vendor KYC status workflow (no DB/network here) -
// see server/controllers/vendorKycController.js for the wrapper that
// reads/writes vendor_kyc and vendor_kyc_audit_log.
//
// Seven states KYC lifecycle (Ryan, Sept 2026): a
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

// --- parity extension (Ryan, Sept 2026) -------------------------------
// migration 088 widened vendor_kyc_documents.document_type to
// national_id/business_registration/bank_certificate/tax_certificate/
// vat_certificate/momo_statement/certificate_of_incorporation months ago,
// but the app never used most of it. migration 122 adds form_20 and
// work_permit (the two added for Uganda KYC)
// plus TIN/VAT number fields on vendor_kyc itself.

const KYC_DOCUMENT_TYPES = [
    "national_id",
    "business_registration",
    "bank_certificate",
    "tax_certificate",
    "vat_certificate",
    "momo_statement",
    "certificate_of_incorporation",
    "form_20",
    "work_permit"
];

function isValidKycDocumentType(type) {
    return KYC_DOCUMENT_TYPES.includes(type);
}

const KYC_DOCUMENT_LABELS = {
    national_id: "National ID",
    business_registration: "Business Registration",
    bank_certificate: "Bank Certificate",
    tax_certificate: "Tax Certificate (TIN)",
    vat_certificate: "VAT Certificate",
    momo_statement: "Mobile Money Statement",
    certificate_of_incorporation: "Certificate of Incorporation",
    form_20: "Form 20 (Particulars of Directors)",
    work_permit: "Work Permit"
};

// Which document types must be on file before a vendor can submit/resubmit
// their KYC info, given their account_type and whether they've declared
// needing a work permit. Single source of truth for that rule - both
// updateMyKyc (the submission gate) and the vendor dashboard UI (what to
// show as required) read from here rather than each hard-coding a list.
function requiredDocumentTypesForKyc({ accountType, requiresWorkPermit }) {
    const required = accountType === "company"
        ? ["business_registration", "tax_certificate", "vat_certificate", "form_20"]
        : ["national_id"];
    if (requiresWorkPermit) required.push("work_permit");
    return required;
}

module.exports = {
    KYC_STATUSES,
    isValidKycStatus,
    ADMIN_TRANSITIONS,
    isValidAdminKycTransition,
    VENDOR_EDITABLE_STATUSES,
    canVendorEditKyc,
    KYC_STATUS_LABELS,
    KYC_DOCUMENT_TYPES,
    isValidKycDocumentType,
    KYC_DOCUMENT_LABELS,
    requiredDocumentTypesForKyc
};
