const express = require("express");
const router = express.Router();

const { authLimiter } = require("../middleware/rateLimiter");

const { registerUser, loginUser, getCurrentUser } = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", requireAuth, getCurrentUser);

module.exports = router;
