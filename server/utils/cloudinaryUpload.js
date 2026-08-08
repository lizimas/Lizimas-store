const cloudinary = require("../config/cloudinary");

// Upload a file buffer to Cloudinary. Resolves with the secure URL plus the
// natural dimensions, which callers need to reserve layout space before load.
function uploadBuffer(fileBuffer, folder = "lizimas-store/products") {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    url: result.secure_url,
                    width: result.width,
                    height: result.height,
                    public_id: result.public_id,
                    bytes: result.bytes
                });
            }
        );
        stream.end(fileBuffer);
    });
}

module.exports = { uploadBuffer };
