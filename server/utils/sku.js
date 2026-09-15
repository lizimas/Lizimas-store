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

module.exports = { generateSku, getBrandPrefix };
