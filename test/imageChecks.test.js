const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const Checks = require("../client/js/lz-image-checks");
const { readImageSize, decodePng, preUploadCheck, postUploadCheck } = require("../server/utils/imageChecks");
const { uploadCheckedPhotos } = require("../server/utils/vendorPhotos");

// --- helpers: synthetic photos --------------------------------------------

// A "product": dark shape with fine texture on a white background.
function productPixels(w, h, opts) {
    opts = opts || {};
    const px = Buffer.alloc(w * h * 4);
    let seed = opts.seed || 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inside = x > w * 0.25 && x < w * 0.75 && y > h * 0.2 && y < h * 0.8;
        let v = inside ? (((x >> 2) + (y >> 2)) % 2 ? 40 : 170) + rnd() * 30 : (opts.bg != null ? opts.bg : 255);
        v *= opts.gain || 1;
        px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
        px[i + 3] = 255;
    }
    return opts.blur ? boxBlur(px, w, h, opts.blur) : px;
}
function boxBlur(px, w, h, r) {
    let src = px;
    for (let pass = 0; pass < 3; pass++) {
        const out = Buffer.alloc(src.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let s = 0, n = 0;
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
                s += src[(yy * w + xx) * 4]; n++;
            }
            const i = (y * w + x) * 4; out[i] = out[i + 1] = out[i + 2] = Math.round(s / n); out[i + 3] = 255;
        }
        src = out;
    }
    return src;
}
function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function encodePng(px, w, h) {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const rows = [];
    for (let y = 0; y < h; y++) {
        // alternate filters so the decoder's filter handling is exercised
        const f = y % 5, row = px.subarray(y * w * 4, (y + 1) * w * 4), prev = y ? px.subarray((y - 1) * w * 4, y * w * 4) : Buffer.alloc(w * 4);
        const out = Buffer.alloc(w * 4);
        for (let x = 0; x < w * 4; x++) {
            const a = x >= 4 ? row[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
            const pr = f === 4 ? (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })()
                : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : 0;
            out[x] = (row[x] - pr) & 0xff;
        }
        rows.push(Buffer.from([f]), out);
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
// Fake JPEG with only a SOF0 header (enough for the size reader).
function fakeJpeg(w, h, extra) {
    const app0 = Buffer.from([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const sof = Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    return Buffer.concat([Buffer.from([0xFF, 0xD8]), app0, sof, Buffer.alloc(extra || 0, 7), Buffer.from([0xFF, 0xD9])]);
}

// --- tests -------------------------------------------------------------------

test("reads photo sizes from PNG, JPEG and WebP headers", () => {
    assert.deepEqual(readImageSize(encodePng(productPixels(20, 10), 20, 10)), { type: "png", width: 20, height: 10 });
    assert.deepEqual(readImageSize(fakeJpeg(1200, 900)), { type: "jpeg", width: 1200, height: 900 });
    const vp8x = Buffer.alloc(30); vp8x.write("RIFF", 0); vp8x.write("WEBP", 8); vp8x.write("VP8X", 12);
    vp8x.writeUIntLE(1023, 24, 3); vp8x.writeUIntLE(767, 27, 3);
    assert.deepEqual(readImageSize(vp8x), { type: "webp", width: 1024, height: 768 });
    assert.equal(readImageSize(Buffer.from("not an image at all, sorry")), null);
});

test("PNG decoder round-trips every row filter", () => {
    const px = productPixels(37, 23);
    const d = decodePng(encodePng(px, 37, 23));
    assert.equal(d.width, 37); assert.equal(d.height, 23);
    assert.ok(d.rgba.equals(px));
});

test("sharp photo passes, blurry photo is rejected", () => {
    const sharp = Checks.analyzePixels(productPixels(256, 256), 256, 256);
    const blurry = Checks.analyzePixels(productPixels(256, 256, { blur: 3 }), 256, 256);
    assert.ok(sharp.edge > Checks.RULES.BLUR_WARN, "sharp edge " + sharp.edge);
    assert.ok(blurry.edge < Checks.RULES.BLUR_REJECT, "blurry edge " + blurry.edge);
    assert.equal(Checks.evaluate({ bytes: 1000, width: 1000, height: 1000 }, sharp).ok, true);
    const r = Checks.evaluate({ bytes: 1000, width: 1000, height: 1000 }, blurry);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map(e => e.code), ["blurry"]);
});

test("too dark is rejected; white background is not mistaken for overexposure", () => {
    const dark = Checks.analyzePixels(productPixels(128, 128, { gain: 0.15 }), 128, 128);
    assert.ok(Checks.evaluate({}, dark).errors.some(e => e.code === "too_dark"));
    const clean = Checks.analyzePixels(productPixels(128, 128), 128, 128);
    const ev = Checks.evaluate({}, clean);
    assert.ok(!ev.errors.length && !ev.warnings.some(w => w.code === "bright" || w.code === "background"));
    const washed = Checks.analyzePixels(productPixels(128, 128, { gain: 6 }), 128, 128);
    assert.ok(Checks.evaluate({}, washed).errors.some(e => e.code === "too_bright"));
});

test("busy background and odd shape only warn", () => {
    const busy = Checks.analyzePixels(productPixels(128, 128, { bg: null, seed: 3 }).map((v, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)), 128, 128);
    const ev = Checks.evaluate({ bytes: 10, width: 2400, height: 1000 }, busy);
    assert.ok(ev.warnings.some(w => w.code === "background"));
    assert.ok(ev.warnings.some(w => w.code === "aspect"));
});

test("size, resolution, count and repeated-file rules before upload", () => {
    const small = { originalname: "small.jpg", buffer: fakeJpeg(640, 480), size: 5000 };
    const big = { originalname: "big.jpg", buffer: fakeJpeg(1600, 1600), size: 6 * 1024 * 1024 };
    const ok = { originalname: "ok.jpg", buffer: fakeJpeg(1000, 1000, 10), size: 5000 };
    const r = preUploadCheck([small, big, ok, { ...ok, originalname: "copy.jpg" }], 0);
    assert.equal(r.ok, false);
    const byName = Object.fromEntries(r.errors.map(e => [e.name, e.reasons.map(x => x.code)]));
    assert.deepEqual(byName["small.jpg"], ["low_resolution"]);
    assert.deepEqual(byName["big.jpg"], ["too_large"]);
    assert.deepEqual(byName["copy.jpg"], ["same_file"]);
    // One photo is enough (Oct 2026: the "at least 3" rule was removed).
    assert.equal(preUploadCheck([ok], 0).ok, true);
    assert.equal(preUploadCheck([], 0).countError, "Add at least 1 photo of the product (0 added so far).");
});

test("duplicate photos across listings are flagged as a warning", async () => {
    const png = encodePng(productPixels(96, 96), 96, 96);
    const known = [{ hash: Checks.analyzePixels(productPixels(96, 96), 96, 96).hash, label: "Blue Tee" }];
    const r = await postUploadCheck([{ name: "a.jpg", width: 1000, height: 1000, bytes: 10, previewUrl: "x" }], known,
        { fetchBuffer: async () => png });
    assert.equal(r.ok, true);
    assert.match(r.warnings[0].notes[0].text, /Blue Tee/);
    assert.equal(r.hashes[0], known[0].hash);
});

test("uploadCheckedPhotos: good photos upload; a blurry one is rejected and removed from Cloudinary", async () => {
    const sharpPng = encodePng(productPixels(128, 128, { seed: 1 }), 128, 128);
    const blurPng = encodePng(productPixels(128, 128, { seed: 2, blur: 3 }), 128, 128);
    const destroyed = [];
    const deps = {
        upload: async (buf) => ({ url: "https://cdn/" + buf.length, publicId: "p" + buf.length, width: 1000, height: 1000, bytes: buf.length, previewUrl: buf.length === 111 ? "blur" : "sharp" }),
        destroy: async (id) => { destroyed.push(id); },
        query: async () => ({ rows: [] }),
        fetchBuffer: async (u) => (u === "blur" ? blurPng : sharpPng)
    };
    const f = (n, len) => ({ originalname: n, buffer: Buffer.concat([fakeJpeg(1000, 1000, len)]), size: 1000 });
    const good = await uploadCheckedPhotos([f("1.jpg", 1), f("2.jpg", 2), f("3.jpg", 3)], { existingCount: 0 }, deps);
    assert.equal(good.ok, true); assert.equal(good.urls.length, 3);

    const blurFile = f("blurry.jpg", 111 - fakeJpeg(1000, 1000, 0).length);
    const bad = await uploadCheckedPhotos([f("1.jpg", 1), blurFile, f("3.jpg", 3)], { existingCount: 0 }, deps);
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /Image not accepted/);
    assert.match(bad.body.message, /blurry\.jpg: Image is too blurry/);
    assert.equal(destroyed.length, 3, "every photo from the rejected upload is removed");

    const one = await uploadCheckedPhotos([f("1.jpg", 1)], { existingCount: 0 }, deps);
    assert.equal(one.ok, true, "a single photo is accepted");
});

test("preview that cannot be fetched does not block the vendor", async () => {
    const r = await postUploadCheck([{ name: "a.jpg", width: 1000, height: 1000, bytes: 10, previewUrl: "x" }], [],
        { fetchBuffer: async () => { throw new Error("timeout"); } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.hashes, [null]);
});
