const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    // Accept on either signal: some pickers (and some desktop browsers) hand us
    // a file with a stripped or unusual extension but a correct mime type.
    const allowedExt = /jpeg|jpg|png|webp/;
    const allowedMime = /^image\/(jpeg|jpg|png|webp)$/;

    const extOk = allowedExt.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowedMime.test((file.mimetype || "").toLowerCase());

    if (extOk || mimeOk) {
        cb(null, true);
    } else {
        const err = new Error("Only .jpeg, .jpg, .png, and .webp image files are allowed.");
        err.code = "INVALID_FILE_TYPE";
        cb(err);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
});

// Promotions only. A slot 4 row tile may carry a short clip instead of a
// still, so this instance accepts video and allows a larger file. Kept
// separate on purpose: the 30MB ceiling must not leak into product, category
// or avatar uploads, which stay at 5MB.
const PROMO_MEDIA_MAX_BYTES = 30 * 1024 * 1024;

const promoMediaFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    const imageOk = /jpeg|jpg|png|webp/.test(ext)
        || /^image\/(jpeg|jpg|png|webp)$/.test(mime);
    // quicktime covers .mov, which is what an iPhone hands over, and what
    // Android sometimes reports for a screen recording.
    const videoOk = /\.(mp4|mov|webm)$/.test(ext)
        || /^video\/(mp4|quicktime|webm)$/.test(mime);

    if (imageOk || videoOk) {
        cb(null, true);
    } else {
        const err = new Error(
            "Upload a .jpg, .png or .webp image, or an .mp4, .mov or .webm video.");
        err.code = "INVALID_FILE_TYPE";
        cb(err);
    }
};

const promoMedia = multer({
    storage,
    fileFilter: promoMediaFilter,
    limits: { fileSize: PROMO_MEDIA_MAX_BYTES }
});

// Staff <-> admin chat attachments. Broader than the image-only instances
// above: covers common document types (PDF, Office docs, plain text) plus
// images, since staff may need to send a delivery note, a receipt photo, or
// a spreadsheet. Kept separate so its wider file-type allowlist can never
// leak into product/category/avatar uploads.
const CHAT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

const chatAttachmentFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    const imageOk = /\.(jpe?g|png|webp|gif)$/.test(ext)
        || /^image\/(jpeg|jpg|png|webp|gif)$/.test(mime);
    const docOk = /\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/.test(ext)
        || /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.|application\/vnd\.ms-excel|text\/plain|text\/csv)/.test(mime);

    if (imageOk || docOk) {
        cb(null, true);
    } else {
        const err = new Error(
            "That file type isn't supported. Try an image, PDF, Word, Excel, PowerPoint, or text file.");
        err.code = "INVALID_FILE_TYPE";
        cb(err);
    }
};

const chatAttachment = multer({
    storage,
    fileFilter: chatAttachmentFilter,
    limits: { fileSize: CHAT_ATTACHMENT_MAX_BYTES }
});

module.exports = upload;
// Attached rather than exported as an object so every existing
// `require("../middleware/upload")` call site keeps working unchanged.
module.exports.promoMedia = promoMedia;
module.exports.PROMO_MEDIA_MAX_BYTES = PROMO_MEDIA_MAX_BYTES;

module.exports.chatAttachment = chatAttachment;
module.exports.CHAT_ATTACHMENT_MAX_BYTES = CHAT_ATTACHMENT_MAX_BYTES;
