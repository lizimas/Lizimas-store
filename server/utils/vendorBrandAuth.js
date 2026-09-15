// Pure logic for the vendor Brand Authorization workflow (Phase 7,
// Ryan Sept 2026 - modelled on Jumia's brand authorization tiers). No
// DB/network here - see server/controllers/vendorBrandAuthController.js
// for the wrapper that reads/writes vendor_brand_authorizations and
// vendor_brand_authorization_audit_log.
//
// A vendor requests authorization for ONE brand at a time (one row per
// (vendor_id, brand_name)) at one of two tiers:
//
//   official_store        - the actual brand, or its official rep/
//                            distributor, presented AS the brand
//                            (e.g. "Samsung Official Store"). Full
//                            documentary bar: authorization letter,
//                            distributor agreement, manufacturer
//                            authorization, business registration, tax
//                            documentation, proof of relationship,
//                            warranty info, proof of authorized sourcing.
//   authorized_distributor - officially authorized to distribute the
//                            brand but isn't presented as the brand
//                            itself (e.g. "XYZ Electronics - Authorized
//                            Samsung Distributor"). Lighter bar: proof of
//                            the distributor relationship plus business
//                            registration.
//
// Status workflow deliberately reuses the exact same seven states as
// vendor KYC (server/utils/vendorKyc.js) for consistency across the
// admin's review queues, including the same non-linear transition shape.
const BRAND_AUTH_TIERS = ["official_store", "authorized_distributor"];

function isValidBrandAuthTier(tier) {
    return BRAND_AUTH_TIERS.includes(tier);
}

const BRAND_AUTH_TIER_LABELS = {
    official_store: "Official Brand Store",
    authorized_distributor: "Authorized Distributor"
};

// Every document type accepted across both tiers. Which ones are actually
// REQUIRED for a given tier is in TIER_REQUIRED_DOCUMENTS below - a
// vendor can still upload any of these regardless of tier (e.g. warranty
// info is nice-to-have evidence either way), but submission is only
// allowed once the tier's required set is present.
const BRAND_AUTH_DOCUMENT_TYPES = [
    "authorization_letter",
    "distributor_agreement",
    "manufacturer_authorization",
    "business_registration",
    "tax_documentation",
    "relationship_proof",
    "warranty_information",
    "sourcing_proof"
];

function isValidBrandAuthDocumentType(type) {
    return BRAND_AUTH_DOCUMENT_TYPES.includes(type);
}

// The minimum bar each tier must clear before a vendor can submit for
// review. Official Brand Store is Jumia's full documentary bar; Authorized
// Distributor is lighter - proof of the relationship plus that the
// business itself is real, not the full manufacturer/warranty/sourcing set.
const TIER_REQUIRED_DOCUMENTS = {
    official_store: [
        "authorization_letter",
        "distributor_agreement",
        "manufacturer_authorization",
        "business_registration",
        "tax_documentation",
        "relationship_proof",
        "warranty_information",
        "sourcing_proof"
    ],
    authorized_distributor: [
        "relationship_proof",
        "business_registration"
    ]
};

function requiredDocumentsForTier(tier) {
    return TIER_REQUIRED_DOCUMENTS[tier] || [];
}

function hasRequiredDocuments(tier, uploadedDocumentTypes) {
    const required = requiredDocumentsForTier(tier);
    const uploaded = new Set(uploadedDocumentTypes || []);
    return required.every((docType) => uploaded.has(docType));
}

// Same seven states as vendor KYC (server/utils/vendorKyc.js) - kept as an
// independent copy rather than a shared import, because the two workflows
// are reviewed by admin separately and Q&A on one must never accidentally
// change the other's allowed transitions.
const BRAND_AUTH_STATUSES = [
    "not_started", "submitted", "under_review", "action_required",
    "verified", "rejected", "suspended"
];

function isValidBrandAuthStatus(status) {
    return BRAND_AUTH_STATUSES.includes(status);
}

const BRAND_AUTH_ADMIN_TRANSITIONS = {
    not_started: [],
    submitted: ["under_review", "verified", "rejected", "action_required"],
    under_review: ["verified", "rejected", "action_required"],
    action_required: ["under_review", "verified", "rejected"],
    verified: ["suspended"],
    rejected: ["under_review"],
    suspended: ["verified", "rejected"]
};

function isValidAdminBrandAuthTransition(from, to) {
    if (!isValidBrandAuthStatus(from) || !isValidBrandAuthStatus(to)) return false;
    return (BRAND_AUTH_ADMIN_TRANSITIONS[from] || []).includes(to);
}

// A vendor can (re)submit their own brand authorization request from:
// not_started (first time), action_required (admin asked for a fix), or
// rejected (try again). Not from submitted/under_review (already in the
// queue) or verified/suspended (locked - a verified badge can't be
// silently re-pointed at different evidence without going through admin
// again, same reasoning as vendor KYC).
const VENDOR_EDITABLE_BRAND_AUTH_STATUSES = ["not_started", "action_required", "rejected"];

function canVendorEditBrandAuth(status) {
    return VENDOR_EDITABLE_BRAND_AUTH_STATUSES.includes(status);
}

const BRAND_AUTH_STATUS_LABELS = {
    not_started: "Not started",
    submitted: "Submitted - awaiting review",
    under_review: "Under review",
    action_required: "Action required",
    verified: "Verified",
    rejected: "Rejected",
    suspended: "Suspended"
};

module.exports = {
    BRAND_AUTH_TIERS,
    isValidBrandAuthTier,
    BRAND_AUTH_TIER_LABELS,
    BRAND_AUTH_DOCUMENT_TYPES,
    isValidBrandAuthDocumentType,
    TIER_REQUIRED_DOCUMENTS,
    requiredDocumentsForTier,
    hasRequiredDocuments,
    BRAND_AUTH_STATUSES,
    isValidBrandAuthStatus,
    BRAND_AUTH_ADMIN_TRANSITIONS,
    isValidAdminBrandAuthTransition,
    VENDOR_EDITABLE_BRAND_AUTH_STATUSES,
    canVendorEditBrandAuth,
    BRAND_AUTH_STATUS_LABELS
};
