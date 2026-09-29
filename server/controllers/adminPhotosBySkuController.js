// Admin › Products › "Photos by SKU" (Sept 2026).
//
// Lizimas' own products imported from a spreadsheet arrive without photos.
// The admin picks a folder of photos named by SKU (e.g. YD-8981/YD-8981_1.jpg,
// YD-8981_2_800x800.jpg ...). The browser groups the files by SKU and sends
// one request per SKU, photos in number order; the first becomes the main
// photo.
//
//  - Only Lizimas' own products (vendor_id IS NULL) are touched - never a
//    vendor's product.
//  - mode "replace" (default) swaps the product's photos for these, so the
//    same folder can be uploaded again when better photos arrive without
//    piling up duplicates. mode "add" appends.
//  - The vendor photo rules don't block the admin's own products; problems
//    (small, blurry, dark...) come back as notes so the admin can decide.
//  - The same photo twice in one upload is stored once.
const crypto = require("crypto");
const pool = require("../config/database");
const ImageChecks = require("../utils/imageChecks");

const MAX_PHOTOS_PER_PRODUCT = 12;

// "YD-8981_2_TOO-SMALL_640x640.jpg" -> { sku: "YD-8981", n: 2 }
// "YD-8981.jpg" -> { sku: "YD-8981", n: 1 };  "YD-8981-3.png" is not split
// (dashes are part of SKUs) - only "_<number>" or " (<number>)" count.
function parsePhotoName(fileName) {
    const base = String(fileName || "").split(/[\\/]/).pop().replace(/\.(jpe?g|png|webp)$/i, "").trim();
    if (!base) return null;
    let m = base.match(/^(.+?)_(\d{1,3})(?:_.*)?$/);
    if (m) return { sku: m[1].trim(), n: Number(m[2]) };
    m = base.match(/^(.+?)\s*\((\d{1,3})\)$/);
    if (m) return { sku: m[1].trim(), n: Number(m[2]) };
    return { sku: base, n: 1 };
}

function defaultDeps() {
    const pc = require("./productController");
    const cloudinary = require("../config/cloudinary");
    return {
        query: (sql, params) => pool.query(sql, params),
        connect: () => pool.connect(),
        upload: pc.uploadBufferWithPreview,
        destroy: (publicId) => cloudinary.uploader.destroy(publicId),
        fetchBuffer: ImageChecks.fetchBuffer
    };
}

// -> { status, body }
async function photosBySku(input, deps) {
    const sku = String(input.sku || "").trim();
    const mode = input.mode === "add" ? "add" : "replace";
    const files = input.files || [];
    if (!sku) return { status: 400, body: { error: "Missing SKU." } };
    if (!files.length) return { status: 400, body: { error: "No photos were sent." } };
    if (files.length > MAX_PHOTOS_PER_PRODUCT) {
        return { status: 400, body: { error: `At most ${MAX_PHOTOS_PER_PRODUCT} photos per product.` } };
    }

    const found = await deps.query(
        `SELECT id, name, vendor_id FROM products WHERE LOWER(sku) = LOWER($1) AND deleted_at IS NULL
         ORDER BY (vendor_id IS NULL) DESC, id ASC`, [sku]);
    const own = found.rows.find((r) => !r.vendor_id);
    if (!own) {
        const vendorOnly = found.rows.length > 0;
        return { status: 404, body: {
            error: vendorOnly ? "vendor_product" : "sku_not_found",
            message: vendorOnly
                ? `SKU ${sku} belongs to a vendor's product - admin can't change its photos.`
                : `No Lizimas product has SKU ${sku}. Import the product sheet first.`
        } };
    }

    // Upload each photo (skipping exact copies), measuring it for notes.
    const kept = [], notes = [], skipped = [];
    const seen = new Set();
    for (const f of files) {
        const name = f.originalname || "photo";
        const sha = crypto.createHash("sha256").update(f.buffer).digest("hex");
        if (seen.has(sha)) { skipped.push({ name, reason: "same photo as another file for this SKU" }); continue; }
        seen.add(sha);
        const size = ImageChecks.readImageSize(f.buffer);
        if (!size) { skipped.push({ name, reason: "not a JPEG, PNG or WebP photo" }); continue; }
        let up;
        try {
            up = await deps.upload(f.buffer);
        } catch (e) {
            skipped.push({ name, reason: "could not be stored - try again" });
            continue;
        }
        const post = await ImageChecks.postUploadCheck(
            [{ name, width: up.width || size.width, height: up.height || size.height, bytes: f.size != null ? f.size : f.buffer.length, previewUrl: up.previewUrl }],
            kept.map((k, i) => ({ hash: k.hash, label: `photo ${i + 1} of this product` })),
            { fetchBuffer: deps.fetchBuffer }
        );
        const why = [];
        post.errors.forEach((e) => e.reasons.forEach((r) => why.push(r.text)));
        post.warnings.forEach((w) => w.notes.forEach((r) => why.push(r.text)));
        if (why.length) notes.push({ name, notes: why });
        kept.push({ name, url: up.url, publicId: up.publicId, hash: post.hashes[0] });
    }
    if (!kept.length) {
        return { status: 400, body: { error: "no_photos_kept", message: `No photo could be added to ${sku}.`, skipped } };
    }

    const client = await deps.connect();
    let removed = [];
    try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [own.id]);
        let start = 0;
        if (mode === "replace") {
            removed = (await client.query("DELETE FROM product_images WHERE product_id = $1 RETURNING image_path", [own.id])).rows;
            await client.query("UPDATE product_colors SET image_path = NULL WHERE product_id = $1", [own.id]).catch(() => {});
        } else {
            start = Number((await client.query(
                "SELECT COALESCE(MAX(display_order), -1) AS m FROM product_images WHERE product_id = $1", [own.id])).rows[0].m) + 1;
            // A product can have up to 20 photos; extra ones are left out.
            const have = Number((await client.query(
                "SELECT COUNT(*)::int AS n FROM product_images WHERE product_id = $1", [own.id])).rows[0].n);
            const room = Math.max(0, 20 - have);
            const extra = kept.splice(room);
            extra.forEach((k) => skipped.push({ name: k.name, reason: "The product already has 20 photos (the most allowed)." }));
            await Promise.all(extra.map((k) => Promise.resolve(deps.destroy(k.publicId)).catch(() => {})));
            if (!kept.length) {
                await client.query("ROLLBACK");
                return { status: 400, body: { error: "no_photos_kept", message: `${sku} already has 20 photos (the most allowed).`, skipped } };
            }
        }
        for (let i = 0; i < kept.length; i++) {
            await client.query(
                "INSERT INTO product_images (product_id, image_path, display_order, phash) VALUES ($1, $2, $3, $4)",
                [own.id, kept[i].url, start + i, kept[i].hash || null]);
        }
        const main = (await client.query(
            `SELECT image_path FROM product_images WHERE product_id = $1
             ORDER BY COALESCE(display_order, 999999) ASC, id ASC LIMIT 1`, [own.id])).rows[0];
        await client.query("UPDATE products SET image = $1 WHERE id = $2", [main ? main.image_path : null, own.id]);
        const total = (await client.query("SELECT COUNT(*)::int AS n FROM product_images WHERE product_id = $1", [own.id])).rows[0].n;
        await client.query("COMMIT");
        return { status: 200, body: {
            product_id: own.id, name: own.name, sku, mode,
            added: kept.length, replaced: removed.length, total, notes, skipped
        } };
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (e2) {}
        await Promise.all(kept.map((k) => Promise.resolve(deps.destroy(k.publicId)).catch(() => {})));
        throw e;
    } finally {
        client.release();
    }
}

exports.parsePhotoName = parsePhotoName;
exports.photosBySku = photosBySku;
exports.MAX_PHOTOS_PER_PRODUCT = MAX_PHOTOS_PER_PRODUCT;

exports.uploadPhotosBySku = async (req, res) => {
    try {
        const out = await photosBySku({ sku: req.body.sku, mode: req.body.mode, files: req.files || [] }, exports._deps || defaultDeps());
        res.status(out.status).json(out.body);
    } catch (e) {
        console.error("photos-by-sku:", e);
        res.status(500).json({ error: "Photos could not be saved - try again." });
    }
};
