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
const { googleSignIn, googleCallback, facebookSignIn, facebookCallback, facebookDataDeletion } = require("../controllers/oauthController");

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

// Facebook Login. Token-mode entry point (FB JS SDK's FB.login(), when it
// works) - kept for callers that can use it, but redirect-mode below is now
// what login.js actually drives, since the popup flow breaks silently in
// browsers that block third-party cookies.
router.post("/oauth/facebook", loginLimiter, facebookSignIn);

// Redirect mode. Facebook's own servers 302 the browser here with ?code&state
// after the user approves on facebook.com, so this is a first-party GET
// navigation, not a cross-site request - no urlencoded parser or CORS carve-out
// needed, unlike Google's form-POST callback above.
router.get("/oauth/facebook/callback", loginLimiter, facebookCallback);

// Meta's data-deletion callback - called by Facebook's own servers, not a
// browser, so it needs the urlencoded parser for the same reason the Google
// callback above does (Meta POSTs signed_request as a form field), and no
// login rate limiter (it is not a login attempt and is not attacker-facing
// in the same way; the signature check in parseSignedRequest is what
// actually gates it).
router.post(
    "/oauth/facebook/deauthorize",
    require("express").urlencoded({ extended: false }),
    facebookDataDeletion
);

// Meta's app-settings form validates this URL by visiting it directly (a
// plain GET, not the signed POST Facebook's platform actually sends) before
// it will save the field - so without this, saving the Data Deletion URL in
// the dashboard fails with "should represent a valid URL" even though the
// real callback above is correct. This just proves the endpoint exists.
router.get("/oauth/facebook/deauthorize", (req, res) => {
    res.status(200).json({ ok: true });
});
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
