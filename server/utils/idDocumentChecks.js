// Identity document checks for vendor KYC (Ryan, Sept 2026): National ID,
// Passport or Driving Licence. Rules live in client/js/lz-image-checks.js
// (checkIdFields / evaluateIdDocument) so the upload form and the server
// agree.
//
// Automatic: the typed details (type, number, expiry in the future) and the
// photo itself (colour photo, resolution, blur, brightness, contrast,
// glare). A PDF is not accepted for the identity document - the photo is
// what gets checked. Document type, authenticity, all four corners visible
// and signs of editing are confirmed by admin before the document can be
// accepted (no OCR/AI service yet).
//
// deps (injectable for tests):
//   upload(buffer, name) -> { public_id, resource_type, format, bytes, width, height }
//   previewUrl(publicId) -> URL of a small PNG copy (or null)
//   fetchBuffer(url) -> Buffer
//   destroy(publicId, resourceType) -> Promise
const ImageChecks = require("./imageChecks");
const Checks = ImageChecks.Checks;

const ID_DOCUMENT_TYPE = "national_id";

function isImage(file) {
    const size = ImageChecks.readImageSize(file.buffer);
    return size ? size : null;
}

// OCR summary sent by the vendor's browser (client/js/lz-id-ocr.js). Only
// known fields of the right shape are kept; it is advisory for the admin
// reviewer, except that an expiry date read from the document that has
// already passed is refused here too.
const OCR_WARNING_CODES = ["expiry_mismatch", "expiry_unread", "number_mismatch", "kind_unread", "kind_mismatch", "hard_to_read"];
function parseOcr(raw) {
    if (raw == null || raw === "") return null;
    let o;
    try { o = typeof raw === "string" ? JSON.parse(String(raw).slice(0, 4000)) : raw; } catch (e) { return null; }
    if (!o || typeof o !== "object") return null;
    if (o.unavailable) return { source: "vendor_browser", unavailable: true };
    const sm = o.summary || {};
    const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const num = (v, max) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null);
    return {
        source: "vendor_browser",
        summary: {
            chars: num(sm.chars, 100000), confidence: num(sm.confidence, 100),
            expiry_read: date(sm.expiry_read),
            expiry_from: ["machine-readable zone", "expiry line"].includes(sm.expiry_from) ? sm.expiry_from : null,
            number_found: typeof sm.number_found === "boolean" ? sm.number_found : null,
            kind_detected: Checks.ID_KINDS[sm.kind_detected] ? sm.kind_detected : null
        },
        warnings: (Array.isArray(o.warnings) ? o.warnings : [])
            .filter((w) => w && OCR_WARNING_CODES.includes(w.code))
            .slice(0, 8).map((w) => ({ code: w.code, text: String(w.text || "").slice(0, 200) }))
    };
}

// -> { ok: true, uploaded, fields, autoChecks } | { ok: false, status, body }
async function checkAndUploadIdDocument(file, body, deps, now) {
    const fields = Checks.checkIdFields({ kind: body.id_kind, number: body.id_number, expires: body.id_expires_on }, now);
    const ocr = parseOcr(body.ocr);
    if (ocr && ocr.summary && ocr.summary.expiry_read && ocr.summary.expiry_read <= Checks.todayIso(now)) {
        return { ok: false, status: 400, body: { error: "document_expired", message: Checks.ID_MESSAGES.expired } };
    }
    // The machine-readable zone's expiry is verified by its check digit in the
    // browser, so a typed date that differs from it is wrong.
    if (fields.ok && ocr && ocr.summary && ocr.summary.expiry_from === "machine-readable zone"
        && ocr.summary.expiry_read && ocr.summary.expiry_read !== fields.value.expires) {
        return { ok: false, status: 400, body: { error: "expiry_wrong",
            message: `❌ Upload rejected\nThe expiry date entered (${fields.value.expires}) doesn't match the document (${ocr.summary.expiry_read}).\nPlease correct the expiry date.` } };
    }
    if (!fields.ok) {
        const expired = fields.errors.find((e) => e.code === "expired");
        return { ok: false, status: 400, body: {
            error: expired ? "document_expired" : "id_details_invalid",
            message: expired ? expired.message : fields.errors.map((e) => e.text).join(" "),
            fields: fields.errors
        } };
    }
    const size = isImage(file);
    if (!size) {
        return { ok: false, status: 400, body: { error: "id_not_image",
            message: "❌ Upload rejected\nUpload a clear colour photo (JPG or PNG) of your National ID, Passport or Driving Licence - not a PDF or scan." } };
    }
    const bytes = file.size != null ? file.size : file.buffer.length;
    const pre = Checks.evaluateIdDocument({ bytes, width: size.width, height: size.height }, null);
    if (!pre.ok) return { ok: false, status: 400, body: { error: "id_rejected", message: pre.message, reasons: pre.errors } };

    const uploaded = await deps.upload(file.buffer, file.originalname);
    let metrics = null;
    try {
        const url = deps.previewUrl ? deps.previewUrl(uploaded.public_id) : null;
        if (url) {
            const png = ImageChecks.decodePng(await deps.fetchBuffer(url));
            metrics = Checks.analyzePixels(png.rgba, png.width, png.height);
        }
    } catch (e) {
        console.warn("ID photo check preview skipped:", e.message);
    }
    const post = Checks.evaluateIdDocument({ bytes, width: size.width, height: size.height }, metrics);
    if (!post.ok) {
        await Promise.resolve(deps.destroy(uploaded.public_id, uploaded.resource_type)).catch(() => {});
        return { ok: false, status: 400, body: { error: "id_rejected", message: post.message, reasons: post.errors } };
    }
    const autoChecks = {
        checked_at: new Date(now || Date.now()).toISOString(),
        photo_checked: !!metrics,
        width: size.width, height: size.height,
        metrics: metrics ? { edge: metrics.edge, mean: metrics.mean, contrast: metrics.p98 - metrics.p2, colour: metrics.colour, glare: metrics.glare } : null,
        warnings: post.warnings.map((w) => w.text),
        ocr
    };
    return { ok: true, uploaded, fields: fields.value, autoChecks };
}

// Admin accepting the identity document: the manual checks must be
// confirmed and the document must not have expired since upload.
function checkIdAcceptance(doc, confirmed, now) {
    if (!confirmed) {
        return { ok: false, error: "Confirm the identity checks first: document type, the details match, all four corners visible, no glare over details, and no signs of editing." };
    }
    if (doc && doc.id_expires_on) {
        const exp = doc.id_expires_on instanceof Date ? doc.id_expires_on.toISOString().slice(0, 10) : String(doc.id_expires_on).slice(0, 10);
        if (exp <= Checks.todayIso(now)) return { ok: false, error: "This document has expired - it can't be accepted. Ask the vendor for a valid document." };
    }
    return { ok: true };
}

module.exports = { ID_DOCUMENT_TYPE, checkAndUploadIdDocument, checkIdAcceptance, parseOcr };
