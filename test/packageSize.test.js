const test = require("node:test");
const assert = require("node:assert/strict");
const { computePackageSize, normalizeMeasurements } = require("../client/js/lz-package-size");
const { readMeasurements } = require("../server/utils/packageMeasurements");

const tier = (w, l, wi, h) => computePackageSize({ weight_kg: w, length_cm: l, width_cm: wi, height_cm: h });

test("package tiers follow docs/package-sizes.md examples", () => {
    assert.equal(tier(0.4, 18, 10, 6), "Small");        // smartphone
    assert.equal(tier(0.3, 35, 25, 5), "Small");        // shirt
    assert.equal(tier(12, 50, 40, 30), "Medium");       // microwave
    assert.equal(tier(25, 60, 40, 15), "Medium");       // 25 kg rice
    assert.equal(tier(18, 135, 85, 15), "Large");       // 55" TV
    assert.equal(tier(25, 190, 120, 25), "Large");      // mattress
    assert.equal(tier(15, 70, 70, 110), "Large");       // office chair
    assert.equal(tier(60, 90, 60, 85), "Extra Large");  // freezer
    assert.equal(tier(45, 60, 60, 90), "Extra Large");  // cooker
    assert.equal(tier(80, 200, 90, 85), "Extra Large"); // sofa set
});

test("weight alone is enough; no weight means no automatic tier", () => {
    assert.equal(tier(2), "Small");
    assert.equal(tier(31), "Large");
    assert.equal(tier(null, 10, 10, 10), null);
});

test("measurement validation", () => {
    assert.equal(normalizeMeasurements({ weight_kg: "abc" }).ok, false);
    assert.equal(normalizeMeasurements({ weight_kg: -1 }).ok, false);
    assert.equal(normalizeMeasurements({ weight_kg: 1, length_cm: 10 }).ok, false); // partial dimensions
    assert.equal(normalizeMeasurements({ weight_kg: 1, length_cm: 10, width_cm: 5, height_cm: 5 }).ok, true);
});

test("server reads form/import fields and reports whether any were sent", () => {
    const none = readMeasurements({ name: "x" });
    assert.equal(none.provided, false);
    assert.equal(none.tier, null);
    const some = readMeasurements({ weight_kg: "12", length_cm: "50", width_cm: "40", height_cm: "30" });
    assert.equal(some.provided, true);
    assert.equal(some.tier, "Medium");
    assert.equal(some.value.weight_kg, 12);
    assert.equal(readMeasurements({ weight_kg: "0" }).ok, false);
});
