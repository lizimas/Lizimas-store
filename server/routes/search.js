const express = require("express");
const router = express.Router();

const { logSearch, getSearchStats } = require("../controllers/searchController");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");

router.post("/log", logSearch);
router.get("/stats", requireAuth, requireAdmin, getSearchStats);

module.exports = router;
