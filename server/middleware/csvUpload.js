const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const okExt = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    if (okExt) {
        cb(null, true);
    } else {
        cb(new Error("Only .csv, .xlsx, or .xls files are allowed."));
    }
};

const csvUpload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

module.exports = csvUpload;
