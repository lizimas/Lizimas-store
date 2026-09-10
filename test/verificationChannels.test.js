const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidEmail } = require("../server/utils/verificationChannels.js");

test("isValidEmail: accepts ordinary well-formed addresses", () => {
    assert.equal(isValidEmail("appo@example.com"), true);
    assert.equal(isValidEmail("first.last+tag@sub.example.co.ug"), true);
});

test("isValidEmail: rejects a bare name with no @ (the Appo case)", () => {
    assert.equal(isValidEmail("Appo"), false);
    assert.equal(isValidEmail("Dominic"), false);
});

test("isValidEmail: rejects missing local part, domain, or TLD", () => {
    assert.equal(isValidEmail("@example.com"), false);
    assert.equal(isValidEmail("appo@"), false);
    assert.equal(isValidEmail("appo@example"), false);
});

test("isValidEmail: rejects whitespace inside the address", () => {
    assert.equal(isValidEmail("ap po@example.com"), false);
    assert.equal(isValidEmail("appo@exa mple.com"), false);
});

test("isValidEmail: rejects empty, null, undefined, and non-string input", () => {
    assert.equal(isValidEmail(""), false);
    assert.equal(isValidEmail(null), false);
    assert.equal(isValidEmail(undefined), false);
    assert.equal(isValidEmail(12345), false);
});
