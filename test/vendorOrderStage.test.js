const test = require("node:test");
const assert = require("node:assert/strict");
const {
    STAGE_LABELS,
    isValidStage,
    canAdvanceStage,
    deriveVendorOrderStage
} = require("../server/utils/vendorOrderStage");

test("isValidStage accepts only the four vendor-controlled stages", () => {
    assert.equal(isValidStage("new"), true);
    assert.equal(isValidStage("accepted"), true);
    assert.equal(isValidStage("processing"), true);
    assert.equal(isValidStage("ready_for_handover"), true);
    assert.equal(isValidStage("handed_over"), false); // that's a handover_status value, not a vendor stage
    assert.equal(isValidStage("bogus"), false);
});

test("canAdvanceStage only allows moving one step forward", () => {
    assert.equal(canAdvanceStage("new", "accepted"), true);
    assert.equal(canAdvanceStage("accepted", "processing"), true);
    assert.equal(canAdvanceStage("processing", "ready_for_handover"), true);
    assert.equal(canAdvanceStage(null, "accepted"), true); // null/undefined treated as "new"
});

test("canAdvanceStage rejects skipping a stage, going backward, or repeating", () => {
    assert.equal(canAdvanceStage("new", "processing"), false); // skips "accepted"
    assert.equal(canAdvanceStage("processing", "accepted"), false); // backward
    assert.equal(canAdvanceStage("new", "new"), false); // no-op
    assert.equal(canAdvanceStage("ready_for_handover", "ready_for_handover"), false);
});

test("canAdvanceStage rejects an invalid target stage", () => {
    assert.equal(canAdvanceStage("new", "handed_over"), false);
    assert.equal(canAdvanceStage("new", "bogus"), false);
});

test("deriveVendorOrderStage: cancelled order always wins, even mid-workflow", () => {
    assert.equal(deriveVendorOrderStage({
        orderStatus: "cancelled", vendorFulfilmentStage: "processing", handoverStatus: null
    }), "cancelled");
});

test("deriveVendorOrderStage: forfeited and return states win over a delivered order", () => {
    assert.equal(deriveVendorOrderStage({
        orderStatus: "delivered", vendorFulfilmentStage: null, handoverStatus: "forfeited"
    }), "forfeited");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "paid", vendorFulfilmentStage: null, handoverStatus: "returned_for_collection"
    }), "return_in_progress");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "paid", vendorFulfilmentStage: null, handoverStatus: "collected"
    }), "return_in_progress");
});

test("deriveVendorOrderStage: rejected at inspection shows even if order later cancels is not the case, but wins over in-flight stage", () => {
    assert.equal(deriveVendorOrderStage({
        orderStatus: "pending", vendorFulfilmentStage: "new", handoverStatus: "rejected"
    }), "rejected");
});

test("deriveVendorOrderStage: delivered order buckets to completed regardless of handover history", () => {
    assert.equal(deriveVendorOrderStage({
        orderStatus: "delivered", vendorFulfilmentStage: null, handoverStatus: "accepted"
    }), "completed");
});

test("deriveVendorOrderStage: Lizimas-owned delivery vs. awaiting-inspection states", () => {
    assert.equal(deriveVendorOrderStage({
        orderStatus: "shipped", vendorFulfilmentStage: null, handoverStatus: "accepted"
    }), "in_delivery");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "paid", vendorFulfilmentStage: null, handoverStatus: "handed_over"
    }), "handed_over");
});

test("deriveVendorOrderStage: falls back to the vendor's own pre-handover stage", () => {
    assert.equal(deriveVendorOrderStage({
        orderStatus: "pending", vendorFulfilmentStage: "ready_for_handover", handoverStatus: "pending_handover"
    }), "ready_for_handover");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "pending", vendorFulfilmentStage: "processing", handoverStatus: "pending_handover"
    }), "processing");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "pending", vendorFulfilmentStage: "accepted", handoverStatus: "pending_handover"
    }), "accepted");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "pending", vendorFulfilmentStage: null, handoverStatus: "pending_handover"
    }), "new");
    assert.equal(deriveVendorOrderStage({
        orderStatus: "pending", vendorFulfilmentStage: null, handoverStatus: null
    }), "new");
});

test("every derivable stage has a display label", () => {
    const cases = [
        { orderStatus: "cancelled" },
        { orderStatus: "paid", handoverStatus: "forfeited" },
        { orderStatus: "paid", handoverStatus: "returned_for_collection" },
        { orderStatus: "paid", handoverStatus: "rejected" },
        { orderStatus: "delivered" },
        { orderStatus: "shipped", handoverStatus: "accepted" },
        { orderStatus: "paid", handoverStatus: "handed_over" },
        { orderStatus: "pending", vendorFulfilmentStage: "ready_for_handover" },
        { orderStatus: "pending", vendorFulfilmentStage: "processing" },
        { orderStatus: "pending", vendorFulfilmentStage: "accepted" },
        { orderStatus: "pending" }
    ];
    for (const c of cases) {
        const stage = deriveVendorOrderStage(c);
        assert.ok(STAGE_LABELS[stage], `no label for stage "${stage}"`);
    }
});
