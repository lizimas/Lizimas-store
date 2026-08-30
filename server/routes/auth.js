const express = require("express");
const router = express.Router();


const {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    completeForcedPasswordReset,
    adminLogin,
    staffLogin,
    getCurrentUser,
    changePassword,
    changeUsername,
    changeEmail,
    setup2FA,
    verify2FA,
    disable2FA,
    verifyLogin2FA,
    requestEmail2FACode,
    getDeviceRequestStatus,
    getDeviceRequestDetails,
    decideDeviceRequestHandler,
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
const { googleSignIn, googleCallback } = require("../controllers/oauthController");

router.post("/login", loginLimiter, loginUser);
router.post("/admin-login", loginLimiter, adminLogin);
router.post("/staff-login", loginLimiter, staffLogin);
router.post("/login/2fa", otpLimiter, verifyLogin2FA);

// Federated sign-in. Same rate limiter as password login: the endpoint is
// public and unauthenticated, so it needs the same protection.
router.post("/oauth/google", loginLimiter, googleSignIn);

// Redirect mode. Google form-POSTs here, so this route needs a urlencoded
// parser: the app mounts express.json() only. Cross-site by construction,
// which is why the CSRF double-submit inside googleCallback is not optional.
router.post(
    "/oauth/google/callback",
    loginLimiter,
    require("express").urlencoded({ extended: false }),
    googleCallback
);
router.post("/login/2fa/email", otpLimiter, requestEmail2FACode);

// Device approval (phase 4c). No auth: the tokens are the credential.
router.get("/device-request/:ref/status", getDeviceRequestStatus);
router.get("/device-request", getDeviceRequestDetails);
router.post("/device-request/decide", otpLimiter, decideDeviceRequestHandler);
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
