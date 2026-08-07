const express = require("express");
const router = express.Router();


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
    requestEmail2FACode,
    listSessions,
    deleteSession,
    getProfile,
    updateProfile,
    uploadProfilePhoto,
    removeProfilePhoto
} = require("./../controllers/authController");

const { loginLimiter, otpLimiter } = require("../middleware/rateLimiter");
const { requireAuth, requireAuthOrSetup } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

router.post("/register", registerUser);
router.post("/login", loginLimiter, loginUser);
router.post("/admin-login", loginLimiter, adminLogin);
router.post("/login/2fa", otpLimiter, verifyLogin2FA);
router.post("/login/2fa/email", otpLimiter, requestEmail2FACode);
router.post("/complete-forced-reset", completeForcedPasswordReset);
router.post("/forgot-password", otpLimiter, forgotPassword);
router.post("/reset-password", otpLimiter, resetPassword);
router.get("/me", requireAuth, getCurrentUser);

router.patch("/password", requireAuth, changePassword);
router.patch("/username", requireAuth, changeUsername);
router.patch("/email", requireAuth, changeEmail);

router.post("/2fa/setup", requireAuthOrSetup, setup2FA);
router.post("/2fa/verify", requireAuthOrSetup, verify2FA);
router.post("/2fa/disable", requireAuth, disable2FA);

router.get("/sessions", requireAuth, listSessions);
router.delete("/sessions/:sessionId", requireAuth, deleteSession);

router.get("/profile", requireAuth, getProfile);
router.patch("/profile", requireAuth, updateProfile);
router.post(
    "/profile/photo",
    requireAuth,
    upload.fields([{ name: "photo", maxCount: 1 }, { name: "original_photo", maxCount: 1 }]),
    uploadProfilePhoto
);
router.delete("/profile/photo", requireAuth, removeProfilePhoto);

module.exports = router;
