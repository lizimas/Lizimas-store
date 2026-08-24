const express = require("express");
const router = express.Router();

const { getDeliveryFee, getDistricts, matchLocation } = require("../controllers/deliveryController");

router.get("/fee", getDeliveryFee);
router.get("/districts", getDistricts);
router.post("/match-location", matchLocation);

module.exports = router;
