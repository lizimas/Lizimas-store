const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const Checks = require("../client/js/lz-image-checks");
const { checkAndUploadIdDocument, checkIdAcceptance } = require("../server/utils/idDocumentChecks");

const NOW = "2026-09-26T09:00:00Z";
const OK = { id_kind: "passport", id_number: "A1234567", id_expires_on: "2031-01-01" };

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, fn) {
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const rows = [];
    for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const [a, b, c] = fn(x, y); r[1 + x * 3] = a; r[2 + x * 3] = b; r[3 + x * 3] = c; } rows.push(r); }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
// A coloured "card" with text-like stripes on a brown table.
const card = (opts = {}) => png(opts.w || 320, opts.h || 200, (x, y) => {
    const inCard = x > 30 && x < 290 && y > 25 && y < 175;
    if (!inCard) return [100, 70, 45];
    if (opts.glare && (x - 160) ** 2 + (y - 100) ** 2 < 70 ** 2) return [255, 255, 255];
    const text = y % 12 < 4 && x % 7 < 4 && y > 50;
    const v = text ? [30, 40, 35] : [225, 238, 228];
    return opts.gray ? [v[1], v[1], v[1]] : v;
});
const bigFile = (preview) => ({ originalname: "id.png", buffer: png(1400, 900, () => [120, 130, 140]), size: 20000, _preview: preview });

function deps(file, record) {
    return {
        upload: async () => ({ public_id: "kyc/1", resource_type: "image", format: "png", bytes: 1 }),
        previewUrl: () => "preview",
        fetchBuffer: async () => file._preview,
        destroy: async (id) => { record.push(id); }
    };
}

test("ID details: type, number and a future expiry date are required", () => {
    const r = Checks.checkIdFields({ kind: "passport", number: " a123 4567 ", expires: "2031-01-01" }, NOW);
    assert.equal(r.ok, true); assert.equal(r.value.number, "A123 4567");
    assert.deepEqual(Checks.checkIdFields({ kind: "library_card", number: "x", expires: "" }, NOW).errors.map(e => e.code), ["kind", "number", "expires"]);
    const exp = Checks.checkIdFields({ kind: "national_id", number: "CM1234567", expires: "2026-09-26" }, NOW);
    assert.equal(exp.errors[0].code, "expired");
    assert.match(exp.errors[0].message, /This document has expired/);
});

test("expired document is rejected before anything is uploaded", async () => {
    const destroyed = []; let uploaded = false;
    const d = deps(bigFile(card()), destroyed); d.upload = async () => { uploaded = true; return {}; };
    const r = await checkAndUploadIdDocument(bigFile(card()), { ...OK, id_expires_on: "2025-12-31" }, d, NOW);
    assert.equal(r.ok, false); assert.equal(r.body.error, "document_expired");
    assert.match(r.body.message, /❌ Upload rejected\nThis document has expired/);
    assert.equal(uploaded, false);
});

test("a PDF or a too-small photo is refused", async () => {
    const pdf = { originalname: "id.pdf", buffer: Buffer.from("%PDF-1.4 fake file content here....."), size: 40 };
    assert.equal((await checkAndUploadIdDocument(pdf, OK, deps(pdf, []), NOW)).body.error, "id_not_image");
    const small = { originalname: "s.png", buffer: png(640, 400, () => [1, 2, 3]), size: 100 };
    const r = await checkAndUploadIdDocument(small, OK, deps(small, []), NOW);
    assert.equal(r.body.error, "id_rejected"); assert.match(r.body.message, /too small to read the text/);
});

test("clear colour photo passes; glare and black-and-white copies are rejected and removed", async () => {
    const good = bigFile(card());
    const ok = await checkAndUploadIdDocument(good, OK, deps(good, []), NOW);
    assert.equal(ok.ok, true, JSON.stringify(ok.body));
    assert.deepEqual(ok.fields, { kind: "passport", number: "A1234567", expires: "2031-01-01" });
    assert.equal(ok.autoChecks.photo_checked, true);

    for (const [name, preview, code] of [["glare", card({ glare: true }), "glare"], ["copy", card({ gray: true }), "not_colour"]]) {
        const destroyed = [];
        const f = bigFile(preview);
        const r = await checkAndUploadIdDocument(f, OK, deps(f, destroyed), NOW);
        assert.equal(r.ok, false, name);
        assert.ok(r.body.reasons.some(x => x.code === code), name + " " + JSON.stringify(r.body.reasons));
        assert.deepEqual(destroyed, ["kyc/1"], name + " upload removed");
    }
});

test("admin can only accept an ID after confirming the checks, and never once expired", () => {
    assert.equal(checkIdAcceptance({ id_expires_on: "2031-01-01" }, false, NOW).ok, false);
    assert.equal(checkIdAcceptance({ id_expires_on: "2031-01-01" }, true, NOW).ok, true);
    assert.match(checkIdAcceptance({ id_expires_on: "2026-09-01" }, true, NOW).error, /expired/);
});

const { parseOcr } = require("../server/utils/idDocumentChecks");
const IdOcr = require("../client/js/lz-id-ocr");

test("OCR text: expiry from the machine-readable zone or an expiry line, number and type", () => {
    const passport = "SPECIMEN PASSPORT\nPassport No. B7654321\nDate of expiry 09 JUN 2031\nP<XXXTESTPERSON<<SAMPLE<<<<<<<<\nB7654321<1XXX8803159M3106095<<<<<<<<<<<<<<<0";
    const a = IdOcr.analyze(passport, 88, { kind: "passport", number: "B7654321", expires: "2031-06-09" }, NOW);
    assert.equal(a.ok, true);
    assert.deepEqual([a.summary.expiry_read, a.summary.expiry_from, a.summary.number_found, a.summary.kind_detected], ["2031-06-09", "machine-readable zone", true, "passport"]);
    assert.deepEqual(IdOcr.datesIn("Valid until: 01/02/2025"), ["2025-02-01"]);
    assert.deepEqual(IdOcr.datesIn("EXP 05 JUL 29 / Expiry 3O/O6/2O30"), ["2030-06-30", "2029-07-05"]);
    assert.equal(IdOcr.detectKind("SPECIMEN DRIVING PERMIT\nPermit No: DL-4455-667"), "driving_license");
});

test("OCR rules: expired or no text rejects; mismatches only warn", () => {
    const dl = "DRIVING PERMIT\nName: SAMPLE TESTPERSON\nPermit No: DL-4455-667\nValid until: 01/02/2025";
    const exp = IdOcr.analyze(dl, 94, { kind: "driving_license", number: "DL-4455-667", expires: "2027-02-01" }, NOW);
    assert.deepEqual(exp.errors.map(e => e.code), ["expired"]);
    assert.match(exp.errors[0].message, /This document has expired/);
    assert.deepEqual(IdOcr.analyze("model+model", 50, {}, NOW).errors.map(e => e.code), ["not_id"]);
    const card = "NATIONAL ID CARD\nNIN CM12345678TEST\nDATE OF EXPIRY 01.01.2031";
    const w = IdOcr.analyze(card, 90, { kind: "passport", number: "CM99999999", expires: "2031-01-02" }, NOW);
    assert.equal(w.ok, true);
    assert.deepEqual(w.warnings.map(x => x.code).sort(), ["expiry_mismatch", "kind_mismatch", "number_mismatch"]);
    // O/0 and I/1 look-alikes still match the typed number
    assert.equal(IdOcr.analyze("NATIONAL ID\nNIN CMI2345678TEST\nEXPIRY 01.01.2031", 80, { number: "CM12345678TEST" }, NOW).summary.number_found, true);
});

test("server keeps only a clean OCR summary and refuses an expired read date", async () => {
    const o = parseOcr(JSON.stringify({ summary: { chars: 120, confidence: 91.4, expiry_read: "2031-01-01", expiry_from: "expiry line", number_found: true, kind_detected: "passport", evil: "<script>" },
        warnings: [{ code: "number_mismatch", text: "x" }, { code: "made_up", text: "y" }] }));
    assert.deepEqual(o.summary, { chars: 120, confidence: 91, expiry_read: "2031-01-01", expiry_from: "expiry line", number_found: true, kind_detected: "passport" });
    assert.deepEqual(o.warnings.map(w => w.code), ["number_mismatch"]);
    assert.equal(parseOcr("not json"), null);
    const good = bigFile(card());
    const r = await checkAndUploadIdDocument(good, { ...OK, ocr: JSON.stringify({ summary: { expiry_read: "2026-01-01" } }) }, deps(good, []), NOW);
    assert.equal(r.body.error, "document_expired");
    const ok = await checkAndUploadIdDocument(good, { ...OK, ocr: JSON.stringify({ summary: { expiry_read: "2031-01-01", number_found: true } }) }, deps(good, []), NOW);
    assert.equal(ok.ok, true);
    assert.equal(ok.autoChecks.ocr.summary.expiry_read, "2031-01-01");
});

test("server refuses a typed expiry that contradicts the verified machine-readable zone", async () => {
    const good = bigFile(card());
    const ocr = JSON.stringify({ summary: { expiry_read: "2031-06-09", expiry_from: "machine-readable zone", number_found: true } });
    const bad = await checkAndUploadIdDocument(good, { ...OK, id_expires_on: "2031-01-01", ocr }, deps(good, []), NOW);
    assert.equal(bad.body.error, "expiry_wrong");
    const ok = await checkAndUploadIdDocument(good, { ...OK, id_expires_on: "2031-06-09", ocr }, deps(good, []), NOW);
    assert.equal(ok.ok, true);
});
