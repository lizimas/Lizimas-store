// Phase 4 Beat 3 - USD dual-currency support for vendor payout statements.
//
// This is ONLY used to convert vendor_statements' summary amounts (and, at
// generation time, their itemized lines) into a vendor's preferred_currency
// for DISPLAY/payout purposes. It has nothing to do with customer checkout -
// the storefront and every order/order_item row stays UGX-only, exactly as
// today. See migrations/100_statement_currency_columns.sql for the schema
// this feeds (vendors.preferred_currency, vendor_statements.currency +
// fx_rate_used).
//
// Rate convention used everywhere in this file and its callers:
//   fxRate = how many UGX one USD buys (e.g. 3700).
//   usd = ugx / fxRate
//   ugx = usd * fxRate
//
// Fetches a live rate from a free, keyless API, with a short in-memory
// cache (rates don't need to be fresher than that for a weekly payout
// cycle) and a fallback to a second provider if the first is unreachable.
// If BOTH fail and there is no cache at all, this throws rather than ever
// silently making up a number for a real payout - closeCycleAndGenerateStatements
// must surface that failure to admin, not guess.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cache = { rate: null, fetchedAt: 0 };

// Primary/secondary are both free, keyless, and return UGX directly in a
// USD-base rates object - no API key to provision, no billing to set up.
const PROVIDERS = [
    {
        name: "exchangerate-api.com",
        url: "https://api.exchangerate-api.com/v4/latest/USD",
        extractUgx: (json) => json && json.rates && json.rates.UGX
    },
    {
        name: "open.er-api.com",
        url: "https://open.er-api.com/v6/latest/USD",
        extractUgx: (json) => json && json.rates && json.rates.UGX
    }
];

async function fetchFromProvider(provider) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(provider.url, { signal: controller.signal });
        if (!res.ok) throw new Error(`${provider.name} responded ${res.status}`);
        const json = await res.json();
        const rate = provider.extractUgx(json);
        if (!rate || typeof rate !== "number" || rate <= 0) {
            throw new Error(`${provider.name} response had no usable UGX rate`);
        }
        return rate;
    } finally {
        clearTimeout(timeout);
    }
}

// Returns { rate, source, stale } where rate is UGX-per-USD. Throws only
// when a live fetch fails on every provider AND there is no cached rate
// (even a stale one) to fall back on.
async function getUsdToUgxRate({ forceRefresh = false } = {}) {
    const cacheIsFresh = cache.rate && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS;
    if (cacheIsFresh && !forceRefresh) {
        return { rate: cache.rate, source: "cache", stale: false };
    }

    const errors = [];
    for (const provider of PROVIDERS) {
        try {
            const rate = await fetchFromProvider(provider);
            cache = { rate, fetchedAt: Date.now() };
            return { rate, source: provider.name, stale: false };
        } catch (error) {
            errors.push(`${provider.name}: ${error.message}`);
        }
    }

    // Every provider failed. Fall back to a stale cached rate rather than
    // blocking a cycle close entirely - but say so, so admin can see it in
    // the response and re-run once connectivity is back if they want a
    // fresher number.
    if (cache.rate) {
        console.error("fxRate: live fetch failed on all providers, using stale cached rate.", errors.join(" | "));
        return { rate: cache.rate, source: "stale-cache", stale: true };
    }

    throw new Error(
        `Could not fetch a live USD exchange rate from any provider, and no cached rate is available yet. ` +
        `(${errors.join(" | ")})`
    );
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function convertUgxToUsd(amountUgx, ugxPerUsd) {
    if (!ugxPerUsd || ugxPerUsd <= 0) throw new Error("convertUgxToUsd: invalid fx rate.");
    return round2(Number(amountUgx) / ugxPerUsd);
}

function convertUsdToUgx(amountUsd, ugxPerUsd) {
    if (!ugxPerUsd || ugxPerUsd <= 0) throw new Error("convertUsdToUgx: invalid fx rate.");
    return round2(Number(amountUsd) * ugxPerUsd);
}

// Re-express an amount that is denominated in `fromCurrency` (with the
// UGX-per-USD rate that was locked for it, if any) into `toCurrency`. Used
// to aggregate a vendor's statements into one total even if their
// preferred_currency changed between cycles, so an old UGX statement and a
// newer USD one don't just get summed as if they were the same unit.
function normalizeAmount(amount, fromCurrency, fxRateUsedForAmount, toCurrency) {
    const from = fromCurrency || "UGX";
    const to = toCurrency || "UGX";
    if (from === to) return Number(amount);

    if (from === "UGX" && to === "USD") {
        if (!fxRateUsedForAmount) throw new Error("normalizeAmount: UGX->USD needs a fx rate.");
        return convertUgxToUsd(amount, fxRateUsedForAmount);
    }
    if (from === "USD" && to === "UGX") {
        if (!fxRateUsedForAmount) throw new Error("normalizeAmount: USD->UGX needs a fx rate.");
        return convertUsdToUgx(amount, fxRateUsedForAmount);
    }
    throw new Error(`normalizeAmount: unsupported currency pair ${from} -> ${to}`);
}

module.exports = {
    getUsdToUgxRate,
    convertUgxToUsd,
    convertUsdToUgx,
    normalizeAmount,
    round2,
    _PROVIDERS: PROVIDERS
};
