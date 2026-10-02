// Identity details read from the vendor's ID (Oct 2026): the boxes filled in
// from the front of the card (surname, given name, nationality, sex, date of
// birth, NIN, card number, date of expiry) and from the back (village,
// parish, sub-county, county, district). Stored in vendor_identity_details
// (migration 155); the NIN and card number are encrypted.
const { encryptField, decryptField } = require("./encryption");

const TEXT_FIELDS = { surname: 80, given_names: 120, nationality: 40, village: 80, parish: 80, sub_county: 80, county: 80, district: 80 };
const FRONT_FIELDS = ["surname", "given_names", "nationality", "sex", "date_of_birth", "nin", "card_number", "expires_on"];
const BACK_FIELDS = ["village", "parish", "sub_county", "county", "district"];
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00Z").getTime());

// -> { ok, value } | { ok: false, error }. Only the keys that were sent are returned.
// Pure - tested in test/identityDetails.test.js.
function readIdentityDetails(input, now) {
    let raw = input;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (e) { return { ok: false, error: "The ID details could not be read." }; } }
    if (!raw || typeof raw !== "object") return { ok: true, value: {} };
    const out = {};
    const today = new Date(now || Date.now()).toISOString().slice(0, 10);
    for (const [key, max] of Object.entries(TEXT_FIELDS)) {
        if (raw[key] === undefined) continue;
        const v = String(raw[key] == null ? "" : raw[key]).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max);
        out[key] = v || null;
    }
    if (raw.sex !== undefined) {
        const v = String(raw.sex || "").trim().toUpperCase().slice(0, 1);
        if (v && v !== "M" && v !== "F") return { ok: false, error: "Sex must be M or F, as printed on the ID." };
        out.sex = v || null;
    }
    if (raw.date_of_birth !== undefined) {
        const v = String(raw.date_of_birth || "").trim();
        if (v && (!isDay(v) || v >= today || v < "1900-01-01")) return { ok: false, error: "Enter the date of birth as printed on the ID." };
        if (v && Number(today.slice(0, 4)) - Number(v.slice(0, 4)) < 18) return { ok: false, error: "The ID holder must be 18 or older to sell on Lizimas Store." };
        out.date_of_birth = v || null;
    }
    if (raw.expires_on !== undefined) {
        const v = String(raw.expires_on || "").trim();
        if (v && !isDay(v)) return { ok: false, error: "Enter the date of expiry as printed on the ID." };
        out.expires_on = v || null;
    }
    if (raw.nin !== undefined) {
        const v = String(raw.nin || "").replace(/\s+/g, "").toUpperCase();
        if (v && !/^[A-Z0-9]{6,20}$/.test(v)) return { ok: false, error: "The NIN can only have letters and numbers." };
        out.nin = v || null;
    }
    if (raw.card_number !== undefined) {
        const v = String(raw.card_number || "").replace(/\s+/g, "").toUpperCase();
        if (v && !/^[A-Z0-9]{5,20}$/.test(v)) return { ok: false, error: "The card number can only have letters and numbers." };
        out.card_number = v || null;
    }
    if (Array.isArray(raw.edited_fields)) out.edited_fields = raw.edited_fields.map(String).filter((f) => FRONT_FIELDS.includes(f) || BACK_FIELDS.includes(f)).slice(0, 20);
    if (raw.read !== undefined) out.read = !!raw.read;
    return { ok: true, value: out };
}

// side: "front" | "back". Writes only the boxes of that side.
async function saveIdentityDetails(db, vendorId, idKind, side, value) {
    const fields = side === "back" ? BACK_FIELDS : FRONT_FIELDS;
    const cols = {};
    fields.forEach((f) => {
        if (value[f] === undefined) return;
        if (f === "nin") cols.nin_enc = value.nin ? encryptField(value.nin) : null;
        else if (f === "card_number") cols.card_number_enc = value.card_number ? encryptField(value.card_number) : null;
        else cols[f] = value[f];
    });
    cols[side === "back" ? "back_read" : "front_read"] = !!value.read;
    if (side !== "back" && idKind) cols.id_kind = idKind;
    if (value.edited_fields) cols.edited_fields = JSON.stringify(value.edited_fields);
    const names = Object.keys(cols);
    await db.query(
        `INSERT INTO vendor_identity_details (vendor_id, ${names.join(", ")}) VALUES ($1, ${names.map((_, i) => "$" + (i + 2)).join(", ")})
         ON CONFLICT (vendor_id) DO UPDATE SET ${names.map((n) => `${n} = EXCLUDED.${n}`).join(", ")}, updated_at = now()`,
        [vendorId].concat(names.map((n) => cols[n])));
}

// -> the details with the NIN and card number readable, or null. A missing
// table (migration 155 not applied yet) is treated as "no details".
async function loadIdentityDetails(db, vendorId) {
    let row;
    try {
        row = (await db.query(
            `SELECT id_kind, surname, given_names, nationality, sex, date_of_birth::text AS date_of_birth, nin_enc, card_number_enc,
                    expires_on::text AS expires_on, village, parish, sub_county, county, district, edited_fields, front_read, back_read, updated_at
               FROM vendor_identity_details WHERE vendor_id = $1`, [vendorId])).rows[0];
    } catch (e) { if (e.code === "42P01") return null; throw e; }
    if (!row) return null;
    const out = Object.assign({}, row, { nin: row.nin_enc ? decryptField(row.nin_enc) : null, card_number: row.card_number_enc ? decryptField(row.card_number_enc) : null });
    delete out.nin_enc; delete out.card_number_enc;
    return out;
}

module.exports = { readIdentityDetails, saveIdentityDetails, loadIdentityDetails, FRONT_FIELDS, BACK_FIELDS };
