// Orchestrates the Lizimas<->Jumia product-linking feature: owns every
// DB read/write for vendor_jumia_connections, jumia_product_links and
// jumia_sync_log, and calls into jumiaClient.js (the actual Jumia HTTP
// calls - see that file's header for what is and isn't verified) for
// anything that talks to Jumia. Kept separate from jumiaController.js so
// the controller stays a thin request/response layer, matching how
// commissionEngine.js/vendorWallet.js sit underneath their controllers
// elsewhere in this codebase.
//
// Since migration 084 a vendor can have several vendor_jumia_connections
// rows ("Applications", matching Jumia's own Manage Applications screen -
// each Web Application or Self Authorization credential set the vendor
// created there). Product push/pull/import only ever use whichever one
// is_active=true - everything below that isn't itself an Applications
// CRUD function resolves that row first and behaves exactly as it did
// pre-084 (a vendor with exactly one Application, active, is the common
// case and nothing changes for them).

const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { encryptField, decryptField } = require("../utils/encryption");
const jumiaClient = require("./jumiaClient");

const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://lizimasstore.com").replace(/\/+$/, "");
const JUMIA_OAUTH_CALLBACK_URL = `${PUBLIC_BASE_URL}/api/vendors/jumia/oauth/callback`;

async function getVendorIdForUser(userId) {
    const row = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [userId]);
    return row.rows.length ? row.rows[0].id : null;
}

async function logSync(vendorId, linkId, action, status, detail) {
    await pool.query(
        `INSERT INTO jumia_sync_log (vendor_id, product_link_id, action, status, detail)
         VALUES ($1, $2, $3, $4, $5)`,
        [vendorId, linkId || null, action, status, detail || null]
    );
}

// --- Applications (Task: multiple named Jumia Applications per vendor,
// matching Jumia's own Manage Applications screen - see migration 084) ---

function shapeApplication(r) {
    return {
        id: r.id,
        name: r.name,
        app_type: r.app_type,
        client_id: r.client_id,
        redirect_uri: r.redirect_uri,
        connection_status: r.connection_status,
        connected: r.connection_status === "connected",
        jumia_shop_name: r.jumia_shop_name,
        last_connected_at: r.last_connected_at,
        last_error: r.last_error,
        is_active: r.is_active,
        created_at: r.created_at
    };
}

async function listApplications(vendorId) {
    const rows = await pool.query(
        `SELECT id, name, app_type, client_id, redirect_uri, connection_status,
                jumia_shop_name, last_connected_at, last_error, is_active, created_at
         FROM vendor_jumia_connections WHERE vendor_id = $1 ORDER BY created_at ASC`,
        [vendorId]
    );
    return rows.rows.map(shapeApplication);
}

// Status of the ACTIVE Application only, for callers that just need to
// know whether there's a working connection at all (Product Sync/Import
// panel gating) without the full Applications list.
async function getConnectionStatus(vendorId) {
    const row = await pool.query(
        `SELECT connection_status, jumia_shop_name, last_connected_at, last_error, client_id
         FROM vendor_jumia_connections WHERE vendor_id = $1 AND is_active = true`,
        [vendorId]
    );
    if (row.rows.length === 0) {
        return { connected: false, connection_status: "disconnected", jumia_shop_name: null, last_connected_at: null, last_error: null, client_id: null };
    }
    const r = row.rows[0];
    return {
        connected: r.connection_status === "connected",
        connection_status: r.connection_status,
        jumia_shop_name: r.jumia_shop_name,
        last_connected_at: r.last_connected_at,
        last_error: r.last_error,
        client_id: r.client_id
    };
}

async function getApplicationOwned(vendorId, applicationId) {
    const row = await pool.query(
        `SELECT * FROM vendor_jumia_connections WHERE id = $1 AND vendor_id = $2`,
        [applicationId, vendorId]
    );
    if (row.rows.length === 0) {
        const err = new Error("Application not found.");
        err.status = 404;
        throw err;
    }
    return row.rows[0];
}

// client_id/client_secret_enc are NOT NULL (migration 082) - a freshly
// created, not-yet-connected Application gets empty-string placeholders
// rather than a schema change to make them nullable.
async function createApplication(vendorId, { name, appType, redirectUri }) {
    const cleanName = String(name || "").trim();
    const cleanType = appType === "web_application" ? "web_application" : "self_authorization";
    if (!cleanName) {
        const err = new Error("Application Name is required.");
        err.status = 400;
        throw err;
    }
    const existingCount = (await pool.query(
        `SELECT count(*)::int AS n FROM vendor_jumia_connections WHERE vendor_id = $1`, [vendorId]
    )).rows[0].n;
    const inserted = await pool.query(
        `INSERT INTO vendor_jumia_connections (vendor_id, name, app_type, client_id, client_secret_enc, connection_status, redirect_uri, is_active)
         VALUES ($1, $2, $3, '', '', 'disconnected', $4, $5)
         RETURNING *`,
        [
            vendorId, cleanName, cleanType,
            cleanType === "web_application" ? JUMIA_OAUTH_CALLBACK_URL : null,
            existingCount === 0
        ]
    );
    await logSync(vendorId, null, "application_create", "success", `Created Application "${cleanName}" (${cleanType}).`);
    return shapeApplication(inserted.rows[0]);
}

async function deleteApplication(vendorId, applicationId) {
    const app = await getApplicationOwned(vendorId, applicationId);
    await pool.query(`DELETE FROM vendor_jumia_connections WHERE id = $1`, [applicationId]);
    await logSync(vendorId, null, "application_delete", "success", `Deleted Application "${app.name}".`);
}

async function setActiveApplication(vendorId, applicationId) {
    const app = await getApplicationOwned(vendorId, applicationId);
    if (app.connection_status !== "connected") {
        const err = new Error("Connect this Application before making it active.");
        err.status = 400;
        throw err;
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`UPDATE vendor_jumia_connections SET is_active = false WHERE vendor_id = $1`, [vendorId]);
        await client.query(`UPDATE vendor_jumia_connections SET is_active = true, updated_at = now() WHERE id = $1`, [applicationId]);
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
    await logSync(vendorId, null, "application_activate", "success", `"${app.name}" is now the active Application for product sync.`);
    return listApplications(vendorId);
}

// clientSecret param here is really the vendor's Jumia Refresh Token for a
// Self Authorization Application (see jumiaClient.js's header note).
async function connectApplication(vendorId, applicationId, clientId, refreshToken) {
    const app = await getApplicationOwned(vendorId, applicationId);
    if (app.app_type !== "self_authorization") {
        const err = new Error('This Application is a Web Application - use "Sign in with Jumia" instead of pasting a Refresh Token.');
        err.status = 400;
        throw err;
    }
    if (!clientId || !refreshToken) {
        const err = new Error("Client ID and Refresh Token are both required.");
        err.status = 400;
        throw err;
    }
    let tokenResult;
    try {
        tokenResult = await jumiaClient.mintAccessToken(clientId, refreshToken);
    } catch (err) {
        await pool.query(
            `UPDATE vendor_jumia_connections
             SET client_id = $1, client_secret_enc = $2, connection_status = 'error', last_error = $3, updated_at = now()
             WHERE id = $4`,
            [clientId, encryptField(refreshToken), err.message, applicationId]
        );
        await logSync(vendorId, null, "connect", "error", err.message);
        const wrapped = new Error(err.message);
        wrapped.status = 400;
        throw wrapped;
    }

    const expiresAt = new Date(Date.now() + tokenResult.expiresInSeconds * 1000);
    await pool.query(
        `UPDATE vendor_jumia_connections
         SET client_id = $1, client_secret_enc = $2, access_token_enc = $3, refresh_token_enc = $4,
             token_expires_at = $5, connection_status = 'connected', jumia_shop_name = $6,
             last_connected_at = now(), last_error = NULL, updated_at = now()
         WHERE id = $7`,
        [
            clientId, encryptField(refreshToken),
            encryptField(tokenResult.accessToken), encryptField(tokenResult.refreshToken),
            expiresAt, tokenResult.shopName, applicationId
        ]
    );
    await logSync(vendorId, null, "connect", "success", tokenResult.shopName ? `Connected "${app.name}" to ${tokenResult.shopName}` : `Connected "${app.name}"`);
    await activateIfNoneActive(vendorId, applicationId);
    return listApplications(vendorId);
}

async function disconnectApplication(vendorId, applicationId) {
    const app = await getApplicationOwned(vendorId, applicationId);
    await pool.query(
        `UPDATE vendor_jumia_connections
         SET connection_status = 'disconnected', access_token_enc = NULL, refresh_token_enc = NULL,
             token_expires_at = NULL, last_error = NULL, is_active = false, updated_at = now()
         WHERE id = $1`,
        [applicationId]
    );
    await logSync(vendorId, null, "disconnect", "success", `Disconnected "${app.name}".`);
    return listApplications(vendorId);
}

// First-ever successful connection with nothing active yet: make this one
// active automatically so a vendor's first Application "just works"
// without an extra step, matching the old single-Application behaviour.
async function activateIfNoneActive(vendorId, applicationId) {
    const hasActive = (await pool.query(
        `SELECT 1 FROM vendor_jumia_connections WHERE vendor_id = $1 AND is_active = true`, [vendorId]
    )).rows.length > 0;
    if (!hasActive) {
        await pool.query(`UPDATE vendor_jumia_connections SET is_active = true, updated_at = now() WHERE id = $1`, [applicationId]);
    }
}

// --- Web Application OAuth (Authorization Code Flow) ---
// UNVERIFIED end to end - see jumiaClient.js's header for exactly what
// part of this is and isn't confirmed against Jumia's real API.

// Sets/updates a Web Application's Client ID + Client Secret, collected
// from the vendor just before "Sign in with Jumia" (Jumia's own dialog
// asks for these at Application-creation time on their side; this UI
// asks right before the redirect instead, once the vendor has created
// the matching Application on Jumia and copied its credentials here).
async function setWebApplicationCredentials(vendorId, applicationId, clientId, clientSecret) {
    const app = await getApplicationOwned(vendorId, applicationId);
    if (app.app_type !== "web_application") {
        const err = new Error("This Application is not a Web Application.");
        err.status = 400;
        throw err;
    }
    if (!clientId) {
        const err = new Error("Client ID is required.");
        err.status = 400;
        throw err;
    }
    await pool.query(
        `UPDATE vendor_jumia_connections SET client_id = $1, client_secret_enc = $2, updated_at = now() WHERE id = $3`,
        [clientId, clientSecret ? encryptField(clientSecret) : app.client_secret_enc, applicationId]
    );
    return listApplications(vendorId);
}

async function getAuthorizeUrl(vendorId, applicationId) {
    const app = await getApplicationOwned(vendorId, applicationId);
    if (app.app_type !== "web_application") {
        const err = new Error("This Application is a Self Authorization type - paste its Client ID and Refresh Token instead.");
        err.status = 400;
        throw err;
    }
    if (!app.client_id) {
        const err = new Error("Enter this Application's Client ID and Client Secret first, then sign in with Jumia.");
        err.status = 400;
        throw err;
    }
    const state = jwt.sign({ vendorId, applicationId }, JWT_SECRET, { expiresIn: "15m" });
    return {
        authorize_url: jumiaClient.buildAuthorizeUrl(app.client_id, JUMIA_OAUTH_CALLBACK_URL, state),
        redirect_uri: JUMIA_OAUTH_CALLBACK_URL
    };
}

// Handles Jumia's redirect back after the vendor consents. Called from a
// PUBLIC route (no vendor auth header is available on a top-level browser
// redirect) - the signed `state` from getAuthorizeUrl() is what identifies
// which vendor/Application this belongs to instead of req.user.
async function handleOAuthCallback(code, state) {
    let decoded;
    try {
        decoded = jwt.verify(state, JWT_SECRET);
    } catch (err) {
        return { success: false, message: "This Jumia sign-in link expired or is invalid. Please try again." };
    }
    const { vendorId, applicationId } = decoded;
    let app;
    try {
        app = await getApplicationOwned(vendorId, applicationId);
    } catch (err) {
        return { success: false, message: "That Jumia Application no longer exists." };
    }

    const clientSecret = decryptField(app.client_secret_enc);
    let tokenResult;
    try {
        tokenResult = await jumiaClient.exchangeAuthorizationCode(app.client_id, clientSecret, JUMIA_OAUTH_CALLBACK_URL, code);
    } catch (err) {
        await pool.query(
            `UPDATE vendor_jumia_connections SET connection_status = 'error', last_error = $1, updated_at = now() WHERE id = $2`,
            [err.message, applicationId]
        );
        await logSync(vendorId, null, "connect", "error", err.message);
        return { success: false, message: err.message };
    }

    const expiresAt = new Date(Date.now() + tokenResult.expiresInSeconds * 1000);
    await pool.query(
        `UPDATE vendor_jumia_connections
         SET access_token_enc = $1, refresh_token_enc = $2, token_expires_at = $3,
             connection_status = 'connected', jumia_shop_name = $4,
             last_connected_at = now(), last_error = NULL, updated_at = now()
         WHERE id = $5`,
        [
            encryptField(tokenResult.accessToken),
            tokenResult.refreshToken ? encryptField(tokenResult.refreshToken) : app.refresh_token_enc,
            expiresAt, tokenResult.shopName, applicationId
        ]
    );
    await logSync(vendorId, null, "connect", "success", tokenResult.shopName ? `Connected "${app.name}" to ${tokenResult.shopName}` : `Connected "${app.name}"`);
    await activateIfNoneActive(vendorId, applicationId);
    return { success: true };
}

// Internal: loads the ACTIVE Application's row and returns a
// guaranteed-fresh access token, persisting a refreshed token back to it
// when one was needed. Throws if there is no active, usable connection.
async function getFreshConnection(vendorId) {
    const row = await pool.query(`SELECT * FROM vendor_jumia_connections WHERE vendor_id = $1 AND is_active = true`, [vendorId]);
    if (row.rows.length === 0 || row.rows[0].connection_status === "disconnected") {
        const err = new Error("No active Jumia Application connected - go to Applications and connect or activate one.");
        err.status = 400;
        throw err;
    }
    const connectionRow = row.rows[0];
    try {
        const fresh = await jumiaClient.ensureFreshAccessToken(connectionRow);
        if (fresh.refreshed) {
            const expiresAt = new Date(Date.now() + (fresh.expiresInSeconds || 3600) * 1000);
            await pool.query(
                `UPDATE vendor_jumia_connections
                 SET access_token_enc = $1, refresh_token_enc = $2, token_expires_at = $3,
                     connection_status = 'connected', last_error = NULL, updated_at = now()
                 WHERE id = $4`,
                [
                    encryptField(fresh.accessToken),
                    fresh.refreshToken ? encryptField(fresh.refreshToken) : connectionRow.refresh_token_enc,
                    expiresAt, connectionRow.id
                ]
            );
        }
        return { connectionRow, accessToken: fresh.accessToken };
    } catch (err) {
        await pool.query(
            `UPDATE vendor_jumia_connections SET connection_status = 'error', last_error = $1, updated_at = now() WHERE id = $2`,
            [err.message, connectionRow.id]
        );
        await logSync(vendorId, null, "token_refresh", "error", err.message);
        throw err;
    }
}

// Testing always exercises the ACTIVE Application (that's the one
// getFreshConnection resolves, and the one push/pull/import actually
// use) - testing a non-active one would tell the vendor nothing about
// what sync currently uses, so it must be made active first.
async function testApplicationConnection(vendorId, applicationId) {
    const app = await getApplicationOwned(vendorId, applicationId);
    if (!app.is_active) {
        const err = new Error("Make this Application active first, then test it.");
        err.status = 400;
        throw err;
    }
    await getFreshConnection(vendorId);
    const refreshed = await getApplicationOwned(vendorId, applicationId);
    return shapeApplication(refreshed);
}

// --- Push: Lizimas product -> Jumia ---

async function loadProductForPush(vendorId, productId) {
    const productRow = await pool.query(
        `SELECT p.*, c.name AS category_name
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1 AND p.vendor_id = $2 AND p.deleted_at IS NULL`,
        [productId, vendorId]
    );
    if (productRow.rows.length === 0) return null;
    const specs = await pool.query(
        `SELECT label, value, display_order FROM product_specifications WHERE product_id = $1 ORDER BY display_order ASC`,
        [productId]
    );
    const images = await pool.query(
        `SELECT image_path, display_order FROM product_images WHERE product_id = $1 ORDER BY display_order ASC`,
        [productId]
    );
    return { product: productRow.rows[0], specs: specs.rows, images: images.rows };
}

async function findOrCreateLink(vendorId, productId, sellerSku) {
    const existing = await pool.query(
        `SELECT * FROM jumia_product_links WHERE vendor_id = $1 AND product_id = $2`,
        [vendorId, productId]
    );
    if (existing.rows.length > 0) return existing.rows[0];
    const created = await pool.query(
        `INSERT INTO jumia_product_links (vendor_id, product_id, jumia_seller_sku, sync_direction, sync_status)
         VALUES ($1, $2, $3, 'push', 'pending')
         ON CONFLICT (vendor_id, jumia_seller_sku) DO UPDATE SET product_id = EXCLUDED.product_id
         RETURNING *`,
        [vendorId, productId, sellerSku]
    );
    return created.rows[0];
}

// Pushes one product. Returns { status: 'success'|'failed', reason? } -
// never throws for an ordinary Jumia-side rejection, so bulk push can
// keep going through the rest of the list (mirrors
// vendorController.bulkUpdateVendorProducts' successful/failed/skipped
// shape).
async function pushProduct(vendorId, productId) {
    const loaded = await loadProductForPush(vendorId, productId);
    if (!loaded) return { status: "failed", reason: "Not found - it may belong to another vendor." };
    const { product, specs, images } = loaded;

    let accessToken;
    try {
        ({ accessToken } = await getFreshConnection(vendorId));
    } catch (err) {
        return { status: "failed", reason: err.message };
    }

    const sellerSku = product.sku || `LZM-${product.id}`;
    const link = await findOrCreateLink(vendorId, productId, sellerSku);
    const payload = jumiaClient.mapLizimasProductToJumiaPayload(product, specs, images);

    try {
        const result = await jumiaClient.upsertJumiaProduct(accessToken, payload, link.jumia_product_id);
        await pool.query(
            `UPDATE jumia_product_links
             SET jumia_product_id = COALESCE($1, jumia_product_id), sync_status = 'synced',
                 last_synced_at = now(), last_synced_product_updated_at = $2, last_error = NULL, updated_at = now()
             WHERE id = $3`,
            [result.jumiaProductId, product.updated_at, link.id]
        );
        await logSync(vendorId, link.id, "push", "success", `Pushed "${product.name}" to Jumia.`);
        return { status: "success" };
    } catch (err) {
        await pool.query(
            `UPDATE jumia_product_links SET sync_status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`,
            [err.message, link.id]
        );
        await logSync(vendorId, link.id, "push", "error", err.message);
        return { status: "failed", reason: err.message };
    }
}

async function pushProductsBulk(vendorId, productIds) {
    const successful = [];
    const failed = [];
    for (const id of productIds) {
        const result = await pushProduct(vendorId, id);
        if (result.status === "success") successful.push({ id });
        else failed.push({ id, reason: result.reason });
    }
    return { successful, failed };
}

// --- Pull: Jumia product -> Lizimas ---

async function listRemoteProducts(vendorId, page) {
    const { accessToken } = await getFreshConnection(vendorId);
    const result = await jumiaClient.listJumiaProducts(accessToken, { page });
    const linked = await pool.query(
        `SELECT jumia_seller_sku FROM jumia_product_links WHERE vendor_id = $1`,
        [vendorId]
    );
    const linkedSkus = new Set(linked.rows.map(r => r.jumia_seller_sku));
    return {
        items: result.items.map(item => ({ ...item, already_linked: linkedSkus.has(item.seller_sku) })),
        totalCount: result.totalCount,
        hasMore: result.hasMore
    };
}

// Imports a set of already-fetched Jumia product objects (as returned by
// listRemoteProducts) into Lizimas as new products, each linked back to
// its Jumia listing. status is 'created'/'linked'/'skipped' per item to
// avoid duplicate products when the same import is retried.
async function importProducts(vendorId, remoteProducts) {
    const created = [];
    const skipped = [];
    for (const remote of remoteProducts) {
        const sellerSku = remote.seller_sku;
        if (!sellerSku) {
            skipped.push({ seller_sku: null, reason: "Missing Jumia SellerSku - cannot import." });
            continue;
        }
        const existingLink = await pool.query(
            `SELECT * FROM jumia_product_links WHERE vendor_id = $1 AND jumia_seller_sku = $2`,
            [vendorId, sellerSku]
        );
        if (existingLink.rows.length > 0 && existingLink.rows[0].product_id) {
            skipped.push({ seller_sku: sellerSku, reason: "Already imported." });
            continue;
        }

        const { productFields, specs, images } = jumiaClient.mapJumiaProductToLizimasFields(remote);
        const inserted = await pool.query(
            `INSERT INTO products (name, description, brand, price, stock, sku, vendor_id, status, image)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
             RETURNING *`,
            [
                productFields.name, productFields.description, productFields.brand,
                productFields.price, productFields.stock, productFields.sku || sellerSku,
                vendorId, images[0] || null
            ]
        );
        const newProduct = inserted.rows[0];

        for (const spec of specs) {
            if (!spec.label) continue;
            await pool.query(
                `INSERT INTO product_specifications (product_id, label, value, display_order) VALUES ($1, $2, $3, $4)`,
                [newProduct.id, spec.label, spec.value, spec.display_order]
            );
        }
        for (const [index, imagePath] of images.entries()) {
            await pool.query(
                `INSERT INTO product_images (product_id, image_path, display_order) VALUES ($1, $2, $3)`,
                [newProduct.id, imagePath, index]
            );
        }

        if (existingLink.rows.length > 0) {
            await pool.query(
                `UPDATE jumia_product_links SET product_id = $1, sync_status = 'synced', last_synced_at = now(),
                    last_synced_product_updated_at = $2, last_error = NULL, updated_at = now() WHERE id = $3`,
                [newProduct.id, newProduct.updated_at, existingLink.rows[0].id]
            );
            await logSync(vendorId, existingLink.rows[0].id, "import", "success", `Imported "${newProduct.name}" from Jumia.`);
        } else {
            const linkInsert = await pool.query(
                `INSERT INTO jumia_product_links
                    (vendor_id, product_id, jumia_seller_sku, jumia_product_id, sync_direction, sync_status, last_synced_at, last_synced_product_updated_at)
                 VALUES ($1, $2, $3, $4, 'pull', 'synced', now(), $5)
                 RETURNING id`,
                [vendorId, newProduct.id, sellerSku, remote.product_id || remote.id || null, newProduct.updated_at]
            );
            await logSync(vendorId, linkInsert.rows[0].id, "import", "success", `Imported "${newProduct.name}" from Jumia.`);
        }

        created.push({ id: newProduct.id, name: newProduct.name });
    }
    return { created, skipped };
}

// --- Sync status list (for the vendor-facing "Jumia" tab) ---

async function listProductLinks(vendorId) {
    const result = await pool.query(
        `SELECT l.id, l.product_id, l.jumia_seller_sku, l.jumia_product_id, l.sync_direction,
                l.sync_status, l.last_synced_at, l.last_error,
                p.name AS product_name, p.updated_at AS product_updated_at,
                (l.last_synced_product_updated_at IS NOT NULL AND p.updated_at IS NOT NULL
                    AND p.updated_at > l.last_synced_product_updated_at) AS locally_changed_since_sync
         FROM jumia_product_links l
         LEFT JOIN products p ON p.id = l.product_id
         WHERE l.vendor_id = $1
         ORDER BY l.updated_at DESC`,
        [vendorId]
    );
    return result.rows;
}

module.exports = {
    getVendorIdForUser,
    getConnectionStatus,
    listApplications,
    createApplication,
    deleteApplication,
    setActiveApplication,
    connectApplication,
    disconnectApplication,
    setWebApplicationCredentials,
    getAuthorizeUrl,
    handleOAuthCallback,
    testApplicationConnection,
    pushProduct,
    pushProductsBulk,
    listRemoteProducts,
    importProducts,
    listProductLinks
};
