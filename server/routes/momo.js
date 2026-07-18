const express = require("express");
const router = express.Router();

const { initiateMomoPayment, getMomoPaymentStatus } = require("../controllers/momoController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/pay", requireAuth, initiateMomoPayment);
router.get("/status/:referenceId", requireAuth, getMomoPaymentStatus);

module.exports = router;
