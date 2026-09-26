// Advertise Your Products (Sept 2026) -
// admin-side review + platform-wide settings control. See
// migrations/112_vendor_ad_campaigns.sql.

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { createVendorNotification } = require("./vendorController");

async function attachCampaignProducts(campaigns) {
    if (campaigns.length === 0) return campaigns;
    const ids = campaigns.map((c) => c.id);
    const { rows: items } = await pool.query(
        `SELECT cp.*, p.name AS product_name, p.sku AS product_sku
         FROM vendor_ad_campaign_products cp
         JOIN products p ON p.id = cp.product_id
         WHERE cp.campaign_id = ANY($1::int[])
         ORDER BY cp.id ASC`,
        [ids]
    );
    const byCampaign = new Map();
    for (const item of items) {
        if (!byCampaign.has(item.campaign_id)) byCampaign.set(item.campaign_id, []);
        byCampaign.get(item.campaign_id).push(item);
    }
    return campaigns.map((c) => ({ ...c, products: byCampaign.get(c.id) || [] }));
}

exports.listCampaignsAdmin = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [];
        let where = "";
        if (status) {
            params.push(status);
            where = `WHERE c.status = $${params.length}`;
        }
        const { rows } = await pool.query(
            `SELECT c.*, v.business_name AS vendor_business_name
             FROM vendor_ad_campaigns c
             JOIN vendors v ON v.id = c.vendor_id
             ${where}
             ORDER BY c.created_at DESC`,
            params
        );
        res.json(await attachCampaignProducts(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.approveCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_notes, start_date, end_date } = req.body;

        const existing = await pool.query("SELECT * FROM vendor_ad_campaigns WHERE id = $1", [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Campaign not found." });
        if (existing.rows[0].status !== "pending_review") {
            return res.status(400).json({ error: `Can't approve a campaign that's "${existing.rows[0].status}".` });
        }

        const result = await pool.query(
            `UPDATE vendor_ad_campaigns
             SET status = 'active', admin_notes = $1, reviewed_by = $2,
                 start_date = COALESCE($3, start_date, CURRENT_DATE), end_date = COALESCE($4, end_date),
                 updated_at = now()
             WHERE id = $5 RETURNING *`,
            [admin_notes || null, req.user.userId, start_date || null, end_date || null, id]
        );

        logActivity(req.user.userId, "approved_ad_campaign", "vendor_ad_campaign", Number(id), `Approved "${result.rows[0].name}"`);
        createVendorNotification(existing.rows[0].vendor_id, "ad_campaign_status", {
            campaignId: id, campaignName: result.rows[0].name, status: "active"
        }).catch(() => {});

        res.json({ message: "Campaign approved and is now active.", campaign: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.rejectCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_notes } = req.body;

        const existing = await pool.query("SELECT * FROM vendor_ad_campaigns WHERE id = $1", [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Campaign not found." });
        if (existing.rows[0].status !== "pending_review") {
            return res.status(400).json({ error: `Can't reject a campaign that's "${existing.rows[0].status}".` });
        }

        const result = await pool.query(
            `UPDATE vendor_ad_campaigns SET status = 'rejected', admin_notes = $1, reviewed_by = $2, updated_at = now()
             WHERE id = $3 RETURNING *`,
            [admin_notes || null, req.user.userId, id]
        );

        logActivity(req.user.userId, "rejected_ad_campaign", "vendor_ad_campaign", Number(id), admin_notes || "");
        createVendorNotification(existing.rows[0].vendor_id, "ad_campaign_status", {
            campaignId: id, campaignName: result.rows[0].name, status: "rejected", note: admin_notes
        }).catch(() => {});

        res.json({ message: "Campaign rejected.", campaign: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin can also force-pause a live campaign (policy issue, etc.) without
// waiting for the vendor - separate from the vendor's own pause/resume
// toggle in vendorAdController.js.
exports.setCampaignPausedAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { paused, admin_notes } = req.body;

        const existing = await pool.query("SELECT * FROM vendor_ad_campaigns WHERE id = $1", [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Campaign not found." });

        const current = existing.rows[0].status;
        if (paused && current !== "active") return res.status(400).json({ error: `Can't pause a campaign that's "${current}".` });
        if (!paused && current !== "paused") return res.status(400).json({ error: `Can't resume a campaign that's "${current}".` });

        const result = await pool.query(
            `UPDATE vendor_ad_campaigns SET status = $1, admin_notes = COALESCE($2, admin_notes), updated_at = now() WHERE id = $3 RETURNING *`,
            [paused ? "paused" : "active", admin_notes || null, id]
        );
        logActivity(req.user.userId, paused ? "admin_paused_ad_campaign" : "admin_resumed_ad_campaign", "vendor_ad_campaign", Number(id), admin_notes || "");
        res.json({ message: paused ? "Campaign paused by admin." : "Campaign resumed.", campaign: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAdSettingsAdmin = async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM ad_platform_settings WHERE id = 1");
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateAdSettingsAdmin = async (req, res) => {
    try {
        const { default_cpc_rate, min_daily_budget, max_daily_budget } = req.body;
        const cpc = Number(default_cpc_rate);
        const minB = Number(min_daily_budget);
        const maxB = Number(max_daily_budget);
        if (isNaN(cpc) || cpc <= 0) return res.status(400).json({ error: "CPC rate must be a positive number." });
        if (isNaN(minB) || minB <= 0) return res.status(400).json({ error: "Minimum daily budget must be a positive number." });
        if (isNaN(maxB) || maxB < minB) return res.status(400).json({ error: "Maximum daily budget must be at least the minimum." });

        const result = await pool.query(
            `UPDATE ad_platform_settings SET default_cpc_rate = $1, min_daily_budget = $2, max_daily_budget = $3, updated_at = now()
             WHERE id = 1 RETURNING *`,
            [cpc, minB, maxB]
        );
        logActivity(req.user.userId, "updated_ad_settings", "ad_platform_settings", 1, `CPC=${cpc}, min=${minB}, max=${maxB}`);
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
