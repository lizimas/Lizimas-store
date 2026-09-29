// Upload a vendor's product photos with the automatic photo checks
// (server/utils/imageChecks.js). Used by addProduct / updateProduct for
// vendor and vendor_staff accounts. Staff and admin uploads skip the checks.
//
// deps (injectable for tests):
//   upload(buffer) -> { url, publicId, width, height, bytes, previewUrl }
//   destroy(publicId) -> Promise
//   query(sql, params) -> { rows }
//   fetchBuffer(url) -> Buffer   (optional, for the preview)
const ImageChecks = require("./imageChecks");

async function knownVendorHashes(query, vendorId, productId) {
    if (!vendorId) return [];
    try {
        const r = await query(
            `SELECT pi.phash AS hash, p.name AS label
               FROM product_images pi JOIN products p ON p.id = pi.product_id
              WHERE p.vendor_id = $1 AND p.deleted_at IS NULL AND pi.phash IS NOT NULL
                AND ($2::int IS NULL OR p.id <> $2::int)`,
            [vendorId, productId || null]
        );
        return r.rows;
    } catch (e) {
        console.warn("Photo duplicate lookup skipped:", e.message);
        return [];
    }
}

// -> { ok: true, urls, hashes, warnings } | { ok: false, status, body }
async function uploadCheckedPhotos(files, opts, deps) {
    files = files || [];
    const pre = ImageChecks.preUploadCheck(files, opts.existingCount || 0);
    if (!pre.ok) return { ok: false, status: 400, body: ImageChecks.rejectionResponse(pre.errors, pre.countError) };
    if (!files.length) return { ok: true, urls: [], hashes: [], warnings: [] };

    const uploaded = await Promise.all(files.map((f) => deps.upload(f.buffer)));
    const known = await knownVendorHashes(deps.query, opts.vendorId, opts.productId);
    const post = await ImageChecks.postUploadCheck(
        uploaded.map((u, i) => ({
            name: files[i].originalname || `Photo ${i + 1}`,
            width: u.width || pre.perFile[i].width,
            height: u.height || pre.perFile[i].height,
            bytes: files[i].size != null ? files[i].size : files[i].buffer.length,
            previewUrl: u.previewUrl
        })),
        known,
        { fetchBuffer: deps.fetchBuffer }
    );
    if (!post.ok) {
        await Promise.all(uploaded.map((u) => u.publicId ? Promise.resolve(deps.destroy(u.publicId)).catch(() => {}) : null));
        return { ok: false, status: 400, body: ImageChecks.rejectionResponse(post.errors, null) };
    }
    return { ok: true, urls: uploaded.map((u) => u.url), hashes: post.hashes, warnings: post.warnings };
}

module.exports = { uploadCheckedPhotos, knownVendorHashes };
