// Variation cards on the vendor product form, and the shop name rule.
const test = require("node:test");
const assert = require("node:assert");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://liz:liz@localhost:5432/liz2";
process.env.DB_SSL = "false";
const { readVariations } = require("../server/controllers/productVariationsController");
const { cleanShopName } = require("../server/controllers/vendorController");

test("one card with no name means the product has no variations", () => {
    const r = readVariations({ variations: [{ name: "", sku: "", stock: 3, payout: 0 }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.list, [{ name: "", stock: 3, payout: null, sku: null, gtin: null }]);
});

test("the first variation sells at the product price; the others need a name, SKU and price", () => {
    const ok = readVariations({ variations: [{ name: "64GB", stock: 4 }, { name: " 128GB ", sku: "ts-128", gtin: "6001234567890", stock: "6", payout: "520000" }] });
    assert.equal(ok.ok, true);
    assert.equal(ok.list[0].payout, null);
    assert.deepEqual(ok.list[1], { name: "128GB", stock: 6, payout: 520000, sku: "TS-128", gtin: "6001234567890" });
    assert.match(readVariations({ variations: [{ name: "S" }, { name: "", sku: "A", payout: 5 }] }).error, /needs a name/);
    assert.match(readVariations({ variations: [{ name: "S" }, { name: "M", payout: 5 }] }).error, /Seller SKU/);
    assert.match(readVariations({ variations: [{ name: "S" }, { name: "M", sku: "A" }] }).error, /price/);
});

test("names and SKUs cannot repeat, quantities are whole numbers", () => {
    assert.match(readVariations({ variations: [{ name: "S" }, { name: "s", sku: "A", payout: 5 }] }).error, /own name/);
    assert.match(readVariations({ variations: [{ name: "S" }, { name: "M", sku: "A", payout: 5 }, { name: "L", sku: "a", payout: 5 }] }).error, /own/);
    assert.match(readVariations({ variations: [{ name: "S", stock: 1.5 }, { name: "M", sku: "A", payout: 5 }] }).error, /whole number/);
    assert.match(readVariations({ variations: [{ name: "S" }, { name: "M", sku: "bad sku!", payout: 5 }] }).error, /letters, numbers/);
    assert.equal(readVariations({}).ok, false);
    assert.equal(readVariations({ variations: Array.from({ length: 31 }, (_, i) => ({ name: "v" + i, sku: "S" + i, payout: 1 })) }).ok, false);
});

test("shop name: 3 to 60 characters, tidy spaces", () => {
    assert.deepEqual(cleanShopName("  Ann   &  Liz  "), { ok: true, name: "Ann & Liz" });
    assert.equal(cleanShopName("ab").ok, false);
    assert.equal(cleanShopName("x".repeat(61)).ok, false);
    assert.equal(cleanShopName("<b>Shop</b>").ok, false);
    assert.equal(cleanShopName("---").ok, false);
});
