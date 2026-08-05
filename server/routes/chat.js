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
    updateConversation
} = require("../controllers/chatController");

const {
    requireAuth,
    optionalAuth,
    requireSupportOrAdmin
} = require("../middleware/authMiddleware");

// Public / guest. optionalAuth attaches req.user when a token is present and
// carries on when it is not, so the same handlers serve guests and customers.
//
// TODO: apply the PostgresStore rate limiter to the two write routes below.
// They are open endpoints and a guest needs no credentials to reach them.
router.post("/start", optionalAuth, startConversation);
router.get("/:id/messages", optionalAuth, getMessages);
router.post("/:id/messages", optionalAuth, postMessage);
router.post("/:id/read", optionalAuth, markCustomerRead);

// Staff inbox. Declared after the public routes but on distinct paths, so
// "/conversations" can never be swallowed by "/:id".
router.get("/conversations", requireAuth, requireSupportOrAdmin, listConversations);
router.get("/conversations/:id", requireAuth, requireSupportOrAdmin, getConversationForStaff);
router.post("/conversations/:id/messages", requireAuth, requireSupportOrAdmin, postStaffMessage);
router.patch("/conversations/:id", requireAuth, requireSupportOrAdmin, updateConversation);

module.exports = router;
