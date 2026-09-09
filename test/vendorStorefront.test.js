const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_ABOUT_LENGTH, isValidAboutText } = require("../server/utils/vendorStorefront.js");

test("MAX_ABOUT_LENGTH is 1000", () => {
    assert.equal(MAX_ABOUT_LENGTH, 1000);
});

test("isValidAboutText: undefined/null/empty are all valid (no bio / clear bio)", () => {
    assert.equal(isValidAboutText(undefined), true);
    assert.equal(isValidAboutText(null), true);
    assert.equal(isValidAboutText(""), true);
});

test("isValidAboutText: within the length cap is valid", () => {
    assert.equal(isValidAboutText("We sell quality electronics at fair prices."), true);
    assert.equal(isValidAboutText("a".repeat(MAX_ABOUT_LENGTH)), true);
});

test("isValidAboutText: over the length cap is invalid", () => {
    assert.equal(isValidAboutText("a".repeat(MAX_ABOUT_LENGTH + 1)), false);
});

test("isValidAboutText: non-string input is invalid", () => {
    assert.equal(isValidAboutText(12345), false);
    assert.equal(isValidAboutText({}), false);
});
