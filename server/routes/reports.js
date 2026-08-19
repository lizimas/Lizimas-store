const router = require("express").Router();
const { createAccountReport } = require("../controllers/reportController");

router.post("/account", createAccountReport);

module.exports = router;
