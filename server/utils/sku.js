// SKU generator.
//
// Format: {PREFIX}{10 UPPERCASE ALNUM}LZMS
//   Example: SAZLF9N9NCMLLZMS
//
// PREFIX rules:
//   - Staff-uploaded products (no vendor) -> LS
//   - Vendor products with a brand        -> first 2 letters of brand, uppercase
//   - Vendor products with no/short brand -> LS
//
// Suffix LZMS always marks it as a Lizimas SKU.
//
// 36^10 random combinations. Brands sharing the same 2-letter prefix
// (Samsung/SanDisk both "SA") are fine - the random part keeps the SKU
// globally unique.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomCode(length) {
    const n = length || 10;
    let out = "";
    for (let i = 0; i < n; i++) {
        out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
}

function getBrandPrefix(brand, vendorId) {
    if (!vendorId) return "LS";

    const cleaned = (brand || "").trim();
    if (cleaned.length >= 2) {
        return cleaned.slice(0, 2).toUpperCase();
    }

    return "LS";
}

function generateSku(brand, vendorId) {
    const prefix = getBrandPrefix(brand, vendorId);
    return prefix + randomCode(10) + "LZMS";
}

// Vendor SKUs: the vendor's own code plus the fixed suffix, e.g.
// "TV-55A" -> "TV-55AULZMS" (joined straight on, no hyphen). No automatic
// codes (Ryan, Oct 2026).
const VENDOR_SKU_SUFFIX = "ULZMS";
// -> { ok, sku } | { ok: false, error }. An empty value gives { ok: true, sku: null }.
function withSkuSuffix(raw) {
    let s = String(raw == null ? "" : raw).trim().toUpperCase().replace(/\s+/g, "-");
    if (s.endsWith(VENDOR_SKU_SUFFIX)) s = s.slice(0, -VENDOR_SKU_SUFFIX.length);
    s = s.replace(/-+$/, "");
    if (!s) return { ok: true, sku: null };
    if (s.length > 50 || !/^[A-Z0-9][A-Z0-9._\/-]*$/.test(s)) {
        return { ok: false, error: "The SKU can only use letters, numbers and - . / _ (up to 50 characters)." };
    }
    return { ok: true, sku: s + VENDOR_SKU_SUFFIX };
}

module.exports = { generateSku, getBrandPrefix, withSkuSuffix, VENDOR_SKU_SUFFIX };
