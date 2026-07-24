const express = require("express");
const router = express.Router();

const { authLimiter } = require("../middleware/rateLimiter");

const {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    completeForcedPasswordReset,
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
    deleteSession,
    getProfile,
    updateProfile,
    uploadProfilePhoto,
    removeProfilePhoto
} = require("./../controllers/authController");

const { requireAuth } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/admin-login", adminLogin);
router.post("/login/2fa", verifyLogin2FA);
router.post("/complete-forced-reset", completeForcedPasswordReset);
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

router.get("/profile", requireAuth, getProfile);
router.patch("/profile", requireAuth, updateProfile);
router.post("/profile/photo", requireAuth, upload.single("photo"), uploadProfilePhoto);
router.delete("/profile/photo", requireAuth, removeProfilePhoto);

module.exports = router;
