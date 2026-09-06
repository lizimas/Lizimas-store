const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const {
    getMyThread,
    sendMyMessage,
    getMyStatus
} = require("../controllers/staffMessagesController");

// Internal staff <-> admin messaging, staff side. Always scoped to the
// caller's own thread inside the controller (req.user.id) - there is no
// :staffUserId param here, so a staff member can never address anyone
// else's conversation. Role check (product_staff/store_manager/
// customer_support) also lives in the controller since a couple of
// differently-shaped role checks already exist across this codebase.
router.get("/status", requireAuth, getMyStatus);
router.get("/mine", requireAuth, getMyThread);
router.post("/mine", requireAuth, sendMyMessage);

module.exports = router;
