// Vendor Center > Applications: HTTP layer over channelSyncService.js
// (connect channel Applications, link, import and export products).

const channelSync = require("../services/channelSyncService");
const { ChannelApiError } = require("../services/channelClient");

const PUSH_BULK_MAX_IDS = 100;

async function requireVendorId(req, res) {
    const vendorId = req.vendorId;
    if (!vendorId) {
        res.status(404).json({ error: "No vendor profile found for this account." });
        return null;
    }
    return vendorId;
}

function handleError(res, error, fallbackMessage) {
    const status = error.status || (error instanceof ChannelApiError ? (error.status || 502) : 500);
    res.status(status).json({ error: error.message || fallbackMessage });
}

// --- Applications CRUD ---

exports.listChannelApplications = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await channelSync.listApplications(vendorId));
    } catch (error) {
        handleError(res, error, "Could not load your Channel Applications.");
    }
};

exports.createChannelApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const { name, app_type } = req.body;
        const created = await channelSync.createApplication(vendorId, { name, appType: app_type });
        res.json(created);
    } catch (error) {
        handleError(res, error, "Could not create the Application.");
    }
};

exports.deleteChannelApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        await channelSync.deleteApplication(vendorId, Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not delete the Application.");
    }
};

exports.activateChannelApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await channelSync.setActiveApplication(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not activate this Application.");
    }
};

exports.connectChannelApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        // refresh_token: what Channel calls the credential from "Generate
        // Token" on a Self Authorization Application (see channelClient.js's
        // header note) - accepting the old client_secret key too in case
        // any not-yet-updated client code is still sending that name.
        const { client_id, refresh_token, client_secret } = req.body;
        const result = await channelSync.connectApplication(vendorId, Number(req.params.id), client_id, refresh_token || client_secret);
        res.json(result);
    } catch (error) {
        handleError(res, error, "Could not connect this Application to Channel.");
    }
};

exports.disconnectChannelApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await channelSync.disconnectApplication(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not disconnect this Application.");
    }
};

exports.testChannelApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await channelSync.testApplicationConnection(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not verify this Application's connection.");
    }
};

exports.setChannelApplicationCredentials = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const { client_id, client_secret } = req.body;
        res.json(await channelSync.setWebApplicationCredentials(vendorId, Number(req.params.id), client_id, client_secret));
    } catch (error) {
        handleError(res, error, "Could not save this Application's credentials.");
    }
};

exports.getChannelAuthorizeUrl = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await channelSync.getAuthorizeUrl(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not start Channel sign-in.");
    }
};

// Public route - Channel redirects the vendor's browser here directly, so
// there is no Authorization header to read req.user from. Ends in a
// redirect back to the vendor dashboard's Applications tab either way, so
// the vendor lands somewhere sensible even if this tab was opened fresh
// by the channel's redirect rather than carried over from the dashboard.
exports.channelOAuthCallback = async (req, res) => {
    const { code, state, error: channelError } = req.query;
    if (channelError) {
        return res.redirect(`/vendor/dashboard.html?channel_oauth=error&message=${encodeURIComponent(String(channelError))}#account`);
    }
    if (!code || !state) {
        return res.redirect(`/vendor/dashboard.html?channel_oauth=error&message=${encodeURIComponent("Missing code or state from Channel.")}#account`);
    }
    try {
        const result = await channelSync.handleOAuthCallback(code, state);
        if (!result.success) {
            return res.redirect(`/vendor/dashboard.html?channel_oauth=error&message=${encodeURIComponent(result.message || "Could not connect to Channel.")}#account`);
        }
        return res.redirect(`/vendor/dashboard.html?channel_oauth=success#account`);
    } catch (error) {
        console.error("channelOAuthCallback error:", error);
        return res.redirect(`/vendor/dashboard.html?channel_oauth=error&message=${encodeURIComponent("Something went wrong completing Channel sign-in.")}#account`);
    }
};

// --- Product sync (unchanged - always operates on the vendor's ACTIVE
// Application, resolved inside channelSyncService) ---

exports.getChannelLinks = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await channelSync.listProductLinks(vendorId));
    } catch (error) {
        handleError(res, error, "Could not load Channel sync status.");
    }
};

exports.pushProductToChannel = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const productId = Number(req.params.id);
        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ error: "Invalid product id." });
        }
        const result = await channelSync.pushProduct(vendorId, productId);
        if (result.status === "failed") {
            return res.status(422).json({ error: result.reason });
        }
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not push this product to Channel.");
    }
};

exports.pushProductsToChannelBulk = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
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
        res.json(await channelSync.pushProductsBulk(vendorId, ids));
    } catch (error) {
        handleError(res, error, "Could not push products to Channel.");
    }
};

exports.getChannelRemoteProducts = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const page = Number(req.query.page) || 1;
        res.json(await channelSync.listRemoteProducts(vendorId, page));
    } catch (error) {
        handleError(res, error, "Could not fetch your Channel products.");
    }
};

exports.importChannelProducts = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "items must be a non-empty array of Channel products to import." });
        }
        res.json(await channelSync.importProducts(vendorId, items));
    } catch (error) {
        handleError(res, error, "Could not import products from Channel.");
    }
};
