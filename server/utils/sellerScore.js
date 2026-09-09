const pool = require("../config/database");

// Seller Score / Seller Performance (spec: "Seller Score - vendor sees it,
// Lizimas calculates" + Ryan's Sept 2026 ask to show a Jumia-style seller
// panel on product pages). Four independent signals, each turned into a
// 0-100 sub-score and bucketed into the same Excellent/Good/Fair/Poor
// labels Jumia uses, plus one weighted overall percentage.
//
// Every threshold and weight below is a considered starting point, not a
// business rule handed down in a spec - same spirit as the 15% default
// commission rate (migrations/061). Tune freely once there's enough real
// order volume to judge them against.

// Below this many completed data points for a signal, it has no opinion -
// shown as "New" rather than let one early order swing a whole bucket.
const MIN_SAMPLES = {
    shipping: 5,     // handed-over items
    quality: 5,      // inspected items (accepted or rejected)
    rating: 3,       // product reviews
    cancellation: 5  // order items ever placed
};

// How much each available sub-score counts toward the overall percentage.
// Renormalized over whichever signals actually have enough data - a brand
// new vendor with only reviews so far is scored on reviews alone, not
// dragged down by three blank signals.
const WEIGHTS = {
    shipping: 0.20,
    quality: 0.30,
    rating: 0.35,
    cancellation: 0.15
};

const LABEL_BANDS = [
    { min: 90, label: "Excellent" },
    { min: 75, label: "Good" },
    { min: 50, label: "Fair" },
    { min: 0, label: "Poor" }
];

// Handover turnaround (order placed -> vendor handed it to a drop-off
// point) scored against a 48h target, reaching 0 at a full week. Pure -
// unit-tested directly.
const SHIPPING_TARGET_HOURS = 48;
const SHIPPING_FLOOR_HOURS = 168; // 7 days

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function shippingScoreFromAvgHours(avgHours) {
    if (avgHours == null || !Number.isFinite(avgHours)) return null;
    if (avgHours <= SHIPPING_TARGET_HOURS) return 100;
    const span = SHIPPING_FLOOR_HOURS - SHIPPING_TARGET_HOURS;
    const over = avgHours - SHIPPING_TARGET_HOURS;
    return clamp(100 - (over / span) * 100, 0, 100);
}

function qualityScoreFromCounts(inspected, rejected) {
    if (!inspected || inspected <= 0) return null;
    return clamp(100 * (inspected - rejected) / inspected, 0, 100);
}

function ratingScoreFromAverage(avgRating) {
    if (avgRating == null || !Number.isFinite(avgRating)) return null;
    return clamp((avgRating / 5) * 100, 0, 100);
}

function cancellationRateFromCounts(cancelled, total) {
    if (!total || total <= 0) return null;
    return clamp(100 * cancelled / total, 0, 100);
}

function labelForScore(score) {
    if (score == null) return "New";
    const band = LABEL_BANDS.find(b => score >= b.min);
    return band ? band.label : "Poor";
}

// Weighted average over whatever sub-scores are present (non-null),
// renormalizing WEIGHTS over just those. Returns null if nothing qualifies.
function overallScore(subScores) {
    let weightSum = 0;
    let scoreSum = 0;
    for (const key of Object.keys(WEIGHTS)) {
        const value = subScores[key];
        if (value == null) continue;
        weightSum += WEIGHTS[key];
        scoreSum += value * WEIGHTS[key];
    }
    if (weightSum === 0) return null;
    return Math.round(scoreSum / weightSum);
}

// DB-touching wrapper: runs the four aggregate queries for one vendor and
// turns them into the shape the storefront/product-page seller panel
// renders. Kept separate from the pure math above so that math is
// unit-tested without a live database (test/sellerScore.test.js), the same
// split commissionEngine.js uses.
async function computeSellerScore(vendorId) {
    const [shippingRes, qualityRes, ratingRes, cancelRes] = await Promise.all([
        pool.query(
            `SELECT AVG(EXTRACT(EPOCH FROM (oi.handed_over_at - o.created_at)) / 3600.0) AS avg_hours,
                    COUNT(*) AS n
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             WHERE p.vendor_id = $1 AND oi.handed_over_at IS NOT NULL`,
            [vendorId]
        ),
        pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE oi.handover_status IS NOT NULL AND oi.handover_status NOT IN ('pending_handover', 'handed_over')) AS inspected,
                COUNT(*) FILTER (WHERE oi.handover_status = 'rejected') AS rejected
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE p.vendor_id = $1`,
            [vendorId]
        ),
        pool.query(
            `SELECT AVG(pr.rating)::numeric AS avg_rating, COUNT(*) AS n
             FROM product_reviews pr
             JOIN products p ON p.id = pr.product_id
             WHERE p.vendor_id = $1`,
            [vendorId]
        ),
        pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
                COUNT(*) AS total
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             WHERE p.vendor_id = $1`,
            [vendorId]
        )
    ]);

    const shippingN = Number(shippingRes.rows[0].n) || 0;
    const qualityInspected = Number(qualityRes.rows[0].inspected) || 0;
    const ratingN = Number(ratingRes.rows[0].n) || 0;
    const cancelTotal = Number(cancelRes.rows[0].total) || 0;

    const shippingScore = shippingN >= MIN_SAMPLES.shipping
        ? shippingScoreFromAvgHours(Number(shippingRes.rows[0].avg_hours))
        : null;
    const qualityScore = qualityInspected >= MIN_SAMPLES.quality
        ? qualityScoreFromCounts(qualityInspected, Number(qualityRes.rows[0].rejected) || 0)
        : null;
    const ratingScore = ratingN >= MIN_SAMPLES.rating
        ? ratingScoreFromAverage(Number(ratingRes.rows[0].avg_rating))
        : null;
    const cancellationRate = cancelTotal >= MIN_SAMPLES.cancellation
        ? cancellationRateFromCounts(Number(cancelRes.rows[0].cancelled) || 0, cancelTotal)
        : null;
    const cancellationScore = cancellationRate == null ? null : (100 - cancellationRate);

    const subScores = { shipping: shippingScore, quality: qualityScore, rating: ratingScore, cancellation: cancellationScore };
    const score = overallScore(subScores);

    return {
        score,
        isNew: score == null,
        averageRating: ratingN > 0 ? Math.round(Number(ratingRes.rows[0].avg_rating) * 10) / 10 : null,
        reviewCount: ratingN,
        performance: {
            shipping: labelForScore(shippingScore),
            quality: labelForScore(qualityScore),
            rating: labelForScore(ratingScore),
            cancellation: labelForScore(cancellationScore)
        }
    };
}

module.exports = {
    computeSellerScore,
    shippingScoreFromAvgHours,
    qualityScoreFromCounts,
    ratingScoreFromAverage,
    cancellationRateFromCounts,
    labelForScore,
    overallScore,
    MIN_SAMPLES,
    WEIGHTS
};
