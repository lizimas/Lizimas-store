const express = require("express");
const router = express.Router();

const { getDeliveryFee, getDistricts } = require("../controllers/deliveryController");

router.get("/fee", getDeliveryFee);
router.get("/districts", getDistricts);

module.exports = router;
