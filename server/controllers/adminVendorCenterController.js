// Admin: inspect what a vendor filled in / did in the Lizimas Vendor Center
// (Ryan, Sept 2026 - "the admin panel should have the fields to inspect
// today's changes"). One read-only endpoint behind the Vendors tab's
// "Vendor Center" button:
//   - shop setup answers (vendor_shop_profile, migrations 123 + 126),
//     including the existing-shop name(s) and reason for a new shop
//   - Account Statements > Transactions Exports (migration 129)
//   - Monitor your promotions rows incl. page views (migration 128)
const pool = require("../config/database");
const { SELLER_TYPE_LABELS, SOURCING_METHOD_LABELS } = require("../utils/vendorShopSetup");
const { loadPromotionMonitoring } = require("./promotionCampaignController");

exports.getVendorCenterDetailsAdmin = async (req, res) => {
    try {
        const vendorId = Number(req.params.id);
        if (!Number.isInteger(vendorId) || vendorId <= 0) return res.status(400).json({ error: "Invalid vendor id." });
        const vendor = await pool.query(
            `SELECT v.id, v.business_name, v.shop_id, v.account_type, u.name AS owner_name, u.email AS owner_email
             FROM vendors v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
            [vendorId]
        );
        if (!vendor.rows.length) return res.status(404).json({ error: "Vendor not found." });

        const [profile, exportsRows, promotions] = await Promise.all([
            pool.query(
                `SELECT sp.*, c.name AS primary_category_name
                 FROM vendor_shop_profile sp LEFT JOIN categories c ON c.id = sp.primary_category_id
                 WHERE sp.vendor_id = $1`,
                [vendorId]
            ),
            pool.query(
                `SELECT id, kind, statement_id, requested, status, created_at
                 FROM vendor_transaction_exports WHERE vendor_id = $1
                 ORDER BY created_at DESC, id DESC LIMIT 50`,
                [vendorId]
            ).catch(() => ({ rows: [] })),
            loadPromotionMonitoring(vendorId, "all").catch(() => [])
        ]);

        const p = profile.rows[0] || null;
        res.json({
            vendor: vendor.rows[0],
            shop_profile: p && {
                ...p,
                seller_type_labels: (p.seller_types || []).map((t) => SELLER_TYPE_LABELS[t] || t),
                sourcing_method_label: p.sourcing_method ? (SOURCING_METHOD_LABELS[p.sourcing_method] || p.sourcing_method) : null
            },
            transaction_exports: exportsRows.rows,
            promotions
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
