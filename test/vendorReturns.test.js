const test = require("node:test");
const assert = require("node:assert/strict");
const {
    REFUND_DECISIONS,
    isValidRefundDecision,
    deriveReturnResolutionStatus,
    canRecordRefundDecision
} = require("../server/utils/vendorReturns.js");

test("REFUND_DECISIONS is exactly approved/denied", () => {
    assert.deepEqual(REFUND_DECISIONS, ["approved", "denied"]);
});

test("isValidRefundDecision accepts only the two known values", () => {
    assert.equal(isValidRefundDecision("approved"), true);
    assert.equal(isValidRefundDecision("denied"), true);
    assert.equal(isValidRefundDecision("pending"), false);
    assert.equal(isValidRefundDecision(""), false);
    assert.equal(isValidRefundDecision(null), false);
});

test("deriveReturnResolutionStatus: no return_reason is no_return regardless of decision", () => {
    assert.equal(
        deriveReturnResolutionStatus({ returnReason: null, refundDecision: null }),
        "no_return"
    );
    assert.equal(
        deriveReturnResolutionStatus({ returnReason: null, refundDecision: "approved" }),
        "no_return"
    );
});

test("deriveReturnResolutionStatus: return with no decision yet is awaiting_decision", () => {
    assert.equal(
        deriveReturnResolutionStatus({ returnReason: "damaged", refundDecision: null }),
        "awaiting_decision"
    );
});

test("deriveReturnResolutionStatus: approved/denied decisions map through", () => {
    assert.equal(
        deriveReturnResolutionStatus({ returnReason: "defective", refundDecision: "approved" }),
        "refund_approved"
    );
    assert.equal(
        deriveReturnResolutionStatus({ returnReason: "customer_return", refundDecision: "denied" }),
        "refund_denied"
    );
});

test("canRecordRefundDecision: allowed when nothing decided yet", () => {
    const result = canRecordRefundDecision(null);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, undefined);
});

test("canRecordRefundDecision: blocked once a decision already exists", () => {
    const approved = canRecordRefundDecision("approved");
    assert.equal(approved.allowed, false);
    assert.match(approved.reason, /already recorded \(approved\)/);

    const denied = canRecordRefundDecision("denied");
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /already recorded \(denied\)/);
});
