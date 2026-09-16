const test = require("node:test");
const assert = require("node:assert/strict");
const { computeQualityScore } = require("../server/utils/productQuality");

test("a bare-minimum listing (no images, short description, nothing else) scores low", () => {
    const result = computeQualityScore({ name: "Shirt", description: "" }, 0);
    assert.equal(result.score, 0);
    assert.equal(result.tips.length > 0, true);
});

test("a fully-completed listing with 4+ images scores 100", () => {
    const product = {
        name: "Men's Blue Cotton Slim-Fit Shirt",
        description: "A".repeat(160),
        brand: "Acme",
        gtin: "1234567890123",
        material: "Cotton", color: "Blue", sleeve: "Long", style: "Casual",
        length: "Regular", fit: "Slim", pattern: "Solid",
        care_instructions: "Machine wash cold", occasion: "Everyday",
        package_size: "M", warranty_months: 6
    };
    const result = computeQualityScore(product, 5);
    assert.equal(result.score, 100);
    assert.equal(result.tips.length, 0);
});

test("images sub-score scales with image count, capping at 4+", () => {
    const base = { name: "A Reasonably Named Product Title", description: "x".repeat(160), brand: "B", gtin: "1" };
    const zero = computeQualityScore(base, 0).score;
    const one = computeQualityScore(base, 1).score;
    const three = computeQualityScore(base, 3).score;
    const four = computeQualityScore(base, 4).score;
    const five = computeQualityScore(base, 5).score;
    assert.equal(zero < one, true);
    assert.equal(one < three, true);
    assert.equal(three < four, true);
    assert.equal(four, five); // caps at 4+
});

test("an ALL-CAPS shouting title is penalized versus a normal-case title of the same length", () => {
    const shouting = computeQualityScore({ name: "AMAZING BEST DEAL SHIRT EVER", description: "", brand: null }, 0).score;
    const normal = computeQualityScore({ name: "Amazing Best Deal Shirt Ever", description: "", brand: null }, 0).score;
    assert.equal(shouting < normal, true);
});

test("a title outside 10-120 characters earns no title points", () => {
    const tooShort = computeQualityScore({ name: "Shirt", description: "x".repeat(160), brand: "B", gtin: "1" }, 4);
    const justRight = computeQualityScore({ name: "A Reasonably Named Product Title", description: "x".repeat(160), brand: "B", gtin: "1" }, 4);
    assert.equal(tooShort.score < justRight.score, true);
});

test("tips are sorted by points left on the table, worst first", () => {
    const result = computeQualityScore({ name: "Shirt", description: "", brand: null, gtin: null, mpn: null }, 0);
    for (let i = 1; i < result.tips.length; i++) {
        const prevMissed = result.tips[i - 1].points - result.tips[i - 1].earned;
        const currMissed = result.tips[i].points - result.tips[i].earned;
        assert.equal(prevMissed >= currMissed, true);
    }
});

test("brand and identifiers are simple present/absent checks", () => {
    const withBoth = computeQualityScore({ name: "x", description: "", brand: "Acme", gtin: "123" }, 0).score;
    const withNeither = computeQualityScore({ name: "x", description: "", brand: null, gtin: null, mpn: null }, 0).score;
    assert.equal(withBoth, withNeither + 20); // brand (10) + identifiers (10)
});
