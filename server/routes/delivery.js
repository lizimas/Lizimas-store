const express = require("express");
const router = express.Router();

const { getDeliveryFee } = require("../controllers/deliveryController");

router.get("/fee", getDeliveryFee);

module.exports = router;
