const router = require("express").Router();

const { authLimiter } = require("../middleware/rateLimiter");

router.use("/auth", authLimiter, require("./auth"));
router.use("/checkout", require("./checkout"));
router.use("/admin", require("./admin"));
router.use("/momo", require("./momo"));
router.use("/categories", require("./categories"));
router.use("/promotions", require("./promotions"));
router.use("/products", require("./products"));
router.use("/variants", require("./variants"));
router.use("/delivery", require("./delivery"));
router.use("/search", require("./search"));
router.use("/reviews", require("./reviews"));

module.exports = router;
