// Jumia Vendor Center API client (Ryan, Sept 2026 - product linking
// between Lizimas and Jumia: push a Lizimas listing out to a vendor's
// Jumia store, and pull an existing Jumia listing into Lizimas).
//
// *** ENDPOINT PATHS BELOW ARE THE ONE UNVERIFIED PIECE OF THIS FEATURE ***
// Jumia's Vendor Center (vendorcenter.jumia.com) is their newer
// OAuth2-based platform - its "Applications" screen (Settings > Seller
// Settings > Applications) is exactly where a vendor generates the
// Client ID/Secret this module authenticates with. Its full API
// reference (vendorcenter.jumia.com/api-docs/) requires a logged-in
// Jumia session to view, and Jumia's API hosts are not reachable from
// this dev environment's network at all (confirmed: every
// *.sellercenter.jumia.com / *.vendorcenter.jumia.com host either
// doesn't resolve or is blocked by the outbound proxy here) - so the
// exact token/product endpoint paths and field names below are this
// module's best-effort placeholder against the standard OAuth2 +
// REST/JSON shape Jumia's own doc titles describe, NOT something that
// has been tested against a real Application. Everything above this
// layer (DB schema, encryption, routes, sync bookkeeping, the vendor
// UI) does not depend on these specifics and is solid; this file is the
// one piece that needs a real Jumia Application connected (or the
// actual api-docs content pasted in) to confirm/correct before the
// first live push or import is trusted.
//
// Once real access is available, the only things that should need to
// change are the constants and the two field-mapping functions below -
// everything else (token refresh, retry/error normalization, the
// push/pull orchestration in jumiaSyncService.js) is written to be
// independent of those specifics.

const axios = require("axios");
const { encryptField, decryptField } = require("../utils/encryption");

const JUMIA_API_BASE = process.env.JUMIA_API_BASE || "https://vendorcenter.jumia.com/api";
const JUMIA_TOKEN_PATH = "/oauth/token";
const JUMIA_PRODUCTS_PATH = "/products";
const JUMIA_CATEGORY_TREE_PATH = "/categories";

const REQUEST_TIMEOUT_MS = 20000;

class JumiaApiError extends Error {
    constructor(message, { status, code, raw } = {}) {
        super(message);
        this.name = "JumiaApiError";
        this.status = status || null;
        this.code = code || null;
        this.raw = raw || null;
    }
}

function jumiaHttp() {
    return axios.create({
        baseURL: JUMIA_API_BASE,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "Content-Type": "application/json", Accept: "application/json" }
    });
}

// Exchanges a vendor's Jumia Application Client ID/Secret for an
// access/refresh token pair. Modelled as an OAuth2 client_credentials
// grant (the common shape for a first-party seller API like this one,
// and the simplest to support without a public browser-redirect
// callback route) - if Jumia's Applications actually require the
// 3-legged authorization-code flow instead, this is the function that
// changes; nothing else needs to know the difference.
async function exchangeCredentialsForToken(clientId, clientSecret) {
    try {
        const response = await jumiaHttp().post(JUMIA_TOKEN_PATH, {
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret
        });
        const data = response.data || {};
        if (!data.access_token) {
            throw new JumiaApiError("Jumia did not return an access token.", { raw: data });
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || null,
            expiresInSeconds: Number(data.expires_in) || 3600,
            shopName: data.shop_name || data.seller_name || null
        };
    } catch (err) {
        throw normalizeAxiosError(err, "Could not connect to Jumia with the Client ID/Secret provided.");
    }
}

async function refreshAccessToken(refreshToken, clientId, clientSecret) {
    try {
        const response = await jumiaHttp().post(JUMIA_TOKEN_PATH, {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        });
        const data = response.data || {};
        if (!data.access_token) {
            throw new JumiaApiError("Jumia did not return a refreshed access token.", { raw: data });
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresInSeconds: Number(data.expires_in) || 3600
        };
    } catch (err) {
        throw normalizeAxiosError(err, "Could not refresh the Jumia connection - it may need to be reconnected.");
    }
}

// Given a stored connection row (with encrypted token fields), returns a
// live access token, transparently refreshing it first if it is expired
// or about to expire. Does NOT persist the refreshed token itself - the
// caller (jumiaSyncService) owns writing the connection row back so this
// module stays free of DB access.
async function ensureFreshAccessToken(connectionRow) {
    const expiresAt = connectionRow.token_expires_at ? new Date(connectionRow.token_expires_at) : null;
    const stillValid = expiresAt && expiresAt.getTime() - Date.now() > 60000; // >1min left
    if (stillValid && connectionRow.access_token_enc) {
        return { accessToken: decryptField(connectionRow.access_token_enc), refreshed: false };
    }
    const refreshToken = decryptField(connectionRow.refresh_token_enc);
    if (!refreshToken) {
        throw new JumiaApiError("This Jumia connection has expired and has no refresh token - reconnect with the Client ID/Secret.", { code: "NO_REFRESH_TOKEN" });
    }
    const clientSecret = decryptField(connectionRow.client_secret_enc);
    const result = await refreshAccessToken(refreshToken, connectionRow.client_id, clientSecret);
    return {
        accessToken: result.accessToken,
        refreshed: true,
        refreshToken: result.refreshToken,
        expiresInSeconds: result.expiresInSeconds
    };
}

function authedHttp(accessToken) {
    const client = jumiaHttp();
    client.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    return client;
}

// --- Field mapping: Lizimas product -> Jumia product payload ---
// Isolated on purpose (see file header) - this is the part most likely
// to need adjusting once real category/attribute requirements are
// confirmed. specs is the array from product_specifications
// (label/value pairs) - passed through as free-form Jumia "attributes"
// until real per-category attribute names are confirmed.
function mapLizimasProductToJumiaPayload(product, specs, images) {
    return {
        seller_sku: product.sku || `LZM-${product.id}`,
        name: product.name,
        description: product.description || "",
        brand: product.brand || null,
        price: product.price != null ? Number(product.price) : null,
        quantity: product.stock != null ? Number(product.stock) : 0,
        primary_category: product.category_name || null,
        images: (images || []).map(img => img.image_path).filter(Boolean),
        attributes: (specs || []).reduce((acc, s) => {
            if (s.label) acc[s.label] = s.value;
            return acc;
        }, {})
    };
}

// --- Field mapping: Jumia product -> Lizimas product fields ---
// Used when importing a vendor's existing Jumia listing into Lizimas.
// Returns { productFields, specs, images } shaped for productController's
// insert path and the product_specifications/product_images tables.
function mapJumiaProductToLizimasFields(jumiaProduct) {
    const attributes = jumiaProduct.attributes || {};
    return {
        productFields: {
            name: jumiaProduct.name || "",
            description: jumiaProduct.description || "",
            brand: jumiaProduct.brand || null,
            price: jumiaProduct.price != null ? Number(jumiaProduct.price) : 0,
            stock: jumiaProduct.quantity != null ? Number(jumiaProduct.quantity) : 0,
            sku: jumiaProduct.seller_sku || null
        },
        specs: Object.entries(attributes).map(([label, value], index) => ({
            label, value: value == null ? "" : String(value), display_order: index + 1
        })),
        images: Array.isArray(jumiaProduct.images) ? jumiaProduct.images : []
    };
}

// Creates or updates one product on Jumia. jumiaProductId present ->
// update (PATCH); absent -> create (POST). Returns Jumia's product id
// for a create, so the caller can store it on the link row.
async function upsertJumiaProduct(accessToken, payload, jumiaProductId) {
    try {
        const http = authedHttp(accessToken);
        if (jumiaProductId) {
            const response = await http.patch(`${JUMIA_PRODUCTS_PATH}/${encodeURIComponent(jumiaProductId)}`, payload);
            return { jumiaProductId, raw: response.data };
        }
        const response = await http.post(JUMIA_PRODUCTS_PATH, payload);
        const data = response.data || {};
        const newId = data.product_id || data.id || null;
        return { jumiaProductId: newId, raw: data };
    } catch (err) {
        throw normalizeAxiosError(err, `Jumia rejected the product "${payload.name || payload.seller_sku}".`);
    }
}

// Lists the vendor's existing products on Jumia (for the "import from
// Jumia" screen). Supports simple pagination since a vendor could have
// hundreds of listings.
async function listJumiaProducts(accessToken, { page = 1, pageSize = 50 } = {}) {
    try {
        const http = authedHttp(accessToken);
        const response = await http.get(JUMIA_PRODUCTS_PATH, { params: { page, page_size: pageSize } });
        const data = response.data || {};
        return {
            items: Array.isArray(data.items) ? data.items : (Array.isArray(data.products) ? data.products : []),
            totalCount: Number(data.total_count) || null,
            hasMore: Boolean(data.has_more)
        };
    } catch (err) {
        throw normalizeAxiosError(err, "Could not fetch your Jumia product list.");
    }
}

function normalizeAxiosError(err, fallbackMessage) {
    if (err instanceof JumiaApiError) return err;
    const status = err.response ? err.response.status : null;
    const raw = err.response ? err.response.data : null;
    const jumiaMessage = raw && (raw.error_description || raw.message || raw.error);

    // The endpoint paths/response shape in this file are unverified against
    // a real Jumia Application (see the header comment) - so the FIRST live
    // attempt is likely to fail in a way normalizeAxiosError can't turn into
    // a friendly message (wrong path -> HTML 404, wrong host, timeout, a
    // JSON error shape this code doesn't recognize yet). Rather than hide
    // that behind the generic fallbackMessage, append whatever diagnostic
    // detail is available directly to the message shown in the vendor UI,
    // so the exact failure is visible without needing server log access -
    // essential for correcting the endpoint/field-name guesses afterwards.
    let message = jumiaMessage || fallbackMessage;
    if (!jumiaMessage) {
        if (status) {
            const bodySnippet = raw ? (typeof raw === "string" ? raw : JSON.stringify(raw)).slice(0, 300) : "";
            message += ` (Jumia responded with HTTP ${status}${bodySnippet ? ": " + bodySnippet : ""})`;
        } else if (err.code) {
            message += ` (${err.code}${err.message ? ": " + err.message : ""})`;
        } else if (err.message) {
            message += ` (${err.message})`;
        }
    }
    console.error("[jumiaClient] request failed:", { status, code: err.code || null, raw, originalMessage: err.message });
    return new JumiaApiError(message, { status, raw });
}

module.exports = {
    JumiaApiError,
    exchangeCredentialsForToken,
    refreshAccessToken,
    ensureFreshAccessToken,
    mapLizimasProductToJumiaPayload,
    mapJumiaProductToLizimasFields,
    upsertJumiaProduct,
    listJumiaProducts
};
