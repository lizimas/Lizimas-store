// Advertise Your Products (Jumia Vendor Center comparison, Sept 2026) -
// public sponsored-product API. See adTrackingController.js /
// migrations/112_vendor_ad_campaigns.sql.

const router = require("express").Router();
const { getSponsoredProducts, trackAdClick } = require("../controllers/adTrackingController");

router.get("/sponsored-products", getSponsoredProducts);
router.post("/track-click", trackAdClick);

module.exports = router;
