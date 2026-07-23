const express = require("express");
const router = express.Router();

const { authLimiter } = require("../middleware/rateLimiter");

const {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    adminLogin,
    getCurrentUser,
    changePassword,
    changeUsername,
    changeEmail,
    setup2FA,
    verify2FA,
    disable2FA,
    verifyLogin2FA,
    listSessions,
    deleteSession
} = require("./../controllers/authController");

const { requireAuth } = require("../middleware/authMiddleware");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/admin-login", adminLogin);
router.post("/login/2fa", verifyLogin2FA);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", requireAuth, getCurrentUser);

router.patch("/password", requireAuth, changePassword);
router.patch("/username", requireAuth, changeUsername);
router.patch("/email", requireAuth, changeEmail);

router.post("/2fa/setup", requireAuth, setup2FA);
router.post("/2fa/verify", requireAuth, verify2FA);
router.post("/2fa/disable", requireAuth, disable2FA);

router.get("/sessions", requireAuth, listSessions);
router.delete("/sessions/:sessionId", requireAuth, deleteSession);

module.exports = router;
