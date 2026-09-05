const express = require("express");
const router = express.Router();

const { getActiveFlashSalePublic } = require("../controllers/flashSaleController");

// Public: the homepage countdown section.
router.get("/active", getActiveFlashSalePublic);

module.exports = router;
