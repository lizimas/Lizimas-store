const test = require("node:test");
const assert = require("node:assert/strict");
const {
    shippingScoreFromAvgHours,
    qualityScoreFromCounts,
    ratingScoreFromAverage,
    cancellationRateFromCounts,
    labelForScore,
    overallScore
} = require("../server/utils/sellerScore");

test("shipping score is perfect within the 48h target, and hits 0 at the 7-day floor", () => {
    assert.equal(shippingScoreFromAvgHours(10), 100);
    assert.equal(shippingScoreFromAvgHours(48), 100);
    assert.equal(shippingScoreFromAvgHours(168), 0);
    assert.equal(shippingScoreFromAvgHours(300), 0); // never goes negative
    assert.equal(shippingScoreFromAvgHours(108), 50); // halfway between 48h and 168h
});

test("shipping score is null with no data", () => {
    assert.equal(shippingScoreFromAvgHours(null), null);
    assert.equal(shippingScoreFromAvgHours(NaN), null);
});

test("quality score is the inspection pass rate", () => {
    assert.equal(qualityScoreFromCounts(10, 0), 100);
    assert.equal(qualityScoreFromCounts(10, 1), 90);
    assert.equal(qualityScoreFromCounts(10, 10), 0);
    assert.equal(qualityScoreFromCounts(0, 0), null);
});

test("rating score scales 0-5 stars to 0-100", () => {
    assert.equal(ratingScoreFromAverage(5), 100);
    assert.equal(ratingScoreFromAverage(2.5), 50);
    assert.equal(ratingScoreFromAverage(0), 0);
    assert.equal(ratingScoreFromAverage(null), null);
});

test("cancellation rate is the plain percentage of cancelled items", () => {
    assert.equal(cancellationRateFromCounts(1, 10), 10);
    assert.equal(cancellationRateFromCounts(0, 10), 0);
    assert.equal(cancellationRateFromCounts(10, 10), 100);
    assert.equal(cancellationRateFromCounts(0, 0), null);
});

test("labelForScore buckets match the documented bands", () => {
    assert.equal(labelForScore(null), "New");
    assert.equal(labelForScore(95), "Excellent");
    assert.equal(labelForScore(90), "Excellent");
    assert.equal(labelForScore(80), "Good");
    assert.equal(labelForScore(60), "Fair");
    assert.equal(labelForScore(10), "Poor");
    assert.equal(labelForScore(0), "Poor");
});

test("overallScore renormalizes weights over only the available sub-scores", () => {
    // Only a rating score available - the overall score should just BE the
    // rating score, not diluted by three missing signals treated as 0.
    assert.equal(overallScore({ shipping: null, quality: null, rating: 80, cancellation: null }), 80);
});

test("overallScore blends all four when every signal has enough data", () => {
    const result = overallScore({ shipping: 100, quality: 100, rating: 100, cancellation: 100 });
    assert.equal(result, 100);
});

test("overallScore returns null when nothing has enough data yet", () => {
    assert.equal(overallScore({ shipping: null, quality: null, rating: null, cancellation: null }), null);
});
