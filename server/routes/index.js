const router = require("express").Router();

const { authLimiter, reportLimiter } = require("../middleware/rateLimiter");

router.use("/auth", authLimiter, require("./auth"));
router.use("/checkout", require("./checkout"));
// New payment module. Serves POST /api/payments and
// GET /api/payments/:id/status, which is what client/js/lz-payment.js calls.
router.use("/payments", require("./checkoutPayment"));
router.use("/admin", require("./admin"));
router.use("/vendors", require("./vendors"));
router.use("/momo", require("./momo"));
router.use("/categories", require("./categories"));
router.use("/promotions", require("./promotions"));
router.use("/chat", require("./chat"));
router.use("/products", require("./products"));
router.use("/variants", require("./variants"));
router.use("/delivery", require("./delivery"));
router.use("/locations", require("./locations"));
router.use("/search", require("./search"));
router.use("/reviews", require("./reviews"));
router.use("/reports", reportLimiter, require("./reports"));

module.exports = router;
