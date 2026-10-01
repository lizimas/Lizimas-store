// Name check on uploaded KYC documents (Oct 2026, Ryan): a document whose
// name doesn't match the vendor's is rejected with a request to upload the
// proper one. The vendor's browser reads the text (OCR, client/js/lz-id-ocr.js)
// and sends it with the upload; the comparison is repeated here with the
// names from the database, using the same nameCheck() the browser uses.
//   - identity documents / work permit: the account owner's name
//   - business documents (registration, TIN, VAT, Form 20, bank, MoMo...):
//     the business name or the owner's name (a sole trader's certificate
//     carries the person's name)
// Only a clear "none of the name is on this readable document" rejects;
// partial or unreadable results are left for the admin reviewer.
const { nameCheck } = require("../../client/js/lz-id-ocr.js");

const PERSON_TYPES = ["national_id", "work_permit"];
const RANK = { match: 0, partial: 1, unread: 2, mismatch: 3 };

function parseOcrText(raw) {
    if (raw == null || raw === "") return null;
    let o;
    try { o = typeof raw === "string" ? JSON.parse(String(raw).slice(0, 12000)) : raw; } catch (e) { return null; }
    if (!o || typeof o !== "object" || typeof o.text !== "string") return null;
    const conf = typeof o.confidence === "number" && isFinite(o.confidence) ? Math.max(0, Math.min(100, o.confidence)) : null;
    return { text: o.text.slice(0, 8000), confidence: conf };
}

// -> null (nothing to check) | { result, expected, found, missing, checked_as }
// otherNames: more names the person may go by on Lizimas (the shop's
// contact name; for an individual seller the shop name is often their own
// name). Any one matching is enough.
function checkDocumentNames({ documentType, ocr, ownerName, businessName, otherNames }) {
    if (!ocr || !ocr.text) return null;
    const extra = (otherNames || []).filter(Boolean).map(n => ({ name: n, business: false, as: "other" }));
    const person = PERSON_TYPES.includes(documentType);
    const candidates = person
        ? [{ name: ownerName, business: false, as: "owner", strict: true }, ...extra.map(c => ({ ...c, strict: true }))]
        : [{ name: businessName, business: true, as: "business" }, { name: ownerName, business: false, as: "owner" }, ...extra];
    let best = null;
    for (const c of candidates) {
        if (!c.name || !String(c.name).trim()) continue;
        const r = nameCheck(ocr.text, c.name, { business: c.business, confidence: ocr.confidence, strict: !!c.strict });
        r.checked_as = c.as;
        if (!best || RANK[r.result] < RANK[best.result]) best = r;
    }
    return best;
}

function nameMismatchMessage(check, label) {
    const names = check && check.expected ? ` (${check.expected})` : "";
    return `❌ Upload rejected\nThe name on this document doesn't match the name on your Lizimas account${names}.\n` +
        `Please upload your own ${label || "document"} showing that name. If your name has changed, contact Lizimas Store support.`;
}

module.exports = { parseOcrText, checkDocumentNames, nameMismatchMessage, PERSON_TYPES };
