// Package weight/dimensions -> delivery tier, server side (Ryan, Sept 2026).
// The formula lives in client/js/lz-package-size.js so the product forms'
// live preview and the saved value can never disagree. The server always
// recomputes; a hand-picked package_size is only a fallback for rows with
// no weight (older clients, imports without measurement columns).
const LzPackage = require("../../client/js/lz-package-size");

// src: req.body or an import row. -> { ok, error, provided, value, tier }
function readMeasurements(src) {
    const s = src || {};
    const raw = { weight_kg: s.weight_kg, length_cm: s.length_cm, width_cm: s.width_cm, height_cm: s.height_cm };
    const provided = Object.values(raw).some((v) => v !== undefined && v !== null && String(v).trim() !== "");
    const checked = LzPackage.normalizeMeasurements(raw);
    return {
        ok: checked.ok,
        error: checked.errors[0] || null,
        provided,
        value: checked.value,
        tier: checked.ok ? LzPackage.computePackageSize(checked.value) : null
    };
}

async function saveMeasurements(db, productId, value) {
    await db.query(
        "UPDATE products SET weight_kg = $1, length_cm = $2, width_cm = $3, height_cm = $4 WHERE id = $5",
        [value.weight_kg, value.length_cm, value.width_cm, value.height_cm, productId]
    );
}

module.exports = { readMeasurements, saveMeasurements, computePackageSize: LzPackage.computePackageSize };
