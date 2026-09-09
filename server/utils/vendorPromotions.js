// Pure logic for Vendor Promotions (Task #64). No DB access here - see
// server/controllers/vendorController.js (proposeVendorPromotion) and
// server/controllers/promotionReviewController.js-equivalent admin
// functions in vendorController.js (approve/reject/feature) for the
// DB-touching wrappers.

// The ceiling a vendor may propose without admin needing to reject it on
// sight. A starting point, not a settled business rule - same spirit as
// MIN_PAYOUT_UGX (vendorWallet.js) and the 15% default commission rate -
// tune in one place here.
const MAX_VENDOR_DISCOUNT_PERCENT = 50;

function computeDiscountPercent(originalPrice, proposedSalePrice) {
    if (!(originalPrice > 0)) return 0;
    return ((originalPrice - proposedSalePrice) / originalPrice) * 100;
}

// Validates a proposed sale price against its own product's current price
// and the discount ceiling. Returns the computed percent alongside the
// verdict so the caller can store/display it without recomputing.
function validateProposedPrice(originalPrice, proposedSalePrice, maxDiscountPercent = MAX_VENDOR_DISCOUNT_PERCENT) {
    if (!(proposedSalePrice > 0)) {
        return { allowed: false, reason: "Sale price must be greater than zero." };
    }
    if (!(proposedSalePrice < originalPrice)) {
        return { allowed: false, reason: "Sale price must be less than the current price." };
    }
    const discountPercent = computeDiscountPercent(originalPrice, proposedSalePrice);
    if (discountPercent > maxDiscountPercent) {
        return {
            allowed: false,
            reason: `Discount cannot exceed ${maxDiscountPercent}% off the current price.`,
            discountPercent
        };
    }
    return { allowed: true, discountPercent };
}

function isValidPromotionWindow(startsAt, endsAt, now = new Date()) {
    const starts = new Date(startsAt);
    const ends = new Date(endsAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
        return { allowed: false, reason: "starts_at and ends_at must be valid dates." };
    }
    if (ends <= starts) {
        return { allowed: false, reason: "ends_at must be after starts_at." };
    }
    if (ends <= now) {
        return { allowed: false, reason: "ends_at must be in the future." };
    }
    return { allowed: true };
}

// A one-word status for a vendor/admin list view - approval status plus
// where the promotion sits relative to its own time window.
//   - 'pending'   - awaiting admin's decision.
//   - 'rejected'  - admin declined it.
//   - 'scheduled' - approved, window hasn't started yet.
//   - 'active'    - approved and currently within its window.
//   - 'expired'   - approved, window already ended.
function deriveVendorPromotionStatus({ status, startsAt, endsAt }, now = new Date()) {
    if (status === "pending") return "pending";
    if (status === "rejected") return "rejected";
    // status === "approved" from here on
    const starts = new Date(startsAt);
    const ends = new Date(endsAt);
    if (now < starts) return "scheduled";
    if (now > ends) return "expired";
    return "active";
}

module.exports = {
    MAX_VENDOR_DISCOUNT_PERCENT,
    computeDiscountPercent,
    validateProposedPrice,
    isValidPromotionWindow,
    deriveVendorPromotionStatus
};
