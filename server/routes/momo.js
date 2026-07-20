const express = require("express");
const router = express.Router();

const { initiateMomoPayment, getMomoPaymentStatus } = require("../controllers/momoController");
const { optionalAuth } = require("../middleware/authMiddleware");

router.post("/pay", optionalAuth, initiateMomoPayment);
router.get("/status/:referenceId", optionalAuth, getMomoPaymentStatus);

module.exports = router;
