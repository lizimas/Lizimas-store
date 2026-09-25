// Promotion campaigns (migration 124) - pure logic, no DB. Used by
// server/controllers/promotionCampaignController.js and unit-tested in
// test/promotionCampaigns.test.js.

const { computeDiscountPercent, MAX_VENDOR_DISCOUNT_PERCENT } = require("./vendorPromotions");

// Campaign status, Jumia Vendor Center wording:
//   open      - registration still open (vendors can join)
//   idle      - registration closed, campaign not started yet
//   ongoing   - campaign is live
//   expired   - campaign ended
//   cancelled - cancelled by Lizimas (wins over everything else)
const CAMPAIGN_STATUSES = ["open", "idle", "ongoing", "expired", "cancelled"];

// Vendor-side list filters: every status above plus "joined" (campaigns
// this vendor has at least one live entry in) and "all".
const CAMPAIGN_FILTERS = ["all", "open", "joined", "idle", "ongoing", "cancelled", "expired"];

function deriveCampaignStatus(c, now = new Date()) {
    if (c.is_cancelled) return "cancelled";
    const reg = new Date(c.registration_ends_at);
    const start = new Date(c.starts_at);
    const end = new Date(c.ends_at);
    if (now >= end) return "expired";
    if (now >= start) return "ongoing";
    if (now < reg) return "open";
    return "idle";
}

function effectiveDiscountBand(c) {
    const min = c.min_discount_pct == null ? null : Number(c.min_discount_pct);
    const max = c.max_discount_pct == null ? MAX_VENDOR_DISCOUNT_PERCENT : Number(c.max_discount_pct);
    return { min, max };
}

// Validates one nominated product's sale price against the campaign band.
function validateCampaignEntryPrice({ originalPrice, salePrice, campaign }) {
    originalPrice = Number(originalPrice);
    salePrice = Number(salePrice);
    if (!(salePrice > 0)) return { allowed: false, reason: "Sale price must be greater than zero." };
    if (!(salePrice < originalPrice)) return { allowed: false, reason: "Sale price must be less than the current price." };
    const pct = computeDiscountPercent(originalPrice, salePrice);
    const { min, max } = effectiveDiscountBand(campaign);
    // Small epsilon so e.g. exactly 10% off isn't rejected by float noise.
    if (min != null && pct + 1e-9 < min) return { allowed: false, reason: `Discount must be at least ${min}% for this campaign.`, discountPercent: pct };
    if (pct - 1e-9 > max) return { allowed: false, reason: `Discount cannot exceed ${max}% for this campaign.`, discountPercent: pct };
    return { allowed: true, discountPercent: pct };
}

// Admin create/update input.
function validateCampaignInput(body, now = new Date()) {
    const errors = [];
    const name = String(body.name || "").trim();
    if (!name) errors.push("Campaign name is required.");
    if (name.length > 160) errors.push("Campaign name must be 160 characters or fewer.");
    const reg = new Date(body.registration_ends_at);
    const start = new Date(body.starts_at);
    const end = new Date(body.ends_at);
    if ([reg, start, end].some((d) => Number.isNaN(d.getTime()))) {
        errors.push("Registration end, start and end must all be valid dates.");
    } else {
        if (end <= start) errors.push("The campaign must end after it starts.");
        if (reg > start) errors.push("Registration must close on or before the campaign starts.");
        if (end <= now) errors.push("The campaign end date must be in the future.");
    }
    const pct = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
    const min = pct(body.min_discount_pct);
    const max = pct(body.max_discount_pct);
    for (const [v, label] of [[min, "Min discount"], [max, "Max discount"]]) {
        if (v !== null && !(v > 0 && v < 100)) errors.push(`${label} must be between 0 and 100.`);
    }
    if (min !== null && max !== null && min > max) errors.push("Min discount can't be higher than max discount.");
    return {
        errors,
        data: {
            name,
            description: body.description ? String(body.description).trim() : null,
            registration_ends_at: body.registration_ends_at,
            starts_at: body.starts_at,
            ends_at: body.ends_at,
            min_discount_pct: min,
            max_discount_pct: max
        }
    };
}

// Daily revenue buckets for the last `days` days (oldest first, today last),
// from rows of { day: 'YYYY-MM-DD' | Date, revenue }. Days with no sales
// are filled with zero so the chart has a stable x-axis.
function buildDailySeries(rows, days, now = new Date()) {
    const byDay = new Map();
    for (const r of rows || []) {
        const key = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
        byDay.set(key, (byDay.get(key) || 0) + Number(r.revenue || 0));
    }
    const out = [];
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(base.getTime() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        out.push({ day: key, revenue: byDay.get(key) || 0 });
    }
    return out;
}

const PERIOD_OPTIONS = [7, 30, 90];

module.exports = {
    CAMPAIGN_STATUSES,
    CAMPAIGN_FILTERS,
    PERIOD_OPTIONS,
    deriveCampaignStatus,
    effectiveDiscountBand,
    validateCampaignEntryPrice,
    validateCampaignInput,
    buildDailySeries
};
