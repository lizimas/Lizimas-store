const pool = require("../config/database");

// Lizimas' launch default: round customer-facing prices to the nearest
// UGX 100 (spec section 9). Kept as a plain constant rather than an env var
// for now - the spec lists five supported granularities but only asks for
// one default to actually ship.
const DEFAULT_ROUND_TO = 100;

// Finds the commission rule that applies to a category: its own active
// rule if it has one, otherwise the nearest ancestor's, otherwise the
// marketplace-wide default (category_id IS NULL). This is what lets the
// engine work correctly today without every one of Lizimas' categories
// needing its own explicit rate - see migrations/061_commission_rules.sql.
//
// DB-dependent, so deliberately kept separate from computePricing() below:
// that function is pure and carries the actual pricing math, so it can be
// unit-tested (test/commissionEngine.test.js) without a live database,
// the same reasoning that split parseSignedRequest out of oauthController.
async function getActiveCommissionRule(categoryId) {
    let currentId = categoryId || null;
    const visited = new Set();

    while (currentId != null && !visited.has(currentId)) {
        visited.add(currentId);

        const rule = await pool.query(
            `SELECT * FROM commission_rules WHERE category_id = $1 AND status = 'active' LIMIT 1`,
            [currentId]
        );
        if (rule.rows.length > 0) return rule.rows[0];

        const parent = await pool.query(`SELECT parent_id FROM categories WHERE id = $1`, [currentId]);
        currentId = parent.rows.length > 0 ? parent.rows[0].parent_id : null;
    }

    const fallback = await pool.query(
        `SELECT * FROM commission_rules WHERE category_id IS NULL AND status = 'active' LIMIT 1`
    );
    return fallback.rows[0] || null;
}

function roundToNearest(value, nearest) {
    if (!nearest || nearest <= 0) return Math.round(value);
    return Math.round(value / nearest) * nearest;
}

// The critical business rule (spec section 83): a vendor enters what they
// want to earn, and Lizimas - never the vendor - calculates what the
// customer pays. A vendor must never manually add commission on top of
// their own number.
//
//   customerPrice = (vendorPayout + fixedFee) / (1 - commissionRate)
//
// rounded to a friendly price point, then the commission is recalculated
// against the ROUNDED price so the vendor still receives exactly the
// payout they asked for - any rounding difference is absorbed by Lizimas'
// commission, never taken from the vendor (spec section 9: "The system
// should calculate the final commission again after rounding so that the
// vendor payout remains correct"). Pure function: no DB access, so it is
// unit-tested directly.
function computePricing({ vendorPayout, rate, fixedFee = 0, roundNearest = DEFAULT_ROUND_TO }) {
    const payout = Number(vendorPayout);
    if (!Number.isFinite(payout) || payout <= 0) {
        throw new Error("Enter a valid desired payout.");
    }

    const commissionRate = Number(rate);
    const fee = Number(fixedFee) || 0;

    if (!(commissionRate >= 0) || commissionRate >= 1) {
        throw new Error("Commission rate is misconfigured for this category.");
    }

    const rawPrice = (payout + fee) / (1 - commissionRate);
    const customerPrice = roundToNearest(rawPrice, roundNearest);
    const commissionAmount = customerPrice - fee - payout;

    return {
        vendorPayout: payout,
        commissionRate,
        fixedFee: fee,
        customerPrice,
        commissionAmount
    };
}

// Convenience wrapper for controllers: looks up the active rule for a
// category, then runs the pure math above.
async function calculatePricing({ vendorPayout, categoryId, roundNearest = DEFAULT_ROUND_TO }) {
    const rule = await getActiveCommissionRule(categoryId);
    if (!rule) {
        throw new Error("No commission rule is configured yet. Contact Lizimas support.");
    }

    const result = computePricing({
        vendorPayout,
        rate: rule.commission_rate,
        fixedFee: rule.fixed_processing_fee,
        roundNearest
    });

    return { ...result, ruleId: rule.id };
}

module.exports = {
    getActiveCommissionRule,
    calculatePricing,
    computePricing,
    roundToNearest,
    DEFAULT_ROUND_TO
};
