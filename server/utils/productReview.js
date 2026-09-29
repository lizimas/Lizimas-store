// Product Approval rules (Ryan, Sept 2026). Pure logic, no database - used
// by server/controllers/productReviewController.js and unit-tested in
// test/productReview.test.js.

const STATUS_LABELS = {
    pending: "Pending Review",
    approved: "Approved (Live)",
    rejected: "Rejected",
    changes_requested: "Changes Requested",
    under_investigation: "Under Investigation",
    draft: "Draft"
};

// Rejection / change-request reasons. `vendor` is what the seller reads.
const REASONS = [
    { code: "poor_images", label: "Poor quality images", vendor: "The photos are blurry, too small, too dark or badly cropped. Upload clear photos at least 800×800 on a plain background." },
    { code: "wrong_images", label: "Images don't match the product", vendor: "The photos show a different product, colour or model from the listing." },
    { code: "watermark", label: "Watermarks, logos or text on images", vendor: "Remove watermarks, other shops' logos, phone numbers or promotional text from the photos." },
    { code: "incomplete_info", label: "Missing or incomplete information", vendor: "Important details are missing (for example size, capacity, material, colour or what's in the box)." },
    { code: "misleading", label: "Misleading or inaccurate description", vendor: "The title or description doesn't match the product or makes claims we can't accept." },
    { code: "wrong_category", label: "Wrong category", vendor: "The product is listed in the wrong category." },
    { code: "price_issue", label: "Price unrealistic (too high or too low)", vendor: "The price is far from the usual market price for this product. Check it and resubmit." },
    { code: "prohibited", label: "Prohibited or restricted item", vendor: "This item isn't allowed on Lizimas Store." },
    { code: "counterfeit", label: "Suspected counterfeit / brand not authorised", vendor: "We couldn't confirm this branded product is genuine or that you're authorised to sell the brand. Provide invoices or brand authorisation." },
    { code: "duplicate", label: "Duplicate of an existing listing", vendor: "This product is already listed. Update the existing listing instead of creating a new one." },
    { code: "ip_violation", label: "Copyright or trademark issue", vendor: "The listing uses photos, names or logos you don't have the rights to." },
    { code: "policy", label: "Violates Lizimas Store policies", vendor: "The listing breaks the Lizimas Store seller policies." },
    { code: "other", label: "Other (explain below)", vendor: "" }
];
const REASON_BY_CODE = Object.fromEntries(REASONS.map((r) => [r.code, r]));

const FLAGS = {
    suspected_counterfeit: "Suspected counterfeit",
    low_quality_images: "Low quality images",
    price_check: "Check price",
    possible_duplicate: "Possible duplicate"
};

// Which actions are allowed from which status.
const ACTIONS = {
    approve: { to: "approved", from: ["pending", "changes_requested", "under_investigation", "rejected", "draft"] },
    reject: { to: "rejected", from: ["pending", "changes_requested", "under_investigation", "approved", "draft"] },
    request_changes: { to: "changes_requested", from: ["pending", "under_investigation", "approved"] },
    investigate: { to: "under_investigation", from: ["pending", "changes_requested", "approved", "rejected"] },
    draft: { to: "draft", from: ["pending", "changes_requested", "under_investigation", "rejected"], ownOnly: true }
};

// -> { ok: true, to, reasonCode, reasonText, vendorMessage } | { ok: false, error }
function validateDecision(product, input) {
    input = input || {};
    const action = String(input.action || "");
    const rule = ACTIONS[action];
    if (!rule) return { ok: false, error: "Unknown action." };
    if (!product) return { ok: false, error: "Product not found." };
    if (rule.ownOnly && product.vendor_id) return { ok: false, error: "Only Lizimas' own products can be saved as drafts. Use Request Changes for a vendor product." };
    if (!rule.from.includes(product.status)) {
        return { ok: false, error: `This product is ${STATUS_LABELS[product.status] || product.status} - it can't be moved to ${STATUS_LABELS[rule.to]}.` };
    }
    const code = input.reason_code ? String(input.reason_code) : null;
    const text = String(input.reason_text || "").trim().slice(0, 2000);
    if (code && !REASON_BY_CODE[code]) return { ok: false, error: "Unknown reason." };
    if (action === "reject") {
        if (!code) return { ok: false, error: "Pick a rejection reason." };
        if (code === "other" && text.length < 5) return { ok: false, error: "Explain the reason in the box when you pick 'Other'." };
    }
    if (action === "request_changes" && text.length < 5 && !code) {
        return { ok: false, error: "Say what the seller needs to change." };
    }
    if (action === "investigate" && text.length < 5) {
        return { ok: false, error: "Add a short note on why this is under investigation (internal)." };
    }
    if (action === "approve" && needsMarketCheck(product.price, product.last_market_check_at, input.now)) {
        return { ok: false, error: `Products from UGX ${MARKET_CHECK_THRESHOLD.toLocaleString("en-US")} need Jumia prices recorded (in the last ${MARKET_CHECK_MAX_AGE_DAYS} days) before approval - see Pricing.` };
    }
    const reason = code ? REASON_BY_CODE[code] : null;
    const vendorMessage = [reason && reason.code !== "other" ? reason.vendor : "", text].filter(Boolean).join(" ");
    return { ok: true, action, to: rule.to, reasonCode: code, reasonText: text || null, vendorMessage: vendorMessage || null };
}

function median(sorted) {
    if (!sorted.length) return null;
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

// Price flag against a market range (Ryan, Sept 2026):
//   Too Low   below 75% of the lowest price       -> check quality / authenticity
//   Low       below 80% of the typical price      -> review carefully
//   Too High  above 130% of the highest price     -> ask for a lower price
//   High      above 125% of the typical price     -> confirm the value
//   Normal    otherwise;  Unknown when there's no typical price.
const FLAG_INFO = {
    too_low: { label: "Too Low", tone: "bad", note: "Far below the market - check quality and that it's genuine." },
    low: { label: "Low", tone: "warn", note: "Noticeably cheaper than usual - review carefully." },
    normal: { label: "Normal", tone: "ok", note: "Within the usual market range." },
    high: { label: "High", tone: "warn", note: "Noticeably dearer than usual - confirm the value justifies it." },
    too_high: { label: "Too High", tone: "bad", note: "Far above the market - consider asking for a lower price." },
    unknown: { label: "Unknown", tone: "none", note: "No prices to compare yet." }
};
function marketFlag(price, range) {
    range = range || {};
    price = Number(price);
    const low = Number(range.lowest) || null, typ = Number(range.typical) || null, high = Number(range.highest) || null;
    let flag = "normal";
    if (!(typ > 0) || !(price > 0)) flag = "unknown";
    else if (low && price < low * 0.75) flag = "too_low";
    else if (price < typ * 0.80) flag = "low";
    else if (high && price > high * 1.30) flag = "too_high";
    else if (price > typ * 1.25) flag = "high";
    return { flag, ...FLAG_INFO[flag], diff_percent: typ > 0 && price > 0 ? Math.round(((price - typ) / typ) * 100) : null };
}
// Kept for callers that only have a typical price.
function priceFlag(price, typical) {
    const r = marketFlag(price, { typical });
    return r.flag === "unknown" ? null : r;
}

// Both comparisons point the same way -> say so louder.
function combinedVerdict(internalFlag, marketFlagValue) {
    const side = (f) => (f === "too_low" || f === "low" ? "low" : f === "too_high" || f === "high" ? "high" : null);
    const a = side(internalFlag), b = side(marketFlagValue);
    if (a && a === b) {
        return a === "low"
            ? { tone: "bad", text: "Both Lizimas and Jumia say this price is low - check it's genuine before approving." }
            : { tone: "bad", text: "Both Lizimas and Jumia say this price is high - consider asking the seller to lower it." };
    }
    return null;
}

// prices: numbers from comparable products -> stats + flag for `price`.
function priceStats(prices, price, minCount) {
    const clean = (prices || []).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (clean.length < (minCount || 3)) return { count: clean.length, enough: false, result: marketFlag(price, {}) };
    const typical = median(clean);
    const out = { count: clean.length, enough: true, lowest: clean[0], typical, highest: clean[clean.length - 1] };
    out.result = marketFlag(price, out);
    return out;
}

// Products at or above this price need Jumia prices recorded (within
// MARKET_CHECK_MAX_AGE_DAYS) before they can be approved.
const MARKET_CHECK_THRESHOLD = 100000;
const MARKET_CHECK_MAX_AGE_DAYS = 30;
function needsMarketCheck(price, lastCheckedAt, now) {
    if (!(Number(price) >= MARKET_CHECK_THRESHOLD)) return false;
    if (!lastCheckedAt) return true;
    const age = ((now || Date.now()) - new Date(lastCheckedAt).getTime()) / 86400000;
    return age > MARKET_CHECK_MAX_AGE_DAYS;
}

// Text copied from a store's search results page (Cmd+A, Cmd+C) -> prices.
// Takes each "UGX 45,000" (or "USh", "Shs"); a price right after another
// price, followed by a "-25%" line, is the crossed-out old price and is
// skipped; "UGX 20,000 - UGX 30,000" ranges count once (the lower). Then
// anything under a quarter or over four times the median is dropped (price
// filter sliders, accessories, bundles).
function parsePastedPrices(text) {
    const lines = String(text || "").slice(0, 400000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const money = /(?:UGX|USh|Ushs?|Shs)\.?\s*(\d{1,3}(?:[,\u00a0 ]\d{3})+(?!\d)|\d{3,})/i;
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const all = [...line.matchAll(new RegExp(money.source, "gi"))];
        if (!all.length) continue;
        const v = Number(all[0][1].replace(/[^\d]/g, ""));
        if (!(v >= 500)) continue;
        const prev = found.length ? found[found.length - 1] : null;
        const isOld = prev && prev.line === i - 1 && lines[i + 1] && /^-?\d{1,2}\s?%$/.test(lines[i + 1]) && v > prev.value;
        if (isOld) continue;
        found.push({ value: v, line: i });
    }
    let prices = found.map((f) => f.value);
    const raw = prices.length;
    if (prices.length >= 3) {
        const med = median([...prices].sort((a, b) => a - b));
        prices = prices.filter((p) => p >= med / 4 && p <= med * 4);
    }
    const sorted = [...prices].sort((a, b) => a - b);
    return {
        prices: sorted, found: raw, dropped: raw - sorted.length,
        lowest: sorted[0] || null, typical: sorted.length ? median(sorted) : null, highest: sorted[sorted.length - 1] || null
    };
}

// Cost -> margin shown as "2.2×" and a percentage of the selling price.
function margin(price, cost) {
    price = Number(price); cost = Number(cost);
    if (!(price > 0) || !(cost > 0)) return null;
    return { times: Math.round((price / cost) * 10) / 10, percent: Math.round(((price - cost) / price) * 100), profit: Math.round(price - cost) };
}

// Words that say what the product is, for finding similar products.
const STOP = new Set(["with", "and", "for", "the", "a", "an", "of", "in", "on", "to", "new", "original", "pcs", "set", "black", "white", "pink", "blue", "red", "green"]);
function keyWords(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9. ]+/g, " ").split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+(\.\d+)?(ml|l|kg|g|cm|mm|inch|in)?$/.test(w));
}
// "570ml", "1L", "55 inch", "20L", "1.5kg" - the attribute that matters for matching.
function keyAttribute(name) {
    const m = String(name || "").match(/(\d+(?:\.\d+)?)\s*(ml|l|litres?|liters?|inch(?:es)?|"|kg|g|gb|tb)\b/i);
    if (!m) return null;
    let unit = m[2].toLowerCase();
    if (/^lit/.test(unit) || unit === "l") unit = "L";
    if (unit === "gb" || unit === "tb") unit = unit.toUpperCase();
    if (/^inch|"/.test(unit)) unit = " inch";
    return m[1] + unit;
}
function similarity(a, b) {
    const A = new Set(keyWords(a)), B = new Set(keyWords(b));
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
    return n / Math.min(A.size, B.size);
}

// Search words for another store: brand + main words + key attribute.
function marketSearchTerm(product) {
    const brand = String(product.brand || "").trim();
    const attr = keyAttribute(product.name);
    const words = keyWords(String(product.name || "").replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")).slice(0, 4);
    return [brand, ...words, attr].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
}
function jumiaSearchUrl(term) {
    return "https://www.jumia.ug/catalog/?q=" + encodeURIComponent(term).replace(/%20/g, "+");
}

function validateMarketCheck(input) {
    const n = (v) => (v === "" || v == null ? null : Math.round(Number(String(v).replace(/[^\d.]/g, ""))));
    const low = n(input.lowest_price), typ = n(input.typical_price), high = n(input.highest_price), cnt = n(input.product_count);
    if (!(typ > 0)) return { ok: false, error: "Enter at least the typical price." };
    if ((low != null && !(low > 0)) || (high != null && !(high > 0))) return { ok: false, error: "Prices must be numbers above 0." };
    if (low != null && low > typ) return { ok: false, error: "Lowest can't be above typical." };
    if (high != null && high < typ) return { ok: false, error: "Highest can't be below typical." };
    return { ok: true, value: { lowest_price: low, typical_price: typ, highest_price: high, product_count: cnt,
        source: String(input.source || "jumia.ug").slice(0, 50), search_term: String(input.search_term || "").slice(0, 255) || null } };
}

module.exports = {
    STATUS_LABELS, REASONS, REASON_BY_CODE, FLAGS, ACTIONS,
    validateDecision, priceFlag, priceStats, median, marketFlag, combinedVerdict, FLAG_INFO,
    MARKET_CHECK_THRESHOLD, MARKET_CHECK_MAX_AGE_DAYS, needsMarketCheck, parsePastedPrices, margin,
    keyWords, keyAttribute, similarity, marketSearchTerm, jumiaSearchUrl, validateMarketCheck
};
