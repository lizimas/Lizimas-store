const test = require("node:test");
const assert = require("node:assert/strict");
const {
    NOTIFICATION_TYPES,
    LOW_STOCK_THRESHOLD,
    isValidNotificationType,
    buildNotification
} = require("../server/utils/vendorNotifications.js");

test("NOTIFICATION_TYPES has exactly the eight known types", () => {
    assert.deepEqual(NOTIFICATION_TYPES, [
        "new_order", "low_stock", "product_approved", "product_rejected",
        "compliance_action", "payout_update", "refund_decision", "admin_message"
    ]);
});

test("LOW_STOCK_THRESHOLD matches the dashboard's own low-stock cutoff", () => {
    assert.equal(LOW_STOCK_THRESHOLD, 10);
});

test("isValidNotificationType accepts only known types", () => {
    assert.equal(isValidNotificationType("new_order"), true);
    assert.equal(isValidNotificationType("payout_update"), true);
    assert.equal(isValidNotificationType("something_else"), false);
    assert.equal(isValidNotificationType(""), false);
    assert.equal(isValidNotificationType(null), false);
});

test("buildNotification: new_order singular vs plural item wording", () => {
    const single = buildNotification("new_order", { orderId: 42, itemCount: 1 });
    assert.equal(single.title, "New order received");
    assert.match(single.message, /includes 1 of your item\.$/);
    assert.equal(single.linkTab, "orders");

    const plural = buildNotification("new_order", { orderId: 42, itemCount: 3 });
    assert.match(plural.message, /includes 3 of your items\.$/);
});

test("buildNotification: low_stock includes product name and count", () => {
    const result = buildNotification("low_stock", { productName: "Blue Shirt", stock: 4 });
    assert.equal(result.title, "Low stock");
    assert.match(result.message, /Blue Shirt is down to 4 in stock/);
    assert.equal(result.linkTab, "products");
});

test("buildNotification: product_approved / product_rejected", () => {
    const approved = buildNotification("product_approved", { productName: "Red Hat" });
    assert.match(approved.message, /Red Hat is now live/);

    const rejected = buildNotification("product_rejected", { productName: "Red Hat", reason: "Blurry photo" });
    assert.match(rejected.message, /Red Hat was rejected: Blurry photo/);
});

test("buildNotification: compliance_action passes through label/reason verbatim", () => {
    const result = buildNotification("compliance_action", { actionLabel: "Account suspended", reason: "Repeated late fulfilment" });
    assert.equal(result.title, "Account suspended");
    assert.equal(result.message, "Repeated late fulfilment");
    assert.equal(result.linkTab, "account");
});

test("buildNotification: payout_update varies title by status", () => {
    const paid = buildNotification("payout_update", { status: "paid", amount: 50000 });
    assert.equal(paid.title, "Payout sent");
    assert.match(paid.message, /UGX 50,000 was paid/);

    const rejected = buildNotification("payout_update", { status: "rejected", amount: 20000 });
    assert.equal(rejected.title, "Payout rejected");
    assert.match(rejected.message, /UGX 20,000 was rejected/);
});

test("buildNotification: refund_decision varies title/message by decision", () => {
    const approved = buildNotification("refund_decision", { decision: "approved", productName: "Blue Shirt", amount: 30000 });
    assert.equal(approved.title, "Refund approved");
    assert.match(approved.message, /Blue Shirt was approved \(UGX 30,000\)/);
    assert.equal(approved.linkTab, "refunds");

    const denied = buildNotification("refund_decision", { decision: "denied", productName: "Blue Shirt", notes: "Item showed signs of use" });
    assert.equal(denied.title, "Refund denied");
    assert.match(denied.message, /Blue Shirt was denied: Item showed signs of use/);
});

test("buildNotification: admin_message includes the thread subject when given", () => {
    const withSubject = buildNotification("admin_message", { subject: "Payout question" });
    assert.equal(withSubject.title, "New reply from Lizimas Store");
    assert.match(withSubject.message, /Reply on: Payout question/);
    assert.equal(withSubject.linkTab, "messages");

    const withoutSubject = buildNotification("admin_message", {});
    assert.match(withoutSubject.message, /You have a new reply/);
});

test("buildNotification: unknown type returns null", () => {
    assert.equal(buildNotification("not_a_real_type", {}), null);
});
