// Pure logic for the vendor Orders Center (Task #59). No DB access here -
// see server/controllers/vendorController.js / fulfilmentController.js for
// the DB-touching wrappers that call into this.
//
// Two lifecycles combine to produce one display-friendly stage for a
// vendor-sourced order item:
//   - vendor_fulfilment_stage: the vendor's OWN pre-handover progress
//     (new -> accepted -> processing -> ready_for_handover), forward-only,
//     advanced by the vendor from their dashboard.
//   - handover_status: Lizimas' OWN post-handover inspection/returns
//     lifecycle (052_vendor_fulfilment.sql) - pending_handover, handed_over,
//     accepted, rejected, returned_for_collection, collected, forfeited.
// Plus orders.status (pending/paid/shipped/delivered/cancelled) at the
// whole-order level.
//
// These were kept as separate columns specifically because handover_status
// already uses 'accepted'/'rejected' to mean "Lizimas' inspection outcome" -
// reusing those names for "the vendor accepted the order" would collide two
// different meanings of the same word on the same row.

const STAGE_ORDER = ["new", "accepted", "processing", "ready_for_handover"];

const STAGE_LABELS = {
    new: "New",
    accepted: "Accepted",
    processing: "Processing",
    ready_for_handover: "Ready for Handover",
    handed_over: "Handed Over — Awaiting Inspection",
    in_delivery: "In Delivery",
    completed: "Delivered",
    rejected: "Rejected at Inspection",
    return_in_progress: "Return in Progress",
    forfeited: "Forfeited",
    cancelled: "Cancelled"
};

function isValidStage(stage) {
    return STAGE_ORDER.includes(stage);
}

// Forward-only, one step at a time: 'new' -> 'accepted' -> 'processing' ->
// 'ready_for_handover'. A null/undefined `from` is treated as 'new' (a
// freshly-placed order item that hasn't been touched yet).
function canAdvanceStage(from, to) {
    if (!isValidStage(to)) return false;
    const fromIndex = STAGE_ORDER.indexOf(from || "new");
    const toIndex = STAGE_ORDER.indexOf(to);
    if (fromIndex === -1) return false;
    return toIndex === fromIndex + 1;
}

// Derives the single stage key to show the vendor for one order item,
// priority-ordered so exception/terminal states always win over an
// in-flight one (e.g. a cancelled order shows Cancelled even if the vendor
// had already marked it Processing).
//
// NOTE: "completed" is a bucket for ANY delivered order - there is no
// reliable delivered_at timestamp yet to distinguish "just delivered" from
// "past the return window", so both read as Delivered. Documented as a
// known simplification in PENDING.md, not a bug - revisit once delivery
// timestamps exist.
function deriveVendorOrderStage({ orderStatus, vendorFulfilmentStage, handoverStatus }) {
    if (orderStatus === "cancelled") return "cancelled";
    if (handoverStatus === "forfeited") return "forfeited";
    if (handoverStatus === "returned_for_collection" || handoverStatus === "collected") return "return_in_progress";
    if (handoverStatus === "rejected") return "rejected";
    if (orderStatus === "delivered") return "completed";
    if (handoverStatus === "accepted") return "in_delivery";
    if (handoverStatus === "handed_over") return "handed_over";
    if (vendorFulfilmentStage === "ready_for_handover") return "ready_for_handover";
    if (vendorFulfilmentStage === "processing") return "processing";
    if (vendorFulfilmentStage === "accepted") return "accepted";
    return "new";
}

module.exports = {
    STAGE_ORDER,
    STAGE_LABELS,
    isValidStage,
    canAdvanceStage,
    deriveVendorOrderStage
};
