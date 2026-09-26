const test = require("node:test");
const assert = require("node:assert/strict");

const {
    isValidKycDocumentType,
    requiredDocumentTypesForKyc,
    KYC_DOCUMENT_TYPES
} = require("../server/utils/vendorKyc");

const {
    hasEvidence,
    canApprovePaymentInstrument
} = require("../server/utils/vendorPaymentInstruments");

// --- isValidKycDocumentType -------------------------------------------------

test("isValidKycDocumentType: accepts every type in the widened parity set", () => {
    for (const type of KYC_DOCUMENT_TYPES) {
        assert.equal(isValidKycDocumentType(type), true, `expected ${type} to be valid`);
    }
});

test("isValidKycDocumentType: rejects an unknown type", () => {
    assert.equal(isValidKycDocumentType("passport_photo"), false);
    assert.equal(isValidKycDocumentType(""), false);
    assert.equal(isValidKycDocumentType(undefined), false);
});

// --- requiredDocumentTypesForKyc --------------------------------------------

test("requiredDocumentTypesForKyc: individual vendor needs just national_id", () => {
    const required = requiredDocumentTypesForKyc({ accountType: "individual", requiresWorkPermit: false });
    assert.deepEqual(required, ["national_id"]);
});

test("requiredDocumentTypesForKyc: individual + work permit adds work_permit", () => {
    const required = requiredDocumentTypesForKyc({ accountType: "individual", requiresWorkPermit: true });
    assert.deepEqual(required, ["national_id", "work_permit"]);
});

test("requiredDocumentTypesForKyc: company vendor needs business_registration, tax_certificate, vat_certificate, form_20", () => {
    const required = requiredDocumentTypesForKyc({ accountType: "company", requiresWorkPermit: false });
    assert.deepEqual(required, ["business_registration", "tax_certificate", "vat_certificate", "form_20"]);
});

test("requiredDocumentTypesForKyc: company + work permit adds work_permit on top of the company set", () => {
    const required = requiredDocumentTypesForKyc({ accountType: "company", requiresWorkPermit: true });
    assert.deepEqual(required, ["business_registration", "tax_certificate", "vat_certificate", "form_20", "work_permit"]);
});

// --- hasEvidence / canApprovePaymentInstrument ------------------------------

test("hasEvidence: true only when evidence_cloudinary_public_id is set", () => {
    assert.equal(hasEvidence({ evidence_cloudinary_public_id: "abc123" }), true);
    assert.equal(hasEvidence({ evidence_cloudinary_public_id: null }), false);
    assert.equal(hasEvidence({}), false);
    assert.equal(hasEvidence(null), false);
});

test("canApprovePaymentInstrument: requires pending status AND evidence present", () => {
    assert.equal(
        canApprovePaymentInstrument({ status: "pending", evidence_cloudinary_public_id: "abc" }),
        true
    );
});

test("canApprovePaymentInstrument: false when pending but no evidence", () => {
    assert.equal(
        canApprovePaymentInstrument({ status: "pending", evidence_cloudinary_public_id: null }),
        false
    );
});

test("canApprovePaymentInstrument: false when evidence present but not pending (already approved)", () => {
    assert.equal(
        canApprovePaymentInstrument({ status: "approved", evidence_cloudinary_public_id: "abc" }),
        false
    );
});

test("canApprovePaymentInstrument: false when instrument is rejected, evidence or not", () => {
    assert.equal(
        canApprovePaymentInstrument({ status: "rejected", evidence_cloudinary_public_id: "abc" }),
        false
    );
});
