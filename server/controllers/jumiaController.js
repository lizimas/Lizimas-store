// HTTP layer for the Lizimas<->Jumia product-linking feature. Every
// handler here resolves req.user.userId to a vendors.id first (the same
// per-request lookup pattern used throughout vendorController.js/
// productController.js - there is no shared middleware that already
// attaches it) and then defers to jumiaSyncService.js for everything
// else. See jumiaClient.js's header for what part of this feature is
// still unverified against Jumia's real API.

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

exports.getJumiaConnection = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.getConnectionStatus(vendorId));
    } catch (error) {
        handleError(res, error, "Could not load Jumia connection status.");
    }
};

exports.connectJumia = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        // refresh_token: what Jumia calls the credential from "Generate
        // Token" on a Self Authorization Application (see jumiaClient.js's
        // header note) - accepting the old client_secret key too in case
        // any not-yet-updated client code is still sending that name.
        const { client_id, refresh_token, client_secret } = req.body;
        const status = await jumiaSync.connectVendor(vendorId, client_id, refresh_token || client_secret);
        res.json(status);
    } catch (error) {
        handleError(res, error, "Could not connect to Jumia.");
    }
};

exports.disconnectJumia = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        await jumiaSync.disconnectVendor(vendorId);
        res.json({ success: true });
    } catch (error) {
        handleError(res, error, "Could not disconnect from Jumia.");
    }
};

exports.testJumiaConnection = async (req, res) => {
    try {
        const vendorId = await requireVendorId(req, res);
        if (!vendorId) return;
        res.json(await jumiaSync.testConnection(vendorId));
    } catch (error) {
        handleError(res, error, "Could not verify the Jumia connection.");
    }
};

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
