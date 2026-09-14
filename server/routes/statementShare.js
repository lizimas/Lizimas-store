// Phase 4 - public share route for vendor statements.
//
// Anybody with a valid, unexpired, unrevoked share token can view the
// PDF of a single statement. No authentication - the token IS the
// credential. Mounted at /api/statements/share/:token.
//
// Rate-limited to avoid a brute-force scan of the 256-bit token space
// (practically impossible, but cheap insurance).

const express = require("express");
const router = express.Router();
const { serveSharedStatement } = require("../controllers/billingController");

router.get("/share/:token", serveSharedStatement);

module.exports = router;
