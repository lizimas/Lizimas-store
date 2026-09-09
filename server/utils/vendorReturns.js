// Pure logic for the Returns & Refunds Center (Task #62). No DB access here
// - see server/controllers/fulfilmentController.js (admin decisions) and
// server/controllers/vendorController.js (getMyReturnsRefunds,
// respondToReturn) for the DB-touching wrappers.
//
// This is the FINANCIAL/decision layer on top of the physical-logistics
// tracking migration 052 already built (handover_status, return_reason,
// collection_deadline). An order_item can be mid-collection logistically
// while still awaiting a refund decision, or fully collected/forfeited
// with a decision already made - the two are tracked independently.

const REFUND_DECISIONS = ["approved", "denied"];

function isValidRefundDecision(decision) {
    return REFUND_DECISIONS.includes(decision);
}

// A one-word status for a vendor/admin list view. Priority-ordered like
// deriveVendorOrderStage (Task #59): no active return at all comes first,
// then whether Lizimas has made a call yet.
//   - 'no_return'         - nothing to show; return_reason was never set.
//   - 'awaiting_decision' - a return was recorded, Lizimas hasn't decided.
//   - 'refund_approved'   - Lizimas approved a refund (amount recorded).
//   - 'refund_denied'     - Lizimas decided against a refund.
function deriveReturnResolutionStatus({ returnReason, refundDecision }) {
    if (!returnReason) return "no_return";
    if (refundDecision === "approved") return "refund_approved";
    if (refundDecision === "denied") return "refund_denied";
    return "awaiting_decision";
}

// A refund decision is final once made - Lizimas/admin retains final
// authority over the outcome, so this blocks a second approve/deny call
// from silently overwriting an earlier one (use a manual ledger adjustment
// for a genuine after-the-fact correction, same as the wallet does).
function canRecordRefundDecision(currentDecision) {
    if (currentDecision) {
        return { allowed: false, reason: `A refund decision was already recorded (${currentDecision}).` };
    }
    return { allowed: true };
}

module.exports = {
    REFUND_DECISIONS,
    isValidRefundDecision,
    deriveReturnResolutionStatus,
    canRecordRefundDecision
};
