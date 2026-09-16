const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldFulfillFromConsignment } = require("../server/utils/consignmentFulfillment");

test("routes to consignment fulfillment when a vendor item has enough consigned_stock", () => {
    const result = shouldFulfillFromConsignment({
        vendorId: 10, fulfillmentType: "lizimas_fulfilled", consignedStock: 5, quantity: 3
    });
    assert.equal(result, true);
});

test("routes to consignment fulfillment when consigned_stock exactly covers the quantity", () => {
    const result = shouldFulfillFromConsignment({
        vendorId: 10, fulfillmentType: "lizimas_fulfilled", consignedStock: 3, quantity: 3
    });
    assert.equal(result, true);
});

test("falls back to normal vendor handover when consigned_stock can't cover the whole line item", () => {
    const result = shouldFulfillFromConsignment({
        vendorId: 10, fulfillmentType: "lizimas_fulfilled", consignedStock: 2, quantity: 3
    });
    assert.equal(result, false);
});

test("falls back to normal vendor handover for a vendor_fulfilled product even with stray consigned_stock", () => {
    const result = shouldFulfillFromConsignment({
        vendorId: 10, fulfillmentType: "vendor_fulfilled", consignedStock: 10, quantity: 3
    });
    assert.equal(result, false);
});

test("never routes a staff-stocked item (no vendorId) to consignment fulfillment", () => {
    const result = shouldFulfillFromConsignment({
        vendorId: null, fulfillmentType: "lizimas_fulfilled", consignedStock: 10, quantity: 3
    });
    assert.equal(result, false);
});

test("treats a missing/undefined consigned_stock as zero", () => {
    const result = shouldFulfillFromConsignment({
        vendorId: 10, fulfillmentType: "lizimas_fulfilled", consignedStock: undefined, quantity: 1
    });
    assert.equal(result, false);
});
