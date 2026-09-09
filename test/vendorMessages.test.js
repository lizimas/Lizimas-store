const test = require("node:test");
const assert = require("node:assert/strict");
const {
    MAX_SUBJECT_LENGTH,
    MAX_BODY_LENGTH,
    MESSAGE_STATUSES,
    isValidMessageSubject,
    isValidMessageBody,
    isValidMessageStatus,
    deriveStatusAfterReply
} = require("../server/utils/vendorMessages.js");

test("MESSAGE_STATUSES has exactly open and resolved", () => {
    assert.deepEqual(MESSAGE_STATUSES, ["open", "resolved"]);
});

test("isValidMessageSubject: rejects empty, whitespace-only, and over-length", () => {
    assert.equal(isValidMessageSubject("Payout question"), true);
    assert.equal(isValidMessageSubject(""), false);
    assert.equal(isValidMessageSubject("   "), false);
    assert.equal(isValidMessageSubject("a".repeat(MAX_SUBJECT_LENGTH)), true);
    assert.equal(isValidMessageSubject("a".repeat(MAX_SUBJECT_LENGTH + 1)), false);
    assert.equal(isValidMessageSubject(null), false);
});

test("isValidMessageBody: rejects empty, whitespace-only, and over-length", () => {
    assert.equal(isValidMessageBody("My payout request has been pending for a week."), true);
    assert.equal(isValidMessageBody(""), false);
    assert.equal(isValidMessageBody("   "), false);
    assert.equal(isValidMessageBody("a".repeat(MAX_BODY_LENGTH)), true);
    assert.equal(isValidMessageBody("a".repeat(MAX_BODY_LENGTH + 1)), false);
});

test("isValidMessageStatus accepts only known statuses", () => {
    assert.equal(isValidMessageStatus("open"), true);
    assert.equal(isValidMessageStatus("resolved"), true);
    assert.equal(isValidMessageStatus("closed"), false);
    assert.equal(isValidMessageStatus(""), false);
});

test("deriveStatusAfterReply: a vendor reply reopens a resolved thread", () => {
    assert.equal(deriveStatusAfterReply("resolved", "vendor"), "open");
});

test("deriveStatusAfterReply: an admin reply never changes status", () => {
    assert.equal(deriveStatusAfterReply("resolved", "admin"), "resolved");
    assert.equal(deriveStatusAfterReply("open", "admin"), "open");
});

test("deriveStatusAfterReply: a vendor reply on an already-open thread stays open", () => {
    assert.equal(deriveStatusAfterReply("open", "vendor"), "open");
});
