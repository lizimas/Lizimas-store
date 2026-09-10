const express = require("express");
const router = express.Router();

const { registerVendor, vendorLogin } = require("../controllers/authController");
const {
    getMyVendorProfile, getMyVendorOrders, updateMyVendorProfile, getPublicStorefront,
    followVendor, unfollowVendor, getFollowStatus, getVendorDashboardSummary,
    advanceVendorOrderStage, bulkUpdateVendorProducts,
    getVendorWallet, requestVendorPayout,
    getMyReturnsRefunds, respondToReturn,
    getMyComplianceNotices,
    proposeVendorPromotion, getMyVendorPromotions,
    getMyVendorNotifications, getMyVendorNotificationsUnreadCount,
    markVendorNotificationRead, markAllVendorNotificationsRead,
    getVendorReports,
    updateVendorStorefront,
    getMyVendorMessages, getMyVendorMessageThread, createVendorMessage, replyToVendorMessage
} = require("../controllers/vendorController");
const { getMyKyc, updateMyKyc } = require("../controllers/vendorKycController");
const {
    addProduct,
    updateProduct,
    deleteProduct,
    getMyProducts,
    getProductImages,
    updateImageOrder,
    deleteProductImage,
    saveProductOptions,
    generateProductVariants,
    updateVariantStock,
    setVariantStockMode
} = require("../controllers/productController");
const {
    getDescriptionBlocks,
    saveDescriptionBlocks,
    uploadBlockImage
} = require("../controllers/descriptionBlockController");
const {
    listActiveDropoffPoints,
    vendorMarkHandedOver,
    getMyReturns
} = require("../controllers/fulfilmentController");

const { previewPricing } = require("../controllers/commissionController");
const { getVendorReviews, respondToReview } = require("../controllers/reviewController");

const { requireAuth, requireVendor } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: a prospective vendor applies, then logs in to check status/manage
// listings once approved. Login itself is unrestricted by status - the
// portal below decides what a pending/rejected vendor is allowed to do.
router.post("/register", registerVendor);
router.post("/login", vendorLogin);

// Public storefront (spec section 17) - a shopper's view of one vendor's
// page and live catalogue. No auth: this must stay reachable by anyone,
// so it is declared before the requireAuth/requireVendor gate below.
router.get("/store/:slug", getPublicStorefront);

// Follow/unfollow a vendor's storefront (spec: "Followers - customers can
// follow, Lizimas owns the system"). Any logged-in user, not just
// customers with a "customer" role and not vendors managing their own
// portal - so this is requireAuth only, declared before the
// requireVendor gate below rather than folded into it.
router.post("/:id/follow", requireAuth, followVendor);
router.delete("/:id/follow", requireAuth, unfollowVendor);
router.get("/:id/follow-status", requireAuth, getFollowStatus);

// Everything below is the vendor's own portal.
router.use(requireAuth, requireVendor);

router.get("/me", getMyVendorProfile);
router.patch("/me", updateMyVendorProfile);
router.patch("/me/storefront", updateVendorStorefront);

// Vendor KYC & Compliance Profile - identity/business-registration
// verification, separate from the profile above (Ryan, Sept 2026).
router.get("/me/kyc", getMyKyc);
router.patch("/me/kyc", updateMyKyc);
router.get("/orders", getMyVendorOrders);
router.patch("/order-items/:orderItemId/stage", advanceVendorOrderStage);
router.get("/dashboard-summary", getVendorDashboardSummary);

// Vendor Wallet & Payouts (Task #61): the balance is derived on every read
// from order_items - see server/utils/vendorWallet.js.
router.get("/wallet", getVendorWallet);
router.post("/wallet/payout-requests", requestVendorPayout);

router.get("/products", getMyProducts);
router.patch("/products/bulk", bulkUpdateVendorProducts);
router.post("/products", upload.array("images", 20), addProduct);
router.put("/products/:id", upload.array("images", 20), updateProduct);
router.delete("/products/:id", deleteProduct);
router.get("/products/:id/images", getProductImages);
router.patch("/products/:id/images/order", updateImageOrder);
router.delete("/products/images/:imageId", deleteProductImage);

// Basic variant support (Task #60): colors/sizes + a generated stock grid,
// scoped to the vendor's own products via the same canEditProduct ownership
// check the admin-only routes at /api/products/... rely on internally.
router.post("/products/:id/options", saveProductOptions);
router.post("/products/:id/variants/generate", generateProductVariants);
router.patch("/products/:id/variant-stock", setVariantStockMode);
router.patch("/products/:id/variants/stock", updateVariantStock);

router.get("/products/:id/description-blocks", getDescriptionBlocks);
router.put("/products/:id/description-blocks", saveDescriptionBlocks);
router.post("/products/:id/description-blocks/image", upload.single("image"), uploadBlockImage);

router.get("/dropoff-points", listActiveDropoffPoints);
router.post("/order-items/:orderItemId/handover", vendorMarkHandedOver);
router.get("/returns", getMyReturns);

// Returns & Refunds Center (Task #62): the financial/decision view, apart
// from the collection-logistics-only "Returns" tab above.
router.get("/returns-refunds", getMyReturnsRefunds);
router.patch("/order-items/:orderItemId/return-response", respondToReturn);

// Vendor reviews view (Task #63).
router.get("/reviews", getVendorReviews);
router.patch("/reviews/:reviewId/response", respondToReview);

// Admin compliance notices (Task #63) - the vendor's own read-only view.
router.get("/compliance-notices", getMyComplianceNotices);

// Vendor Promotions (Task #64): propose a time-boxed sale price on one of
// your own products.
router.post("/promotions", proposeVendorPromotion);
router.get("/promotions", getMyVendorPromotions);

// Vendor Notifications + Reports (Task #65).
router.get("/notifications", getMyVendorNotifications);
router.get("/notifications/unread-count", getMyVendorNotificationsUnreadCount);
router.patch("/notifications/:id/read", markVendorNotificationRead);
router.patch("/notifications/read-all", markAllVendorNotificationsRead);
router.get("/reports", getVendorReports);

// Vendor-to-Admin Messaging (Task #71).
router.get("/messages", getMyVendorMessages);
router.get("/messages/:id", getMyVendorMessageThread);
router.post("/messages", createVendorMessage);
router.post("/messages/:id/replies", replyToVendorMessage);

// Live pricing preview for the product-upload form (spec section 8): given
// a category and the vendor's desired payout, returns the commission rate,
// Lizimas' cut, and the customer-facing price - before the vendor submits
// anything.
router.post("/pricing/preview", previewPricing);

module.exports = router;
