const test = require("node:test");
const assert = require("node:assert/strict");
const { isStrongPassword } = require("../server/utils/verificationChannels.js");

test("isStrongPassword: accepts a password with all four character classes", () => {
    assert.equal(isStrongPassword("Abcdef1!"), true);
    assert.equal(isStrongPassword("Str0ng&Password"), true);
});

test("isStrongPassword: rejects passwords under 8 characters", () => {
    assert.equal(isStrongPassword("Ab1!"), false);
});

test("isStrongPassword: rejects passwords missing a character class", () => {
    assert.equal(isStrongPassword("abcdefg1"), false); // no uppercase, no symbol
    assert.equal(isStrongPassword("ABCDEFG1"), false); // no lowercase, no symbol
    assert.equal(isStrongPassword("Abcdefgh"), false); // no digit, no symbol
    assert.equal(isStrongPassword("Abcdefg1"), false); // no symbol
});

test("isStrongPassword: rejects empty, null, undefined, and non-string input", () => {
    assert.equal(isStrongPassword(""), false);
    assert.equal(isStrongPassword(null), false);
    assert.equal(isStrongPassword(undefined), false);
    assert.equal(isStrongPassword(12345678), false);
});
