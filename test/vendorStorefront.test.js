const test = require("node:test");
const assert = require("node:assert/strict");
const {
    MAX_ABOUT_LENGTH,
    isValidAboutText,
    DELIVERY_METHODS,
    isValidDeliveryMethod,
    findStorefrontContactViolation
} = require("../server/utils/vendorStorefront.js");

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

// --- Delivery/payment method (Task #74) ------------------------------------

test("DELIVERY_METHODS has exactly the two options", () => {
    assert.deepEqual(DELIVERY_METHODS, ["cash_on_delivery", "payment_first"]);
});

test("isValidDeliveryMethod: null/undefined are valid (no method set yet)", () => {
    assert.equal(isValidDeliveryMethod(undefined), true);
    assert.equal(isValidDeliveryMethod(null), true);
});

test("isValidDeliveryMethod: the two real values are valid", () => {
    assert.equal(isValidDeliveryMethod("cash_on_delivery"), true);
    assert.equal(isValidDeliveryMethod("payment_first"), true);
});

test("isValidDeliveryMethod: anything else is invalid", () => {
    assert.equal(isValidDeliveryMethod(""), false);
    assert.equal(isValidDeliveryMethod("negotiable"), false);
    assert.equal(isValidDeliveryMethod("COD"), false);
});

// --- Storefront bio content filter (Task #75) -------------------------------

test("findStorefrontContactViolation: clean bio text passes", () => {
    assert.equal(findStorefrontContactViolation("We sell quality electronics at fair prices since 2019."), null);
    assert.equal(findStorefrontContactViolation(undefined), null);
    assert.equal(findStorefrontContactViolation(""), null);
});

test("findStorefrontContactViolation: a price is not mistaken for a phone number", () => {
    assert.equal(findStorefrontContactViolation("All items under UGX 1,500,000, delivered fast."), null);
    assert.equal(findStorefrontContactViolation("Over 250,000 happy customers served."), null);
});

test("findStorefrontContactViolation: catches Ugandan phone numbers in common written forms", () => {
    assert.equal(findStorefrontContactViolation("Call 0700123456 for bulk orders"), "a phone number");
    assert.equal(findStorefrontContactViolation("Call 0700 123 456 for bulk orders"), "a phone number");
    assert.equal(findStorefrontContactViolation("Reach us on +256 700 123 456"), "a phone number");
    assert.equal(findStorefrontContactViolation("256700123456 is our line"), "a phone number");
    assert.equal(findStorefrontContactViolation("700123456"), "a phone number");
});

test("findStorefrontContactViolation: catches off-platform contact phrasing", () => {
    assert.equal(findStorefrontContactViolation("Message me on WhatsApp for a better price"), "a request to contact you outside Lizimas Store");
    assert.equal(findStorefrontContactViolation("wa.me/2567001234 for quick replies"), "a request to contact you outside Lizimas Store");
    assert.equal(findStorefrontContactViolation("Just call me directly"), "a request to contact you outside Lizimas Store");
});

test("findStorefrontContactViolation: catches address/location phrasing", () => {
    assert.equal(findStorefrontContactViolation("We are located at Plot 45 Kampala Road"), "a store address or location");
    assert.equal(findStorefrontContactViolation("Visit us at our warehouse"), "a store address or location");
    assert.equal(findStorefrontContactViolation("Shop No. 12, opposite the market"), "a store address or location");
    assert.equal(findStorefrontContactViolation("Find us at 0.3476, 32.5825"), "a store address or location");
});
