// Pure logic for vendor-to-admin messaging (Task #71) - a minimal
// ticket/thread channel so a vendor can reach admin outside the specific
// structured flows that already exist (return responses, compliance
// notices, promotion proposals). No DB access here - see
// server/controllers/vendorController.js for the DB-touching wrappers
// (createVendorMessage, replyToVendorMessage, and the admin-side
// equivalents) that build these plain inputs from vendor_messages/
// vendor_message_replies rows.

const MAX_SUBJECT_LENGTH = 150;
const MAX_BODY_LENGTH = 2000;
const MESSAGE_STATUSES = ["open", "resolved"];

function isValidMessageSubject(text) {
    return typeof text === "string" && text.trim().length > 0 && text.length <= MAX_SUBJECT_LENGTH;
}

function isValidMessageBody(text) {
    return typeof text === "string" && text.trim().length > 0 && text.length <= MAX_BODY_LENGTH;
}

function isValidMessageStatus(status) {
    return MESSAGE_STATUSES.includes(status);
}

// What a thread's status becomes after a new reply lands on it. A vendor
// replying to a thread admin already marked resolved clearly means the
// issue isn't actually done, so it reopens automatically. An admin reply
// never changes status on its own - resolving/reopening stays a separate,
// explicit admin action, so admin can correct or add context on an
// already-closed thread without it silently reopening under them.
function deriveStatusAfterReply(currentStatus, senderRole) {
    if (senderRole === "vendor" && currentStatus === "resolved") return "open";
    return currentStatus;
}

module.exports = {
    MAX_SUBJECT_LENGTH,
    MAX_BODY_LENGTH,
    MESSAGE_STATUSES,
    isValidMessageSubject,
    isValidMessageBody,
    isValidMessageStatus,
    deriveStatusAfterReply
};
