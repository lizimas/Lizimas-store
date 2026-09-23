import shutil, datetime, sys

path = "server/utils/cloudinaryUpload.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''// Mint a short-lived signed URL for viewing a private KYC document. Callers
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
}'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''// Mint a short-lived signed URL for viewing (or, with attachment=true,
// downloading - Ryan, record-keeping requirement) a private KYC document.
// Callers must fetch a fresh URL on every view rather than storing this
// anywhere - it expires ~5 minutes after it's generated. attachment=true
// makes Cloudinary itself send Content-Disposition: attachment, which is
// the only reliable way to force a download for a cross-origin URL like
// this one - a plain HTML download attribute is silently ignored here.
function privateDocumentViewUrl(publicId, resourceType, format, attachment = false) {
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    return cloudinary.utils.private_download_url(publicId, format, {
        resource_type: resourceType || "image",
        type: "private",
        attachment,
        expires_at: expiresAt
    });
}'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
