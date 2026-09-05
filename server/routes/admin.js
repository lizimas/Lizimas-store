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
    getActivityLog,
    getStaffSessions
} = require("../controllers/adminController");

const {
    getPendingProducts,
    approveProduct,
    rejectProduct,
    getDeletionRequests,
    approveDeletionRequest,
    rejectDeletionRequest,
    getTrash,
    restoreProduct,
    permanentlyDeleteProduct
} = require("../controllers/productController");

const { createStaffAccount, activateStaffAccount, blockStaffAccount, forcePasswordReset, logoutAllDevices, resetStaff2FA, getLoginHistory } = require("../controllers/authController");

const { requireAuth, requireAdmin } = require("./../middleware/authMiddleware");
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
    markForfeited
} = require("../controllers/fulfilmentController");
const {
    getPendingVendors,
    approveVendor,
    rejectVendor
} = require("../controllers/vendorController");
const csvUpload = require("../middleware/csvUpload");
const { getSecurityLogins, unlockAccount, getAccountReports, updateAccountReport } = require("../controllers/adminController");

router.use(requireAuth, requireAdmin);

router.get("/stats", getDashboardStats);
router.get("/visitor-stats", getVisitorStats);
router.get("/orders", getAllOrdersAdmin);
router.get("/orders/:id/items", getOrderItems);
router.get("/orders/:id/receipt-link", getReceiptLink);
router.get("/customers", getAllCustomers);
router.delete("/customers/:id", deleteCustomer);

// Staff account creation
router.post("/staff", createStaffAccount);
router.patch("/staff/:id/activate", activateStaffAccount);
router.patch("/staff/:id/block", blockStaffAccount);
router.patch("/staff/:id/force-reset", forcePasswordReset);
router.post("/staff/:id/logout-all", logoutAllDevices);
router.post("/staff/:id/reset-2fa", resetStaff2FA);
router.get("/staff/:id/login-history", getLoginHistory);

// Product approval workflow
router.get("/products/pending", getPendingProducts);
router.patch("/products/:id/approve", approveProduct);
router.patch("/products/:id/reject", rejectProduct);

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

// Vendor fulfilment: drop-off points, handover inspection, returns collection
// Vendor KYC review
router.get("/vendors/pending", getPendingVendors);
router.patch("/vendors/:id/approve", approveVendor);
router.patch("/vendors/:id/reject", rejectVendor);

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

module.exports = router;
