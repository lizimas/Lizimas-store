// Certifications a product can hold (Add Product form, product page).
// Shared by the browser and the server (UMD) so both use one list.
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LzCertifications = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";
    const LIST = [
        "UNBS Certified (Uganda National Bureau of Standards)",
        "UNBS Q-Mark",
        "NDA Approved (National Drug Authority)",
        "ISO 9001",
        "ISO 14001",
        "ISO 22000",
        "CE Marked",
        "FDA Approved",
        "FCC Certified",
        "RoHS Compliant",
        "ASTM Certified",
        "HACCP",
        "GMP (Good Manufacturing Practice)",
        "Halal Certified",
        "Organic Certified",
        "Eco Friendly",
        "Fair Trade",
        "Energy Star",
        "Cruelty Free",
        "Dermatologically Tested",
        "AFRDI - Australian Furnishing Research & Development Institute",
        "AFRDI Leather",
        "Australian Made"
    ];
    // Any input -> the listed certifications it names (no duplicates).
    function clean(value) {
        let arr = value;
        if (typeof arr === "string") {
            try { arr = JSON.parse(arr); } catch (e) { arr = arr.split("|"); }
        }
        if (!Array.isArray(arr)) return [];
        const want = new Set(arr.map((v) => String(v || "").trim()));
        return LIST.filter((c) => want.has(c));
    }
    return { LIST, clean };
});
