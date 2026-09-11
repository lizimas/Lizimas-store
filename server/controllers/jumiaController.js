// HTTP layer for the Lizimas<->Jumia product-linking feature. Every
// handler here resolves req.user.userId to a vendors.id first (the same
// per-request lookup pattern used throughout vendorController.js/
// productController.js - there is no shared middleware that already
// attaches it) and then defers to jumiaSyncService.js for everything
// else. See jumiaClient.js's header for what part of this feature is
// still unverified against Jumia's real API.
//
// Since migration 084, "connection" in the old single-Application sense
// has been replaced by "Applications" - a vendor can add several named
// Jumia credential sets (Web Application or Self Authorization, matching
// Jumia's own Create Application dialog). handleOAuthCallback is the one
// exception to the requireVendorId pattern above: it is reached by a
// public GET from Jumia's own redirect, with no vendor auth header
// available, so it identifies the vendor from the signed `state` param
// instead (see jumiaSyncService.getAuthorizeUrl/handleOAuthCallback).

const jumiaSync = require("../services/jumiaSyncService");
const { JumiaApiError } = require("../services/jumiaClient");

const PUSH_BULK_MAX_IDS = 100;

async function requireVendorId(req, res) {
    const vendorId = await jumiaSync.getVendorIdForUser(req.user.userId);
    if (!vendorId) {
        res.status(404).json({ error: "No vendor profile found for this account." });
        return null;
    }
    return vendorId;
}

function handleError(res, error, fallbackMessage) {
    const status = error.status || (error instanceof JumiaApiError ? (error.status || 502) : 500);
    res.status(status).json({ error: error.message || fallbackMessage });
}

// --- Applications CRUD ---

exports.listJumiaApplications = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.listApplications(vendorId));
    } catch (error) {
        handleError(res, error, "Could not load your Jumia Applications.");
    }
};

exports.createJumiaApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const { name, app_type } = req.body;
        const created = await jumiaSync.createApplication(vendorId, { name, appType: app_type });
        res.json(created);
    } catch (error) {
        handleError(res, error, "Could not create the Application.");
    }
};

exports.deleteJumiaApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        await jumiaSync.deleteApplication(vendorId, Number(req.params.id));
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not delete the Application.");
    }
};

exports.activateJumiaApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.setActiveApplication(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not activate this Application.");
    }
};

exports.connectJumiaApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        // refresh_token: what Jumia calls the credential from "Generate
        // Token" on a Self Authorization Application (see jumiaClient.js's
        // header note) - accepting the old client_secret key too in case
        // any not-yet-updated client code is still sending that name.
        const { client_id, refresh_token, client_secret } = req.body;
        const result = await jumiaSync.connectApplication(vendorId, Number(req.params.id), client_id, refresh_token || client_secret);
        res.json(result);
    } catch (error) {
        handleError(res, error, "Could not connect this Application to Jumia.");
    }
};

exports.disconnectJumiaApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.disconnectApplication(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not disconnect this Application.");
    }
};

exports.testJumiaApplication = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.testApplicationConnection(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not verify this Application's connection.");
    }
};

exports.setJumiaApplicationCredentials = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const { client_id, client_secret } = req.body;
        res.json(await jumiaSync.setWebApplicationCredentials(vendorId, Number(req.params.id), client_id, client_secret));
    } catch (error) {
        handleError(res, error, "Could not save this Application's credentials.");
    }
};

exports.getJumiaAuthorizeUrl = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.getAuthorizeUrl(vendorId, Number(req.params.id)));
    } catch (error) {
        handleError(res, error, "Could not start Jumia sign-in.");
    }
};

// Public route - Jumia redirects the vendor's browser here directly, so
// there is no Authorization header to read req.user from. Ends in a
// redirect back to the vendor dashboard's Applications tab either way, so
// the vendor lands somewhere sensible even if this tab was opened fresh
// by Jumia's redirect rather than carried over from the dashboard.
exports.jumiaOAuthCallback = async (req, res) => {
    const { code, state, error: jumiaError } = req.query;
    if (jumiaError) {
        return res.redirect(`/vendor/dashboard.html?jumia_oauth=error&message=${encodeURIComponent(String(jumiaError))}#account`);
    }
    if (!code || !state) {
        return res.redirect(`/vendor/dashboard.html?jumia_oauth=error&message=${encodeURIComponent("Missing code or state from Jumia.")}#account`);
    }
    try {
        const result = await jumiaSync.handleOAuthCallback(code, state);
        if (!result.success) {
            return res.redirect(`/vendor/dashboard.html?jumia_oauth=error&message=${encodeURIComponent(result.message || "Could not connect to Jumia.")}#account`);
        }
        return res.redirect(`/vendor/dashboard.html?jumia_oauth=success#account`);
    } catch (error) {
        console.error("jumiaOAuthCallback error:", error);
        return res.redirect(`/vendor/dashboard.html?jumia_oauth=error&message=${encodeURIComponent("Something went wrong completing Jumia sign-in.")}#account`);
    }
};

// --- Product sync (unchanged - always operates on the vendor's ACTIVE
// Application, resolved inside jumiaSyncService) ---

exports.getJumiaLinks = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.listProductLinks(vendorId));
    } catch (error) {
        handleError(res, error, "Could not load Jumia sync status.");
    }
};

exports.pushProductToJumia = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const productId = Number(req.params.id);
        if (!Number.isInteger(productId) || productId <= 0) {
            return res.status(400).json({ error: "Invalid product id." });
        }
        const result = await jumiaSync.pushProduct(vendorId, productId);
        if (result.status === "failed") {
            return res.status(422).json({ error: result.reason });
        }
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not push this product to Jumia.");
    }
};

exports.pushProductsToJumiaBulk = async (req, res) => {
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
        res.json(await jumiaSync.pushProductsBulk(vendorId, ids));
    } catch (error) {
        handleError(res, error, "Could not push products to Jumia.");
    }
};

exports.getJumiaRemoteProducts = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const page = Number(req.query.page) || 1;
        res.json(await jumiaSync.listRemoteProducts(vendorId, page));
    } catch (error) {
        handleError(res, error, "Could not fetch your Jumia products.");
    }
};

exports.importJumiaProducts = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "items must be a non-empty array of Jumia products to import." });
        }
        res.json(await jumiaSync.importProducts(vendorId, items));
    } catch (error) {
        handleError(res, error, "Could not import products from Jumia.");
    }
};
