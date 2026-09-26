const express = require("express");
const router = express.Router();

const { getActiveFlashSalePublic, getSharedFlashSale } = require("../controllers/flashSaleController");

// Public: the homepage countdown section.
router.get("/active", getActiveFlashSalePublic);
// Public: a campaign opened from the share link copied in the admin panel.
router.get("/share/:token", getSharedFlashSale);

module.exports = router;
