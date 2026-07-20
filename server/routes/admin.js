const express = require("express");
const router = express.Router();

const {
    getDashboardStats,
    getAllOrdersAdmin,
    getOrderItems,
    getAllCustomers,
    updateOrderStatus,
    getVisitorStats
} = require("../controllers/adminController");

const { requireAuth, requireAdmin } = require("./../middleware/authMiddleware");
const csvUpload = require("../middleware/csvUpload");

router.use(requireAuth, requireAdmin);

router.get("/stats", getDashboardStats);
router.get("/visitor-stats", getVisitorStats);
router.get("/orders", getAllOrdersAdmin);
router.get("/orders/:id/items", getOrderItems);
router.get("/customers", getAllCustomers);
router.patch("/orders/:id/status", updateOrderStatus);

router.post("/products/import", csvUpload.single("file"), require("../controllers/adminController").importProducts);
module.exports = router;
