const express = require("express");
const router = express.Router();

const { checkout, getMyOrders } = require("../controllers/checkoutController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/", checkout);
router.get("/my-orders", requireAuth, getMyOrders);

module.exports = router;
