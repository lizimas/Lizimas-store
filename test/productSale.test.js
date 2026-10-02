// Sale Price on the product form + certifications (Oct 2026).
const test = require("node:test");
const assert = require("node:assert");
const { readSaleFields, syncProductSale } = require("../server/utils/productSale");
const Certs = require("../client/js/lz-certifications.js");

const NOW = new Date("2026-10-02T09:00:00Z");

test("sale fields: not sent, empty, valid and invalid", () => {
    assert.deepStrictEqual(readSaleFields({}, 50000, NOW), { ok: true, sent: false, sale: null });
    assert.deepStrictEqual(readSaleFields({ sale_price: "" }, 50000, NOW), { ok: true, sent: true, sale: null });
    const ok = readSaleFields({ sale_price: "40000", sale_start: "2026-10-05", sale_end: "2026-10-12" }, 50000, NOW);
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.sale.vendorPrice, 40000);
    assert.strictEqual(ok.sale.startsAt.toISOString(), "2026-10-04T21:00:00.000Z");   // midnight in Uganda
    assert.strictEqual(ok.sale.endsAt.toISOString(), "2026-10-12T20:59:59.000Z");     // end of that day in Uganda
    assert.match(readSaleFields({ sale_price: "50000", sale_end: "2026-10-12" }, 50000, NOW).error, /lower than the price/);
    assert.match(readSaleFields({ sale_price: "40000" }, 50000, NOW).error, /end date/);
    assert.match(readSaleFields({ sale_price: "40000", sale_start: "2026-10-12", sale_end: "2026-10-05" }, 50000, NOW).error, /after the sale start/);
    assert.match(readSaleFields({ sale_price: "40000", sale_end: "2026-09-01" }, 50000, new Date("2026-08-01")).ok.toString(), /true/);
    assert.match(readSaleFields({ sale_price: "40000", sale_start: "2026-08-01", sale_end: "2026-09-01" }, 50000, NOW).error, /already passed/);
});

function fakeDb(otherPromo) {
    const calls = [];
    return { calls, query: async (sql, params) => { calls.push([sql.replace(/\s+/g, " ").trim(), params]);
        return { rows: /source <> 'product_form'/.test(sql) && otherPromo ? [{}] : [] }; } };
}
const pricing = { calculatePricing: async ({ vendorPayout }) => ({ customerPrice: Math.round(vendorPayout * 1.15) }) };

test("a sale becomes an approved promotion at the customer price", async () => {
    const db = fakeDb(false);
    const sale = { vendorPrice: 40000, startsAt: new Date("2026-10-05"), endsAt: new Date("2026-10-12") };
    const r = await syncProductSale(db, { productId: 7, vendorId: 3, categoryId: 2, customerPrice: 57500, sale }, pricing);
    assert.strictEqual(r.customerSale, 46000);
    const insert = db.calls.find(([s]) => s.startsWith("INSERT INTO vendor_promotions"));
    assert.deepStrictEqual(insert[1].slice(0, 4), [3, 7, 57500, 46000]);
    assert.strictEqual(insert[1][6], "approved");   // 20% off: goes live by itself
    assert.strictEqual(r.status, "approved");
    assert.match(insert[0], /'product_form'/);

    // More than 30% off waits for an admin.
    const big = fakeDb(false);
    const r2 = await syncProductSale(big, { productId: 7, vendorId: 3, categoryId: 2, customerPrice: 57500,
        sale: { vendorPrice: 30000, startsAt: new Date("2026-10-05"), endsAt: new Date("2026-10-12") } }, pricing);
    assert.strictEqual(big.calls.find(([s]) => s.startsWith("INSERT INTO vendor_promotions"))[1][6], "pending");
    assert.match(r2.note, /40% off.*above 30%/);
});

test("clearing the sale removes it; another promotion keeps the sale from running", async () => {
    const db = fakeDb(false);
    await syncProductSale(db, { productId: 7, vendorId: 3, customerPrice: 57500, sale: null }, pricing);
    assert.match(db.calls[0][0], /^DELETE FROM vendor_promotions WHERE product_id = \$1 AND source = 'product_form'/);
    assert.ok(!db.calls.some(([s]) => s.startsWith("INSERT")));

    const busy = fakeDb(true);
    const r = await syncProductSale(busy, { productId: 7, vendorId: 3, customerPrice: 57500,
        sale: { vendorPrice: 40000, startsAt: new Date("2026-10-05"), endsAt: new Date("2026-10-12") } }, pricing);
    assert.match(r.note, /already has a promotion/);
    assert.ok(!busy.calls.some(([s]) => s.startsWith("INSERT")));
});

test("certifications: only listed ones are kept", () => {
    assert.deepStrictEqual(Certs.clean(JSON.stringify(["ISO 9001", "Made up", "Fair Trade", "ISO 9001"])), ["ISO 9001", "Fair Trade"]);
    assert.deepStrictEqual(Certs.clean(""), []);
    assert.deepStrictEqual(Certs.clean(undefined), []);
});
