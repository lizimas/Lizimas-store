const express = require("express");
const router = express.Router();

const {
    getDashboardStats,
    getAllOrdersAdmin,
    getOrderItems,
    getAllCustomers,
    updateOrderStatus
} = require("../controllers/adminController");

const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

router.use(requireAuth, requireAdmin);

router.get("/stats", getDashboardStats);
router.get("/orders", getAllOrdersAdmin);
router.get("/orders/:id/items", getOrderItems);
router.get("/customers", getAllCustomers);
router.patch("/orders/:id/status", updateOrderStatus);

module.exports = router;
