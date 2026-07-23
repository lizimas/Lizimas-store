const express = require("express");
const router = express.Router();

const { checkout, getMyOrders, trackOrder } = require("../controllers/checkoutController");
const { requireAuth, optionalAuth } = require("../middleware/authMiddleware");

router.post("/", optionalAuth, checkout);
router.get("/my-orders", requireAuth, getMyOrders);
router.get("/track", trackOrder);

module.exports = router;
