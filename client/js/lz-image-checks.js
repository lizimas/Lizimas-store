// Automatic photo checks for vendor product uploads (Ryan, Sept 2026).
//
// One set of rules for the browser (instant feedback when a vendor picks a
// photo) and the server (the same rules enforced on upload), so the two can
// never disagree. Works in Node (require) and the browser (window.LzImageChecks).
//
// Checks: file size, minimum resolution, blur, too dark / too bright,
// aspect ratio, clean background, duplicates, and the minimum photo count.
// Watermark and face detection need an AI vision service and are not here.
//
// Pixel measurements run on a copy scaled so its longest side is at most
// ANALYSIS_SIZE, so a phone's 4000px photo and a 900px photo are judged
// on the same footing. Thresholds were set against real product photos.
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LzImageChecks = api;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const RULES = {
        MIN_IMAGES: 3,
        MAX_BYTES: 5 * 1024 * 1024,
        MIN_SIDE: 800,              // both width and height, in pixels
        ANALYSIS_SIZE: 512,
        BLUR_REJECT: 25,            // edge strength below this = blurry
        BLUR_WARN: 45,              // below this = a little soft
        DARK_REJECT: 40,            // average brightness (0-255)
        DARK_WARN: 70,
        BRIGHT_WARN: { mean: 235, p2: 160 },    // washed out: bright AND nothing dark left
        BRIGHT_REJECT: { mean: 245, p2: 200 },
        ASPECT_WARN: 1.5,           // longest side / shortest side
        BG_WHITE_MIN: 0.6,          // share of the border that is white
        BG_UNIFORM_STD: 12,         // or: border is one plain colour
        DUPLICATE_DISTANCE: 6       // of 64 bits, perceptual hash
    };

    // --- Pixel measurements -------------------------------------------------

    function toGray(rgba, w, h) {
        const g = new Float32Array(w * h);
        for (let i = 0, j = 0; i < g.length; i++, j += 4) {
            g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
        }
        return g;
    }

    // Mean of the strongest 1% of Laplacian responses. Unlike the plain
    // Laplacian variance this doesn't fall when a sharp product sits on a
    // large plain background.
    function edgeStrength(gray, w, h) {
        if (w < 3 || h < 3) return 0;
        const hist = new Uint32Array(1021); // |laplacian| is at most 4*255
        let n = 0;
        for (let y = 1; y < h - 1; y++) {
            const r = y * w;
            for (let x = 1; x < w - 1; x++) {
                const i = r + x;
                const v = Math.abs(gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i]);
                hist[Math.min(1020, Math.round(v))]++;
                n++;
            }
        }
        let want = Math.max(1, Math.floor(n * 0.01));
        let sum = 0, taken = 0;
        for (let v = 1020; v >= 0 && taken < want; v--) {
            const c = Math.min(hist[v], want - taken);
            sum += c * v; taken += c;
        }
        return taken ? sum / taken : 0;
    }

    function brightness(gray) {
        const hist = new Uint32Array(256);
        let total = 0;
        for (let i = 0; i < gray.length; i++) { const v = Math.max(0, Math.min(255, Math.round(gray[i]))); hist[v]++; total += gray[i]; }
        let p2 = 0, acc = 0; const target = gray.length * 0.02;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { p2 = v; break; } }
        return { mean: gray.length ? total / gray.length : 0, p2 };
    }

    // Outer 6% ring of the photo: how much of it is white, and how plain it is.
    function background(rgba, w, h) {
        const band = Math.max(1, Math.round(Math.min(w, h) * 0.06));
        let count = 0, white = 0, sum = 0, sumSq = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (x >= band && y >= band && x < w - band && y < h - band) continue;
                const j = (y * w + x) * 4;
                const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
                const l = 0.299 * r + 0.587 * g + 0.114 * b;
                if (l >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) white++;
                sum += l; sumSq += l * l; count++;
            }
        }
        const mean = count ? sum / count : 0;
        return { whiteShare: count ? white / count : 0, std: count ? Math.sqrt(Math.max(0, sumSq / count - mean * mean)) : 0 };
    }

    // 64-bit difference hash, as 16 hex characters.
    function dHash(gray, w, h) {
        const cols = 9, rows = 8, cells = new Float32Array(cols * rows);
        for (let cy = 0; cy < rows; cy++) {
            const y0 = Math.floor(cy * h / rows), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * h / rows));
            for (let cx = 0; cx < cols; cx++) {
                const x0 = Math.floor(cx * w / cols), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * w / cols));
                let s = 0, n = 0;
                for (let y = y0; y < y1 && y < h; y++) for (let x = x0; x < x1 && x < w; x++) { s += gray[y * w + x]; n++; }
                cells[cy * cols + cx] = n ? s / n : 0;
            }
        }
        let hex = "";
        for (let cy = 0; cy < rows; cy++) {
            let byte = 0;
            for (let cx = 0; cx < 8; cx++) byte = (byte << 1) | (cells[cy * cols + cx] > cells[cy * cols + cx + 1] ? 1 : 0);
            hex += (byte & 0xff).toString(16).padStart(2, "0");
        }
        return hex;
    }

    function hamming(a, b) {
        if (!a || !b || a.length !== b.length) return 64;
        let d = 0;
        for (let i = 0; i < a.length; i += 2) {
            let x = parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16);
            while (x) { d += x & 1; x >>= 1; }
        }
        return d;
    }

    // Extra measurements used for ID documents: contrast spread, colour,
    // glare in the middle of the photo, and how busy the outer edge is.
    function documentExtras(rgba, gray, w, h) {
        const hist = new Uint32Array(256);
        let satSum = 0, glare = 0, centre = 0;
        const x0 = Math.floor(w * 0.15), x1 = Math.ceil(w * 0.85), y0 = Math.floor(h * 0.15), y1 = Math.ceil(h * 0.85);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x, j = i * 4;
            const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
            hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            if (x >= x0 && x < x1 && y >= y0 && y < y1) {
                centre++;
                satSum += mx - mn;   // colour of the middle, where the document is
                if (gray[i] >= 250 && mx - mn <= 20) glare++;
            }
        }
        const n = w * h;
        let acc = 0, p98 = 255;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.98) { p98 = v; break; } }
        return { p98, colour: centre ? Math.round((satSum / centre) * 10) / 10 : 0, glare: centre ? Math.round((glare / centre) * 1000) / 1000 : 0 };
    }

    // rgba: pixels of the (already scaled-down) photo.
    function analyzePixels(rgba, w, h) {
        const gray = toGray(rgba, w, h);
        const b = brightness(gray);
        const bg = background(rgba, w, h);
        const extra = documentExtras(rgba, gray, w, h);
        return {
            edge: Math.round(edgeStrength(gray, w, h) * 10) / 10,
            mean: Math.round(b.mean),
            p2: b.p2,
            p98: extra.p98,
            colour: extra.colour,
            glare: extra.glare,
            whiteShare: Math.round(bg.whiteShare * 100) / 100,
            borderStd: Math.round(bg.std * 10) / 10,
            hash: dHash(gray, w, h)
        };
    }

    // --- Rules --------------------------------------------------------------

    const mb = (n) => (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");

    // info: { bytes, width, height }; metrics: from analyzePixels (optional).
    function evaluate(info, metrics) {
        const errors = [], warnings = [];
        info = info || {};
        if (info.bytes > RULES.MAX_BYTES) {
            errors.push({ code: "too_large", text: `File is too large (${mb(info.bytes)}MB - maximum ${mb(RULES.MAX_BYTES)}MB)` });
        }
        if (info.width && info.height) {
            if (info.width < RULES.MIN_SIDE || info.height < RULES.MIN_SIDE) {
                errors.push({ code: "low_resolution", text: `Resolution is too low (${info.width}×${info.height} - minimum ${RULES.MIN_SIDE}×${RULES.MIN_SIDE} required)` });
            }
            const ratio = Math.max(info.width, info.height) / Math.min(info.width, info.height);
            if (ratio > RULES.ASPECT_WARN) {
                warnings.push({ code: "aspect", text: `Photo is very ${info.width > info.height ? "wide" : "tall"} (${ratio.toFixed(1)}:1) - square photos look best; it will be shown padded to a square` });
            }
        }
        if (metrics) {
            if (metrics.edge < RULES.BLUR_REJECT) errors.push({ code: "blurry", text: "Image is too blurry" });
            else if (metrics.edge < RULES.BLUR_WARN) warnings.push({ code: "soft", text: "Image looks slightly out of focus" });

            if (metrics.mean < RULES.DARK_REJECT) errors.push({ code: "too_dark", text: "Image is too dark" });
            else if (metrics.mean < RULES.DARK_WARN) warnings.push({ code: "dark", text: "Image is quite dark - use more light" });

            if (metrics.mean > RULES.BRIGHT_REJECT.mean && metrics.p2 > RULES.BRIGHT_REJECT.p2) errors.push({ code: "too_bright", text: "Image is too bright (washed out)" });
            else if (metrics.mean > RULES.BRIGHT_WARN.mean && metrics.p2 > RULES.BRIGHT_WARN.p2) warnings.push({ code: "bright", text: "Image looks overexposed - details may be washed out" });

            if (metrics.whiteShare < RULES.BG_WHITE_MIN && metrics.borderStd > RULES.BG_UNIFORM_STD) {
                warnings.push({ code: "background", text: "Background is not plain or white - a clean white background looks more professional" });
            }
        }
        return { ok: errors.length === 0, errors, warnings };
    }

    // hash vs a list of { hash, label } already in use.
    function findDuplicate(hash, known) {
        if (!hash) return null;
        for (const k of known || []) {
            if (k && k.hash && hamming(hash, k.hash) <= RULES.DUPLICATE_DISTANCE) return k;
        }
        return null;
    }

    // --- Identity documents (KYC) -----------------------------------------
    // National ID, Passport or Driving Licence. Photos are judged a little
    // more strictly than product photos because the text must be readable.
    // Document type, authenticity, corners and tampering are confirmed by
    // admin (no OCR/AI service yet); the expiry date is typed by the vendor
    // and must be in the future.
    const ID_KINDS = { national_id: "National ID", passport: "Passport", driving_license: "Driving Licence" };
    const ID_RULES = {
        MAX_BYTES: 10 * 1024 * 1024,
        MIN_LONG: 1000, MIN_SHORT: 600,
        BLUR_REJECT: 30, BLUR_WARN: 50,
        DARK_REJECT: 50,
        BRIGHT_REJECT: { mean: 240, p2: 170 },
        MIN_CONTRAST: 70,           // p98 - p2
        MIN_COLOUR: 4,              // average colour; below = black-and-white copy
        GLARE_WARN: 0.01, GLARE_REJECT: 0.08
    };
    const ID_MESSAGES = {
        not_id: "❌ Upload rejected\nThis does not appear to be a National ID, Passport, or Driving License.\nPlease upload a valid identification document.",
        expired: "❌ Upload rejected\nThis document has expired.\nPlease upload a valid (non-expired) National ID, Passport, or Driving License.",
        unclear: "❌ Upload rejected\nThe image is too blurry or unclear.\nPlease take a clear photo of the full document."
    };

    function todayIso(now) {
        const d = now ? new Date(now) : new Date();
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }

    // fields: { kind, number, expires } -> { ok, errors:[{code,text}], value }
    function checkIdFields(fields, now) {
        const f = fields || {};
        const errors = [];
        const kind = String(f.kind || "").trim();
        if (!ID_KINDS[kind]) errors.push({ code: "kind", text: "Choose the document type: National ID, Passport or Driving Licence." });
        const number = String(f.number || "").trim().toUpperCase().replace(/\s+/g, " ");
        if (!/^[A-Z0-9][A-Z0-9 \/-]{3,29}$/.test(number)) errors.push({ code: "number", text: "Enter the document number exactly as printed on the document." });
        const expires = String(f.expires || "").trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expires);
        const valid = m && !isNaN(Date.parse(expires + "T00:00:00Z")) && new Date(expires + "T00:00:00Z").toISOString().slice(0, 10) === expires;
        if (!valid) errors.push({ code: "expires", text: "Enter the expiry date shown on the document." });
        else if (expires <= todayIso(now)) errors.push({ code: "expired", text: "This document has expired.", message: ID_MESSAGES.expired });
        else if (Number(m[1]) > new Date(now || Date.now()).getFullYear() + 20) errors.push({ code: "expires", text: "Check the expiry date - it is more than 20 years away." });
        return { ok: !errors.length, errors, value: { kind, number, expires } };
    }

    // info: { bytes, width, height }; metrics from analyzePixels (optional).
    function evaluateIdDocument(info, metrics) {
        const errors = [], warnings = [];
        info = info || {};
        if (info.bytes > ID_RULES.MAX_BYTES) errors.push({ code: "too_large", text: `File is too large (${mb(info.bytes)}MB - maximum ${mb(ID_RULES.MAX_BYTES)}MB)` });
        if (info.width && info.height) {
            const long = Math.max(info.width, info.height), short = Math.min(info.width, info.height);
            if (long < ID_RULES.MIN_LONG || short < ID_RULES.MIN_SHORT) {
                errors.push({ code: "low_resolution", text: `Resolution is too low to read the text (${info.width}×${info.height} - at least ${ID_RULES.MIN_LONG}×${ID_RULES.MIN_SHORT} required)` });
            }
        }
        if (metrics) {
            if (metrics.edge < ID_RULES.BLUR_REJECT) errors.push({ code: "blurry", text: "The image is too blurry or unclear" });
            else if (metrics.edge < ID_RULES.BLUR_WARN) warnings.push({ code: "soft", text: "The image is slightly soft - make sure the text is readable" });
            if (metrics.mean < ID_RULES.DARK_REJECT) errors.push({ code: "too_dark", text: "The image is too dark" });
            if (metrics.mean > ID_RULES.BRIGHT_REJECT.mean && metrics.p2 > ID_RULES.BRIGHT_REJECT.p2) errors.push({ code: "too_bright", text: "The image is too bright (washed out)" });
            if (metrics.p98 != null && metrics.p98 - metrics.p2 < ID_RULES.MIN_CONTRAST) errors.push({ code: "low_contrast", text: "The image has too little contrast to read" });
            if (metrics.colour != null && metrics.colour < ID_RULES.MIN_COLOUR) errors.push({ code: "not_colour", text: "This looks like a black-and-white copy - upload a clear colour photo of the original document" });
            if (metrics.glare >= ID_RULES.GLARE_REJECT) errors.push({ code: "glare", text: "Strong glare or flash reflection covers part of the document" });
            else if (metrics.glare >= ID_RULES.GLARE_WARN) warnings.push({ code: "glare", text: "Some glare on the document - make sure no details are hidden" });
        }
        const unclear = errors.some((e) => ["blurry", "too_dark", "too_bright", "low_contrast", "glare"].includes(e.code));
        return { ok: !errors.length, errors, warnings, message: errors.length ? (unclear ? ID_MESSAGES.unclear + (errors.some((e) => e.code !== "blurry") ? "\n\nReason: " + errors.filter((e) => e.code !== "blurry").map((e) => e.text).join("; ") : "") : "❌ Upload rejected\n" + errors.map((e) => "• " + e.text).join("\n") + "\nPlease take a clear colour photo of the full document.") : null };
    }

    function countMessage(n) {
        return n >= RULES.MIN_IMAGES ? null
            : `Add at least ${RULES.MIN_IMAGES} photos of the product (${n} added so far).`;
    }

    function rejectionText(reasons) {
        return "❌ Image not accepted\n\nReasons:\n" + reasons.map((r) => "• " + (r.text || r)).join("\n")
            + "\n\nPlease upload a clear, high-quality photo to keep quality high on Lizimas Store.";
    }

    // --- Browser helper -----------------------------------------------------
    // file -> { width, height, bytes, metrics, result }
    async function analyzeFile(file, evaluator) {
        const bmp = await createImageBitmap(file);
        const width = bmp.width, height = bmp.height;
        const s = Math.min(1, RULES.ANALYSIS_SIZE / Math.max(width, height));
        const w = Math.max(1, Math.round(width * s)), h = Math.max(1, Math.round(height * s));
        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        const metrics = analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h);
        const info = { bytes: file.size, width, height };
        return { ...info, metrics, result: (evaluator || evaluate)(info, metrics) };
    }

    return { RULES, analyzePixels, evaluate, findDuplicate, hamming, dHash, countMessage, rejectionText, analyzeFile,
        ID_KINDS, ID_RULES, ID_MESSAGES, checkIdFields, evaluateIdDocument, todayIso };
});
