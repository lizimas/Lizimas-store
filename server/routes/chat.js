const express = require("express");
const router = express.Router();

const {
    startConversation,
    getMessages,
    postMessage,
    markCustomerRead,
    listConversations,
    getConversationForStaff,
    postStaffMessage,
    updateConversation,
    setAvailability,
    heartbeat,
    getAvailability
} = require("../controllers/chatController");

const {
    requireAuth,
    optionalAuth,
    requireSupportOrAdmin
} = require("../middleware/authMiddleware");

const {
    chatStartLimiter,
    chatMessageLimiter,
    chatPollLimiter
} = require("../middleware/rateLimiter");

// Public / guest. optionalAuth attaches req.user when a token is present and
// carries on when it is not, so the same handlers serve guests and customers.
//
// The two write routes are open endpoints - a guest needs no credentials to
// reach them - so both carry PostgresStore-backed limiters. The poll route
// uses a memory-backed limiter instead: it fires every few seconds per open
// widget, and a DB write per poll would cost more than the protection is worth.
router.post("/start", chatStartLimiter, optionalAuth, startConversation);
router.get("/:id/messages", chatPollLimiter, optionalAuth, getMessages);
router.post("/:id/messages", chatMessageLimiter, optionalAuth, postMessage);
router.post("/:id/read", chatPollLimiter, optionalAuth, markCustomerRead);

// Staff inbox. Declared after the public routes but on distinct paths, so
// "/conversations" can never be swallowed by "/:id".
router.get("/conversations", requireAuth, requireSupportOrAdmin, listConversations);
router.get("/conversations/:id", requireAuth, requireSupportOrAdmin, getConversationForStaff);
router.post("/conversations/:id/messages", requireAuth, requireSupportOrAdmin, postStaffMessage);
router.patch("/conversations/:id", requireAuth, requireSupportOrAdmin, updateConversation);

// Presence. Distinct single-segment paths, so none of these collide with the
// public "/:id" routes above.
router.get("/availability", requireAuth, requireSupportOrAdmin, getAvailability);
router.post("/availability", requireAuth, requireSupportOrAdmin, setAvailability);
router.post("/heartbeat", requireAuth, requireSupportOrAdmin, heartbeat);

module.exports = router;
