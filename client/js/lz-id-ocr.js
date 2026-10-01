// Reading identity documents with OCR (Ryan, Sept 2026).
//
// Tesseract.js (self-hosted in client/vendor-lib/tesseract - no outside CDN)
// reads the text on a National ID, Passport or Driving Licence photo in the
// vendor's browser. analyze() works out, from that text:
//   - the document type, from its wording ("PASSPORT", "NATIONAL ID",
//     "DRIVING PERMIT", ...) or its machine-readable zone (MRZ);
//   - the expiry date: from the MRZ, trusted only when its check digit is
//     right (so a misread digit can't pass), otherwise from the date printed
//     after an "expiry"-style label;
//   - whether the document number the vendor typed appears on it.
// Rules: text that can't be read, or text with nothing of an ID about it ->
// rejected; an expiry date read from the document that has passed ->
// rejected; an MRZ expiry (check digit verified) that differs from the typed
// date -> rejected until the vendor corrects it. Softer mismatches become
// notes for the admin reviewer - OCR can misread, so a guess never blocks.
// If OCR can't run on the device (old browser), read() returns null and the
// upload carries on with the photo checks and admin review only.
// nameCheck() (Oct 2026) compares the names on any document with the
// account's names; the server repeats it (utils/documentNameCheck.js) and
// rejects a document whose readable text shows none of the name.
// read(file, { generic: true }) reads any document (certificates, TIN...).
//
// Works in Node (require - for tests) and the browser (window.LzIdOcr).
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LzIdOcr = api;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const BASE = "/vendor-lib/tesseract/";
    const KIND_WORDS = {
        passport: [/\bPASS\s?PORT\b/, /\bPASSEPORT\b/, /\bPASAPORTE\b/],
        driving_license: [/\bDRIVING\s+(PERMIT|LICEN[CS]E)\b/, /\bDRIVER'?S?\s+LICEN[CS]E\b/, /\bDRIVING\b/],
        national_id: [/\bNATIONAL\s*I\.?D\b/, /\bNATIONAL\s+IDENTI/, /\bIDENTITY\s+CARD\b/, /\bID\s+CARD\b/, /\bNIN\b/]
    };
    const GENERIC_ID_WORDS = [/\bREPUBLIC\b/, /\bSURNAME\b/, /\bGIVEN\s+NAMES?\b/, /\bDATE\s+OF\s+BIRTH\b/, /\bNATIONALITY\b/, /\bSEX\b/, /\bHOLDER\b/, /\bSIGNATURE\b/, /\bISSUE/];
    const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
    const EXPIRY_LABEL = /(DATE\s+OF\s+EXPIR\w*|EXPIR\w*|\bEXP\b\.?|VALID\s+(UNTIL|TO|THRU|THROUGH)|VALIDITY)/g;
    const LABELS = { national_id: "National ID", passport: "Passport", driving_license: "Driving Licence" };
    const MSG = {
        not_id: "❌ Upload rejected\nThis does not appear to be a National ID, Passport, or Driving License.\nPlease upload a valid identification document.",
        expired: "❌ Upload rejected\nThis document has expired.\nPlease upload a valid (non-expired) National ID, Passport, or Driving License.",
        unreadable: "❌ Upload rejected\nThis does not appear to be a National ID, Passport, or Driving License, or its text can't be read.\nPlease upload a clear photo of the full document, upright and in good light."
    };

    const pad = (n) => String(n).padStart(2, "0");
    function isoDate(y, m, d) {
        y = Number(y); m = Number(m); d = Number(d);
        if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
        const s = `${y}-${pad(m)}-${pad(d)}`;
        const t = new Date(s + "T00:00:00Z");
        return !isNaN(t) && t.toISOString().slice(0, 10) === s ? s : null;
    }
    function todayIso(now) {
        const d = now ? new Date(now) : new Date();
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    const normalize = (text) => String(text || "").toUpperCase().replace(/[‘’]/g, "'").replace(/[ \t]+/g, " ");

    // --- Dates written on the document (day first, as on Ugandan documents) --
    function findDates(s) {
        const out = [];
        const push = (index, v) => { if (v) out.push({ index, iso: v }); };
        const t = s.replace(/(?<=\d)[OQ]|[OQ](?=\d)/g, "0");
        let m;
        const dmy = /\b(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{4})\b/g;
        while ((m = dmy.exec(t))) push(m.index, isoDate(m[3], m[2], m[1]));
        const ymd = /\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/g;
        while ((m = ymd.exec(t))) push(m.index, isoDate(m[1], m[2], m[3]));
        const named = /\b(\d{1,2})\s*[ ./-]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*[ ./-]?\s*(\d{4}|\d{2})\b/g;
        while ((m = named.exec(t))) push(m.index, isoDate(m[3].length === 2 ? 2000 + Number(m[3]) : m[3], MONTHS[m[2]], m[1]));
        return out;
    }
    // Every date on one line of text, in the order the patterns find them.
    function datesIn(line) {
        return findDates(normalize(line)).map((d) => d.iso);
    }
    function expiryFromLabel(s) {
        const dates = findDates(s).sort((a, b) => a.index - b.index);
        EXPIRY_LABEL.lastIndex = 0;
        let m;
        while ((m = EXPIRY_LABEL.exec(s))) {
            const after = dates.find((d) => d.index >= m.index && d.index - m.index <= 60);
            if (after) return after.iso;
        }
        return null;
    }

    // --- Machine-readable zone ------------------------------------------------
    function mrzValue(c) {
        if (c === "<") return 0;
        if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
        if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55;
        return -1;
    }
    function checkDigit(str) {
        const w = [7, 3, 1];
        let sum = 0;
        for (let i = 0; i < str.length; i++) {
            const v = mrzValue(str[i]);
            if (v < 0) return -1;
            sum += v * w[i % 3];
        }
        return sum % 10;
    }
    // OCR confuses a few letters with digits in digit-only positions.
    const DIGITISH = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
    const asDigits = (s) => String(s || "").replace(/[OQDILZSBG]/g, (c) => DIGITISH[c]);
    function mrzDate(yymmdd) {
        const s = asDigits(yymmdd);
        return /^\d{6}$/.test(s) ? isoDate(2000 + Number(s.slice(0, 2)), s.slice(2, 4), s.slice(4, 6)) : null;
    }
    function mrzLines(text) {
        return String(text || "").toUpperCase().split(/\n/)
            .map((l) => l.replace(/\s+/g, "").replace(/[«‹]/g, "<").replace(/[^A-Z0-9<]/g, ""))
            .filter((l) => (l.match(/</g) || []).length >= 2 && l.length >= 25);
    }
    // -> { format, kind, expiry, expiryChecked, number, numberChecked } | null
    function parseMrz(text) {
        const lines = mrzLines(text);
        if (!lines.length) return null;
        // TD3 (passports): 2 lines of 44 - line 2 holds number, birth date, expiry.
        for (let i = 1; i < lines.length; i++) {
            const l = lines[i];
            if (l.length >= 40 && /^P/.test(lines[i - 1])) {
                const num = l.slice(0, 9), exp = l.slice(21, 27);
                return {
                    format: "TD3", kind: "passport",
                    expiry: mrzDate(exp), expiryChecked: checkDigit(asDigits(exp)) === Number(asDigits(l[27] || "x")),
                    number: num.replace(/<+$/, ""), numberChecked: checkDigit(num) === Number(asDigits(l[9] || "x"))
                };
            }
        }
        // TD1 (ID cards, some driving permits): 3 lines of 30.
        for (let i = 0; i + 1 < lines.length; i++) {
            const l1 = lines[i], l2 = lines[i + 1];
            if (/^[IAC]/.test(l1) && l2.length >= 28) {
                const num = l1.slice(5, 14), exp = l2.slice(8, 14);
                return {
                    format: "TD1", kind: /^I/.test(l1) ? "national_id" : null,
                    expiry: mrzDate(exp), expiryChecked: checkDigit(asDigits(exp)) === Number(asDigits(l2[14] || "x")),
                    number: num.replace(/<+$/, ""), numberChecked: checkDigit(num) === Number(asDigits(l1[14] || "x"))
                };
            }
        }
        return { format: "unknown", kind: null, expiry: null, expiryChecked: false, number: null, numberChecked: false };
    }
    // Phone photos often lose the first characters of an MRZ line, which
    // breaks reading by position. The birth date, sex and expiry date sit
    // together in both formats - YYMMDD c [M/F/<] YYMMDD c - so find that run
    // anywhere and keep the expiry only when its check digit adds up.
    function scanMrzExpiry(text) {
        const D = "[0-9OQDILZSBG]";
        const re = new RegExp(`(${D}{6})(${D})([MFX<])(${D}{6})(${D})`, "g");
        let best = null;
        for (const line of mrzLines(text)) {
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(line))) {
                const expOk = checkDigit(asDigits(m[4])) === Number(asDigits(m[5]));
                if (!expOk || !mrzDate(m[4])) continue;
                const birthOk = checkDigit(asDigits(m[1])) === Number(asDigits(m[2]));
                if (!best || (birthOk && !best.birthOk)) best = { expiry: mrzDate(m[4]), birthOk };
            }
        }
        return best;
    }
    function readMrz(text) {
        const r = parseMrz(text);
        if (r && r.expiryChecked) return r;
        const found = scanMrzExpiry(text);
        if (!found) return r;
        return Object.assign({ format: "partial", kind: null, number: null, numberChecked: false }, r || {},
            { expiry: found.expiry, expiryChecked: true, format: r && r.format !== "unknown" ? r.format : "partial" });
    }

    function detectKind(s) {
        let best = null, bestHits = 0;
        for (const [kind, words] of Object.entries(KIND_WORDS)) {
            const hits = words.filter((w) => w.test(s)).length;
            if (hits > bestHits) { best = kind; bestHits = hits; }
        }
        return best;
    }
    const fold = (s) => asDigits(String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
    function numberFound(text, typed) {
        const t = fold(typed);
        return t.length >= 4 ? fold(text).includes(t) : null;
    }

    // text + confidence from Tesseract; typed = { kind, number, expires }.
    // -> { ok, message, errors:[{code,text,message}], warnings:[{code,text}], summary }
    function analyze(text, confidence, typed, now) {
        typed = typed || {};
        const s = normalize(text);
        const words = (s.match(/[A-Z0-9]{3,}/g) || []).length;
        const chars = (s.match(/[A-Z0-9]/g) || []).length;
        const mrz = readMrz(text);
        const kind = (mrz && mrz.kind) || detectKind(s);
        const generic = GENERIC_ID_WORDS.filter((w) => w.test(s)).length;
        const found = numberFound(text, typed.number);
        const labelExpiry = expiryFromLabel(s);
        const mrzExpiry = mrz && mrz.expiry && mrz.expiryChecked ? mrz.expiry : null;
        const expiry = mrzExpiry || labelExpiry;
        const source = mrzExpiry ? "machine-readable zone" : labelExpiry ? "expiry line" : null;
        const errors = [], warnings = [];
        const readable = words >= 3 && chars >= 20 && (confidence == null || confidence >= 30);
        const looksLikeId = !!kind || !!(mrz && mrz.format !== "unknown") || found === true || generic >= 2;

        if (!readable || !looksLikeId) {
            errors.push({ code: "not_id", text: "This does not appear to be a National ID, Passport or Driving Licence", message: readable ? MSG.not_id : MSG.unreadable });
        } else {
            if (expiry && expiry <= todayIso(now)) {
                errors.push({ code: "expired", text: `The document shows it expired on ${expiry}`, message: MSG.expired });
            } else if (expiry && typed.expires && expiry !== typed.expires) {
                if (mrzExpiry) {
                    // Verified by the MRZ check digit: the typed date is wrong.
                    errors.push({ code: "expiry_wrong", text: `The document expires on ${expiry}, but ${typed.expires} was entered`,
                        message: `❌ Upload rejected\nThe expiry date entered (${typed.expires}) doesn't match the document (${expiry}).\nPlease correct the expiry date.` });
                } else {
                    warnings.push({ code: "expiry_mismatch", text: `The expiry date on the document reads ${expiry}, but ${typed.expires} was entered - check it matches.` });
                }
            } else if (!expiry) {
                warnings.push({ code: "expiry_unread", text: "The expiry date could not be read automatically." });
            }
            if (found === false) warnings.push({ code: "number_mismatch", text: "The document number entered could not be found on the document - check it is typed exactly as printed." });
            if (!kind) warnings.push({ code: "kind_unread", text: "The document type could not be confirmed from the text." });
            else if (typed.kind && kind !== typed.kind) warnings.push({ code: "kind_mismatch", text: `This looks like a ${LABELS[kind]}, but ${LABELS[typed.kind] || typed.kind} was chosen.` });
            if (confidence != null && confidence < 55) warnings.push({ code: "hard_to_read", text: "The text is hard to read - a sharper, well-lit photo helps." });
        }
        return {
            ok: errors.length === 0,
            message: errors.length ? errors[0].message : null,
            errors, warnings,
            summary: {
                chars, confidence: confidence == null ? null : Math.round(confidence),
                expiry_read: expiry || null, expiry_from: source,
                number_found: found, kind_detected: kind || null
            }
        };
    }

    // --- Names on the document (Oct 2026, Ryan) -----------------------------
    // Does the name on the document match the name on the Lizimas account?
    // Word by word, in any order, allowing one misread letter in longer
    // words (two in very long ones). The machine-readable zone's "<" counts
    // as a space, so "OKELLO<<JOHN<PETER" is read too.
    //   match    - enough of the name found (person: 2 words, or all if fewer;
    //              business: at least half of its distinctive words)
    //   partial  - some but not enough (left for the reviewer)
    //   mismatch - the text is clearly readable and none of the name is there
    //   unread   - too little readable text to judge
    const NAME_STOP = new Set(["LTD", "LIMITED", "CO", "COMPANY", "ENTERPRISES", "ENTERPRISE", "UGANDA", "U", "SMC", "THE", "AND",
        "OF", "INVESTMENTS", "INVESTMENT", "GROUP", "INTERNATIONAL", "STORE", "STORES", "SHOP", "TRADING", "TRADERS", "GENERAL",
        "SUPPLIES", "SERVICES", "MR", "MRS", "MS", "DR", "INC", "PLC"]);
    function nameWords(name, business) {
        const out = [];
        for (const w of normalize(name).replace(/[^A-Z\s]/g, " ").split(/\s+/)) {
            if (w.length < 2 || (business && NAME_STOP.has(w)) || out.includes(w)) continue;
            out.push(w);
        }
        return out;
    }
    function editDistance(a, b) {
        if (Math.abs(a.length - b.length) > 2) return 3;
        const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            let diag = prev[0];
            prev[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const tmp = prev[j];
                prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
                diag = tmp;
            }
        }
        return prev[b.length];
    }
    function nameCheck(text, name, opts) {
        opts = opts || {};
        const want = nameWords(name, opts.business);
        if (!want.length) return { result: "unread", expected: String(name || ""), found: [], missing: [] };
        // Digits OCR often reads instead of letters (0/O, 1/I, 5/S, 8/B...).
        const fixed = normalize(text).replace(/</g, " ").replace(/[A-Z0-9]+/g, (w) => /[A-Z]/.test(w)
            ? w.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B").replace(/6/g, "G").replace(/2/g, "Z") : w);
        const words = fixed.replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
        const has = (w) => words.some((t) => t === w
            || (w.length >= 5 && t.length >= 4 && editDistance(w, t) <= (w.length >= 8 ? 2 : 1))
            || (w.length >= 4 && t.includes(w)));
        const found = want.filter(has);
        const missing = want.filter((w) => !found.includes(w));
        const need = opts.business ? Math.max(1, Math.ceil(want.length / 2)) : Math.min(2, want.length);
        const readable = words.length >= 12 && (opts.confidence == null || opts.confidence >= 55);
        // Identity documents: only call it a mismatch when the name area was
        // clearly read - a name label (SURNAME / GIVEN NAMES / NAMES) or the
        // machine-readable zone - with good confidence; otherwise leave it
        // to the reviewer rather than refuse a genuine ID.
        const nameAreaRead = !opts.strict || ((/\b(SURNAME|GIVEN\s*NAMES?|NAMES?|FORENAMES?)\b/.test(fixed) || /[A-Z]{2,}<<[A-Z]/.test(normalize(text)))
            && words.length >= 20 && (opts.confidence == null || opts.confidence >= 70));
        let result;
        if (found.length >= need) result = "match";
        else if (!readable || !nameAreaRead) result = "unread";
        else if (found.length === 0) result = "mismatch";
        else result = "partial";
        return { result, expected: String(name || ""), found, missing };
    }

    // --- Browser: run Tesseract ------------------------------------------------
    let workerPromise = null;
    let progressCb = null;     // the current read()'s onProgress, fed by Tesseract's logger
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (typeof Tesseract !== "undefined") return resolve();
            const el = document.createElement("script");
            el.src = src; el.onload = resolve; el.onerror = () => reject(new Error("OCR engine failed to load"));
            document.head.appendChild(el);
        });
    }
    function getWorker() {
        if (!workerPromise) {
            workerPromise = loadScript(BASE + "tesseract.min.js")
                .then(() => Tesseract.createWorker("eng", 1, { workerPath: BASE + "worker.min.js", corePath: BASE, langPath: BASE, workerBlobURL: false,
                    logger: (m) => { if (progressCb && m && typeof m.progress === "number") progressCb(m); } }))
                .catch((e) => { workerPromise = null; throw e; });
        }
        return workerPromise;
    }
    async function canvasFor(file, angle) {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
        const side = angle % 180 !== 0;
        const c = document.createElement("canvas");
        c.width = side ? h : w; c.height = side ? w : h;
        const ctx = c.getContext("2d");
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(angle * Math.PI / 180);
        ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
        if (bmp.close) bmp.close();
        return c;
    }
    // Second pass for the machine-readable zone: the bottom band of the photo,
    // enlarged, black-and-white, and read with only the characters an MRZ can
    // hold (A-Z, 0-9, <). The general English model garbles "<<<<" otherwise.
    async function readMrzBand(worker, canvas) {
        const bandTop = Math.floor(canvas.height * 0.62);
        const bh = canvas.height - bandTop;
        const scale = Math.min(3, 2400 / canvas.width);
        const c = document.createElement("canvas");
        c.width = Math.round(canvas.width * scale); c.height = Math.round(bh * scale);
        const ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(canvas, 0, bandTop, canvas.width, bh, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const cut = (sum / (d.length / 4)) * 0.75;
        for (let i = 0; i < d.length; i += 4) {
            const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < cut ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(img, 0, 0);
        await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", tessedit_pageseg_mode: "6" });
        try {
            const { data } = await worker.recognize(c, { rotateAuto: true });
            return data.text || "";
        } finally {
            await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" });
        }
    }

    // Does this reading look like the right way up?
    function looksRight(text, confidence, generic) {
        if (generic) return (normalize(text).match(/[A-Z]{3,}/g) || []).length >= 12 && (confidence == null || confidence >= 40);
        const r = analyze(text, confidence, {});
        return r.ok || r.errors[0].code !== "not_id";
    }
    // image (File/Blob) -> { text, confidence, rotation } or null when OCR
    // can't run on this device. A sideways or upside-down photo is retried
    // turned round; passports and ID cards get the MRZ pass as well.
    async function read(image, opts) {
        opts = opts || {};
        const timeout = opts.timeoutMs || 60000;
        progressCb = opts.onProgress || null;
        const job = (async () => {
            const worker = await getWorker();
            let best = null;
            for (const angle of [0, 90, 270, 180]) {
                if (opts.onStep) opts.onStep(angle);
                const canvas = await canvasFor(image, angle);
                const { data } = await worker.recognize(canvas);
                let text = data.text || "";
                const ok = looksRight(text, data.confidence, opts.generic);
                if (ok && !opts.generic && detectKind(normalize(text)) !== "driving_license") {
                    const band = await readMrzBand(worker, canvas).catch(() => "");
                    if (band) text += "\n" + band;
                }
                const out = { text, confidence: data.confidence, rotation: angle };
                if (ok) return out;
                if (!best || text.length > best.text.length) best = out;
            }
            return best;
        })();
        try {
            return await Promise.race([job, new Promise((res) => setTimeout(() => res(null), timeout))]);
        } catch (e) {
            console.warn("OCR unavailable:", e && e.message);
            return null;
        }
    }
    async function readFile(file, typed, opts) {
        const r = await read(file, opts);
        if (!r) return null;
        return Object.assign(analyze(r.text, r.confidence, typed, opts && opts.now), { rotation: r.rotation, text: r.text });
    }

    return { nameCheck, nameWords, read, datesIn, analyze, parseMrz, readMrz, scanMrzExpiry, findDates, expiryFromLabel, detectKind, checkDigit, numberFound, readFile, MSG };
});
