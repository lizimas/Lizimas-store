// Product form rules (Sept 2026 Add Product redesign), kept free of the
// database so they can be tested on their own. Used by productController.

// Columns that never leave the admin side: commission, Lizimas' cost price,
// internal approval notes/flags. Public product endpoints return rows
// through this (Sept 2026: cost_price and the review columns were being
// returned by /api/products).
const PRIVATE_PRODUCT_FIELDS = [
    "vendor_desired_payout", "commission_rate_applied", "fixed_fee_applied", "commission_rule_id",
    "cost_price", "review_flags", "review_reason_code", "reviewed_by", "reviewed_at"
];
function publicProductRow(row) {
    if (!row) return row;
    const out = Object.assign({}, row);
    PRIVATE_PRODUCT_FIELDS.forEach((k) => { delete out[k]; });
    return out;
}
module.exports.publicProductRow = publicProductRow;
module.exports.PRIVATE_PRODUCT_FIELDS = PRIVATE_PRODUCT_FIELDS;

// Optional fields from the redesigned form (Sept 2026). Returns only the
// fields that were sent, so an older form that doesn't send them changes
// nothing. cost_price and compare_at_price are Lizimas-only (not vendors).
function readExtraProductFields(body, role) {
    const out = {};
    const money = (v, label) => {
        if (v === undefined) return undefined;
        if (v === null || String(v).trim() === "") return null;
        const n = Number(String(v).replace(/[, ]/g, ""));
        if (!(n > 0)) throw new Error(`${label} must be a number above 0, or left blank.`);
        return Math.round(n * 100) / 100;
    };
    const isVendor = ["vendor", "vendor_staff"].includes(role);
    if (!isVendor) {
        const cost = money(body.cost_price, "Cost price");
        if (cost !== undefined) out.cost_price = cost;
        const was = money(body.compare_at_price, "The 'Was' price");
        if (was !== undefined) out.compare_at_price = was;
    }
    if (body.low_stock_threshold !== undefined) {
        const t = String(body.low_stock_threshold).trim();
        if (t === "") out.low_stock_threshold = null;
        else {
            const n = Number(t);
            if (!Number.isInteger(n) || n < 0) throw new Error("Low stock alert must be a whole number (0 or more), or left blank.");
            out.low_stock_threshold = n;
        }
    }
    return out;
}
module.exports.readExtraProductFields = readExtraProductFields;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
function cleanColorInput(body, partial) {
    const out = {};
    if (!partial || body.name !== undefined) {
        const name = String(body.name == null ? "" : body.name).replace(/\s+/g, " ").trim();
        if (!name) return { error: "Give the colour a name, e.g. Beige." };
        if (name.length > 50) return { error: "Colour names can be up to 50 characters." };
        out.name = name;
    }
    if (!partial || body.hex !== undefined) {
        const hex = body.hex == null || body.hex === "" ? null : String(body.hex).trim();
        if (hex !== null && !HEX_RE.test(hex)) return { error: "Pick the colour with the colour picker (a code like #E8DCC4)." };
        out.hex = hex ? hex.toUpperCase() : null;
    }
    return { value: out };
}
module.exports.cleanColorInput = cleanColorInput;

// Colour x size combinations; with only colours (or only sizes) one row each.
function variantCombos(colors, sizes) {
    const out = [];
    if (colors.length && sizes.length) {
        colors.forEach((c, ci) => sizes.forEach((z) => out.push({ color: c, size: z, colorIndex: ci, name: `${c.name} - ${z.name}` })));
    } else if (colors.length) {
        colors.forEach((c, ci) => out.push({ color: c, size: null, colorIndex: ci, name: c.name }));
    } else {
        sizes.forEach((z) => out.push({ color: null, size: z, colorIndex: -1, name: z.name }));
    }
    return out;
}
// Suggested variant SKU from the product SKU: colours get letters A, B, C...
// (YD-8981 -> YD-8981A, YD-8981B) and sizes are added after a dash. Editable.
function suggestVariantSku(baseSku, combo) {
    const base = String(baseSku || "").trim();
    if (!base) return null;
    let letters = "";
    if (combo.colorIndex >= 0) {
        let n = combo.colorIndex;
        do { letters = String.fromCharCode(65 + (n % 26)) + letters; n = Math.floor(n / 26) - 1; } while (n >= 0);
    }
    const size = combo.size ? "-" + String(combo.size.name).toUpperCase().replace(/[^A-Z0-9]+/g, "") : "";
    return (base + letters + size).slice(0, 64);
}
module.exports.variantCombos = variantCombos;
module.exports.suggestVariantSku = suggestVariantSku;
