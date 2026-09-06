const express = require("express");
const router = express.Router();

const { trackCartAdd } = require("../controllers/analyticsController");

// Public, unauthenticated (an anonymous shopper can add to cart without
// logging in). Fire-and-forget from cart.js addToCart() - see that function
// for why this must never block or surface an error to the shopper.
router.post("/cart-add", trackCartAdd);

module.exports = router;
