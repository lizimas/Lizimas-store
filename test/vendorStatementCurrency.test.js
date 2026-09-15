// Phase 4 Beat 3 - USD dual-currency vendor statements. Pure-logic tests
// for server/utils/fxRate.js. No DB/network - convertUgxToUsd/convertUsdToUgx/
// normalizeAmount are pure functions, and the live-fetch path
// (getUsdToUgxRate) is exercised for its cache/error-shape behavior only,
// with fetch mocked so this suite never makes a real network call.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    convertUgxToUsd,
    convertUsdToUgx,
    normalizeAmount,
    round2,
    getUsdToUgxRate
} = require("../server/utils/fxRate.js");

test("round2 rounds to 2 decimal places, half-up", () => {
    assert.equal(round2(10.005), 10.01);
    assert.equal(round2(10.004), 10);
    assert.equal(round2(-5.005), -5);
});

test("convertUgxToUsd divides by the UGX-per-USD rate and rounds to cents", () => {
    assert.equal(convertUgxToUsd(370000, 3700), 100);
    assert.equal(convertUgxToUsd(123456, 3700), 33.37);
    assert.equal(convertUgxToUsd(0, 3700), 0);
});

test("convertUgxToUsd throws on an invalid rate rather than dividing by zero/garbage", () => {
    assert.throws(() => convertUgxToUsd(1000, 0));
    assert.throws(() => convertUgxToUsd(1000, -1));
    assert.throws(() => convertUgxToUsd(1000, null));
});

test("convertUsdToUgx multiplies by the rate and rounds to 2dp", () => {
    assert.equal(convertUsdToUgx(100, 3700), 370000);
    assert.equal(convertUsdToUgx(33.37, 3700), 123469);
});

test("convertUgxToUsd and convertUsdToUgx round-trip within a cent", () => {
    const rate = 3812.5;
    const originalUgx = 987654;
    const usd = convertUgxToUsd(originalUgx, rate);
    const backToUgx = convertUsdToUgx(usd, rate);
    // Two independent 2-decimal-place roundings (UGX->USD, then USD->UGX)
    // can each drift by up to half a cent in UGX terms (rate / 200) -
    // tolerance reflects that, not an arbitrary number.
    const tolerance = rate / 100;
    assert.ok(Math.abs(backToUgx - originalUgx) < tolerance, `round-trip drifted too far: ${originalUgx} -> ${usd} -> ${backToUgx}`);
});

test("normalizeAmount is a no-op when currencies already match", () => {
    assert.equal(normalizeAmount(50000, "UGX", null, "UGX"), 50000);
    assert.equal(normalizeAmount(75.5, "USD", 3700, "USD"), 75.5);
});

test("normalizeAmount converts UGX statement amounts into USD for a vendor now preferring USD", () => {
    // A vendor's OWN historical statement was locked in UGX (fx_rate_used
    // is null/irrelevant for a UGX-denominated row); normalizing it into
    // their new USD preference needs an explicit rate to convert WITH,
    // since the row itself never had one.
    assert.throws(() => normalizeAmount(370000, "UGX", null, "USD"));
    assert.equal(normalizeAmount(370000, "UGX", 3700, "USD"), 100);
});

test("normalizeAmount converts a USD-locked statement back to UGX using its own locked rate", () => {
    assert.equal(normalizeAmount(100, "USD", 3700, "UGX"), 370000);
});

test("normalizeAmount rejects a currency pair it doesn't know about", () => {
    assert.throws(() => normalizeAmount(100, "EUR", 3700, "UGX"));
});

test("getUsdToUgxRate: on a live fetch success, caches and returns a fresh, non-stale rate", async (t) => {
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
        calls += 1;
        return {
            ok: true,
            json: async () => ({ rates: { UGX: 3750 } })
        };
    };
    t.after(() => { global.fetch = originalFetch; });

    const result = await getUsdToUgxRate({ forceRefresh: true });
    assert.equal(result.rate, 3750);
    assert.equal(result.stale, false);
    assert.ok(calls >= 1);
});

test("getUsdToUgxRate: throws a clear error when every provider fails and there is no cache", async (t) => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    t.after(() => { global.fetch = originalFetch; });

    // Use a fresh module instance so this test's failure doesn't collide
    // with the cache the earlier success test populated in-process.
    delete require.cache[require.resolve("../server/utils/fxRate.js")];
    const isolated = require("../server/utils/fxRate.js");

    await assert.rejects(
        () => isolated.getUsdToUgxRate({ forceRefresh: true }),
        /Could not fetch a live USD exchange rate/
    );

    // Restore the normal module instance for any later requires in this process.
    delete require.cache[require.resolve("../server/utils/fxRate.js")];
    require("../server/utils/fxRate.js");
});
