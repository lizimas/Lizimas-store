const test = require("node:test");
const assert = require("node:assert/strict");
const { computeStockRecommendation } = require("../server/utils/stockRecommendation");

test("no sales in the trailing window and no stock: no_recent_sales, no reorder suggested", () => {
    const result = computeStockRecommendation({ stock: 0, unitsSoldWindow: 0 });
    assert.equal(result.urgency, "no_recent_sales");
    assert.equal(result.recommendedReorderQty, 0);
    assert.equal(result.dailyVelocity, 0);
});

test("no sales in the trailing window but stock on hand: ok, days remaining is null (can't estimate)", () => {
    const result = computeStockRecommendation({ stock: 20, unitsSoldWindow: 0 });
    assert.equal(result.urgency, "ok");
    assert.equal(result.daysOfStockRemaining, null);
    assert.equal(result.recommendedReorderQty, 0);
});

test("selling fast with only a few days of cover left: reorder_now, with a reorder quantity", () => {
    // 60 units sold in 30 days = 2/day; 10 in stock = 5 days of cover.
    const result = computeStockRecommendation({ stock: 10, unitsSoldWindow: 60 });
    assert.equal(result.dailyVelocity, 2);
    assert.equal(result.daysOfStockRemaining, 5);
    assert.equal(result.urgency, "reorder_now");
    // Target cover is 30 days at 2/day = 60 units; already holding 10, so recommend 50 more.
    assert.equal(result.recommendedReorderQty, 50);
});

test("moderate velocity with 10-14 days of cover left: reorder_soon", () => {
    // 30 units sold in 30 days = 1/day; 12 in stock = 12 days of cover.
    const result = computeStockRecommendation({ stock: 12, unitsSoldWindow: 30 });
    assert.equal(result.dailyVelocity, 1);
    assert.equal(result.daysOfStockRemaining, 12);
    assert.equal(result.urgency, "reorder_soon");
    assert.equal(result.recommendedReorderQty, 18);
});

test("healthy stock well beyond the reorder window: ok, no reorder suggested", () => {
    // 30 units sold in 30 days = 1/day; 90 in stock = 90 days of cover.
    const result = computeStockRecommendation({ stock: 90, unitsSoldWindow: 30 });
    assert.equal(result.urgency, "ok");
    assert.equal(result.recommendedReorderQty, 0);
});

test("zero stock but still selling recently: reorder_now (0 days of cover)", () => {
    const result = computeStockRecommendation({ stock: 0, unitsSoldWindow: 15 });
    assert.equal(result.daysOfStockRemaining, 0);
    assert.equal(result.urgency, "reorder_now");
    assert.equal(result.recommendedReorderQty > 0, true);
});

test("handles missing/undefined inputs as zero rather than throwing", () => {
    const result = computeStockRecommendation({});
    assert.equal(result.stock, 0);
    assert.equal(result.unitsSoldWindow, 0);
    assert.equal(result.urgency, "no_recent_sales");
});
