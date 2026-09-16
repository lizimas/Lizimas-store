const test = require("node:test");
const assert = require("node:assert/strict");
const { generateShopId } = require("../server/utils/shopId");

// Fake `client`/pool - just enough of the pg interface (a .query() that
// resolves { rows }) for generateShopId to run without a real database.
function fakeRunner(nextval) {
    return {
        query: async (sql) => {
            assert.match(sql, /nextval\('vendor_shop_id_seq'\)/);
            return { rows: [{ n: nextval }] };
        }
    };
}

test("generateShopId matches Jumia's Shop ID shape: UG + digits + 2 uppercase letters", async () => {
    const shopId = await generateShopId(fakeRunner(140));
    assert.match(shopId, /^UG\d{3,}[A-Z]{2}$/);
    assert.equal(shopId.startsWith("UG140"), true);
});

test("generateShopId pads a small sequence number to 3 digits", async () => {
    const shopId = await generateShopId(fakeRunner(7));
    assert.equal(shopId.slice(0, 5), "UG007");
});

test("generateShopId does not truncate a sequence number past 999", async () => {
    const shopId = await generateShopId(fakeRunner(12345));
    assert.equal(shopId.slice(0, 7), "UG12345");
});

test("generateShopId's random letters are always uppercase A-Z", async () => {
    for (let i = 0; i < 20; i++) {
        const shopId = await generateShopId(fakeRunner(100));
        const letters = shopId.slice(-2);
        assert.match(letters, /^[A-Z]{2}$/);
    }
});
