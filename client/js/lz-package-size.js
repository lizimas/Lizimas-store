// Automatic package size / delivery tier (Ryan, Sept 2026).
//
// Vendors and staff no longer pick "Package Size (delivery tier)" by hand -
// they enter the packed product's weight and dimensions and the tier that
// drives delivery charges (server/utils/deliveryPricing.js) is worked out
// here. Shared by the server (productController / adminController, which
// always recompute before saving) and every product form (live preview).
//
// Limits follow docs/package-sizes.md (how the item ships):
//   Small       fits in a boda rider's bag        <= 3 kg, longest side <= 45 cm, <= 40 L
//   Medium      boda, strapped / on the seat      <= 30 kg, longest side <= 80 cm, <= 120 L
//   Large       special hire / van, one person    <= 40 kg, longest side <= 200 cm, <= 700 L
//   Extra Large pickup / truck or two people      anything bigger
// A package moves up a tier as soon as ANY one limit is passed.
// Checked against the guide's examples: phone/shirt/perfume -> Small,
// microwave / 25 kg rice -> Medium, 55" TV / mattress / office chair -> Large,
// freezer / cooker / sofa set -> Extra Large.

(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LzPackage = api;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const TIERS = [
        { tier: "Small", maxKg: 3, maxSideCm: 45, maxLitres: 40 },
        { tier: "Medium", maxKg: 30, maxSideCm: 80, maxLitres: 120 },
        { tier: "Large", maxKg: 40, maxSideCm: 200, maxLitres: 700 }
    ];
    const TIER_NOTES = {
        "Small": "fits in a boda rider's bag",
        "Medium": "boda, strapped or on the seat",
        "Large": "special hire or van, one person",
        "Extra Large": "pickup or truck, two people"
    };
    const LIMITS = { maxKg: 1000, maxCm: 1000 };

    function num(v) {
        if (v === null || v === undefined || String(v).trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : NaN;
    }

    // -> { ok, value: {weight_kg, length_cm, width_cm, height_cm}, errors }
    function normalizeMeasurements(input) {
        const src = input || {};
        const value = {
            weight_kg: num(src.weight_kg),
            length_cm: num(src.length_cm),
            width_cm: num(src.width_cm),
            height_cm: num(src.height_cm)
        };
        const errors = [];
        if (Number.isNaN(value.weight_kg) || (value.weight_kg && value.weight_kg > LIMITS.maxKg)) errors.push("Enter the package weight in kg (a number above 0).");
        for (const k of ["length_cm", "width_cm", "height_cm"]) {
            if (Number.isNaN(value[k]) || (value[k] && value[k] > LIMITS.maxCm)) { errors.push("Enter the package length, width and height in cm (numbers above 0)."); break; }
        }
        const dims = [value.length_cm, value.width_cm, value.height_cm].filter((x) => x != null && !Number.isNaN(x));
        if (dims.length > 0 && dims.length < 3) errors.push("Enter all three dimensions (length, width and height) or leave them all blank.");
        return { ok: errors.length === 0, value, errors };
    }

    // Returns the tier name, or null when there's nothing to go on (no weight).
    function computePackageSize(input) {
        const { ok, value } = normalizeMeasurements(input);
        if (!ok || value.weight_kg == null) return null;
        const hasDims = value.length_cm != null && value.width_cm != null && value.height_cm != null;
        const longest = hasDims ? Math.max(value.length_cm, value.width_cm, value.height_cm) : 0;
        const litres = hasDims ? (value.length_cm * value.width_cm * value.height_cm) / 1000 : 0;
        for (const t of TIERS) {
            if (value.weight_kg <= t.maxKg && longest <= t.maxSideCm && litres <= t.maxLitres) return t.tier;
        }
        return "Extra Large";
    }

    // --- Browser helpers (every product form uses the same ids with a prefix:
    //     <prefix>-weight-kg, -length-cm, -width-cm, -height-cm, -package-size
    //     (hidden) and -package-tier-note). -------------------------------------
    function el(prefix, suffix) { return typeof document !== "undefined" ? document.getElementById(`${prefix}-${suffix}`) : null; }

    function read(prefix) {
        return {
            weight_kg: (el(prefix, "weight-kg") || {}).value,
            length_cm: (el(prefix, "length-cm") || {}).value,
            width_cm: (el(prefix, "width-cm") || {}).value,
            height_cm: (el(prefix, "height-cm") || {}).value
        };
    }

    function refresh(prefix) {
        const note = el(prefix, "package-tier-note");
        const hidden = el(prefix, "package-size");
        const m = read(prefix);
        const checked = normalizeMeasurements(m);
        const tier = computePackageSize(m);
        if (hidden && tier) hidden.value = tier;
        if (!note) return tier;
        // Ryan, Sept 2026: the delivery size is worked out quietly in the
        // background - the person uploading only sees a message when a
        // number they typed can't be used.
        if (!checked.ok) { note.textContent = checked.errors[0]; note.className = "lz-pack-note lz-pack-note-error"; note.hidden = false; }
        else { note.textContent = ""; note.className = "lz-pack-note"; note.hidden = true; }
        return tier;
    }

    // Fill the inputs for editing (product) or clear them (null).
    function fill(prefix, product) {
        const p = product || {};
        const set = (s, v) => { const e = el(prefix, s); if (e) e.value = v == null ? "" : String(Number(v)); };
        set("weight-kg", p.weight_kg);
        set("length-cm", p.length_cm);
        set("width-cm", p.width_cm);
        set("height-cm", p.height_cm);
        const hidden = el(prefix, "package-size");
        if (hidden) { hidden.value = p.package_size || "Small"; hidden.dataset.saved = product ? (p.package_size || "") : ""; }
        refresh(prefix);
    }

    // Add the measurements to a product FormData (the server recomputes the tier).
    function appendTo(formData, prefix) {
        const m = read(prefix);
        for (const k of Object.keys(m)) formData.append(k, m[k] == null ? "" : String(m[k]).trim());
    }

    // Client-side check before saving. requireWeight: true for new products.
    function validate(prefix, requireWeight) {
        const m = read(prefix);
        const checked = normalizeMeasurements(m);
        if (!checked.ok) return checked.errors[0];
        if (requireWeight && checked.value.weight_kg == null) return "Enter the packed weight (kg) so the delivery size can be worked out.";
        return null;
    }

    function bind(prefix) {
        ["weight-kg", "length-cm", "width-cm", "height-cm"].forEach((s) => {
            const e = el(prefix, s);
            if (e && !e.dataset.lzPackBound) { e.dataset.lzPackBound = "1"; e.addEventListener("input", () => refresh(prefix)); }
        });
        refresh(prefix);
    }

    if (typeof document !== "undefined") {
        const auto = () => document.querySelectorAll("[data-lz-pack]").forEach((host) => bind(host.dataset.lzPack));
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto();
    }

    return { TIERS, TIER_NOTES, normalizeMeasurements, computePackageSize, read, refresh, fill, appendTo, validate, bind };
});
