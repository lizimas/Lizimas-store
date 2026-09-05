const express = require("express");
const router = express.Router();

const {
    listActiveDiscountCodesPublic,
    previewDiscountCode
} = require("../controllers/discountController");

// Public: read-only surface for the vendor dashboard's promotions panel
router.get("/active", listActiveDiscountCodesPublic);

// Public: lets the checkout page validate a code before placing the order
router.post("/preview", previewDiscountCode);

module.exports = router;
