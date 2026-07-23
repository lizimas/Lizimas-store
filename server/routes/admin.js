const express = require("express");
const router = express.Router();

const {
    getDashboardStats,
    getAllOrdersAdmin,
    getOrderItems,
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

const { createStaffAccount, activateStaffAccount, blockStaffAccount } = require("../controllers/authController");

const { requireAuth, requireAdmin } = require("./../middleware/authMiddleware");
const csvUpload = require("../middleware/csvUpload");

router.use(requireAuth, requireAdmin);

router.get("/stats", getDashboardStats);
router.get("/visitor-stats", getVisitorStats);
router.get("/orders", getAllOrdersAdmin);
router.get("/orders/:id/items", getOrderItems);
router.get("/customers", getAllCustomers);
router.delete("/customers/:id", deleteCustomer);

// Staff account creation
router.post("/staff", createStaffAccount);
router.patch("/staff/:id/activate", activateStaffAccount);
router.patch("/staff/:id/block", blockStaffAccount);

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
router.patch("/orders/:id/status", updateOrderStatus);

router.post("/products/import", csvUpload.single("file"), require("../controllers/adminController").importProducts);
module.exports = router;
