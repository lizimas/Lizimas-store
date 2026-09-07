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

// Upload an arbitrary attachment (image, PDF, Office doc, plain text) for
// the staff<->admin chat. resource_type "auto" lets Cloudinary route images
// through its image pipeline and everything else through "raw" storage, and
// use_filename/unique_filename keeps the original name recognisable in the
// resulting URL while still avoiding collisions between two people sending
// a file called "receipt.pdf" on the same day.
function uploadChatAttachment(fileBuffer, originalName, folder = "lizimas-store/staff-messages") {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: "auto",
                use_filename: true,
                unique_filename: true,
                filename_override: originalName
            },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    url: result.secure_url,
                    bytes: result.bytes,
                    public_id: result.public_id,
                    format: result.format
                });
            }
        );
        stream.end(fileBuffer);
    });
}

module.exports = { uploadBuffer, uploadChatAttachment };
