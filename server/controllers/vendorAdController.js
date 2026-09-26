// Advertise Your Products (Sept 2026) -
// vendor-side campaign management. See migrations/112_vendor_ad_campaigns.sql
// for the full design and what's deliberately not built yet.

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");

async function getPlatformAdSettings() {
    const { rows } = await pool.query("SELECT * FROM ad_platform_settings WHERE id = 1");
    return rows[0];
}

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

exports.listMyCampaigns = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { rows } = await pool.query(
            `SELECT * FROM vendor_ad_campaigns WHERE vendor_id = $1 ORDER BY created_at DESC`,
            [vendorId]
        );
        res.json(await attachCampaignProducts(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAdRates = async (req, res) => {
    try {
        const settings = await getPlatformAdSettings();
        res.json({
            cpcRate: Number(settings.default_cpc_rate),
            minDailyBudget: Number(settings.min_daily_budget),
            maxDailyBudget: Number(settings.max_daily_budget)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createCampaign = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { name, daily_budget, total_budget, product_ids } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: "Campaign name is required." });
        if (!Array.isArray(product_ids) || product_ids.length === 0) {
            return res.status(400).json({ error: "Select at least one product to advertise." });
        }

        const settings = await getPlatformAdSettings();
        const dailyBudget = Number(daily_budget);
        const totalBudget = Number(total_budget);
        if (isNaN(dailyBudget) || dailyBudget < Number(settings.min_daily_budget) || dailyBudget > Number(settings.max_daily_budget)) {
            return res.status(400).json({ error: `Daily budget must be between UGX ${settings.min_daily_budget} and UGX ${settings.max_daily_budget}.` });
        }
        if (isNaN(totalBudget) || totalBudget < dailyBudget) {
            return res.status(400).json({ error: "Total budget must be at least the daily budget." });
        }

        const cleanIds = [...new Set(product_ids.map(Number))].filter(Boolean);
        const { rows: ownProducts } = await pool.query(
            `SELECT id FROM products WHERE id = ANY($1::int[]) AND vendor_id = $2 AND deleted_at IS NULL`,
            [cleanIds, vendorId]
        );
        const ownedIds = new Set(ownProducts.map((r) => r.id));
        const notOwned = cleanIds.filter((id) => !ownedIds.has(id));
        if (notOwned.length > 0) {
            return res.status(403).json({ error: `Product id(s) ${notOwned.join(", ")} don't belong to your account.` });
        }

        const client = await pool.connect();
        let campaign;
        try {
            await client.query("BEGIN");
            const campaignResult = await client.query(
                `INSERT INTO vendor_ad_campaigns (vendor_id, name, cpc_rate, daily_budget, total_budget)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [vendorId, name.trim(), settings.default_cpc_rate, dailyBudget, totalBudget]
            );
            campaign = campaignResult.rows[0];

            for (const productId of cleanIds) {
                await client.query(
                    `INSERT INTO vendor_ad_campaign_products (campaign_id, product_id) VALUES ($1, $2)`,
                    [campaign.id, productId]
                );
            }
            await client.query("COMMIT");
        } catch (txError) {
            await client.query("ROLLBACK");
            throw txError;
        } finally {
            client.release();
        }

        res.status(201).json({ message: "Campaign saved as a draft.", campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.submitCampaign = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query("SELECT * FROM vendor_ad_campaigns WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Campaign not found." });
        if (!["draft", "rejected"].includes(existing.rows[0].status)) {
            return res.status(400).json({ error: `Can't submit a campaign that's already "${existing.rows[0].status}".` });
        }

        const settings = await getPlatformAdSettings();
        const result = await pool.query(
            `UPDATE vendor_ad_campaigns
             SET status = 'pending_review', cpc_rate = $1, submitted_at = now(), admin_notes = NULL, updated_at = now()
             WHERE id = $2 RETURNING *`,
            [settings.default_cpc_rate, id]
        );

        logActivity(req.user.userId, "submitted_ad_campaign", "vendor_ad_campaign", Number(id), `Submitted "${result.rows[0].name}" for review`);
        res.json({ message: "Campaign submitted for review.", campaign: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.setCampaignPaused = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const { paused } = req.body;
        const existing = await pool.query("SELECT * FROM vendor_ad_campaigns WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Campaign not found." });

        const current = existing.rows[0].status;
        if (paused && current !== "active") {
            return res.status(400).json({ error: `Can't pause a campaign that's "${current}".` });
        }
        if (!paused && current !== "paused") {
            return res.status(400).json({ error: `Can't resume a campaign that's "${current}".` });
        }

        const result = await pool.query(
            "UPDATE vendor_ad_campaigns SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
            [paused ? "paused" : "active", id]
        );
        res.json({ message: paused ? "Campaign paused." : "Campaign resumed.", campaign: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteCampaign = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query("SELECT id, status FROM vendor_ad_campaigns WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Campaign not found." });
        if (existing.rows[0].status !== "draft") {
            return res.status(400).json({ error: "Only a draft campaign can be deleted - submit and let it run its course, or pause it, instead." });
        }

        await pool.query("DELETE FROM vendor_ad_campaigns WHERE id = $1", [id]);
        res.json({ message: "Draft campaign deleted." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
