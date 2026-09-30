// Clean page addresses (Sept 2026): /vendor-login.html -> /vendor-login.
const test = require("node:test");
const assert = require("node:assert");
const { cleanPath } = require("../server/utils/cleanUrls");

test("old .html addresses map to clean ones", () => {
    assert.strictEqual(cleanPath("/vendor-login.html"), "/vendor-login");
    assert.strictEqual(cleanPath("/vendor/dashboard.html"), "/vendor/dashboard");
    assert.strictEqual(cleanPath("/index.html"), "/");
    assert.strictEqual(cleanPath("/staff/index.html"), "/staff/");
});

test("partials, odd paths and non-pages are left alone", () => {
    assert.strictEqual(cleanPath("/admin-support-control-center.partial.html"), null);
    assert.strictEqual(cleanPath("/a/../b.html"), null);
    assert.strictEqual(cleanPath("/vendor-login"), null);
    assert.strictEqual(cleanPath("/x.htm"), null);
});
