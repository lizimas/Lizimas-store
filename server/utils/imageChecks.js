// Server side of the vendor photo checks (Ryan, Sept 2026). The rules live
// in client/js/lz-image-checks.js so the browser and server always agree.
//
// Two stages, no image libraries needed:
//  1. Before upload, from the raw file: size, resolution (read from the
//     JPEG/PNG/WebP header), exact duplicates, and the photo count.
//  2. After upload: Cloudinary makes a small PNG copy during the upload
//     (eager transformation); we decode it with Node's zlib and measure
//     blur, brightness and background, plus a perceptual hash for
//     duplicate detection. If that copy can't be fetched, stage 2 is
//     skipped (the browser already ran the same checks) rather than
//     blocking the vendor on a network hiccup.
const zlib = require("zlib");
const crypto = require("crypto");
const Checks = require("../../client/js/lz-image-checks");

// --- Image header sizes --------------------------------------------------

function readImageSize(buf) {
    if (!buf || buf.length < 24) return null;
    // PNG
    if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
        return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // JPEG: walk the segments to the first SOFn marker.
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
        let i = 2;
        while (i + 9 < buf.length) {
            if (buf[i] !== 0xFF) { i++; continue; }
            const marker = buf[i + 1];
            if (marker === 0xFF) { i++; continue; }
            if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
            const len = buf.readUInt16BE(i + 2);
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                return { type: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
            }
            i += 2 + len;
        }
        return null;
    }
    // WebP
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
        const chunk = buf.toString("ascii", 12, 16);
        if (chunk === "VP8X" && buf.length >= 30) {
            return { type: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        }
        if (chunk === "VP8 " && buf.length >= 30) {
            return { type: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        }
        if (chunk === "VP8L" && buf.length >= 25) {
            const b = buf.readUInt32LE(21);
            return { type: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
        }
    }
    return null;
}

// --- Minimal PNG decoder (8/16-bit, non-interlaced) ----------------------

function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buf) {
    if (!(buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG")) throw new Error("not a PNG");
    let pos = 8, width, height, depth, colorType, interlace, palette = null, trns = null;
    const idat = [];
    while (pos + 8 <= buf.length) {
        const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === "IHDR") {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            depth = data[8]; colorType = data[9]; interlace = data[12];
        } else if (type === "PLTE") palette = data;
        else if (type === "tRNS") trns = data;
        else if (type === "IDAT") idat.push(data);
        else if (type === "IEND") break;
        pos += 12 + len;
    }
    if (!width || !height) throw new Error("PNG has no size");
    if (interlace) throw new Error("interlaced PNG not supported");
    if (depth !== 8 && depth !== 16) throw new Error("PNG bit depth " + depth + " not supported");
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new Error("PNG colour type " + colorType + " not supported");
    const bpp = channels * (depth / 8);
    const stride = width * bpp;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const out = Buffer.alloc(width * height * 4);
    let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const off = y * (stride + 1), filter = raw[off];
        for (let x = 0; x < stride; x++) {
            const v = raw[off + 1 + x], a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
            cur[x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b
                : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
        }
        for (let x = 0; x < width; x++) {
            const s = x * bpp, d = (y * width + x) * 4, step = depth / 8;
            const ch = (k) => cur[s + k * step];
            if (colorType === 0) { out[d] = out[d + 1] = out[d + 2] = ch(0); out[d + 3] = 255; }
            else if (colorType === 2) { out[d] = ch(0); out[d + 1] = ch(1); out[d + 2] = ch(2); out[d + 3] = 255; }
            else if (colorType === 3) {
                const idx = cur[s]; out[d] = palette[idx * 3]; out[d + 1] = palette[idx * 3 + 1]; out[d + 2] = palette[idx * 3 + 2];
                out[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
            }
            else if (colorType === 4) { out[d] = out[d + 1] = out[d + 2] = ch(0); out[d + 3] = ch(1); }
            else { out[d] = ch(0); out[d + 1] = ch(1); out[d + 2] = ch(2); out[d + 3] = ch(3); }
        }
        [prev, cur] = [cur, prev];
    }
    // Transparent pixels count as white, the way the storefront shows them.
    for (let i = 0; i < out.length; i += 4) {
        const al = out[i + 3] / 255;
        if (al < 1) { for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * al + 255 * (1 - al)); out[i + 3] = 255; }
    }
    return { width, height, rgba: out };
}

// --- Stage 1: before upload ----------------------------------------------

// files: multer files. existingCount: photos the product keeps.
// -> { ok, count, errors:[{name, reasons}], perFile:[{name, width, height, sha}] }
function preUploadCheck(files, existingCount) {
    const perFile = [], errors = [];
    const seen = new Map();
    for (const f of files || []) {
        const size = readImageSize(f.buffer);
        const sha = crypto.createHash("sha256").update(f.buffer).digest("hex");
        const info = { bytes: f.size != null ? f.size : f.buffer.length, width: size && size.width, height: size && size.height };
        const res = Checks.evaluate(info, null);
        const reasons = res.errors.slice();
        if (seen.has(sha)) reasons.push({ code: "same_file", text: `Same photo as ${seen.get(sha)} - each photo should show something new` });
        else seen.set(sha, f.originalname || "another photo");
        if (reasons.length) errors.push({ name: f.originalname || "photo", reasons });
        perFile.push({ name: f.originalname, width: info.width, height: info.height, sha });
    }
    const count = (existingCount || 0) + (files ? files.length : 0);
    const countError = Checks.countMessage(count);
    return { ok: !errors.length && !countError, count, countError, errors, perFile };
}

// --- Stage 2: after upload -----------------------------------------------

const PREVIEW_TRANSFORM = { width: Checks.RULES.ANALYSIS_SIZE, height: Checks.RULES.ANALYSIS_SIZE, crop: "limit", format: "png" };

async function fetchBuffer(url, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 8000);
    try {
        const r = await fetch(url, { signal: ctl.signal });
        if (!r.ok) throw new Error("preview HTTP " + r.status);
        return Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
}

// uploaded: [{ name, width, height, bytes, previewUrl }]
// known: [{ hash, label }] photos already on the vendor's other products.
// -> { ok, errors:[{name, reasons}], warnings:[{name, notes}], hashes:[hash|null] }
async function postUploadCheck(uploaded, known, opts) {
    opts = opts || {};
    const fetcher = opts.fetchBuffer || fetchBuffer;
    const errors = [], warnings = [], hashes = [];
    const batch = [];
    for (const u of uploaded) {
        let metrics = null;
        if (u.previewUrl) {
            try {
                const png = decodePng(await fetcher(u.previewUrl));
                metrics = Checks.analyzePixels(png.rgba, png.width, png.height);
            } catch (e) {
                console.warn("Photo check preview skipped:", e.message);
            }
        }
        const res = Checks.evaluate({ bytes: u.bytes, width: u.width, height: u.height }, metrics);
        const notes = res.warnings.slice();
        if (metrics) {
            const dupOther = Checks.findDuplicate(metrics.hash, known);
            if (dupOther) notes.push({ code: "duplicate", text: `Looks the same as a photo already used on "${dupOther.label}"` });
            const dupHere = Checks.findDuplicate(metrics.hash, batch);
            if (dupHere) notes.push({ code: "duplicate", text: `Looks the same as ${dupHere.label} in this upload` });
            batch.push({ hash: metrics.hash, label: u.name || "another photo" });
        }
        hashes.push(metrics ? metrics.hash : null);
        if (res.errors.length) errors.push({ name: u.name, reasons: res.errors });
        if (notes.length) warnings.push({ name: u.name, notes });
    }
    return { ok: !errors.length, errors, warnings, hashes };
}

function rejectionResponse(errors, countError) {
    const lines = [];
    errors.forEach((e) => e.reasons.forEach((r) => lines.push(`${e.name}: ${r.text}`)));
    if (countError) lines.push(countError);
    const onlyCount = !errors.length && countError;
    return {
        error: "image_rejected",
        message: onlyCount ? "❌ Product not submitted\n\n" + countError : Checks.rejectionText(lines),
        images: errors,
        count_error: countError || null
    };
}

module.exports = { readImageSize, decodePng, preUploadCheck, postUploadCheck, rejectionResponse, PREVIEW_TRANSFORM, Checks, fetchBuffer };
