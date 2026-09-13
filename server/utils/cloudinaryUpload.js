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


// Upload a vendor KYC document (national ID or business registration proof)
// privately - type: "private" means the resulting asset is NOT reachable at
// its plain secure_url like every other upload in this codebase; it can only
// be viewed via a short-lived signed URL minted by privateDocumentViewUrl.
// resource_type "auto" lets Cloudinary route an image through its image
// pipeline and a PDF through "raw" storage, same as uploadChatAttachment.
function uploadPrivateDocument(fileBuffer, originalName, folder = "lizimas-store/vendor-kyc") {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                type: "private",
                resource_type: "auto",
                use_filename: true,
                unique_filename: true,
                filename_override: originalName
            },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    public_id: result.public_id,
                    resource_type: result.resource_type,
                    format: result.format,
                    bytes: result.bytes
                });
            }
        );
        stream.end(fileBuffer);
    });
}

// Mint a short-lived signed URL for viewing a private KYC document. Callers
// must fetch a fresh URL on every view rather than storing this anywhere -
// it expires ~5 minutes after it's generated.
function privateDocumentViewUrl(publicId, resourceType, format) {
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    return cloudinary.utils.private_download_url(publicId, format, {
        resource_type: resourceType || "image",
        type: "private",
        attachment: false,
        expires_at: expiresAt
    });
}

// Best-effort cleanup of a KYC document being replaced by a re-upload.
// Failure here must never block the new upload from being saved, so callers
// should catch/log rather than await-and-throw.
function destroyPrivateDocument(publicId, resourceType) {
    return cloudinary.uploader.destroy(publicId, {
        type: "private",
        resource_type: resourceType || "image"
    });
}

module.exports = { uploadBuffer, uploadChatAttachment, uploadPrivateDocument, privateDocumentViewUrl, destroyPrivateDocument };
