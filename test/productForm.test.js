// Add Product redesign rules (Sept 2026): variant rows and suggested SKUs,
// the colour list, the extra price fields, and what public endpoints hide.
const test = require("node:test");
const assert = require("node:assert");
const f = require("../server/utils/productForm");

const colors = [{ id: 1, name: "Black" }, { id: 2, name: "Beige" }];
const sizes = [{ id: 9, name: "M" }, { id: 10, name: "XL" }];

test("variants: colour-only, size-only and colour x size", () => {
    assert.deepStrictEqual(f.variantCombos(colors, []).map((c) => c.name), ["Black", "Beige"]);
    assert.deepStrictEqual(f.variantCombos([], sizes).map((c) => c.name), ["M", "XL"]);
    assert.strictEqual(f.variantCombos(colors, sizes).length, 4);
    assert.deepStrictEqual(f.variantCombos([], []), []);
});

test("suggested variant SKUs follow the product SKU", () => {
    const sku = (cs, zs) => f.variantCombos(cs, zs).map((c) => f.suggestVariantSku("YD-8981", c));
    assert.deepStrictEqual(sku(colors, []), ["YD-8981A", "YD-8981B"]);
    assert.deepStrictEqual(sku([], sizes), ["YD-8981-M", "YD-8981-XL"]);
    assert.deepStrictEqual(sku(colors, sizes), ["YD-8981A-M", "YD-8981A-XL", "YD-8981B-M", "YD-8981B-XL"]);
    assert.strictEqual(f.suggestVariantSku("", f.variantCombos(colors, [])[0]), null);
    const many = Array.from({ length: 28 }, (_, i) => ({ id: i, name: "C" + i }));
    assert.strictEqual(f.suggestVariantSku("P", f.variantCombos(many, [])[26]), "PAA");
});

test("colour list input: name and colour code", () => {
    assert.deepStrictEqual(f.cleanColorInput({ name: "  Beige ", hex: "#e8dcc4" }, false).value, { name: "Beige", hex: "#E8DCC4" });
    assert.ok(f.cleanColorInput({ name: "", hex: "#FFFFFF" }, false).error);
    assert.ok(f.cleanColorInput({ name: "Red", hex: "red" }, false).error);
    assert.deepStrictEqual(f.cleanColorInput({ hex: "" }, true).value, { hex: null });
    assert.deepStrictEqual(f.cleanColorInput({ name: "Navy" }, true).value, { name: "Navy" });
});

test("cost and Was price are Lizimas-only; blanks clear", () => {
    assert.deepStrictEqual(f.readExtraProductFields({ cost_price: "59,976", compare_at_price: "165000", low_stock_threshold: "10" }, "admin"),
        { cost_price: 59976, compare_at_price: 165000, low_stock_threshold: 10 });
    assert.deepStrictEqual(f.readExtraProductFields({ cost_price: "5", compare_at_price: "9" }, "vendor"), {});
    assert.deepStrictEqual(f.readExtraProductFields({ compare_at_price: "", low_stock_threshold: "" }, "admin"), { compare_at_price: null, low_stock_threshold: null });
    assert.deepStrictEqual(f.readExtraProductFields({}, "admin"), {});
    assert.throws(() => f.readExtraProductFields({ cost_price: "-3" }, "admin"));
    assert.throws(() => f.readExtraProductFields({ low_stock_threshold: "2.5" }, "admin"));
});

test("public product rows hide cost, commission and review notes", () => {
    const row = f.publicProductRow({ id: 1, name: "Cup", price: 5, compare_at_price: 7, cost_price: 3, vendor_desired_payout: 4,
        commission_rate_applied: 0.1, review_flags: ["suspected_counterfeit"], review_reason_code: "x", reviewed_by: 2 });
    assert.deepStrictEqual(row, { id: 1, name: "Cup", price: 5, compare_at_price: 7 });
});
