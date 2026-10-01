// Blocks product changes (add, edit, import, stock, photos, options) for a
// vendor on hold for documents (migration 145). Reading products and
// deleting one are still allowed. Runs after requireVendor (req.vendorId).
const pool = require("../config/database");
const { HOLD_BLOCKED_MESSAGE } = require("../utils/vendorHold");

async function blockProductChangesWhileOnHold(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE" || !req.vendorId) return next();
    try {
        const r = await pool.query("SELECT COALESCE(documents_hold, false) AS hold FROM vendors WHERE id = $1", [req.vendorId]);
        if (r.rows[0] && r.rows[0].hold) {
            return res.status(403).json({ error: "on_hold", message: HOLD_BLOCKED_MESSAGE });
        }
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { blockProductChangesWhileOnHold };
