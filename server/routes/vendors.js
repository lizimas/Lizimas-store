const express = require("express");
const router = express.Router();

const { registerVendor, vendorLogin, requestVendorRegistrationCode, verifyVendorRegistrationCode } = require("../controllers/authController");
const { requireVendorPermission } = require("../utils/vendorContext");
const {
    listMyConsignments,
    createConsignment,
    markConsignmentInTransit,
    cancelConsignment
} = require("../controllers/vendorConsignmentController");
const {
    listMyPickers,
    createMyPicker,
    updateMyPicker,
    togglePickerActive,
    deleteMyPicker
} = require("../controllers/vendorPickerController");
const {
    listMyCampaigns,
    getAdRates,
    createCampaign,
    submitCampaign,
    setCampaignPaused,
    deleteCampaign
} = require("../controllers/vendorAdController");
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
    getMyVendorMessages, getMyVendorMessageThread, createVendorMessage, replyToVendorMessage,
    getVendorShopStatus, updateVendorShopActive, updateVendorHolidayMode,
    getMyProductTierStatus,
    getMyStockRecommendations
} = require("../controllers/vendorController");
const { getMyKyc, updateMyKyc, uploadMyKycDocument, getMyKycDocumentUrl } = require("../controllers/vendorKycController");
const { getMyShopSetup, updateMyShopInfo, updateMyCompanyInfo, updateMyShippingInfo, updateMyAdditionalInfo } = require("../controllers/vendorShopSetupController");
const {
    listVendorStaff,
    createVendorStaffUser,
    updateVendorStaffUserRoles,
    toggleVendorStaffUserEnabled,
    deleteVendorStaffUser
} = require("../controllers/vendorStaffController");
const {
    getMyBrandAuthorizations,
    submitBrandAuthorization,
    submitBrandAuthorizationFinal,
    uploadMyBrandAuthDocument,
    getMyBrandAuthDocumentUrl
} = require("../controllers/vendorBrandAuthController");
const {
    getMyPaymentInstruments,
    addMyPaymentInstrument,
    updateMyPaymentInstrument,
    setPreferredPaymentInstrument,
    uploadMyPaymentInstrumentEvidence,
    getMyPaymentInstrumentEvidenceUrl
} = require("../controllers/vendorPaymentInstrumentsController");
const {
    listVendorStatements,
    downloadStatementPdfVendor,
    downloadStatementCsvVendor,
    shareStatementVendor,
    updateMyPreferredCurrency
} = require("../controllers/billingController");
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
    setVariantStockMode,
    importVendorProducts
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
const {
    listJumiaApplications, createJumiaApplication, deleteJumiaApplication,
    activateJumiaApplication, connectJumiaApplication, disconnectJumiaApplication,
    testJumiaApplication, setJumiaApplicationCredentials, getJumiaAuthorizeUrl,
    jumiaOAuthCallback,
    getJumiaLinks, pushProductToJumia, pushProductsToJumiaBulk,
    getJumiaRemoteProducts, importJumiaProducts
} = require("../controllers/jumiaController");

const { requireAuth, requireVendor } = require("../middleware/authMiddleware");
const { otpLimiter } = require("../middleware/rateLimiter");
const upload = require("../middleware/upload");
const csvUpload = require("../middleware/csvUpload");

// Public: a prospective vendor applies, then logs in to check status/manage
// listings once approved. Login itself is unrestricted by status - the
// portal below decides what a pending/rejected vendor is allowed to do.
router.post("/register/send-code", otpLimiter, requestVendorRegistrationCode);
router.post("/register/verify-code", otpLimiter, verifyVendorRegistrationCode);
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

// Public: Jumia redirects a vendor's browser straight here after OAuth
// consent (Web Application Applications only) - no auth header is
// available on a top-level browser redirect, so this must sit before the
// requireAuth/requireVendor gate below. See jumiaSyncService.js's
// handleOAuthCallback for how the vendor/Application is identified
// instead (the signed `state` param).
router.get("/jumia/oauth/callback", jumiaOAuthCallback);

// Everything below is the vendor's own portal.
router.use(requireAuth, requireVendor);

router.get("/me", getMyVendorProfile);
router.patch("/me", requireVendorPermission("vc_shop_manager"), updateMyVendorProfile);
router.patch("/me/storefront", requireVendorPermission("vc_shop_manager"), updateVendorStorefront);
router.get("/me/shop-status", requireVendorPermission("vc_shop_manager", "vc_shop_viewer"), getVendorShopStatus);
router.patch("/me/shop-active", requireVendorPermission("vc_shop_manager"), updateVendorShopActive);
router.patch("/me/holiday-mode", requireVendorPermission("vc_shop_manager"), updateVendorHolidayMode);

// Mobile Home "Let's take your shop live!" onboarding (Ryan, Sept 2026) -
// see server/controllers/vendorShopSetupController.js.
router.get("/me/shop-setup", getMyShopSetup);
router.patch("/me/shop-setup/shop-info", requireVendorPermission("vc_shop_manager"), updateMyShopInfo);
router.patch("/me/shop-setup/company", requireVendorPermission("vc_shop_manager"), updateMyCompanyInfo);
router.patch("/me/shop-setup/shipping", requireVendorPermission("vc_shop_manager"), updateMyShippingInfo);
router.patch("/me/shop-setup/additional", requireVendorPermission("vc_shop_manager"), updateMyAdditionalInfo);

// Vendor KYC & Compliance Profile - identity/business-registration
// verification, separate from the profile above (Ryan, Sept 2026).
router.get("/me/kyc", getMyKyc);
router.patch("/me/kyc", updateMyKyc);
router.post("/me/kyc/documents", upload.kycDocument.single("document"), uploadMyKycDocument);
router.get("/me/kyc/documents/url", getMyKycDocumentUrl);

// Users/Roles (Settings > Users, matching Jumia Vendor Center) - owner-only,
// see vendorStaffController.js's header for why.
router.get("/me/staff", listVendorStaff);
router.post("/me/staff", createVendorStaffUser);
router.patch("/me/staff/:id/roles", updateVendorStaffUserRoles);
router.patch("/me/staff/:id/enabled", toggleVendorStaffUserEnabled);
router.delete("/me/staff/:id", deleteVendorStaffUser);

router.get("/me/brand-authorizations", getMyBrandAuthorizations);
router.post("/me/brand-authorizations", submitBrandAuthorization);
router.post("/me/brand-authorizations/:authorizationId/submit", submitBrandAuthorizationFinal);
router.post("/me/brand-authorizations/:authorizationId/documents", upload.kycDocument.single("document"), uploadMyBrandAuthDocument);
router.get("/me/brand-authorizations/:authorizationId/documents/url", getMyBrandAuthDocumentUrl);

router.get("/me/payment-instruments", getMyPaymentInstruments);
router.post("/me/payment-instruments", addMyPaymentInstrument);
// /preferred must be registered before /:id or Express matches "preferred" as an id.
router.patch("/me/payment-instruments/preferred", setPreferredPaymentInstrument);
router.patch("/me/payment-instruments/:id", updateMyPaymentInstrument);
router.post("/me/payment-instruments/:id/evidence", upload.kycDocument.single("document"), uploadMyPaymentInstrumentEvidence);
router.get("/me/payment-instruments/:id/evidence/url", getMyPaymentInstrumentEvidenceUrl);
router.get("/orders", requireVendorPermission("vc_order_manager", "vc_order_viewer"), getMyVendorOrders);
router.patch("/order-items/:orderItemId/stage", requireVendorPermission("vc_order_manager"), advanceVendorOrderStage);
router.get("/dashboard-summary", getVendorDashboardSummary);
router.get("/me/product-tier", getMyProductTierStatus);
router.get("/me/stock-recommendations", requireVendorPermission("vc_product_manager", "vc_product_viewer", "vc_product_update"), getMyStockRecommendations);

// Vendor Wallet & Payouts (Task #61): the balance is derived on every read
// from order_items - see server/utils/vendorWallet.js.
router.get("/wallet", requireVendorPermission("vc_finance_viewer"), getVendorWallet);
router.post("/wallet/payout-requests", requireVendorPermission("vc_finance_viewer"), requestVendorPayout);

router.get("/products", requireVendorPermission("vc_product_manager", "vc_product_viewer", "vc_product_update"), getMyProducts);
router.patch("/products/bulk", requireVendorPermission("vc_product_manager", "vc_product_update"), bulkUpdateVendorProducts);
router.post("/products", requireVendorPermission("vc_product_manager"), upload.array("images", 20), addProduct);
router.post("/products/import", requireVendorPermission("vc_product_manager"), csvUpload.single("file"), importVendorProducts);
router.put("/products/:id", requireVendorPermission("vc_product_manager", "vc_product_update"), upload.array("images", 20), updateProduct);
router.delete("/products/:id", requireVendorPermission("vc_product_manager"), deleteProduct);
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
// Staging upload for the vendor Add Product form, where no product id
// exists yet - mirrors products.js's equivalent no-id route.
router.post("/products/description-blocks/image", upload.single("image"), uploadBlockImage);

router.get("/dropoff-points", listActiveDropoffPoints);
router.post("/order-items/:orderItemId/handover", requireVendorPermission("vc_order_manager"), vendorMarkHandedOver);

// Fulfillment-by-Lizimas / Consignments (Jumia Vendor Center comparison,
// Sept 2026) - see migrations/110_vendor_consignments.sql.
router.get("/me/consignments", requireVendorPermission("vc_shop_manager", "vc_shop_viewer"), listMyConsignments);
router.post("/me/consignments", requireVendorPermission("vc_shop_manager"), createConsignment);
router.post("/me/consignments/:id/in-transit", requireVendorPermission("vc_shop_manager"), markConsignmentInTransit);
router.post("/me/consignments/:id/cancel", requireVendorPermission("vc_shop_manager"), cancelConsignment);

// Manage Pickers (Jumia Vendor Center comparison, Sept 2026) - see
// migrations/111_vendor_pickers.sql.
router.get("/me/pickers", requireVendorPermission("vc_shop_manager", "vc_shop_viewer"), listMyPickers);
router.post("/me/pickers", requireVendorPermission("vc_shop_manager"), createMyPicker);
router.put("/me/pickers/:id", requireVendorPermission("vc_shop_manager"), updateMyPicker);
router.patch("/me/pickers/:id/active", requireVendorPermission("vc_shop_manager"), togglePickerActive);
router.delete("/me/pickers/:id", requireVendorPermission("vc_shop_manager"), deleteMyPicker);

// Advertise Your Products (Jumia Vendor Center comparison, Sept 2026) - see
// migrations/112_vendor_ad_campaigns.sql.
router.get("/me/ad-rates", requireVendorPermission("vc_advertising_manager"), getAdRates);
router.get("/me/ad-campaigns", requireVendorPermission("vc_advertising_manager"), listMyCampaigns);
router.post("/me/ad-campaigns", requireVendorPermission("vc_advertising_manager"), createCampaign);
router.post("/me/ad-campaigns/:id/submit", requireVendorPermission("vc_advertising_manager"), submitCampaign);
router.patch("/me/ad-campaigns/:id/paused", requireVendorPermission("vc_advertising_manager"), setCampaignPaused);
router.delete("/me/ad-campaigns/:id", requireVendorPermission("vc_advertising_manager"), deleteCampaign);
router.get("/returns", requireVendorPermission("vc_order_manager", "vc_order_viewer"), getMyReturns);

// Returns & Refunds Center (Task #62): the financial/decision view, apart
// from the collection-logistics-only "Returns" tab above.
router.get("/returns-refunds", requireVendorPermission("vc_order_manager", "vc_order_viewer"), getMyReturnsRefunds);
router.patch("/order-items/:orderItemId/return-response", requireVendorPermission("vc_order_manager"), respondToReturn);

// Vendor reviews view (Task #63).
router.get("/reviews", getVendorReviews);
router.patch("/reviews/:reviewId/response", respondToReview);

// Admin compliance notices (Task #63) - the vendor's own read-only view.
router.get("/compliance-notices", getMyComplianceNotices);

// Vendor Promotions (Task #64): propose a time-boxed sale price on one of
// your own products.
router.post("/promotions", requireVendorPermission("vc_promotion_manager"), proposeVendorPromotion);
router.get("/promotions", requireVendorPermission("vc_promotion_manager"), getMyVendorPromotions);

// Vendor Notifications + Reports (Task #65).
router.get("/notifications", getMyVendorNotifications);
router.get("/notifications/unread-count", getMyVendorNotificationsUnreadCount);
router.patch("/notifications/:id/read", markVendorNotificationRead);
router.patch("/notifications/read-all", markAllVendorNotificationsRead);
router.get("/reports", requireVendorPermission("vc_order_report", "vc_finance_viewer"), getVendorReports);

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

// Jumia product linking (Settings > Applications on the vendor side):
// connect/disconnect a vendor's Jumia Vendor Center Application, push
// Lizimas listings out to Jumia, and pull existing Jumia listings in.
// See jumiaClient.js for what is/isn't verified against Jumia's real API.
router.get("/me/jumia/applications", requireVendorPermission("vc_shop_manager"), listJumiaApplications);
router.post("/me/jumia/applications", requireVendorPermission("vc_shop_manager"), createJumiaApplication);
router.delete("/me/jumia/applications/:id", deleteJumiaApplication);
router.post("/me/jumia/applications/:id/activate", activateJumiaApplication);
router.post("/me/jumia/applications/:id/connect", connectJumiaApplication);
router.post("/me/jumia/applications/:id/disconnect", disconnectJumiaApplication);
router.post("/me/jumia/applications/:id/test", testJumiaApplication);
router.post("/me/jumia/applications/:id/credentials", setJumiaApplicationCredentials);
router.get("/me/jumia/applications/:id/authorize", getJumiaAuthorizeUrl);
router.get("/me/jumia/links", getJumiaLinks);
router.post("/me/jumia/products/:id/push", pushProductToJumia);
router.post("/me/jumia/products/push-bulk", pushProductsToJumiaBulk);
router.get("/me/jumia/remote-products", getJumiaRemoteProducts);
router.post("/me/jumia/import", importJumiaProducts);

// --- Phase 4: vendor statement downloads + share (behind auth gate) ---
router.get("/me/statements", requireVendorPermission("vc_finance_viewer"), listVendorStatements);
router.patch("/me/currency", requireVendorPermission("vc_finance_viewer"), updateMyPreferredCurrency);
router.get("/me/statements/:id/pdf", requireVendorPermission("vc_finance_viewer"), downloadStatementPdfVendor);
router.get("/me/statements/:id/csv", requireVendorPermission("vc_finance_viewer"), downloadStatementCsvVendor);
router.post("/me/statements/:id/share", requireVendorPermission("vc_finance_viewer"), shareStatementVendor);

module.exports = router;
