const router = require("express").Router();

const { authLimiter, reportLimiter } = require("../middleware/rateLimiter");

router.use("/auth", authLimiter, require("./auth"));
router.use("/checkout", require("./checkout"));
router.use("/admin", require("./admin"));
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
