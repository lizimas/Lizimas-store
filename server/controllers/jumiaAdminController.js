// HTTP layer for the store-level Jumia integration (migration 085) - the
// same Applications concept jumiaController.js exposes for vendors, but
// for Lizimas's own products. No vendor lookup here: this whole router
// (server/routes/admin.js) already gates on the admin role above where
// these routes are mounted, and there is only one store, so every
// handler defers straight to jumiaAdminSyncService.js. See that file's
// header, and jumiaClient.js's, for what is/isn't verified against Jumia.

const jumiaAdminSync = require("../services/jumiaAdminSyncService");
const { JumiaApiError } = require("../services/jumiaClient");

const PUSH_BULK_MAX_IDS = 100;

function handleError(res, error, fallbackMessage) {
    const status = error.status || (error instanceof JumiaApiError ? (error.status || 502) : 500);
    res.status(status).json({ error: error.message || fallbackMessage });
}

// --- Applications CRUD ---

exports.listAdminJumiaApplications = async (req, res) => {
    try {
        res.json(await jumiaAdminSync.listApplications());
    } catch (error) {
        handleError(res, error, "Could not load Jumia Applications.");
    }
};

exports.createAdminJumiaApplication = async (req, res) => {
    try {
        const { name, app_type } = req.body;
        res.json(await jumiaAdminSync.createApplication({ name, appType: app_type }));
    } catch (error) {
        handleError(res, error, "Could not create the Application.");
    }
};

exports.deleteAdminJumiaApplication = async (req, res) => {
    try {
        await jumiaAdminSync.deleteApplication(Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not delete the Application.");
    }
};

exports.activateAdminJumiaApplication = async (req, res) => {
    try {
        res.json(await jumiaAdminSync.setActiveApplication(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not activate this Application.");
    }
};

exports.connectAdminJumiaApplication = async (req, res) => {
    try {
        const { client_id, refresh_token, client_secret } = req.body;
        const result = await jumiaAdminSync.connectApplication(Number(req.params.id), client_id, refresh_token || client_secret);
        res.json(result);
    } catch (error) {
        handleError(res, error, "Could not connect this Application to Jumia.");
    }
};

exports.disconnectAdminJumiaApplication = async (req, res) => {
    try {
        res.json(await jumiaAdminSync.disconnectApplication(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not disconnect this Application.");
    }
};

exports.testAdminJumiaApplication = async (req, res) => {
    try {
        res.json(await jumiaAdminSync.testApplicationConnection(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not verify this Application's connection.");
    }
};

exports.setAdminJumiaApplicationCredentials = async (req, res) => {
    try {
        const { client_id, client_secret } = req.body;
        res.json(await jumiaAdminSync.setWebApplicationCredentials(Number(req.params.id), client_id, client_secret));
    } catch (error) {
        handleError(res, error, "Could not save this Application's credentials.");
    }
};

exports.getAdminJumiaAuthorizeUrl = async (req, res) => {
    try {
        res.json(await jumiaAdminSync.getAuthorizeUrl(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not start Jumia sign-in.");
    }
};

// Public route - Jumia redirects the browser here directly (no admin auth
// header available on a top-level redirect); the signed `state` from
// getAuthorizeUrl identifies which Application this belongs to. Always
// ends in a redirect back to the admin panel's Products tab.
exports.adminJumiaOAuthCallback = async (req, res) => {
    const { code, state, error: jumiaError } = req.query;
    if (jumiaError) {
        return res.redirect(`/admin.html?jumia_oauth=error&message=${encodeURIComponent(String(jumiaError))}#products`);
    }
    if (!code || !state) {
        return res.redirect(`/admin.html?jumia_oauth=error&message=${encodeURIComponent("Missing code or state from Jumia.")}#products`);
    }
    try {
        const result = await jumiaAdminSync.handleOAuthCallback(code, state);
        if (!result.success) {
            return res.redirect(`/admin.html?jumia_oauth=error&message=${encodeURIComponent(result.message || "Could not connect to Jumia.")}#products`);
        }
        return res.redirect(`/admin.html?jumia_oauth=success#products`);
    } catch (error) {
        console.error("adminJumiaOAuthCallback error:", error);
        return res.redirect(`/admin.html?jumia_oauth=error&message=${encodeURIComponent("Something went wrong completing Jumia sign-in.")}#products`);
    }
};

// --- Product sync (always the active Application, resolved inside
// jumiaAdminSyncService) ---

exports.getAdminJumiaLinks = async (req, res) => {
    try {
        res.json(await jumiaAdminSync.listProductLinks());
    } catch (error) {
        handleError(res, error, "Could not load Jumia sync status.");
    }
};

exports.pushAdminProductToJumia = async (req, res) => {
    try {
        const productId = Number(req.params.id);
        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ error: "Invalid product id." });
        }
        const result = await jumiaAdminSync.pushProduct(productId);
        if (result.status === "failed") {
            return res.status(422).json({ error: result.reason });
        }
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not push this product to Jumia.");
    }
};

exports.pushAdminProductsToJumiaBulk = async (req, res) => {
    try {
        const { productIds } = req.body;
        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: "productIds must be a non-empty array." });
        }
        const ids = [...new Set(productIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
        if (ids.length === 0) {
            return res.status(400).json({ error: "No valid product ids given." });
        }
        if (ids.length > PUSH_BULK_MAX_IDS) {
            return res.status(400).json({ error: `You can push at most ${PUSH_BULK_MAX_IDS} products at once.` });
        }
        res.json(await jumiaAdminSync.pushProductsBulk(ids));
    } catch (error) {
        handleError(res, error, "Could not push products to Jumia.");
    }
};

exports.getAdminJumiaRemoteProducts = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        res.json(await jumiaAdminSync.listRemoteProducts(page));
    } catch (error) {
        handleError(res, error, "Could not fetch Jumia products.");
    }
};

exports.importAdminJumiaProducts = async (req, res) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "items must be a non-empty array of Jumia products to import." });
        }
        res.json(await jumiaAdminSync.importProducts(items, req.user.userId));
    } catch (error) {
        handleError(res, error, "Could not import products from Jumia.");
    }
};
