const test = require("node:test");
const assert = require("node:assert/strict");
const {
    MIN_PAYOUT_UGX,
    classifyOrderItemForWallet,
    summarizeVendorWallet,
    canRequestPayout
} = require("../server/utils/vendorWallet.js");

test("classifyOrderItemForWallet: cancelled order excludes regardless of handover status", () => {
    assert.equal(
        classifyOrderItemForWallet({ orderStatus: "cancelled", handoverStatus: "accepted" }),
        "excluded"
    );
    assert.equal(
        classifyOrderItemForWallet({ orderStatus: "cancelled", handoverStatus: null }),
        "excluded"
    );
});

test("classifyOrderItemForWallet: returned/collected/forfeited handover overrides delivered status", () => {
    for (const handoverStatus of ["returned_for_collection", "collected", "forfeited"]) {
        assert.equal(
            classifyOrderItemForWallet({ orderStatus: "delivered", handoverStatus }),
            "refunded"
        );
    }
});

test("classifyOrderItemForWallet: delivered + no return-shaped handover is available", () => {
    assert.equal(
        classifyOrderItemForWallet({ orderStatus: "delivered", handoverStatus: "accepted" }),
        "available"
    );
    assert.equal(
        classifyOrderItemForWallet({ orderStatus: "delivered", handoverStatus: null }),
        "available"
    );
});

test("classifyOrderItemForWallet: anything else (pending/paid/shipped) is pending", () => {
    for (const orderStatus of ["pending", "paid", "shipped"]) {
        assert.equal(
            classifyOrderItemForWallet({ orderStatus, handoverStatus: null }),
            "pending"
        );
    }
});

test("summarizeVendorWallet: basic split across pending/available/refunded", () => {
    const items = [
        { saleAmount: 10000, chargeAmount: 1500, classification: "pending" },
        { saleAmount: 20000, chargeAmount: 3000, classification: "available" },
        { saleAmount: 5000, chargeAmount: 750, classification: "refunded" },
        { saleAmount: 99999, chargeAmount: 1, classification: "excluded" }
    ];
    const result = summarizeVendorWallet(items, [], []);

    assert.equal(result.pendingBalance, 10000);
    // netEarned = availableSale - availableCharges - (refundedSale - refundedCharges)
    //           = 20000 - 3000 - (5000 - 750) = 17000 - 4250 = 12750
    assert.equal(result.netEarned, 12750);
    assert.equal(result.availableBalance, 12750);
    assert.equal(result.paidOutTotal, 0);
    assert.equal(result.requestedTotal, 0);
    assert.equal(result.breakdown.availableSale, 20000);
    assert.equal(result.breakdown.availableCharges, 3000);
    assert.equal(result.breakdown.refundedSale, 5000);
    assert.equal(result.breakdown.refundedCharges, 750);
});

test("summarizeVendorWallet: excluded (cancelled) items contribute nothing anywhere", () => {
    const items = [{ saleAmount: 999999, chargeAmount: 999999, classification: "excluded" }];
    const result = summarizeVendorWallet(items, [], []);
    assert.equal(result.pendingBalance, 0);
    assert.equal(result.netEarned, 0);
    assert.equal(result.availableBalance, 0);
});

test("summarizeVendorWallet: paid payouts and outstanding requests both reduce available balance", () => {
    const items = [{ saleAmount: 100000, chargeAmount: 15000, classification: "available" }];
    const payouts = [
        { amount: 30000, status: "paid" },
        { amount: 20000, status: "requested" },
        { amount: 5000, status: "rejected" }
    ];
    const result = summarizeVendorWallet(items, payouts, []);

    // netEarned = 100000 - 15000 = 85000
    assert.equal(result.netEarned, 85000);
    assert.equal(result.paidOutTotal, 30000);
    assert.equal(result.requestedTotal, 20000);
    // rejected payouts don't count against balance at all
    // available = netEarned - paidOutTotal - requestedTotal = 85000 - 30000 - 20000 = 35000
    assert.equal(result.availableBalance, 35000);
});

test("summarizeVendorWallet: manual adjustments add to netEarned and availableBalance", () => {
    const items = [{ saleAmount: 50000, chargeAmount: 7500, classification: "available" }];
    const adjustments = [{ amount: 10000 }, { amount: -2000 }];
    const result = summarizeVendorWallet(items, [], adjustments);

    // netEarned = 50000 - 7500 + (10000 - 2000) = 42500 + 8000 = 50500
    assert.equal(result.netEarned, 50500);
    assert.equal(result.availableBalance, 50500);
    assert.equal(result.breakdown.adjustmentsTotal, 8000);
});

test("summarizeVendorWallet: empty inputs produce all-zero summary", () => {
    const result = summarizeVendorWallet([], [], []);
    assert.equal(result.pendingBalance, 0);
    assert.equal(result.availableBalance, 0);
    assert.equal(result.netEarned, 0);
    assert.equal(result.paidOutTotal, 0);
    assert.equal(result.requestedTotal, 0);
});

test("canRequestPayout: blocks when an outstanding request already exists", () => {
    const result = canRequestPayout(MIN_PAYOUT_UGX * 5, true);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /already have a payout request/i);
});

test("canRequestPayout: blocks when available balance is below the floor", () => {
    const result = canRequestPayout(MIN_PAYOUT_UGX - 1, false);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /must be at least/i);
});

test("canRequestPayout: allows exactly at the floor with no outstanding request", () => {
    const result = canRequestPayout(MIN_PAYOUT_UGX, false);
    assert.equal(result.allowed, true);
    assert.equal(result.reason, undefined);
});

test("canRequestPayout: allows comfortably above the floor", () => {
    const result = canRequestPayout(MIN_PAYOUT_UGX * 10, false);
    assert.equal(result.allowed, true);
});
