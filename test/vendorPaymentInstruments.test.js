// Phase 5 - Payment Instrument Approval. Pure-logic tests for
// server/utils/vendorPaymentInstruments.js: the name-match rule (the
// whole point of this feature) and the edit-lock rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    isValidMethod,
    canVendorEditInstrument,
    expectedLegalName,
    normalizeName,
    namesMatch,
    missingFieldsForMethod
} = require("../server/utils/vendorPaymentInstruments.js");

test("isValidMethod accepts momo/bank, rejects anything else", () => {
    assert.equal(isValidMethod("momo"), true);
    assert.equal(isValidMethod("bank"), true);
    assert.equal(isValidMethod("paypal"), false);
    assert.equal(isValidMethod(""), false);
});

test("canVendorEditInstrument: only a rejected instrument is editable", () => {
    assert.equal(canVendorEditInstrument("rejected"), true);
    assert.equal(canVendorEditInstrument("pending"), false);
    assert.equal(canVendorEditInstrument("approved"), false);
});

test("expectedLegalName: company vendors match against business_name, individuals against owner name", () => {
    assert.equal(
        expectedLegalName({ accountType: "company", businessName: "Lizimas Enterprises Ltd", ownerName: "Ryan K" }),
        "Lizimas Enterprises Ltd"
    );
    assert.equal(
        expectedLegalName({ accountType: "individual", businessName: "Lizimas Enterprises Ltd", ownerName: "Ryan K" }),
        "Ryan K"
    );
});

test("normalizeName lowercases, strips punctuation, and collapses whitespace", () => {
    assert.equal(normalizeName("  Ryan   K.  "), "ryan k");
    assert.equal(normalizeName("O'Brien-Smith"), "obriensmith");
    assert.equal(normalizeName("MTN Uganda Ltd."), "mtn uganda ltd");
});

test("namesMatch: exact match after normalization passes", () => {
    assert.equal(namesMatch("Ryan Okello", "ryan   okello"), true);
    assert.equal(namesMatch("Lizimas Enterprises Ltd.", "LIZIMAS ENTERPRISES LTD"), true);
});

test("namesMatch: a partial/substring name is NOT a match (fraud control, not fuzzy autocomplete)", () => {
    assert.equal(namesMatch("Ryan Okello", "Ryan Okello Mukasa"), false);
    assert.equal(namesMatch("Ryan", "Ryan Okello"), false);
});

test("namesMatch: a genuinely different name is rejected", () => {
    assert.equal(namesMatch("John Doe", "Jane Doe"), false);
});

test("namesMatch: empty/missing names never match anything", () => {
    assert.equal(namesMatch("", "Ryan Okello"), false);
    assert.equal(namesMatch("Ryan Okello", ""), false);
    assert.equal(namesMatch(null, null), false);
});

test("missingFieldsForMethod: momo requires account_holder_name + momo_number", () => {
    assert.deepEqual(
        missingFieldsForMethod("momo", { account_holder_name: "Ryan" }).sort(),
        ["momo_number"]
    );
    assert.deepEqual(missingFieldsForMethod("momo", {}).sort(), ["account_holder_name", "momo_number"]);
    assert.deepEqual(
        missingFieldsForMethod("momo", { account_holder_name: "Ryan", momo_number: "0771234567" }),
        []
    );
});

test("missingFieldsForMethod: bank requires account_holder_name + bank_name + account_number", () => {
    assert.deepEqual(
        missingFieldsForMethod("bank", { account_holder_name: "Ryan" }).sort(),
        ["account_number", "bank_name"]
    );
    assert.deepEqual(
        missingFieldsForMethod("bank", {
            account_holder_name: "Ryan", bank_name: "Stanbic", account_number: "12345"
        }),
        []
    );
});
