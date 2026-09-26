// Consignment order-routing ("Fulfillment by Lizimas",
// migrations 110/114) - the single decision checkoutController.js needs at
// checkout time: does this line item get fulfilled straight from stock
// Lizimas is already physically holding at a hub (vendor_consignments/
// consigned_stock), skipping the vendor per-order handover step entirely?
//
// Deliberately requires full coverage of the line item's quantity - if
// consigned_stock can't cover the whole order, the item falls back to the
// normal vendor-handover flow unchanged. There is no split-fulfillment of
// one order_items row across two sources.
//
// Only ever true for a vendor-sourced, non-variant item: product_variants
// has no fulfillment_type/consigned_stock of its own (see migration 110),
// and a staff-stocked item (no vendorId) was never handed over in the
// first place, so the question doesn't apply to it either.
function shouldFulfillFromConsignment({ vendorId, fulfillmentType, consignedStock, quantity }) {
    if (!vendorId) return false;
    if (fulfillmentType !== "lizimas_fulfilled") return false;
    return Number(consignedStock || 0) >= Number(quantity);
}

module.exports = { shouldFulfillFromConsignment };
