const test = require("node:test");
const assert = require("node:assert/strict");
const {
    deriveCampaignStatus, validateCampaignEntryPrice, validateCampaignInput, buildDailySeries, effectiveDiscountBand
} = require("../server/utils/promotionCampaigns");
const { computeReplenishment, summarizeReplenishment } = require("../server/utils/stockRecommendation");

const now = new Date("2026-10-01T12:00:00Z");
const c = (o) => ({ is_cancelled: false, registration_ends_at: "2026-10-05T00:00:00Z", starts_at: "2026-10-06T00:00:00Z", ends_at: "2026-10-20T00:00:00Z", ...o });

test("deriveCampaignStatus covers open / idle / ongoing / expired / cancelled", () => {
    assert.equal(deriveCampaignStatus(c({}), now), "open");
    assert.equal(deriveCampaignStatus(c({ registration_ends_at: "2026-09-30T00:00:00Z" }), now), "idle");
    assert.equal(deriveCampaignStatus(c({ starts_at: "2026-09-30T00:00:00Z", registration_ends_at: "2026-09-29T00:00:00Z" }), now), "ongoing");
    assert.equal(deriveCampaignStatus(c({ ends_at: "2026-10-01T00:00:00Z", starts_at: "2026-09-20T00:00:00Z", registration_ends_at: "2026-09-19T00:00:00Z" }), now), "expired");
    assert.equal(deriveCampaignStatus(c({ is_cancelled: true }), now), "cancelled");
});

test("validateCampaignEntryPrice enforces the campaign band", () => {
    const camp = { min_discount_pct: 10, max_discount_pct: 50 };
    assert.equal(validateCampaignEntryPrice({ originalPrice: 1000, salePrice: 950, campaign: camp }).allowed, false); // 5%
    assert.equal(validateCampaignEntryPrice({ originalPrice: 1000, salePrice: 900, campaign: camp }).allowed, true);  // exactly 10%
    assert.equal(validateCampaignEntryPrice({ originalPrice: 1000, salePrice: 500, campaign: camp }).allowed, true);  // exactly 50%
    assert.equal(validateCampaignEntryPrice({ originalPrice: 1000, salePrice: 400, campaign: camp }).allowed, false); // 60%
    assert.equal(validateCampaignEntryPrice({ originalPrice: 1000, salePrice: 1000, campaign: camp }).allowed, false);
});

test("no max discount falls back to the standard 50% ceiling; a higher campaign max is honoured", () => {
    assert.equal(effectiveDiscountBand({ min_discount_pct: null, max_discount_pct: null }).max, 50);
    assert.equal(validateCampaignEntryPrice({ originalPrice: 1000, salePrice: 400, campaign: { max_discount_pct: 60 } }).allowed, true);
});

test("validateCampaignInput rejects bad windows and bands", () => {
    const ok = { name: "Payweek", registration_ends_at: "2026-10-05T00:00:00Z", starts_at: "2026-10-06T00:00:00Z", ends_at: "2026-10-20T00:00:00Z" };
    assert.deepEqual(validateCampaignInput(ok, now).errors, []);
    assert.ok(validateCampaignInput({ ...ok, name: "" }, now).errors.length);
    assert.ok(validateCampaignInput({ ...ok, registration_ends_at: "2026-10-07T00:00:00Z" }, now).errors.length);
    assert.ok(validateCampaignInput({ ...ok, ends_at: "2026-10-05T00:00:00Z" }, now).errors.length);
    assert.ok(validateCampaignInput({ ...ok, min_discount_pct: 40, max_discount_pct: 20 }, now).errors.length);
});

test("buildDailySeries fills missing days with zero, oldest first", () => {
    const s = buildDailySeries([{ day: "2026-10-01", revenue: "5000" }, { day: "2026-09-29", revenue: 100 }], 7, now);
    assert.equal(s.length, 7);
    assert.equal(s[6].day, "2026-10-01");
    assert.equal(s[6].revenue, 5000);
    assert.equal(s[4].revenue, 100);
    assert.equal(s[0].revenue, 0);
});

test("computeReplenishment: suggested = target - available - in transit", () => {
    // 60 sold in 30 days = 2/day -> target 60; 10 own + 5 at hub + 20 in transit -> 25
    const r = computeReplenishment({ stock: 10, consignedStock: 5, inTransit: 20, unitsSoldWindow: 60, sellable: true });
    assert.equal(r.available, 15);
    assert.equal(r.targetStock, 60);
    assert.equal(r.suggestedQty, 25);
    assert.equal(r.status, "low_stock");
});

test("computeReplenishment statuses", () => {
    assert.equal(computeReplenishment({ stock: 0, unitsSoldWindow: 30, sellable: true }).status, "out_of_stock");
    assert.equal(computeReplenishment({ stock: 0, unitsSoldWindow: 30, sellable: true }).missedUnits, 30);
    assert.equal(computeReplenishment({ stock: 100, unitsSoldWindow: 30, sellable: true }).status, "ok");
    assert.equal(computeReplenishment({ stock: 0, unitsSoldWindow: 30, sellable: false }).status, "sales_issue");
    assert.equal(computeReplenishment({ stock: 5, unitsSoldWindow: 0, sellable: true }).suggestedQty, 0);
});

test("summarizeReplenishment totals and counts", () => {
    const rows = [
        computeReplenishment({ stock: 0, unitsSoldWindow: 30, sellable: true }),
        computeReplenishment({ stock: 100, unitsSoldWindow: 30, sellable: true, inTransit: 4 })
    ];
    const { summary, counts } = summarizeReplenishment(rows);
    assert.equal(summary.totalSkus, 2);
    assert.equal(summary.available, 100);
    assert.equal(summary.inTransit, 4);
    assert.equal(counts.out_of_stock, 1);
    assert.equal(counts.ok, 1);
});
