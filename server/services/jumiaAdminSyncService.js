// Store-level counterpart to jumiaSyncService.js: same Jumia Applications
// concept (migration 084's per-vendor design, generalised in migration 085
// to a store-owned equivalent with no owning vendor at all), for pushing
// Lizimas's own products (products.vendor_id IS NULL) to/from Jumia
// independently of any vendor's connection. Deliberately a parallel file
// rather than a generalised vendorId-or-null parameter threaded through
// jumiaSyncService.js: that file is live, tested, and in production use -
// this keeps the two paths fully independent so nothing here can regress
// the vendor feature, at the cost of some duplication.
//
// Every function below is the direct store-scoped analogue of the
// same-named function in jumiaSyncService.js - see that file's comments
// for the reasoning that carries over unchanged (the Applications
// lifecycle, the Web Application OAuth flow's unverified status, the
// getFreshConnection() token-refresh contract). Only the differences are
// called out here.

const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { encryptField, decryptField } = require("../utils/encryption");
const jumiaClient = require("./jumiaClient");

const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://lizimasstore.com").replace(/\/+$/, "");
const JUMIA_OAUTH_CALLBACK_URL = `${PUBLIC_BASE_URL}/api/admin/jumia/oauth/callback`;

async function logSync(linkId, action, status, detail) {
    await pool.query(
        `INSERT INTO admin_jumia_sync_log (product_link_id, action, status, detail)
         VALUES ($1, $2, $3, $4)`,
        [linkId || null, action, status, detail || null]
    );
}

// --- Applications ---

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

async function listApplications() {
    const rows = await pool.query(
        `SELECT id, name, app_type, client_id, redirect_uri, connection_status,
                jumia_shop_name, last_connected_at, last_error, is_active, created_at
         FROM admin_jumia_connections ORDER BY created_at ASC`
    );
    return rows.rows.map(shapeApplication);
}

async function getConnectionStatus() {
    const row = await pool.query(
        `SELECT connection_status, jumia_shop_name, last_connected_at, last_error, client_id
         FROM admin_jumia_connections WHERE is_active = true`
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

async function getApplicationOwned(applicationId) {
    const row = await pool.query(`SELECT * FROM admin_jumia_connections WHERE id = $1`, [applicationId]);
    if (row.rows.length === 0) {
        const err = new Error("Application not found.");
        err.status = 404;
        throw err;
    }
    return row.rows[0];
}

async function createApplication({ name, appType, redirectUri }) {
    const cleanName = String(name || "").trim();
    const cleanType = appType === "web_application" ? "web_application" : "self_authorization";
    if (!cleanName) {
        const err = new Error("Application Name is required.");
        err.status = 400;
        throw err;
    }
    const existingCount = (await pool.query(`SELECT count(*)::int AS n FROM admin_jumia_connections`)).rows[0].n;
    const inserted = await pool.query(
        `INSERT INTO admin_jumia_connections (name, app_type, client_id, client_secret_enc, connection_status, redirect_uri, is_active)
         VALUES ($1, $2, '', '', 'disconnected', $3, $4)
         RETURNING *`,
        [
            cleanName, cleanType,
            cleanType === "web_application" ? JUMIA_OAUTH_CALLBACK_URL : null,
            existingCount === 0
        ]
    );
    await logSync(null, "application_create", "success", `Created Application "${cleanName}" (${cleanType}).`);
    return shapeApplication(inserted.rows[0]);
}

async function deleteApplication(applicationId) {
    const app = await getApplicationOwned(applicationId);
    await pool.query(`DELETE FROM admin_jumia_connections WHERE id = $1`, [applicationId]);
    await logSync(null, "application_delete", "success", `Deleted Application "${app.name}".`);
}

async function setActiveApplication(applicationId) {
    const app = await getApplicationOwned(applicationId);
    if (app.connection_status !== "connected") {
        const err = new Error("Connect this Application before making it active.");
        err.status = 400;
        throw err;
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`UPDATE admin_jumia_connections SET is_active = false`);
        await client.query(`UPDATE admin_jumia_connections SET is_active = true, updated_at = now() WHERE id = $1`, [applicationId]);
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
    await logSync(null, "application_activate", "success", `"${app.name}" is now the active Application for product sync.`);
    return listApplications();
}

async function connectApplication(applicationId, clientId, refreshToken) {
    const app = await getApplicationOwned(applicationId);
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
            `UPDATE admin_jumia_connections
             SET client_id = $1, client_secret_enc = $2, connection_status = 'error', last_error = $3, updated_at = now()
             WHERE id = $4`,
            [clientId, encryptField(refreshToken), err.message, applicationId]
        );
        await logSync(null, "connect", "error", err.message);
        const wrapped = new Error(err.message);
        wrapped.status = 400;
        throw wrapped;
    }

    const expiresAt = new Date(Date.now() + tokenResult.expiresInSeconds * 1000);
    await pool.query(
        `UPDATE admin_jumia_connections
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
    await logSync(null, "connect", "success", tokenResult.shopName ? `Connected "${app.name}" to ${tokenResult.shopName}` : `Connected "${app.name}"`);
    await activateIfNoneActive(applicationId);
    return listApplications();
}

async function disconnectApplication(applicationId) {
    const app = await getApplicationOwned(applicationId);
    await pool.query(
        `UPDATE admin_jumia_connections
         SET connection_status = 'disconnected', access_token_enc = NULL, refresh_token_enc = NULL,
             token_expires_at = NULL, last_error = NULL, is_active = false, updated_at = now()
         WHERE id = $1`,
        [applicationId]
    );
    await logSync(null, "disconnect", "success", `Disconnected "${app.name}".`);
    return listApplications();
}

async function activateIfNoneActive(applicationId) {
    const hasActive = (await pool.query(`SELECT 1 FROM admin_jumia_connections WHERE is_active = true`)).rows.length > 0;
    if (!hasActive) {
        await pool.query(`UPDATE admin_jumia_connections SET is_active = true, updated_at = now() WHERE id = $1`, [applicationId]);
    }
}

// --- Web Application OAuth (Authorization Code Flow) - UNVERIFIED, same
// caveat as jumiaSyncService.js's vendor version: see jumiaClient.js's
// header for exactly what part of this is/isn't confirmed against Jumia. ---

async function setWebApplicationCredentials(applicationId, clientId, clientSecret) {
    const app = await getApplicationOwned(applicationId);
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
        `UPDATE admin_jumia_connections SET client_id = $1, client_secret_enc = $2, updated_at = now() WHERE id = $3`,
        [clientId, clientSecret ? encryptField(clientSecret) : app.client_secret_enc, applicationId]
    );
    return listApplications();
}

async function getAuthorizeUrl(applicationId) {
    const app = await getApplicationOwned(applicationId);
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
    // scope: "admin" distinguishes this state token from a vendor's (see
    // jumiaSyncService.js's getAuthorizeUrl) so the callback handler below
    // never confuses the two, even though they share the same JWT_SECRET.
    const state = jwt.sign({ scope: "admin", applicationId }, JWT_SECRET, { expiresIn: "15m" });
    return {
        authorize_url: jumiaClient.buildAuthorizeUrl(app.client_id, JUMIA_OAUTH_CALLBACK_URL, state),
        redirect_uri: JUMIA_OAUTH_CALLBACK_URL
    };
}

async function handleOAuthCallback(code, state) {
    let decoded;
    try {
        decoded = jwt.verify(state, JWT_SECRET);
    } catch (err) {
        return { success: false, message: "This Jumia sign-in link expired or is invalid. Please try again." };
    }
    if (decoded.scope !== "admin") {
        return { success: false, message: "This sign-in link is not valid here." };
    }
    const { applicationId } = decoded;
    let app;
    try {
        app = await getApplicationOwned(applicationId);
    } catch (err) {
        return { success: false, message: "That Jumia Application no longer exists." };
    }

    const clientSecret = decryptField(app.client_secret_enc);
    let tokenResult;
    try {
        tokenResult = await jumiaClient.exchangeAuthorizationCode(app.client_id, clientSecret, JUMIA_OAUTH_CALLBACK_URL, code);
    } catch (err) {
        await pool.query(
            `UPDATE admin_jumia_connections SET connection_status = 'error', last_error = $1, updated_at = now() WHERE id = $2`,
            [err.message, applicationId]
        );
        await logSync(null, "connect", "error", err.message);
        return { success: false, message: err.message };
    }

    const expiresAt = new Date(Date.now() + tokenResult.expiresInSeconds * 1000);
    await pool.query(
        `UPDATE admin_jumia_connections
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
    await logSync(null, "connect", "success", tokenResult.shopName ? `Connected "${app.name}" to ${tokenResult.shopName}` : `Connected "${app.name}"`);
    await activateIfNoneActive(applicationId);
    return { success: true };
}

async function getFreshConnection() {
    const row = await pool.query(`SELECT * FROM admin_jumia_connections WHERE is_active = true`);
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
                `UPDATE admin_jumia_connections
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
            `UPDATE admin_jumia_connections SET connection_status = 'error', last_error = $1, updated_at = now() WHERE id = $2`,
            [err.message, connectionRow.id]
        );
        await logSync(null, "token_refresh", "error", err.message);
        throw err;
    }
}

async function testApplicationConnection(applicationId) {
    const app = await getApplicationOwned(applicationId);
    if (!app.is_active) {
        const err = new Error("Make this Application active first, then test it.");
        err.status = 400;
        throw err;
    }
    await getFreshConnection();
    const refreshed = await getApplicationOwned(applicationId);
    return shapeApplication(refreshed);
}

// --- Push: Lizimas's own products -> Jumia ---
// vendor_id IS NULL is the load-bearing filter here: it's what keeps this
// path scoped to Lizimas's own catalogue and out of any vendor's products,
// per how this feature was scoped (Ryan, Sept 2026).

async function loadProductForPush(productId) {
    const productRow = await pool.query(
        `SELECT p.*, c.name AS category_name
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1 AND p.vendor_id IS NULL AND p.deleted_at IS NULL`,
        [productId]
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

async function findOrCreateLink(productId, sellerSku) {
    const existing = await pool.query(`SELECT * FROM admin_jumia_product_links WHERE product_id = $1`, [productId]);
    if (existing.rows.length > 0) return existing.rows[0];
    const created = await pool.query(
        `INSERT INTO admin_jumia_product_links (product_id, jumia_seller_sku, sync_direction, sync_status)
         VALUES ($1, $2, 'push', 'pending')
         ON CONFLICT (jumia_seller_sku) DO UPDATE SET product_id = EXCLUDED.product_id
         RETURNING *`,
        [productId, sellerSku]
    );
    return created.rows[0];
}

async function pushProduct(productId) {
    const loaded = await loadProductForPush(productId);
    if (!loaded) return { status: "failed", reason: "Not found, already deleted, or owned by a vendor rather than Lizimas itself." };
    const { product, specs, images } = loaded;

    let accessToken;
    try {
        ({ accessToken } = await getFreshConnection());
    } catch (err) {
        return { status: "failed", reason: err.message };
    }

    const sellerSku = product.sku || `LZM-${product.id}`;
    const link = await findOrCreateLink(productId, sellerSku);
    const payload = jumiaClient.mapLizimasProductToJumiaPayload(product, specs, images);

    try {
        const result = await jumiaClient.upsertJumiaProduct(accessToken, payload, link.jumia_product_id);
        await pool.query(
            `UPDATE admin_jumia_product_links
             SET jumia_product_id = COALESCE($1, jumia_product_id), sync_status = 'synced',
                 last_synced_at = now(), last_synced_product_updated_at = $2, last_error = NULL, updated_at = now()
             WHERE id = $3`,
            [result.jumiaProductId, product.updated_at, link.id]
        );
        await logSync(link.id, "push", "success", `Pushed "${product.name}" to Jumia.`);
        return { status: "success" };
    } catch (err) {
        await pool.query(
            `UPDATE admin_jumia_product_links SET sync_status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`,
            [err.message, link.id]
        );
        await logSync(link.id, "push", "error", err.message);
        return { status: "failed", reason: err.message };
    }
}

async function pushProductsBulk(productIds) {
    const successful = [];
    const failed = [];
    for (const id of productIds) {
        const result = await pushProduct(id);
        if (result.status === "success") successful.push({ id });
        else failed.push({ id, reason: result.reason });
    }
    return { successful, failed };
}

// --- Pull: Jumia product -> Lizimas (as a store-owned product, vendor_id NULL) ---

async function listRemoteProducts(page) {
    const { accessToken } = await getFreshConnection();
    const result = await jumiaClient.listJumiaProducts(accessToken, { page });
    const linked = await pool.query(`SELECT jumia_seller_sku FROM admin_jumia_product_links`);
    const linkedSkus = new Set(linked.rows.map(r => r.jumia_seller_sku));
    return {
        items: result.items.map(item => ({ ...item, already_linked: linkedSkus.has(item.seller_sku) })),
        totalCount: result.totalCount,
        hasMore: result.hasMore
    };
}

// createdBy: the admin user importing, so the new product is attributed
// like any other staff-added product (addProduct/importProducts in
// productController.js/adminController.js do the same).
async function importProducts(remoteProducts, createdBy) {
    const created = [];
    const skipped = [];
    for (const remote of remoteProducts) {
        const sellerSku = remote.seller_sku;
        if (!sellerSku) {
            skipped.push({ seller_sku: null, reason: "Missing Jumia SellerSku - cannot import." });
            continue;
        }
        const existingLink = await pool.query(`SELECT * FROM admin_jumia_product_links WHERE jumia_seller_sku = $1`, [sellerSku]);
        if (existingLink.rows.length > 0 && existingLink.rows[0].product_id) {
            skipped.push({ seller_sku: sellerSku, reason: "Already imported." });
            continue;
        }

        const { productFields, specs, images } = jumiaClient.mapJumiaProductToLizimasFields(remote);
        const inserted = await pool.query(
            `INSERT INTO products (name, description, brand, price, stock, sku, vendor_id, created_by, status, image)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'approved', $8)
             RETURNING *`,
            [
                productFields.name, productFields.description, productFields.brand,
                productFields.price, productFields.stock, productFields.sku || sellerSku,
                createdBy, images[0] || null
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
                `UPDATE admin_jumia_product_links SET product_id = $1, sync_status = 'synced', last_synced_at = now(),
                    last_synced_product_updated_at = $2, last_error = NULL, updated_at = now() WHERE id = $3`,
                [newProduct.id, newProduct.updated_at, existingLink.rows[0].id]
            );
            await logSync(existingLink.rows[0].id, "import", "success", `Imported "${newProduct.name}" from Jumia.`);
        } else {
            const linkInsert = await pool.query(
                `INSERT INTO admin_jumia_product_links
                    (product_id, jumia_seller_sku, jumia_product_id, sync_direction, sync_status, last_synced_at, last_synced_product_updated_at)
                 VALUES ($1, $2, $3, 'pull', 'synced', now(), $4)
                 RETURNING id`,
                [newProduct.id, sellerSku, remote.product_id || remote.id || null, newProduct.updated_at]
            );
            await logSync(linkInsert.rows[0].id, "import", "success", `Imported "${newProduct.name}" from Jumia.`);
        }

        created.push({ id: newProduct.id, name: newProduct.name });
    }
    return { created, skipped };
}

async function listProductLinks() {
    const result = await pool.query(
        `SELECT l.id, l.product_id, l.jumia_seller_sku, l.jumia_product_id, l.sync_direction,
                l.sync_status, l.last_synced_at, l.last_error,
                p.name AS product_name, p.updated_at AS product_updated_at,
                (l.last_synced_product_updated_at IS NOT NULL AND p.updated_at IS NOT NULL
                    AND p.updated_at > l.last_synced_product_updated_at) AS locally_changed_since_sync
         FROM admin_jumia_product_links l
         LEFT JOIN products p ON p.id = l.product_id
         ORDER BY l.updated_at DESC`
    );
    return result.rows;
}

module.exports = {
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
