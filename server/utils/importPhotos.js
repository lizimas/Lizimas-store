// Photos for products imported from a CSV/Excel file (Sept 2026).
//
// Each row can list photo links in an `images` column (separated by | or new
// lines; the older single `image` column still works). Every link is
// downloaded (server/utils/remoteImage.js), put through the same photo checks
// as the upload form (server/utils/imageChecks.js) and stored on Lizimas'
// own Cloudinary. Photos that fail are reported with the reasons; the rest
// are kept. A row that ends up with fewer than the minimum number of good
// photos is saved as a draft for the vendor to finish in the form.
const crypto = require("crypto");
const ImageChecks = require("./imageChecks");
const Checks = ImageChecks.Checks;

const MAX_LINKS_PER_ROW = 8;

function splitLinks(row) {
    const out = [];
    const add = (v) => String(v == null ? "" : v).split(/[|\n\r;]+/).map((s) => s.trim()).filter(Boolean).forEach((s) => { if (!out.includes(s)) out.push(s); });
    add(row.images);
    add(row.image);
    return out.slice(0, MAX_LINKS_PER_ROW);
}

// links -> { kept:[{url, publicId, hash}], problems:[{link, reasons:[text]}], notes:[{link, notes:[text]}] }
// deps: fetchImage(link), upload(buffer), destroy(publicId), fetchBuffer(previewUrl)
async function importRowPhotos(links, known, deps) {
    const kept = [], problems = [], notes = [];
    const seen = new Set();
    for (const link of links) {
        let img;
        try {
            img = await deps.fetchImage(link);
        } catch (e) {
            problems.push({ link, reasons: [e.message || "could not be downloaded"] });
            continue;
        }
        const sha = crypto.createHash("sha256").update(img.buffer).digest("hex");
        if (seen.has(sha)) { problems.push({ link, reasons: ["same photo as another link in this row"] }); continue; }
        seen.add(sha);
        const size = ImageChecks.readImageSize(img.buffer);
        const pre = Checks.evaluate({ bytes: img.size, width: size && size.width, height: size && size.height }, null);
        if (!pre.ok) { problems.push({ link, reasons: pre.errors.map((e) => e.text) }); continue; }

        let up;
        try {
            up = await deps.upload(img.buffer);
        } catch (e) {
            problems.push({ link, reasons: ["could not be stored - try again later"] });
            continue;
        }
        const post = await ImageChecks.postUploadCheck(
            [{ name: img.name || "photo", width: up.width || size.width, height: up.height || size.height, bytes: img.size, previewUrl: up.previewUrl }],
            (known || []).concat(kept.map((k, i) => ({ hash: k.hash, label: `photo ${i + 1} of this row` }))),
            { fetchBuffer: deps.fetchBuffer }
        );
        if (!post.ok) {
            await Promise.resolve(deps.destroy(up.publicId)).catch(() => {});
            problems.push({ link, reasons: post.errors[0].reasons.map((r) => r.text) });
            continue;
        }
        kept.push({ url: up.url, publicId: up.publicId, hash: post.hashes[0] });
        if (post.warnings.length) notes.push({ link, notes: post.warnings[0].notes.map((n) => n.text) });
    }
    return { kept, problems, notes };
}

// Runs fn over items with at most `limit` running at once.
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    });
    await Promise.all(workers);
    return out;
}

module.exports = { splitLinks, importRowPhotos, mapLimit, MAX_LINKS_PER_ROW };
