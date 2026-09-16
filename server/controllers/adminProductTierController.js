// Admin control over Product-count limit tiers (Jumia Vendor Center
// comparison, Sept 2026 - see migrations/109_vendor_product_tiers.sql and
// server/utils/vendorProductTier.js). Mirrors commissionController.js's
// shape (admin-only, no vendor-facing write path).

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { getVendorProductLimitStatus, resolveVendorTier, getVendorGmv90d } = require("../utils/vendorProductTier");

// The full tier ladder, for the admin Settings screen.
exports.listProductTiers = async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT * FROM vendor_product_tiers ORDER BY sort_order ASC"
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Edit one tier's name/threshold/cap. Deliberately can't create or delete
// tiers here (schema_migrations is the source of truth for which tiers
// exist, same as commission_rules' categories) - just tune the numbers.
exports.updateProductTier = async (req, res) => {
    try {
        const { tierCode } = req.params;
        const { tier_name, min_gmv_90d, max_active_products } = req.body;

        const existing = await pool.query("SELECT * FROM vendor_product_tiers WHERE tier_code = $1", [tierCode]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Tier not found." });
        }
        const before = existing.rows[0];

        if (min_gmv_90d !== undefined && (isNaN(Number(min_gmv_90d)) || Number(min_gmv_90d) < 0)) {
            return res.status(400).json({ error: "min_gmv_90d must be a non-negative number." });
        }
        if (max_active_products !== undefined && max_active_products !== null && (isNaN(Number(max_active_products)) || Number(max_active_products) < 0)) {
            return res.status(400).json({ error: "max_active_products must be a non-negative number, or null for unlimited." });
        }

        const result = await pool.query(
            `UPDATE vendor_product_tiers
             SET tier_name = COALESCE($1, tier_name),
                 min_gmv_90d = COALESCE($2, min_gmv_90d),
                 max_active_products = $3,
                 updated_at = now()
             WHERE tier_code = $4
             RETURNING *`,
            [
                tier_name || null,
                min_gmv_90d !== undefined ? Number(min_gmv_90d) : null,
                max_active_products !== undefined ? (max_active_products === null ? null : Number(max_active_products)) : before.max_active_products,
                tierCode
            ]
        );

        logActivity(req.user.userId, "updated_product_tier", "vendor_product_tier", tierCode,
            `${before.tier_name} -> ${result.rows[0].tier_name}, cap ${before.max_active_products ?? "unlimited"} -> ${result.rows[0].max_active_products ?? "unlimited"}`);

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// One vendor's tier picture for the admin vendor detail screen: their
// trailing GMV, the tier that GMV alone would put them in, their actual
// effective tier (which may differ if overridden), and their current
// listing count against the cap.
exports.getVendorTierStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const vendorRow = await pool.query("SELECT id, product_tier_override FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }

        const [limitStatus, gmv, tiers] = await Promise.all([
            getVendorProductLimitStatus(id),
            getVendorGmv90d(id),
            pool.query("SELECT tier_code, tier_name FROM vendor_product_tiers ORDER BY sort_order ASC")
        ]);

        res.json({
            ...limitStatus,
            gmv90d: gmv,
            override: vendorRow.rows[0].product_tier_override,
            availableTiers: tiers.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Manually place (or un-place) a vendor onto a specific tier, bypassing
// the GMV ladder - e.g. fast-tracking a promising new seller, or capping
// someone early over a quality issue. tierCode: null clears the override
// and goes back to normal GMV-based resolution.
exports.setVendorTierOverride = async (req, res) => {
    try {
        const { id } = req.params;
        const { tierCode } = req.body;

        if (tierCode) {
            const tierExists = await pool.query("SELECT 1 FROM vendor_product_tiers WHERE tier_code = $1", [tierCode]);
            if (tierExists.rows.length === 0) {
                return res.status(400).json({ error: "Unknown tier code." });
            }
        }

        const result = await pool.query(
            "UPDATE vendors SET product_tier_override = $1 WHERE id = $2 RETURNING id, business_name, product_tier_override",
            [tierCode || null, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }

        logActivity(req.user.userId, "set_vendor_tier_override", "vendor", Number(id),
            tierCode ? `Manually placed on tier ${tierCode}` : "Cleared manual tier override");

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
