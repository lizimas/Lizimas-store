const test = require("node:test");
const assert = require("node:assert");
const { variantPriceFromPayout, repriceVariants } = require("../server/utils/variantPricing");

test("variant price follows the product's commission snapshot", () => {
    const p = { commission_rate_applied: "0.15", fixed_fee_applied: "0" };
    assert.strictEqual(variantPriceFromPayout(p, 70000), 82400);
    assert.strictEqual(variantPriceFromPayout({ commission_rate_applied: null }, 70000), null);
});

test("repriceVariants: plain variants follow the product price, own payouts are re-priced", async () => {
    const calls = [];
    const db = {
        query: async (sql, params) => {
            calls.push([sql.replace(/\s+/g, " ").trim(), params]);
            if (/SELECT id, vendor_payout/.test(sql)) return { rows: [{ id: 7, vendor_payout: "70000" }] };
            return { rows: [] };
        }
    };
    await repriceVariants(db, { id: 11, price: 64000, commission_rate_applied: "0.2", fixed_fee_applied: "0" });
    assert.match(calls[0][0], /vendor_payout IS NULL/);
    assert.deepStrictEqual(calls[0][1], [11, 64000]);
    const own = calls.find(c => /WHERE id = \$2/.test(c[0]));
    assert.deepStrictEqual(own[1], [87500, 7]);
});
