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

module.exports = upload;
