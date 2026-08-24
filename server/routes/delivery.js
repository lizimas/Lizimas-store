const express = require("express");
const router = express.Router();

const { getDeliveryFee, getDistricts, matchLocation, geocodePin } = require("../controllers/deliveryController");

router.get("/fee", getDeliveryFee);
router.get("/districts", getDistricts);
router.post("/match-location", matchLocation);
router.post("/geocode-pin", geocodePin);

module.exports = router;
