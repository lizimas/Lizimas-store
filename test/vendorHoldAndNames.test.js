// Hold for documents + document name check (Oct 2026).
const test = require("node:test");
const assert = require("node:assert");
const { vendorSellableSql, holdReadyToRelease, canUploadKycDocument } = require("../server/utils/vendorHold");
const { checkDocumentNames, parseOcrText, nameMismatchMessage } = require("../server/utils/documentNameCheck");
const { nameCheck } = require("../client/js/lz-id-ocr.js");

const ID_TEXT = "REPUBLIC OF UGANDA NATIONAL ID CARD SURNAME OKELLO GIVEN NAME JOHN PETER NATIONALITY UGA SEX M " +
    "DATE OF BIRTH NIN CARD NO DATE OF EXPIRY HOLDER SIGNATURE";

test("sellable SQL hides suspended and held vendors", () => {
    const sql = vendorSellableSql("v");
    assert.match(sql, /v\.status = 'approved'/);
    assert.match(sql, /COALESCE\(v\.documents_hold, false\) = false/);
});

test("hold lifts only when every held document is accepted", () => {
    const held = ["national_id", "tax_certificate"];
    assert.strictEqual(holdReadyToRelease(held, [{ document_type: "national_id", review_status: "accepted" }]), false);
    assert.strictEqual(holdReadyToRelease(held, [
        { document_type: "national_id", review_status: "accepted" },
        { document_type: "tax_certificate", review_status: "pending" }]), false);
    assert.strictEqual(holdReadyToRelease(held, [
        { document_type: "national_id", review_status: "accepted" },
        { document_type: "tax_certificate", review_status: "accepted" }]), true);
});

test("who may upload while KYC is locked", () => {
    assert.ok(canUploadKycDocument({ kycEditable: true, holdDocuments: [], docStatus: "accepted" }, "national_id"));
    assert.ok(canUploadKycDocument({ kycEditable: false, holdDocuments: ["national_id"], docStatus: "accepted" }, "national_id"));
    assert.ok(canUploadKycDocument({ kycEditable: false, holdDocuments: [], docStatus: null }, "tax_certificate"));
    assert.ok(canUploadKycDocument({ kycEditable: false, holdDocuments: [], docStatus: "rejected" }, "tax_certificate"));
    assert.ok(!canUploadKycDocument({ kycEditable: false, holdDocuments: [], docStatus: "pending" }, "tax_certificate"));
    assert.ok(!canUploadKycDocument({ kycEditable: false, holdDocuments: [], docStatus: "accepted" }, "national_id"));
});

test("name check: match, misread letter, mismatch, unreadable", () => {
    assert.strictEqual(nameCheck(ID_TEXT, "John Okello").result, "match");
    assert.strictEqual(nameCheck(ID_TEXT, "Okello Jonh").result, "partial");   // typo: left for the reviewer, never rejected
    assert.strictEqual(nameCheck(ID_TEXT, "Jhon Okelo").result, "partial");
    assert.strictEqual(nameCheck(ID_TEXT, "Ryan Mukasa").result, "mismatch");
    assert.strictEqual(nameCheck("TOO SHORT", "Ryan Mukasa").result, "unread");
    assert.strictEqual(nameCheck(ID_TEXT, "Ryan Mukasa", { confidence: 30 }).result, "unread");
    assert.strictEqual(nameCheck("P<UGAOKELLO<<JOHN<PETER<<<<<<<<<<<<<<<", "John Okello").result, "match");
});

test("business documents accept the business name or the owner's name", () => {
    const cert = "THE REPUBLIC OF UGANDA THE COMPANIES ACT CERTIFICATE OF INCORPORATION I HEREBY CERTIFY THAT " +
        "ANN AND LIZ ENTERPRISES LIMITED IS THIS DAY INCORPORATED UNDER THE COMPANIES ACT";
    const ocr = { text: cert, confidence: 80 };
    assert.strictEqual(checkDocumentNames({ documentType: "business_registration", ocr, ownerName: "Annet Liz", businessName: "Ann & Liz Enterprises Ltd" }).result, "match");
    assert.strictEqual(checkDocumentNames({ documentType: "business_registration", ocr, ownerName: "Ryan Mukasa", businessName: "Talent Gadgets Ltd" }).result, "mismatch");
    // identity documents compare the owner only
    assert.strictEqual(checkDocumentNames({ documentType: "national_id", ocr: { text: ID_TEXT, confidence: 80 }, ownerName: "Ryan Mukasa", businessName: "John Okello Traders" }).result, "mismatch");
    assert.strictEqual(checkDocumentNames({ documentType: "national_id", ocr: null, ownerName: "x", businessName: "y" }), null);
});

test("OCR payload parsing and the rejection message", () => {
    assert.deepStrictEqual(parseOcrText(JSON.stringify({ text: "ABC", confidence: 120 })), { text: "ABC", confidence: 100 });
    assert.strictEqual(parseOcrText("not json"), null);
    assert.strictEqual(parseOcrText(JSON.stringify({ summary: {} })), null);
    assert.match(nameMismatchMessage({ expected: "Ryan Mukasa" }, "National ID"), /doesn't match the name on your Lizimas account \(Ryan Mukasa\)/);
});

test("ID name check only rejects when the name area was clearly read", () => {
    // no name label / machine-readable zone -> left for the reviewer
    const noLabel = "REPUBLIC OF UGANDA NATIONAL IDENTITY CARD NATIONALITY UGA SEX M DATE OF BIRTH CARD NO HOLDER SIGNATURE " +
        "DATE OF EXPIRY NIN SOME OTHER WORDS HERE TODAY";
    assert.strictEqual(nameCheck(noLabel, "Ryan Mukasa", { strict: true, confidence: 90 }).result, "unread");
    // low confidence -> left for the reviewer
    assert.strictEqual(nameCheck(ID_TEXT, "Ryan Mukasa", { strict: true, confidence: 60 }).result, "unread");
    // clear name label, good confidence, none of the name -> mismatch
    assert.strictEqual(nameCheck(ID_TEXT + " NIN CM900 CARD NUMBER 01234", "Ryan Mukasa", { strict: true, confidence: 85 }).result, "mismatch");
    // digits read instead of letters still match
    assert.strictEqual(nameCheck("SURNAME 0KELL0 GIVEN NAME J0HN", "John Okello", { strict: true }).result, "match");
});

test("an ID matches the shop contact name or an individual's shop name too", () => {
    const ocr = { text: ID_TEXT + " NIN CM900 CARD NUMBER 01234", confidence: 85 };
    assert.strictEqual(checkDocumentNames({ documentType: "national_id", ocr, ownerName: "Lizimas Test", businessName: "x", otherNames: ["John Okello"] }).result, "match");
    assert.strictEqual(checkDocumentNames({ documentType: "national_id", ocr, ownerName: "Lizimas Test", businessName: "x", otherNames: [null, "Peter Okello Shop"] }).result, "match");
    assert.strictEqual(checkDocumentNames({ documentType: "national_id", ocr, ownerName: "Ryan Mukasa", businessName: "x", otherNames: [] }).result, "mismatch");
});
