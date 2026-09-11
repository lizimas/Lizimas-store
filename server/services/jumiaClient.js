// Jumia Vendor Center API client (Ryan, Sept 2026 - product linking
// between Lizimas and Jumia: push a Lizimas listing out to a vendor's
// Jumia store, and pull an existing Jumia listing into Lizimas).
//
// The auth flow (host, /token path, form-urlencoded body, response
// shape) is now CONFIRMED against Jumia's own official Postman
// documentation (postman.com/jumiagandalf/jumia-vendor-api -
// "Vendor API Collection" > Authentication > "Obtain an Access Token
// from Authorization Code / Refresh Token", author Pedro Ferreira),
// which Ryan opened directly since every Jumia host is unreachable from
// both dev environments here. The product/category paths below remain
// an educated guess (that collection also has "GPM API" and "GOP API"
// folders that likely hold the real ones - not yet opened) and are the
// one piece still to confirm before the first real product push/import.
//
// UNVERIFIED (Sept 2026, added for multi-Application support): Jumia's
// Create Application dialog also offers a "Web Application (OAuth -
// Authorization Code Flow)" type alongside the Self Authorization one
// this integration has used exclusively so far. The Postman doc Ryan
// opened is titled "...from Authorization Code / Refresh Token" together,
// which is why exchangeAuthorizationCode() below reuses the SAME
// confirmed /token endpoint and host, just with grant_type=
// authorization_code and the standard OAuth2 fields that heading implies
// (client_id, client_secret, code, redirect_uri) - this part IS
// consistent with the confirmed doc. What is NOT confirmed is
// JUMIA_AUTHORIZE_BASE/JUMIA_AUTHORIZE_PATH below (the browser-facing
// consent screen a vendor is redirected to first) - Ryan's Postman
// screenshots only covered the token exchange, never the authorize step,
// so that URL is a best-effort guess (Jumia's own seller-facing domain,
// vendorcenter.jumia.com, rather than the vendor-api.jumia.com API host,
// since an OAuth consent page is normally served from the web app, not
// the API). This whole Web Application flow needs a real end-to-end test
// (redirect to Jumia, log in, consent, land back on the callback route)
// before it can be trusted - Self Authorization remains the flow to use
// until that happens.
const axios = require("axios");
const { encryptField, decryptField } = require("../utils/encryption");

const JUMIA_API_BASE = process.env.JUMIA_API_BASE || "https://vendor-api.jumia.com";
const JUMIA_TOKEN_PATH = "/token";
const JUMIA_PRODUCTS_PATH = "/catalog/products";
const JUMIA_CATEGORY_TREE_PATH = "/categories";
// UNVERIFIED - see header note. Overridable via env once the real value
// is confirmed, without another code change.
const JUMIA_AUTHORIZE_BASE = process.env.JUMIA_AUTHORIZE_BASE || "https://vendorcenter.jumia.com";
const JUMIA_AUTHORIZE_PATH = process.env.JUMIA_AUTHORIZE_PATH || "/oauth/authorize";

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

// Mints a short-lived access token from a vendor's Jumia Application
// Client ID + Refresh Token, per the "Case 2 (Refresh Token)" branch of
// Jumia's own /token endpoint: form-urlencoded body (NOT JSON - the
// endpoint's Content-Type is application/x-www-form-urlencoded), with
// client_id, grant_type=refresh_token, and refresh_token - client_secret
// is only required for Case 1 (the 3-legged Authorization Code flow,
// which this app does not use). Response is { access_token, expires_in,
// refresh_token, refresh_expires_in, token_type }. There is no separate
// "exchange" step: the vendor's pasted Refresh Token IS the long-lived
// credential, used as-is on every call. Uncertain whether Jumia rotates
// the refresh token on each use - if data.refresh_token comes back, the
// caller is given it to persist, but the ORIGINAL pasted token is what
// gets used again if nothing rotates, so a connection keeps working
// either way unless Jumia actively invalidates the old one.
async function mintAccessToken(clientId, refreshToken, clientSecret) {
    try {
        const fields = {
            grant_type: "refresh_token",
            client_id: clientId,
            refresh_token: refreshToken
        };
        // Self Authorization's confirmed Refresh Token grant never sends
        // this (see file header). Only a Web Application connection passes
        // a clientSecret here, since a confidential OAuth client's refresh
        // call conventionally includes it - unconfirmed either way for
        // Jumia specifically, but harmless to include when present.
        if (clientSecret) fields.client_secret = clientSecret;
        const body = new URLSearchParams(fields);
        const response = await axios.post(`${JUMIA_API_BASE}${JUMIA_TOKEN_PATH}`, body.toString(), {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
        });
        const data = response.data || {};
        if (!data.access_token) {
            throw new JumiaApiError("Jumia did not return an access token.", { raw: data });
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresInSeconds: Number(data.expires_in) || 3600,
            shopName: data.shop_name || data.seller_name || null
        };
    } catch (err) {
        throw normalizeAxiosError(err, "Could not connect to Jumia with the Client ID/Refresh Token provided.");
    }
}

// Builds the URL to send a vendor's browser to for a Web Application's
// OAuth consent screen. state is an opaque, server-signed token (a JWT
// from jumiaSyncService) the caller uses to identify which vendor/
// Application the callback belongs to - Jumia is expected to hand it
// back unchanged on the redirect per standard OAuth2 "state" handling.
// UNVERIFIED: see this file's header - the host/path here are a
// best-effort guess, not confirmed against Jumia's real authorize screen.
function buildAuthorizeUrl(clientId, redirectUri, state) {
    const url = new URL(JUMIA_AUTHORIZE_PATH, JUMIA_AUTHORIZE_BASE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
}

// Exchanges a Web Application's OAuth authorization code for tokens, on
// the SAME confirmed /token endpoint mintAccessToken() uses, with the
// standard OAuth2 authorization_code fields per the "...Authorization
// Code / Refresh Token" heading on Jumia's own Postman doc (Ryan opened
// the Refresh Token branch of that same request - the Authorization Code
// branch was not opened, so the exact field set is inferred, not read).
async function exchangeAuthorizationCode(clientId, clientSecret, redirectUri, code) {
    try {
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code
        });
        const response = await axios.post(`${JUMIA_API_BASE}${JUMIA_TOKEN_PATH}`, body.toString(), {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
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
        throw normalizeAxiosError(err, "Could not complete sign-in with Jumia.");
    }
}

// Given a stored connection row, returns a live access token, minting a
// new one first if the cached one is missing or about to expire. The
// vendor's Refresh Token (stored in client_secret_enc - see the schema
// note in jumiaSyncService.js for why the column keeps its original
// name) is the durable credential re-used on every mint; there is no
// separate rotating secret to track. Does NOT persist the minted token
// itself - the caller (jumiaSyncService) owns writing the connection row
// back so this module stays free of DB access.
async function ensureFreshAccessToken(connectionRow) {
    const expiresAt = connectionRow.token_expires_at ? new Date(connectionRow.token_expires_at) : null;
    const stillValid = expiresAt && expiresAt.getTime() - Date.now() > 60000; // >1min left
    if (stillValid && connectionRow.access_token_enc) {
        return { accessToken: decryptField(connectionRow.access_token_enc), refreshed: false };
    }

    // Web Application connections keep the real refresh token in
    // refresh_token_enc (rotated on each use, per standard OAuth2) and the
    // real client secret in client_secret_enc - the opposite of Self
    // Authorization, where client_secret_enc holds the vendor's pasted
    // Refresh Token and there is no separate secret. See this file's
    // header for how confirmed each path is.
    if (connectionRow.app_type === "web_application") {
        const refreshToken = decryptField(connectionRow.refresh_token_enc);
        const clientSecret = decryptField(connectionRow.client_secret_enc);
        if (!refreshToken) {
            throw new JumiaApiError("This Application has no refresh token yet - sign in with Jumia again from the Applications tab.", { code: "NO_REFRESH_TOKEN" });
        }
        const result = await mintAccessToken(connectionRow.client_id, refreshToken, clientSecret);
        return {
            accessToken: result.accessToken,
            refreshed: true,
            refreshToken: result.refreshToken || refreshToken,
            expiresInSeconds: result.expiresInSeconds
        };
    }

    const refreshToken = decryptField(connectionRow.client_secret_enc);
    if (!refreshToken) {
        throw new JumiaApiError("This Jumia connection is missing its Refresh Token - reconnect with the Client ID/Refresh Token.", { code: "NO_REFRESH_TOKEN" });
    }
    const result = await mintAccessToken(connectionRow.client_id, refreshToken);
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
// update (PATCH); absent -> create (POST). Per the same third-party
// integration referenced above, Jumia's catalog API is feed-based: both
// create and update POST/PATCH to the SAME /catalog/products path (no id
// in the URL) with the seller_sku identifying the product in the payload,
// rather than a REST-style /products/{id} - unverified against a real
// response, but consistent with the "async feed" pattern that source
// describes (a create/update is accepted and processed, not applied
// synchronously - a real response may need polling a feed-status endpoint
// this module does not yet implement). Returns Jumia's product id for a
// create, so the caller can store it on the link row.
async function upsertJumiaProduct(accessToken, payload, jumiaProductId) {
    try {
        const http = authedHttp(accessToken);
        const body = jumiaProductId ? { ...payload, jumia_product_id: jumiaProductId } : payload;
        const response = jumiaProductId
            ? await http.patch(JUMIA_PRODUCTS_PATH, body)
            : await http.post(JUMIA_PRODUCTS_PATH, body);
        const data = response.data || {};
        const newId = jumiaProductId || data.product_id || data.id || null;
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
    mintAccessToken,
    buildAuthorizeUrl,
    exchangeAuthorizationCode,
    ensureFreshAccessToken,
    mapLizimasProductToJumiaPayload,
    mapJumiaProductToLizimasFields,
    upsertJumiaProduct,
    listJumiaProducts
};
