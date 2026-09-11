// Orchestrates the Lizimas<->Jumia product-linking feature: owns every
// DB read/write for vendor_jumia_connections, jumia_product_links and
// jumia_sync_log, and calls into jumiaClient.js (the actual Jumia HTTP
// calls - see that file's header for what is and isn't verified) for
// anything that talks to Jumia. Kept separate from jumiaController.js so
// the controller stays a thin request/response layer, matching how
// commissionEngine.js/vendorWallet.js sit underneath their controllers
// elsewhere in this codebase.

const pool = require("../config/database");
const { encryptField, decryptField } = require("../utils/encryption");
const jumiaClient = require("./jumiaClient");

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

// --- Connection lifecycle ---

async function getConnectionStatus(vendorId) {
    const row = await pool.query(
        `SELECT connection_status, jumia_shop_name, last_connected_at, last_error, client_id
         FROM vendor_jumia_connections WHERE vendor_id = $1`,
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

async function connectVendor(vendorId, clientId, clientSecret) {
    if (!clientId || !clientSecret) {
        const err = new Error("Client ID and Client Secret are both required.");
        err.status = 400;
        throw err;
    }
    let tokenResult;
    try {
        tokenResult = await jumiaClient.exchangeCredentialsForToken(clientId, clientSecret);
    } catch (err) {
        // Record the attempt even on failure, so a vendor who mistypes their
        // secret sees why the connection didn't take instead of a silent
        // no-op, and so the row's status flips to 'error' with a reason.
        await pool.query(
            `INSERT INTO vendor_jumia_connections (vendor_id, client_id, client_secret_enc, connection_status, last_error, updated_at)
             VALUES ($1, $2, $3, 'error', $4, now())
             ON CONFLICT (vendor_id) DO UPDATE SET
                client_id = EXCLUDED.client_id,
                client_secret_enc = EXCLUDED.client_secret_enc,
                connection_status = 'error',
                last_error = EXCLUDED.last_error,
                updated_at = now()`,
            [vendorId, clientId, encryptField(clientSecret), err.message]
        );
        await logSync(vendorId, null, "connect", "error", err.message);
        const wrapped = new Error(err.message);
        wrapped.status = 400;
        throw wrapped;
    }

    const expiresAt = new Date(Date.now() + tokenResult.expiresInSeconds * 1000);
    await pool.query(
        `INSERT INTO vendor_jumia_connections
            (vendor_id, client_id, client_secret_enc, access_token_enc, refresh_token_enc,
             token_expires_at, connection_status, jumia_shop_name, last_connected_at, last_error, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'connected', $7, now(), NULL, now())
         ON CONFLICT (vendor_id) DO UPDATE SET
            client_id = EXCLUDED.client_id,
            client_secret_enc = EXCLUDED.client_secret_enc,
            access_token_enc = EXCLUDED.access_token_enc,
            refresh_token_enc = EXCLUDED.refresh_token_enc,
            token_expires_at = EXCLUDED.token_expires_at,
            connection_status = 'connected',
            jumia_shop_name = EXCLUDED.jumia_shop_name,
            last_connected_at = now(),
            last_error = NULL,
            updated_at = now()`,
        [
            vendorId, clientId, encryptField(clientSecret),
            encryptField(tokenResult.accessToken), encryptField(tokenResult.refreshToken),
            expiresAt, tokenResult.shopName
        ]
    );
    await logSync(vendorId, null, "connect", "success", tokenResult.shopName ? `Connected to ${tokenResult.shopName}` : "Connected");
    return getConnectionStatus(vendorId);
}

async function disconnectVendor(vendorId) {
    await pool.query(
        `UPDATE vendor_jumia_connections
         SET connection_status = 'disconnected', access_token_enc = NULL, refresh_token_enc = NULL,
             token_expires_at = NULL, last_error = NULL, updated_at = now()
         WHERE vendor_id = $1`,
        [vendorId]
    );
    await logSync(vendorId, null, "disconnect", "success", "Vendor disconnected their Jumia account.");
}

// Internal: loads the connection row and returns a guaranteed-fresh
// access token, persisting a refreshed token back to the row when one
// was needed. Throws if there is no usable connection.
async function getFreshConnection(vendorId) {
    const row = await pool.query(`SELECT * FROM vendor_jumia_connections WHERE vendor_id = $1`, [vendorId]);
    if (row.rows.length === 0 || row.rows[0].connection_status === "disconnected") {
        const err = new Error("Not connected to Jumia yet.");
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
                 WHERE vendor_id = $4`,
                [encryptField(fresh.accessToken), encryptField(fresh.refreshToken), expiresAt, vendorId]
            );
        }
        return { connectionRow, accessToken: fresh.accessToken };
    } catch (err) {
        await pool.query(
            `UPDATE vendor_jumia_connections SET connection_status = 'error', last_error = $1, updated_at = now() WHERE vendor_id = $2`,
            [err.message, vendorId]
        );
        await logSync(vendorId, null, "token_refresh", "error", err.message);
        throw err;
    }
}

async function testConnection(vendorId) {
    await getFreshConnection(vendorId);
    return getConnectionStatus(vendorId);
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
    connectVendor,
    disconnectVendor,
    testConnection,
    pushProduct,
    pushProductsBulk,
    listRemoteProducts,
    importProducts,
    listProductLinks
};
