const express = require("express");
const router = express.Router();

const {
    getDashboardStats,
    getAllOrdersAdmin,
    getOrderItems,
    getReceiptLink,
    getAllCustomers,
    updateOrderStatus,
    getVisitorStats,
    deleteCustomer,
    permanentlyDeleteCustomer,
    restoreCustomer,
    getActivityLog,
    getStaffSessions
} = require("../controllers/adminController");

const {
    getAnalyticsOverview,
    getProductAnalytics,
    getVendorPerformanceReport,
    getStaffPerformanceReport,
    getVendorReportPdf,
    getStaffReportPdf,
    shareVendorReportPdf,
    shareStaffReportPdf
} = require("../controllers/analyticsController");

const {
    getStaffMessagingEnabled,
    setStaffMessagingEnabled,
    listThreadsForAdmin,
    getThreadForAdmin,
    replyToThread,
    uploadThreadAttachment
} = require("../controllers/staffMessagesController");
const { chatAttachment } = require("../middleware/upload");
const upload = require("../middleware/upload");

const {
    getPendingProducts,
    approveProduct,
    rejectProduct,
    getDeletionRequests,
    approveDeletionRequest,
    rejectDeletionRequest,
    getTrash,
    restoreProduct,
    permanentlyDeleteProduct,
    restrictVendorProduct,
    unrestrictVendorProduct
} = require("../controllers/productController");

const { createStaffAccount, activateStaffAccount, blockStaffAccount, forcePasswordReset, clearLoginLockout, logoutAllDevices, resetStaff2FA, getLoginHistory } = require("../controllers/authController");

const {
    listProductTiers,
    updateProductTier,
    getVendorTierStatus,
    setVendorTierOverride
} = require("../controllers/adminProductTierController");
const {
    listConsignmentsAdmin,
    receiveConsignment,
    rejectConsignment
} = require("../controllers/adminConsignmentController");
const { searchPickersAdmin } = require("../controllers/adminPickerController");
const {
    listCampaignsAdmin,
    approveCampaign,
    rejectCampaign,
    setCampaignPausedAdmin,
    getAdSettingsAdmin,
    updateAdSettingsAdmin
} = require("../controllers/adminAdController");

const { requireAuth, requireAdmin, requireSupportOrAdmin } = require("./../middleware/authMiddleware");
const {
    listDropoffPoints,
    createDropoffPoint,
    updateDropoffPoint,
    getPendingHandovers,
    acceptHandover,
    rejectHandover,
    markReturned,
    getPendingReturns,
    markCollected,
    markForfeited,
    getReturnsAwaitingRefundDecision,
    getReturnsRefundHistory,
    uploadReturnEvidence,
    approveReturnRefund,
    denyReturnRefund
} = require("../controllers/fulfilmentController");
const {
    getPendingVendors,
    getAllVendors,
    approveVendor,
    rejectVendor,
    regenerateVendorShopId,
    getVendorPayoutRequests,
    markVendorPayoutPaid,
    rejectVendorPayout,
    createVendorLedgerAdjustment,
    getVendorWalletAdmin,
    warnVendor,
    suspendVendor,
    reinstateVendor,
    freezeVendorPayouts,
    unfreezeVendorPayouts,
    getVendorComplianceHistory,
    getVendorProductsAdmin,
    getPendingVendorPromotions,
    getApprovedVendorPromotions,
    approveVendorPromotion,
    rejectVendorPromotion,
    setVendorPromotionFeatured,
    setVendorPromotionSponsored,
    getVendorMessagesAdmin,
    getVendorMessageThreadAdmin,
    replyToVendorMessageAdmin,
    resolveVendorMessageAdmin,
    reopenVendorMessageAdmin,
    escalateVendorMessageAdmin,
    unescalateVendorMessageAdmin
} = require("../controllers/vendorController");
const {
    listVendorKycAdmin, getVendorKycAdminDetail, reviewVendorKycAdmin,
    updateVendorUrsbVerification,
    reviewVendorKycDocumentAdmin, getVendorKycDocumentAdmin
} = require("../controllers/vendorKycController");
const {
    listBrandAuthorizationsAdmin,
    getBrandAuthorizationAdminDetail,
    reviewBrandAuthorizationAdmin,
    reviewBrandAuthDocumentAdmin,
    getBrandAuthDocumentAdmin
} = require("../controllers/vendorBrandAuthController");
const {
    listPaymentInstrumentsAdmin,
    reviewPaymentInstrumentAdmin,
    getPaymentInstrumentEvidenceUrlAdmin
} = require("../controllers/vendorPaymentInstrumentsController");
const {
    listProhibitedItemsAdmin,
    addProhibitedItemAdmin,
    updateProhibitedItemAdmin,
    deleteProhibitedItemAdmin
} = require("../controllers/prohibitedItemsController");

const {
    getCurrentCycle,
    ensureCurrentCycle,
    listCyclesAdmin,
    closeCycleAndGenerateStatements,
    listStatementsAdmin,
    getStatementDetail,
    batchApproveStatements,
    markStatementPaid,
    rejectStatement,
    downloadStatementPdfAdmin,
    downloadStatementCsvAdmin
} = require("../controllers/billingController");

const {
    generateCode,
    listDiscountCodes,
    createDiscountCode,
    setDiscountCodeActive,
    deleteDiscountCode
} = require("../controllers/discountController");

const {
    listFlashSales,
    getFlashSale,
    createFlashSale,
    updateFlashSale,
    setFlashSaleActive,
    deleteFlashSale
} = require("../controllers/flashSaleController");
const csvUpload = require("../middleware/csvUpload");
const jumiaAdmin = require("../controllers/jumiaAdminController");
const { getSecurityLogins, unlockAccount, getAccountReports, updateAccountReport } = require("../controllers/adminController");

const {
    listNotes,
    createNote,
    updateNote,
    setNotePinned,
    setNoteReaction,
    deleteNote
} = require("../controllers/adminNotesController");

// Vendor messages (Task #71/#76) - reachable by customer_support as well
// as admin, so these are registered ahead of the requireAdmin gate below
// with their own requireSupportOrAdmin check instead of inheriting it.
router.get("/vendor-messages", requireAuth, requireSupportOrAdmin, getVendorMessagesAdmin);
router.get("/vendor-messages/:id", requireAuth, requireSupportOrAdmin, getVendorMessageThreadAdmin);
router.post("/vendor-messages/:id/replies", requireAuth, requireSupportOrAdmin, replyToVendorMessageAdmin);
router.patch("/vendor-messages/:id/resolve", requireAuth, requireSupportOrAdmin, resolveVendorMessageAdmin);
router.patch("/vendor-messages/:id/reopen", requireAuth, requireSupportOrAdmin, reopenVendorMessageAdmin);
router.patch("/vendor-messages/:id/escalate", requireAuth, requireSupportOrAdmin, escalateVendorMessageAdmin);
router.patch("/vendor-messages/:id/unescalate", requireAuth, requireSupportOrAdmin, unescalateVendorMessageAdmin);

// Public - Jumia redirects here directly, no admin auth header on a
// top-level browser redirect (see jumiaAdminController.js).
router.get("/jumia/oauth/callback", jumiaAdmin.adminJumiaOAuthCallback);

router.use(requireAuth, requireAdmin);
router.use("/support", require("./supportAdmin"));

router.get("/stats", getDashboardStats);

// Admin-only reference notes (Samsung Notes-style scratchpad) - see
// adminNotesController.js / migrations/116_admin_notes.sql. Inherits the
// requireAuth + requireAdmin gate above; no staff or vendor access.
router.get("/notes", listNotes);
router.post("/notes", createNote);
router.put("/notes/:id", updateNote);
router.patch("/notes/:id/pin", setNotePinned);
router.patch("/notes/:id/reaction", setNoteReaction);
router.delete("/notes/:id", deleteNote);

// Product-count limit tiers (Jumia Vendor Center comparison, Sept 2026) -
// see adminProductTierController.js.
router.get("/product-tiers", listProductTiers);
router.patch("/product-tiers/:tierCode", updateProductTier);
router.get("/vendors/:id/product-tier", getVendorTierStatus);
router.patch("/vendors/:id/product-tier-override", setVendorTierOverride);

// Fulfillment-by-Lizimas / Consignments (Jumia Vendor Center comparison,
// Sept 2026) - see migrations/110_vendor_consignments.sql /
// adminConsignmentController.js.
router.get("/consignments", listConsignmentsAdmin);
router.post("/consignments/:id/receive", receiveConsignment);
router.post("/consignments/:id/reject", rejectConsignment);

// Manage Pickers (Jumia Vendor Center comparison, Sept 2026) - hub-desk
// lookup only, see adminPickerController.js.
router.get("/pickers/search", searchPickersAdmin);

// Advertise Your Products (Jumia Vendor Center comparison, Sept 2026) - see
// migrations/112_vendor_ad_campaigns.sql.
router.get("/ad-campaigns", listCampaignsAdmin);
router.post("/ad-campaigns/:id/approve", approveCampaign);
router.post("/ad-campaigns/:id/reject", rejectCampaign);
router.patch("/ad-campaigns/:id/paused", setCampaignPausedAdmin);
router.get("/ad-settings", getAdSettingsAdmin);
router.patch("/ad-settings", updateAdSettingsAdmin);
router.get("/visitor-stats", getVisitorStats);

// Cloudflare-style analytics dashboard: accepts either ?start=&end= (custom
// range from the date picker) or ?period=week|month|year (the report tables'
// preset toggle) - see resolveRange() in analyticsController.js.
router.get("/analytics/overview", getAnalyticsOverview);
router.get("/analytics/products", getProductAnalytics);
router.get("/performance/vendors", getVendorPerformanceReport);
router.get("/performance/staff", getStaffPerformanceReport);
router.get("/performance/vendors/:id/pdf", getVendorReportPdf);
router.get("/performance/staff/:id/pdf", getStaffReportPdf);
router.post("/performance/vendors/:id/share", shareVendorReportPdf);
router.post("/performance/staff/:id/share", shareStaffReportPdf);

// Internal staff <-> admin messaging (separate from the customer-facing
// live chat under /api/chat) - admin side.
router.get("/staff-messaging/enabled", getStaffMessagingEnabled);
router.post("/staff-messaging/enabled", setStaffMessagingEnabled);
router.get("/staff-messages/threads", listThreadsForAdmin);
router.get("/staff-messages/threads/:staffUserId", getThreadForAdmin);
router.post("/staff-messages/threads/:staffUserId", replyToThread);
router.post("/staff-messages/threads/:staffUserId/attachment", chatAttachment.single("file"), uploadThreadAttachment);
router.get("/orders", getAllOrdersAdmin);
router.get("/orders/:id/items", getOrderItems);
router.get("/orders/:id/receipt-link", getReceiptLink);
router.get("/customers", getAllCustomers);
router.delete("/customers/:id", deleteCustomer);
router.delete("/customers/:id/permanent", permanentlyDeleteCustomer);
router.patch("/customers/:id/restore", restoreCustomer);

// Staff account creation
router.post("/staff", createStaffAccount);
router.patch("/staff/:id/activate", activateStaffAccount);
router.patch("/staff/:id/block", blockStaffAccount);
router.patch("/staff/:id/force-reset", forcePasswordReset);
router.post("/staff/:id/clear-login-lockout", clearLoginLockout);
router.post("/staff/:id/logout-all", logoutAllDevices);
router.post("/staff/:id/reset-2fa", resetStaff2FA);
router.get("/staff/:id/login-history", getLoginHistory);

// Product approval workflow
router.get("/products/pending", getPendingProducts);
router.patch("/products/:id/approve", approveProduct);
router.patch("/products/:id/reject", rejectProduct);
router.patch("/products/:id/restrict", restrictVendorProduct);
router.patch("/products/:id/unrestrict", unrestrictVendorProduct);

// Deletion requests (from Store Managers)
router.get("/deletion-requests", getDeletionRequests);
router.patch("/deletion-requests/:id/approve", approveDeletionRequest);
router.patch("/deletion-requests/:id/reject", rejectDeletionRequest);

// Trash (soft-deleted products)
router.get("/trash", getTrash);
router.patch("/products/:id/restore", restoreProduct);
router.delete("/products/:id/permanent", permanentlyDeleteProduct);

// Activity log
router.get("/activity-log", getActivityLog);
router.get("/staff-sessions", getStaffSessions);
router.get("/security/logins", getSecurityLogins);
router.post("/security/unlock/:id", unlockAccount);
router.get("/security/reports", getAccountReports);
router.patch("/security/reports/:id", updateAccountReport);
router.patch("/orders/:id/status", updateOrderStatus);

router.post("/products/import", csvUpload.single("file"), require("../controllers/adminController").importProducts);
router.get("/products/export", require("../controllers/adminController").exportProducts);

// Store-level Jumia integration (migration 085) - same Applications
// concept vendors have, scoped to Lizimas's own products so Ryan can push
// the store's own catalogue to Jumia independently of any vendor.
router.get("/jumia/applications", jumiaAdmin.listAdminJumiaApplications);
router.post("/jumia/applications", jumiaAdmin.createAdminJumiaApplication);
router.delete("/jumia/applications/:id", jumiaAdmin.deleteAdminJumiaApplication);
router.post("/jumia/applications/:id/activate", jumiaAdmin.activateAdminJumiaApplication);
router.post("/jumia/applications/:id/connect", jumiaAdmin.connectAdminJumiaApplication);
router.post("/jumia/applications/:id/disconnect", jumiaAdmin.disconnectAdminJumiaApplication);
router.post("/jumia/applications/:id/test", jumiaAdmin.testAdminJumiaApplication);
router.post("/jumia/applications/:id/credentials", jumiaAdmin.setAdminJumiaApplicationCredentials);
router.get("/jumia/applications/:id/authorize", jumiaAdmin.getAdminJumiaAuthorizeUrl);
router.get("/jumia/links", jumiaAdmin.getAdminJumiaLinks);
router.post("/jumia/products/:id/push", jumiaAdmin.pushAdminProductToJumia);
router.post("/jumia/products/push-bulk", jumiaAdmin.pushAdminProductsToJumiaBulk);
router.get("/jumia/remote-products", jumiaAdmin.getAdminJumiaRemoteProducts);
router.post("/jumia/import", jumiaAdmin.importAdminJumiaProducts);

// Vendor fulfilment: drop-off points, handover inspection, returns collection
// Vendor KYC review
router.get("/vendors/pending", getPendingVendors);
router.get("/vendors", getAllVendors);
router.patch("/vendors/:id/approve", approveVendor);
router.patch("/vendors/:id/reject", rejectVendor);
router.patch("/vendors/:id/regenerate-shop-id", regenerateVendorShopId);

// Vendor KYC & Compliance Profile review (Ryan, Sept 2026) - separate
// from vendor approval above: approval means "allowed to sell," KYC
// status means "identity/business registration verified." Admin-only,
// same as the rest of this section - KYC data is more sensitive than
// vendor messages (which customer_support also reaches, above the gate).
router.get("/vendors/kyc", listVendorKycAdmin);
router.get("/vendors/:id/kyc", getVendorKycAdminDetail);
router.patch("/vendors/:id/kyc/review", reviewVendorKycAdmin);
router.patch("/vendors/:id/kyc/ursb", updateVendorUrsbVerification);
router.patch("/vendors/:id/kyc/documents/:documentType/review", reviewVendorKycDocumentAdmin);
router.get("/vendors/:id/kyc/documents/url", getVendorKycDocumentAdmin);

router.get("/brand-authorizations", listBrandAuthorizationsAdmin);
router.get("/brand-authorizations/:id", getBrandAuthorizationAdminDetail);
router.patch("/brand-authorizations/:id/review", reviewBrandAuthorizationAdmin);
router.patch("/brand-authorizations/:id/documents/:documentType/review", reviewBrandAuthDocumentAdmin);
router.get("/brand-authorizations/:id/documents/:documentType/url", getBrandAuthDocumentAdmin);

router.get("/payment-instruments", listPaymentInstrumentsAdmin);
router.patch("/payment-instruments/:id/review", reviewPaymentInstrumentAdmin);
router.get("/payment-instruments/:id/evidence/url", getPaymentInstrumentEvidenceUrlAdmin);

router.get("/prohibited-items", listProhibitedItemsAdmin);
router.post("/prohibited-items", addProhibitedItemAdmin);
router.patch("/prohibited-items/:id", updateProhibitedItemAdmin);
router.delete("/prohibited-items/:id", deleteProhibitedItemAdmin);

// --- Billing Cycles (Phase 4) ---
router.get("/billing/current", getCurrentCycle);
router.post("/billing/ensure-current", ensureCurrentCycle);
router.get("/billing/cycles", listCyclesAdmin);
router.post("/billing/cycles/:id/close", closeCycleAndGenerateStatements);
router.get("/billing/statements", listStatementsAdmin);
router.get("/billing/statements/:id", getStatementDetail);
router.post("/billing/statements/batch-approve", batchApproveStatements);
router.post("/billing/statements/:id/mark-paid", markStatementPaid);
router.post("/billing/statements/:id/reject", rejectStatement);
router.get("/billing/statements/:id/pdf", downloadStatementPdfAdmin);
router.get("/billing/statements/:id/csv", downloadStatementCsvAdmin);

// Vendor Wallet & Payouts (Task #61).
router.get("/vendor-payouts", getVendorPayoutRequests);
router.patch("/vendor-payouts/:id/paid", markVendorPayoutPaid);
router.patch("/vendor-payouts/:id/reject", rejectVendorPayout);
router.get("/vendors/:id/wallet", getVendorWalletAdmin);
router.post("/vendors/:id/ledger-adjustments", createVendorLedgerAdjustment);

// Admin compliance actions against a vendor (Task #63).
router.post("/vendors/:id/warn", warnVendor);
router.patch("/vendors/:id/suspend", suspendVendor);
router.patch("/vendors/:id/reinstate", reinstateVendor);
router.patch("/vendors/:id/freeze-payouts", freezeVendorPayouts);
router.patch("/vendors/:id/unfreeze-payouts", unfreezeVendorPayouts);
router.get("/vendors/:id/compliance-history", getVendorComplianceHistory);
router.get("/vendors/:id/products", getVendorProductsAdmin);

// Vendor Promotions (Task #64): admin review + homepage/sponsored control.
router.get("/vendor-promotions/pending", getPendingVendorPromotions);
router.get("/vendor-promotions/approved", getApprovedVendorPromotions);
router.patch("/vendor-promotions/:id/approve", approveVendorPromotion);
router.patch("/vendor-promotions/:id/reject", rejectVendorPromotion);
router.patch("/vendor-promotions/:id/featured", setVendorPromotionFeatured);
router.patch("/vendor-promotions/:id/sponsored", setVendorPromotionSponsored);

// Vendor-to-Admin Messaging (Task #71): the admin-side merged inbox.


router.get("/dropoff-points", listDropoffPoints);
router.post("/dropoff-points", createDropoffPoint);
router.patch("/dropoff-points/:id", updateDropoffPoint);

router.get("/handovers/pending", getPendingHandovers);
router.patch("/handovers/:orderItemId/accept", acceptHandover);
router.patch("/handovers/:orderItemId/reject", rejectHandover);
router.patch("/handovers/:orderItemId/return", markReturned);

router.get("/returns/pending", getPendingReturns);
router.patch("/returns/:orderItemId/collect", markCollected);
router.patch("/returns/:orderItemId/forfeit", markForfeited);

// Returns & Refunds Center (Task #62): the financial/decision side.
router.get("/returns/refunds/pending", getReturnsAwaitingRefundDecision);
router.get("/returns/refunds/history", getReturnsRefundHistory);
router.post("/returns/:orderItemId/evidence", upload.single("image"), uploadReturnEvidence);
router.patch("/returns/:orderItemId/refund/approve", approveReturnRefund);
router.patch("/returns/:orderItemId/refund/deny", denyReturnRefund);


router.get("/discount-codes", listDiscountCodes);
router.post("/discount-codes/generate-code", generateCode);
router.post("/discount-codes", createDiscountCode);
router.patch("/discount-codes/:id/active", setDiscountCodeActive);
router.delete("/discount-codes/:id", deleteDiscountCode);

router.get("/flash-sales", listFlashSales);
router.get("/flash-sales/:id", getFlashSale);
router.post("/flash-sales", createFlashSale);
router.put("/flash-sales/:id", updateFlashSale);
router.patch("/flash-sales/:id/active", setFlashSaleActive);
router.delete("/flash-sales/:id", deleteFlashSale);

module.exports = router;
