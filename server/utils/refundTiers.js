// Pure logic for Phase 6 - Refund Tiers (Ryan, Sept 2026). Today
// approveReturnRefund lets admin type ANY amount with no policy guidance
// at all - two identical returns filed a day apart vs. three weeks apart
// get whatever number the reviewer feels like that day. This gives every
// return a POLICY-DERIVED suggested refund percentage based on how long
// ago the item was delivered, while leaving admin free to override it
// (Lizimas/admin retains final authority - see approveReturnRefund's own
// comment) - the tier is guidance + an audit trail, not a hard block.
//
// NOTE: the day thresholds and percentages below are a reasonable
// e-commerce-standard default (full refund shortly after delivery,
// tapering off, nothing after the cutoff), not numbers Ryan specified -
// call REFUND_TIERS.set(...) is unnecessary, just edit the array below
// once the real policy is decided; every caller reads from it live.
const REFUND_TIERS = [
    { key: "full", maxDays: 3, percentage: 100, label: "Full refund (within 3 days of delivery)" },
    { key: "partial_high", maxDays: 7, percentage: 75, label: "75% refund (4-7 days after delivery)" },
    { key: "partial_low", maxDays: 14, percentage: 50, label: "50% refund (8-14 days after delivery)" },
    { key: "ineligible", maxDays: Infinity, percentage: 0, label: "Outside refund window (14+ days after delivery)" }
];

function daysBetween(fromDate, toDate) {
    const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
    return ms / (1000 * 60 * 60 * 24);
}

// Returns the tier for a given day count (>= 0). A negative/invalid
// distance (delivered_at missing, or in the future somehow) is treated as
// day 0 - the safest default is the most generous tier, never the most
// punitive, since a missing timestamp is a data problem, not the
// customer's fault.
function tierForDaysSinceDelivery(days) {
    const d = Number.isFinite(days) && days >= 0 ? days : 0;
    return REFUND_TIERS.find((t) => d <= t.maxDays) || REFUND_TIERS[REFUND_TIERS.length - 1];
}

// deliveredAt/decisionAt are Date-like (or ISO strings). Returns the full
// tier object plus the raw day count, for both display and persistence.
function resolveRefundTier(deliveredAt, decisionAt = new Date()) {
    if (!deliveredAt) {
        // No delivered_at on file - fall back to the most generous tier
        // rather than guessing; see tierForDaysSinceDelivery's own note.
        return { ...REFUND_TIERS[0], daysSinceDelivery: null };
    }
    const days = daysBetween(deliveredAt, decisionAt);
    return { ...tierForDaysSinceDelivery(days), daysSinceDelivery: Math.max(0, Math.round(days * 10) / 10) };
}

// The tier-suggested refund amount for a sale amount (price * quantity).
// Rounded to the nearest whole UGX (or cent, for a USD-denominated line -
// this operates on whatever unit the caller passes in).
function suggestedRefundAmount(saleAmount, tier) {
    return Math.round(Number(saleAmount) * (tier.percentage / 100));
}

module.exports = {
    REFUND_TIERS,
    tierForDaysSinceDelivery,
    resolveRefundTier,
    suggestedRefundAmount
};
