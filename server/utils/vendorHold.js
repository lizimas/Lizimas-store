// "Hold for documents" (Oct 2026, Ryan). Pure rules + SQL fragments; the
// DB-touching parts live in vendorController (hold / release endpoints) and
// vendorKycController (automatic release when a document is accepted).
//
// While vendors.documents_hold is true the vendor:
//   - has their products hidden everywhere on the store (VENDOR_SELLABLE_SQL)
//     and their shop page shows as unavailable;
//   - can't add, edit or import products, and can't request payouts;
//   - can still sign in and upload the held documents, even if their KYC
//     is otherwise locked (verified / under review).
// The same SQL also hides a SUSPENDED vendor's products - before Oct 2026
// the main listing only checked shop_active, so a suspended vendor's
// products still appeared in rows, categories and search.

// Use inside a WHERE on a query that LEFT JOINs vendors as `alias`, for a
// product whose vendor_id is not null.
function vendorSellableSql(alias) {
    const a = alias || "vendors";
    return `${a}.status = 'approved' AND COALESCE(${a}.documents_hold, false) = false`;
}

const HOLD_BLOCKED_MESSAGE =
    "Your shop is on hold until the requested documents are approved. Upload them under Identity & Business Verification - " +
    "your shop, products and payouts come back automatically once they're approved.";

// Every held document type has been accepted -> the hold can lift.
// documents: [{ document_type, review_status }]
function holdReadyToRelease(holdDocuments, documents) {
    const types = (holdDocuments || []).filter(Boolean);
    if (!types.length) return true;
    const byType = new Map((documents || []).map(d => [d.document_type, d.review_status]));
    return types.every(t => byType.get(t) === "accepted");
}

// Whether the vendor may upload this document type right now.
//  - KYC editable (not started / action required / rejected): yes
//  - the type is one they're being held for: yes
//  - that document is missing, rejected or needs action (e.g. after
//    "Send Required Documents" on a verified vendor): yes
//  - otherwise (pending review or accepted while KYC is locked): no
function canUploadKycDocument({ kycEditable, holdDocuments, docStatus }, type) {
    if (kycEditable) return true;
    if ((holdDocuments || []).includes(type)) return true;
    return !docStatus || docStatus === "rejected" || docStatus === "action_required";
}

module.exports = { vendorSellableSql, HOLD_BLOCKED_MESSAGE, holdReadyToRelease, canUploadKycDocument };
