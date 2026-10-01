// Compliance column of the admin Vendor Compliance table (Oct 2026).
const test = require("node:test");
const assert = require("node:assert");
const { complianceSummary, documentStatus, canApplyComplianceAction, isValidComplianceAction } = require("../server/utils/vendorCompliance");

const req = ["business_registration", "tax_certificate"];

test("document statuses", () => {
    assert.strictEqual(documentStatus(undefined), "missing");
    assert.strictEqual(documentStatus({ review_status: "pending" }), "submitted");
    assert.strictEqual(documentStatus({ review_status: "accepted" }), "approved");
    assert.strictEqual(documentStatus({ review_status: "rejected" }), "rejected");
    assert.strictEqual(documentStatus({ review_status: "action_required" }), "rejected");
});

test("missing or rejected documents -> documents pending, listed as needed", () => {
    const s = complianceSummary({ vendorStatus: "approved", required: req,
        documents: [{ document_type: "tax_certificate", review_status: "rejected" }], restrictedProducts: 0 });
    assert.strictEqual(s.state, "documents_pending");
    assert.deepStrictEqual(s.needed, ["business_registration", "tax_certificate"]);
});

test("all uploaded, one waiting -> under review", () => {
    const s = complianceSummary({ vendorStatus: "approved", required: req, documents: [
        { document_type: "business_registration", review_status: "accepted" },
        { document_type: "tax_certificate", review_status: "pending" }], restrictedProducts: 0 });
    assert.strictEqual(s.state, "under_review");
    assert.deepStrictEqual(s.needed, []);
});

test("all approved -> compliant; suspended or restricted products -> restricted", () => {
    const docs = req.map(t => ({ document_type: t, review_status: "accepted" }));
    assert.strictEqual(complianceSummary({ vendorStatus: "approved", required: req, documents: docs, restrictedProducts: 0 }).state, "compliant");
    assert.strictEqual(complianceSummary({ vendorStatus: "suspended", required: req, documents: docs, restrictedProducts: 0 }).state, "restricted");
    assert.strictEqual(complianceSummary({ vendorStatus: "approved", required: req, documents: docs, restrictedProducts: 2 }).state, "restricted");
});

test("request_documents is a valid, always-allowed action", () => {
    assert.ok(isValidComplianceAction("request_documents"));
    assert.deepStrictEqual(canApplyComplianceAction("request_documents", {}), { allowed: true });
});
