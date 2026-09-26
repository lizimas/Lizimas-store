import shutil, datetime, sys

path = "server/utils/vendorKyc.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''const KYC_STATUS_LABELS = {
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
};'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''const KYC_STATUS_LABELS = {
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
};'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
