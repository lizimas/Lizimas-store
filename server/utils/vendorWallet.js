// Pure logic for the Vendor Wallet & Payouts center (Task #61). No DB
// access here - see server/controllers/vendorController.js for the
// DB-touching wrapper (getVendorWallet, requestVendorPayout) that builds
// these plain inputs from order_items/vendor_payouts/vendor_ledger_
// adjustments and calls into this.
//
// The wallet is DERIVED, not a maintained ledger table: sale and
// marketplace-charge amounts are computed straight from order_items,
// using each order_item's own locked-in commission_rate_applied/
// fixed_fee_applied where present (Task #67, migration 072) and falling
// back to the product's current snapshot only for orders placed before
// that migration existed - see loadVendorWalletData in vendorController.js.
// The two things that genuinely cannot be derived from anything else -
// money actually paid out, and one-off admin adjustments - are the only
// two real tables (vendor_payouts, vendor_ledger_adjustments). Avoiding a
// second, separately-maintained ledger table for the derivable part
// avoids ledger drift from its own source of truth.

// A vendor can request a payout once their available balance reaches this
// floor. Considered a starting point, not a settled business rule - same
// spirit as the 15% default commission rate - tune in one place here.
const MIN_PAYOUT_UGX = 20000;

// Where one order_item's money currently sits, from the vendor's point of
// view. Priority-ordered similarly to deriveVendorOrderStage (Task #59):
// exception states win over the order's raw status.
//   - 'excluded'  - the order was cancelled; nothing to pay out or await.
//   - 'refunded'  - the item came back (return/forfeiture); its sale is
//                   clawed back out of the vendor's earnings.
//   - 'available' - delivered and kept; the sale (minus the marketplace
//                   charge) is real, spendable vendor money.
//   - 'pending'   - anything else (not yet delivered) - a preview of what
//                   becomes available once the order is delivered, not
//                   money the vendor can request a payout against yet.
function classifyOrderItemForWallet({ orderStatus, handoverStatus }) {
    if (orderStatus === "cancelled") return "excluded";
    if (["returned_for_collection", "collected", "forfeited"].includes(handoverStatus)) return "refunded";
    if (orderStatus === "delivered") return "available";
    return "pending";
}

// items: [{ saleAmount, chargeAmount, classification }] - saleAmount is
// price*quantity, chargeAmount is that item's commission + fixed fee at
// its CURRENT rate (0 for items with no commission snapshot, e.g. very
// old listings predating the commission engine).
// payouts: [{ amount, status }] - status one of 'requested'|'paid'|'rejected'.
// adjustments: [{ amount }] - positive = credit, negative = debit.
function summarizeVendorWallet(items, payouts, adjustments) {
    let pendingSale = 0;
    let availableSale = 0;
    let availableCharges = 0;
    let refundedSale = 0;
    let refundedCharges = 0;

    for (const item of items) {
        if (item.classification === "pending") {
            pendingSale += item.saleAmount;
        } else if (item.classification === "available") {
            availableSale += item.saleAmount;
            availableCharges += item.chargeAmount;
        } else if (item.classification === "refunded") {
            refundedSale += item.saleAmount;
            refundedCharges += item.chargeAmount;
        }
    }

    const adjustmentsTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const paidOutTotal = payouts.filter(p => p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
    const requestedTotal = payouts.filter(p => p.status === "requested").reduce((sum, p) => sum + p.amount, 0);

    // Net earned = what delivered sales are actually worth to the vendor
    // after Lizimas' charges, less whatever came back as a return/
    // forfeiture (its charge is refunded right along with the sale - the
    // vendor never keeps a commission-adjusted amount on an item that came
    // back), plus/minus any manual adjustment.
    const netEarned = availableSale - availableCharges - (refundedSale - refundedCharges) + adjustmentsTotal;

    // Available to request now excludes money already paid out AND money
    // tied up in an outstanding payout request (never double-count a
    // pending request as still available to request again).
    const availableBalance = netEarned - paidOutTotal - requestedTotal;

    return {
        pendingBalance: pendingSale,
        availableBalance,
        netEarned,
        paidOutTotal,
        requestedTotal,
        breakdown: { availableSale, availableCharges, refundedSale, refundedCharges, adjustmentsTotal }
    };
}

// Whether a vendor may submit a new payout request right now: enough
// available balance, and no other request already outstanding (one
// in-flight request at a time keeps admin's queue and the vendor's own
// expectations simple).
function canRequestPayout(availableBalance, hasOutstandingRequest) {
    if (hasOutstandingRequest) {
        return { allowed: false, reason: "You already have a payout request awaiting review." };
    }
    if (availableBalance < MIN_PAYOUT_UGX) {
        return {
            allowed: false,
            reason: `Available balance must be at least UGX ${MIN_PAYOUT_UGX.toLocaleString()} to request a payout.`
        };
    }
    return { allowed: true };
}

module.exports = {
    MIN_PAYOUT_UGX,
    classifyOrderItemForWallet,
    summarizeVendorWallet,
    canRequestPayout
};
