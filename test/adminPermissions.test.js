const test = require("node:test");
const assert = require("node:assert");
const ap = require("../server/utils/adminPermissions");

test("every permission has tabs and a label", () => {
    for (const r of ap.AP_ROLES) {
        assert.ok(r.code.startsWith("ap_") && r.label && r.tabs.length, r.code);
    }
});

test("paths map to the right permission", () => {
    assert.deepStrictEqual(ap.permissionsForPath("/api/admin/orders?page=2"), ["ap_orders"]);
    assert.deepStrictEqual(ap.permissionsForPath("/api/admin/products/pending"), ["ap_products", "ap_staff"]);
    assert.deepStrictEqual(ap.permissionsForPath("/api/admin/product-discounts/end"), ["ap_marketing"]);
    assert.strictEqual(ap.permissionsForPath("/api/admin/my-access"), "*");
    assert.strictEqual(ap.permissionsForPath("/api/admin/notes/4/pin"), "*");
    assert.strictEqual(ap.permissionsForPath("/api/admin/admin-users"), null);
    assert.strictEqual(ap.permissionsForPath("/api/admin/something-new"), null);
    // prefix must end at a path boundary
    assert.strictEqual(ap.permissionsForPath("/api/admin/staffing"), null);
    assert.deepStrictEqual(ap.permissionsForPath("/api/admin/staff-sessions"), ["ap_staff"]);
});

test("canAccessPath", () => {
    assert.strictEqual(ap.canAccessPath(["ap_orders"], "/api/admin/orders"), true);
    assert.strictEqual(ap.canAccessPath(["ap_orders"], "/api/admin/vendors"), false);
    assert.strictEqual(ap.canAccessPath([], "/api/admin/my-access"), true);
    assert.strictEqual(ap.canAccessPath(["ap_staff", "ap_security", "ap_vendors"], "/api/admin/admin-users"), false);
    assert.strictEqual(ap.canAccessPath(null, "/api/admin/orders"), false);
});

test("sanitize and tabs", () => {
    assert.deepStrictEqual(ap.sanitizePermissions(["ap_orders", "ap_orders", "hack", 5]), ["ap_orders"]);
    const tabs = ap.tabsFor(["ap_orders"]);
    assert.ok(tabs.includes("orders") && tabs.includes("account") && tabs.includes("notes"));
    assert.ok(!tabs.includes("admin-users") && !tabs.includes("overview"));
});

test("target user ids for account-changing endpoints", () => {
    assert.strictEqual(ap.targetUserId("/api/admin/staff/12/block"), 12);
    assert.strictEqual(ap.targetUserId("/api/admin/customers/7"), 7);
    assert.strictEqual(ap.targetUserId("/api/admin/security/unlock/3"), 3);
    assert.strictEqual(ap.targetUserId("/api/admin/staff-sessions"), null);
    assert.strictEqual(ap.targetUserId("/api/admin/orders/5"), null);
});
