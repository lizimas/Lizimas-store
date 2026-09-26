// Admin > Products > channel Applications: HTTP layer over
// channelAdminSyncService.js.

const channelAdminSync = require("../services/channelAdminSyncService");
const { ChannelApiError } = require("../services/channelClient");

const PUSH_BULK_MAX_IDS = 100;

function handleError(res, error, fallbackMessage) {
    const status = error.status || (error instanceof ChannelApiError ? (error.status || 502) : 500);
    res.status(status).json({ error: error.message || fallbackMessage });
}

// --- Applications CRUD ---

exports.listAdminChannelApplications = async (req, res) => {
    try {
        res.json(await channelAdminSync.listApplications());
    } catch (error) {
        handleError(res, error, "Could not load Channel Applications.");
    }
};

exports.createAdminChannelApplication = async (req, res) => {
    try {
        const { name, app_type } = req.body;
        res.json(await channelAdminSync.createApplication({ name, appType: app_type }));
    } catch (error) {
        handleError(res, error, "Could not create the Application.");
    }
};

exports.deleteAdminChannelApplication = async (req, res) => {
    try {
        await channelAdminSync.deleteApplication(Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not delete the Application.");
    }
};

exports.activateAdminChannelApplication = async (req, res) => {
    try {
        res.json(await channelAdminSync.setActiveApplication(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not activate this Application.");
    }
};

exports.connectAdminChannelApplication = async (req, res) => {
    try {
        const { client_id, refresh_token, client_secret } = req.body;
        const result = await channelAdminSync.connectApplication(Number(req.params.id), client_id, refresh_token || client_secret);
        res.json(result);
    } catch (error) {
        handleError(res, error, "Could not connect this Application to Channel.");
    }
};

exports.disconnectAdminChannelApplication = async (req, res) => {
    try {
        res.json(await channelAdminSync.disconnectApplication(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not disconnect this Application.");
    }
};

exports.testAdminChannelApplication = async (req, res) => {
    try {
        res.json(await channelAdminSync.testApplicationConnection(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not verify this Application's connection.");
    }
};

exports.setAdminChannelApplicationCredentials = async (req, res) => {
    try {
        const { client_id, client_secret } = req.body;
        res.json(await channelAdminSync.setWebApplicationCredentials(Number(req.params.id), client_id, client_secret));
    } catch (error) {
        handleError(res, error, "Could not save this Application's credentials.");
    }
};

exports.getAdminChannelAuthorizeUrl = async (req, res) => {
    try {
        res.json(await channelAdminSync.getAuthorizeUrl(Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not start Channel sign-in.");
    }
};

// Public route - Channel redirects the browser here directly (no admin auth
// header available on a top-level redirect); the signed `state` from
// getAuthorizeUrl identifies which Application this belongs to. Always
// ends in a redirect back to the admin panel's Products tab.
exports.adminChannelOAuthCallback = async (req, res) => {
    const { code, state, error: channelError } = req.query;
    if (channelError) {
        return res.redirect(`/admin.html?channel_oauth=error&message=${encodeURIComponent(String(channelError))}#products`);
    }
    if (!code || !state) {
        return res.redirect(`/admin.html?channel_oauth=error&message=${encodeURIComponent("Missing code or state from Channel.")}#products`);
    }
    try {
        const result = await channelAdminSync.handleOAuthCallback(code, state);
        if (!result.success) {
            return res.redirect(`/admin.html?channel_oauth=error&message=${encodeURIComponent(result.message || "Could not connect to Channel.")}#products`);
        }
        return res.redirect(`/admin.html?channel_oauth=success#products`);
    } catch (error) {
        console.error("adminChannelOAuthCallback error:", error);
        return res.redirect(`/admin.html?channel_oauth=error&message=${encodeURIComponent("Something went wrong completing Channel sign-in.")}#products`);
    }
};

// --- Product sync (always the active Application, resolved inside
// channelAdminSyncService) ---

exports.getAdminChannelLinks = async (req, res) => {
    try {
        res.json(await channelAdminSync.listProductLinks());
    } catch (error) {
        handleError(res, error, "Could not load Channel sync status.");
    }
};

exports.pushAdminProductToChannel = async (req, res) => {
    try {
        const productId = Number(req.params.id);
        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ error: "Invalid product id." });
        }
        const result = await channelAdminSync.pushProduct(productId);
        if (result.status === "failed") {
            return res.status(422).json({ error: result.reason });
        }
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not push this product to Channel.");
    }
};

exports.pushAdminProductsToChannelBulk = async (req, res) => {
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
        res.json(await channelAdminSync.pushProductsBulk(ids));
    } catch (error) {
        handleError(res, error, "Could not push products to Channel.");
    }
};

exports.getAdminChannelRemoteProducts = async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        res.json(await channelAdminSync.listRemoteProducts(page));
    } catch (error) {
        handleError(res, error, "Could not fetch Channel products.");
    }
};

exports.importAdminChannelProducts = async (req, res) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "items must be a non-empty array of Channel products to import." });
        }
        res.json(await channelAdminSync.importProducts(items, req.user.userId));
    } catch (error) {
        handleError(res, error, "Could not import products from Channel.");
    }
};
