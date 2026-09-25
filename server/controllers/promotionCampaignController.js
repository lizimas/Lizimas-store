// Promotion campaigns + vendor Promotions Management (Ryan, Sept 2026 -
// Jumia Vendor Center parity). See migrations/124_promotion_campaigns.sql
// for the design: a vendor "joins" a campaign by nominating products, and
// each nomination is a normal pending vendor_promotions row (campaign_id
// set, window = campaign period), so admin review, checkout price
// enforcement and product-page display are the existing ones.

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { computeDiscountPercent } = require("../utils/vendorPromotions");
const {
    CAMPAIGN_FILTERS, PERIOD_OPTIONS, deriveCampaignStatus, effectiveDiscountBand,
    validateCampaignEntryPrice, validateCampaignInput, buildDailySeries
} = require("../utils/promotionCampaigns");

const CAMPAIGN_COLUMNS = `c.id, c.name, c.description, c.registration_ends_at, c.starts_at, c.ends_at,
    c.min_discount_pct, c.max_discount_pct, c.is_cancelled, c.created_at`;

function shapeCampaign(row, now = new Date()) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        registration_ends_at: row.registration_ends_at,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        min_discount_pct: row.min_discount_pct == null ? null : Number(row.min_discount_pct),
        max_discount_pct: row.max_discount_pct == null ? null : Number(row.max_discount_pct),
        status: deriveCampaignStatus(row, now),
        joined_count: row.joined_count == null ? undefined : Number(row.joined_count)
    };
}

// --- Vendor: campaign list (Promotions Management > View All) --------------

async function loadCampaignsForVendor(vendorId) {
    const { rows } = await pool.query(
        `SELECT ${CAMPAIGN_COLUMNS},
                (SELECT COUNT(*) FROM vendor_promotions vp
                  WHERE vp.campaign_id = c.id AND vp.vendor_id = $1 AND vp.status <> 'rejected') AS joined_count
         FROM promotion_campaigns c
         ORDER BY c.registration_ends_at ASC, c.id ASC`,
        [vendorId]
    );
    return rows.map((r) => shapeCampaign(r));
}

exports.listMyCampaigns = async (req, res) => {
    try {
        const status = CAMPAIGN_FILTERS.includes(req.query.status) ? req.query.status : "all";
        const q = String(req.query.q || "").trim().toLowerCase();
        const limit = [10, 25, 50].includes(Number(req.query.limit)) ? Number(req.query.limit) : 25;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);

        const all = await loadCampaignsForVendor(req.vendorId);
        const counts = Object.fromEntries(CAMPAIGN_FILTERS.map((f) => [f, 0]));
        for (const c of all) {
            counts.all++;
            counts[c.status]++;
            if (c.joined_count > 0) counts.joined++;
        }
        let rows = all.filter((c) => status === "all" || (status === "joined" ? c.joined_count > 0 : c.status === status));
        if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(q));
        const total = rows.length;
        const pageRows = rows.slice((page - 1) * limit, page * limit);
        res.json({ campaigns: pageRows, total, page, limit, counts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor: one campaign + their entries + products they can nominate ----

exports.getMyCampaign = async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT ${CAMPAIGN_COLUMNS} FROM promotion_campaigns c WHERE c.id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Campaign not found." });
        const campaign = shapeCampaign(rows[0]);

        const [entries, products] = await Promise.all([
            pool.query(
                `SELECT vp.id, vp.product_id, vp.original_price, vp.proposed_sale_price, vp.status, vp.rejection_reason,
                        p.name AS product_name, p.sku, p.image AS product_image
                 FROM vendor_promotions vp JOIN products p ON p.id = vp.product_id
                 WHERE vp.campaign_id = $1 AND vp.vendor_id = $2
                 ORDER BY vp.created_at DESC`,
                [campaign.id, req.vendorId]
            ),
            // Products that could be nominated: approved, not restricted,
            // not deleted, and with no pending/approved promotion whose
            // window overlaps the campaign period.
            pool.query(
                `SELECT p.id, p.name, p.sku, p.price, p.image, p.stock
                 FROM products p
                 WHERE p.vendor_id = $1 AND p.deleted_at IS NULL AND p.status = 'approved'
                   AND COALESCE(p.admin_restricted, false) = false
                   AND NOT EXISTS (
                       SELECT 1 FROM vendor_promotions vp
                       WHERE vp.product_id = p.id AND vp.status IN ('pending', 'approved')
                         AND vp.starts_at < $3 AND vp.ends_at > $2
                   )
                 ORDER BY p.name ASC`,
                [req.vendorId, campaign.starts_at, campaign.ends_at]
            )
        ]);

        res.json({
            campaign: { ...campaign, band: effectiveDiscountBand(campaign) },
            entries: entries.rows.map((e) => ({
                ...e,
                discount_pct: Math.round(computeDiscountPercent(Number(e.original_price), Number(e.proposed_sale_price)))
            })),
            eligible_products: campaign.status === "open" ? products.rows : []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Join: nominate one or more products. All-or-nothing, so a vendor never
// ends up half-registered without knowing which items failed.
exports.joinCampaign = async (req, res) => {
    const client = await pool.connect();
    try {
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (items.length === 0) return res.status(400).json({ error: "Select at least one product." });
        if (items.length > 100) return res.status(400).json({ error: "You can nominate up to 100 products at a time." });

        await client.query("BEGIN");
        const cRes = await client.query(`SELECT ${CAMPAIGN_COLUMNS} FROM promotion_campaigns c WHERE c.id = $1 FOR SHARE`, [req.params.id]);
        if (!cRes.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Campaign not found." }); }
        const campaign = shapeCampaign(cRes.rows[0]);
        if (campaign.status !== "open") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Registration for this campaign is closed." });
        }

        const seen = new Set();
        const created = [];
        for (const raw of items) {
            const productId = Number(raw.product_id);
            if (!Number.isInteger(productId) || seen.has(productId)) continue;
            seen.add(productId);

            const pRes = await client.query(
                `SELECT id, name, price, status, COALESCE(admin_restricted, false) AS admin_restricted
                 FROM products WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
                [productId, req.vendorId]
            );
            if (!pRes.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "One of the products isn't on your account." }); }
            const product = pRes.rows[0];
            if (product.status !== "approved" || product.admin_restricted) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: `"${product.name}" isn't approved for sale, so it can't join a campaign.` });
            }
            const check = validateCampaignEntryPrice({ originalPrice: product.price, salePrice: raw.sale_price, campaign });
            if (!check.allowed) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: `"${product.name}": ${check.reason}` });
            }
            const overlap = await client.query(
                `SELECT 1 FROM vendor_promotions
                 WHERE product_id = $1 AND status IN ('pending', 'approved') AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
                [productId, campaign.starts_at, campaign.ends_at]
            );
            if (overlap.rows.length) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: `"${product.name}" already has a promotion during this campaign's period.` });
            }
            const ins = await client.query(
                `INSERT INTO vendor_promotions (vendor_id, product_id, original_price, proposed_sale_price, starts_at, ends_at, campaign_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [req.vendorId, productId, product.price, Number(raw.sale_price), campaign.starts_at, campaign.ends_at, campaign.id]
            );
            created.push(ins.rows[0].id);
        }
        if (created.length === 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Select at least one product." }); }
        await client.query("COMMIT");
        res.status(201).json({ message: `${created.length} product(s) submitted for review.`, created: created.length });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// Withdraw a still-pending entry while registration is open.
exports.withdrawCampaignEntry = async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT ${CAMPAIGN_COLUMNS} FROM promotion_campaigns c WHERE c.id = $1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Campaign not found." });
        if (shapeCampaign(rows[0]).status !== "open") return res.status(409).json({ error: "Registration for this campaign is closed." });
        const del = await pool.query(
            `DELETE FROM vendor_promotions WHERE id = $1 AND campaign_id = $2 AND vendor_id = $3 AND status = 'pending' RETURNING id`,
            [req.params.entryId, req.params.id, req.vendorId]
        );
        if (!del.rows.length) return res.status(409).json({ error: "Only entries still awaiting review can be withdrawn." });
        res.json({ message: "Product withdrawn from the campaign." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor: Promotions Management overview -------------------------------
// Open campaigns, revenue from promotions (last 7/30/90 days) and the
// vendor's currently-promoted ("highlight") products.
//
// An order line counts as promotional revenue when, at the moment the
// order was placed, that product had an approved vendor promotion (incl.
// campaign entries) or sat in an active flash sale. Cancelled orders are
// excluded.
const PROMO_AT_ORDER_TIME = `(
    EXISTS (SELECT 1 FROM vendor_promotions vp
            WHERE vp.product_id = oi.product_id AND vp.status = 'approved'
              AND o.created_at BETWEEN vp.starts_at AND vp.ends_at)
 OR EXISTS (SELECT 1 FROM flash_sale_items fsi JOIN flash_sales fs ON fs.id = fsi.flash_sale_id
            WHERE fsi.product_id = oi.product_id
              AND o.created_at >= COALESCE(fs.starts_at, fs.created_at) AND o.created_at <= fs.ends_at)
)`;

exports.getPromotionsOverview = async (req, res) => {
    try {
        const days = PERIOD_OPTIONS.includes(Number(req.query.days)) ? Number(req.query.days) : 7;
        const vendorId = req.vendorId;

        const [campaigns, revenue, highlights] = await Promise.all([
            loadCampaignsForVendor(vendorId),
            pool.query(
                `SELECT to_char(date_trunc('day', o.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                        SUM(oi.price * oi.quantity) AS revenue,
                        SUM(oi.quantity) AS units,
                        COUNT(DISTINCT o.id) AS orders
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1 AND o.status <> 'cancelled'
                   AND o.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - ($2::int - 1) * INTERVAL '1 day'
                   AND ${PROMO_AT_ORDER_TIME}
                 GROUP BY 1`,
                [vendorId, days]
            ),
            pool.query(
                `SELECT p.id, p.name, p.sku, p.image, p.price AS current_price,
                        vp.original_price, vp.proposed_sale_price AS sale_price, vp.starts_at, vp.ends_at,
                        c.name AS campaign_name,
                        COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                                  WHERE oi.product_id = p.id AND o.status <> 'cancelled'
                                    AND o.created_at BETWEEN vp.starts_at AND vp.ends_at), 0) AS units_sold
                 FROM vendor_promotions vp
                 JOIN products p ON p.id = vp.product_id
                 LEFT JOIN promotion_campaigns c ON c.id = vp.campaign_id
                 WHERE vp.vendor_id = $1 AND vp.status = 'approved' AND now() BETWEEN vp.starts_at AND vp.ends_at
                   AND p.deleted_at IS NULL
                 ORDER BY units_sold DESC, vp.ends_at ASC
                 LIMIT 50`,
                [vendorId]
            )
        ]);

        const series = buildDailySeries(revenue.rows, days);
        const totals = revenue.rows.reduce((acc, r) => {
            acc.revenue += Number(r.revenue || 0);
            acc.units += Number(r.units || 0);
            acc.orders += Number(r.orders || 0);
            return acc;
        }, { revenue: 0, units: 0, orders: 0 });

        const open = campaigns.filter((c) => c.status === "open");
        res.json({
            days,
            open_campaigns: open.slice(0, 3),
            open_campaigns_total: open.length,
            revenue: { ...totals, series },
            highlight_products: highlights.rows.map((h) => ({
                ...h,
                units_sold: Number(h.units_sold),
                discount_pct: Math.round(computeDiscountPercent(Number(h.original_price), Number(h.sale_price)))
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor: Monitor your promotions ---------------------------------------
// One row per promotion that has started: the vendor's own approved
// promotions, Lizimas campaign entries, and Lizimas flash sales on the
// vendor's products. Page views = product_view_daily inside the promotion
// window; items sold / revenue = non-cancelled order lines placed inside it.
// status: ongoing (running now) or expired.
exports.getPromotionMonitoring = async (req, res) => {
    try {
        const status = ["ongoing", "expired"].includes(req.query.status) ? req.query.status : "all";
        const { rows } = await pool.query(
            `WITH promos AS (
                 SELECT 'promotion' AS kind, vp.id AS promo_id, vp.product_id, vp.starts_at, vp.ends_at,
                        vp.proposed_sale_price AS promo_price, c.name AS campaign_name
                 FROM vendor_promotions vp
                 LEFT JOIN promotion_campaigns c ON c.id = vp.campaign_id
                 WHERE vp.vendor_id = $1 AND vp.status = 'approved' AND vp.starts_at <= now()
                 UNION ALL
                 SELECT 'flash_sale', fsi.id, fsi.product_id, COALESCE(fs.starts_at, fs.created_at), fs.ends_at,
                        fsi.sale_price, fs.title
                 FROM flash_sale_items fsi
                 JOIN flash_sales fs ON fs.id = fsi.flash_sale_id
                 JOIN products fp ON fp.id = fsi.product_id
                 WHERE fp.vendor_id = $1 AND COALESCE(fs.starts_at, fs.created_at) <= now()
                   AND NOT EXISTS (SELECT 1 FROM vendor_promotions x WHERE x.flash_sale_item_id = fsi.id)
             )
             SELECT pr.kind, pr.promo_id, pr.product_id, pr.starts_at, pr.ends_at, pr.promo_price, pr.campaign_name,
                    p.name AS product_name, p.sku, p.lizimas_sku, p.image,
                    (pr.ends_at >= now()) AS ongoing,
                    COALESCE((SELECT SUM(v.views) FROM product_view_daily v
                              WHERE v.product_id = pr.product_id
                                AND v.day BETWEEN (pr.starts_at AT TIME ZONE 'UTC')::date AND (LEAST(pr.ends_at, now()) AT TIME ZONE 'UTC')::date), 0) AS page_views,
                    COALESCE(s.items_sold, 0) AS items_sold,
                    COALESCE(s.revenue, 0) AS revenue
             FROM promos pr
             JOIN products p ON p.id = pr.product_id
             LEFT JOIN LATERAL (
                 SELECT SUM(oi.quantity) AS items_sold, SUM(oi.quantity * oi.price) AS revenue
                 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = pr.product_id AND o.status <> 'cancelled'
                   AND o.created_at BETWEEN pr.starts_at AND pr.ends_at
             ) s ON true
             WHERE ($2 = 'all' OR ($2 = 'ongoing' AND pr.ends_at >= now()) OR ($2 = 'expired' AND pr.ends_at < now()))
             ORDER BY (pr.ends_at >= now()) DESC, pr.starts_at DESC
             LIMIT 500`,
            [req.vendorId, status]
        );
        res.json(rows.map((r) => ({
            ...r,
            page_views: Number(r.page_views),
            items_sold: Number(r.items_sold),
            revenue: Number(r.revenue),
            status: r.ongoing ? "ongoing" : "expired",
            country: "Uganda"
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin -----------------------------------------------------------------

exports.listCampaignsAdmin = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ${CAMPAIGN_COLUMNS},
                    (SELECT COUNT(*) FROM vendor_promotions vp WHERE vp.campaign_id = c.id AND vp.status = 'pending') AS pending_entries,
                    (SELECT COUNT(*) FROM vendor_promotions vp WHERE vp.campaign_id = c.id AND vp.status = 'approved') AS approved_entries,
                    (SELECT COUNT(DISTINCT vp.vendor_id) FROM vendor_promotions vp WHERE vp.campaign_id = c.id AND vp.status <> 'rejected') AS vendors_joined
             FROM promotion_campaigns c
             ORDER BY c.starts_at DESC, c.id DESC`
        );
        res.json(rows.map((r) => ({
            ...shapeCampaign(r),
            pending_entries: Number(r.pending_entries),
            approved_entries: Number(r.approved_entries),
            vendors_joined: Number(r.vendors_joined)
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createCampaignAdmin = async (req, res) => {
    try {
        const { data, errors } = validateCampaignInput(req.body || {});
        if (errors.length) return res.status(400).json({ error: errors[0], errors });
        const { rows } = await pool.query(
            `INSERT INTO promotion_campaigns (name, description, registration_ends_at, starts_at, ends_at, min_discount_pct, max_discount_pct, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [data.name, data.description, data.registration_ends_at, data.starts_at, data.ends_at, data.min_discount_pct, data.max_discount_pct, req.user.userId]
        );
        logActivity(req.user.userId, "promotion_campaign_created", "promotion_campaign", rows[0].id, null);
        res.status(201).json({ message: "Campaign created.", id: rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Cancelling a campaign also withdraws every entry that isn't finished:
// pending ones are rejected, and approved ones that haven't ended stop
// immediately (status rejected, homepage feature row removed) - so no
// cancelled campaign's price keeps applying at checkout.
exports.cancelCampaignAdmin = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const upd = await client.query(
            `UPDATE promotion_campaigns SET is_cancelled = true, cancelled_at = now(), updated_at = now()
             WHERE id = $1 AND is_cancelled = false AND ends_at > now() RETURNING id`,
            [req.params.id]
        );
        if (!upd.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Campaign not found, already cancelled, or already ended." });
        }
        const affected = await client.query(
            `UPDATE vendor_promotions SET status = 'rejected', rejection_reason = 'Campaign cancelled by Lizimas Store.',
                    reviewed_by = $2, reviewed_at = now()
             WHERE campaign_id = $1 AND (status = 'pending' OR (status = 'approved' AND ends_at > now()))
             RETURNING flash_sale_item_id`,
            [req.params.id, req.user.userId]
        );
        const fsiIds = affected.rows.map((r) => r.flash_sale_item_id).filter(Boolean);
        if (fsiIds.length) await client.query("DELETE FROM flash_sale_items WHERE id = ANY($1)", [fsiIds]);
        await client.query("COMMIT");
        logActivity(req.user.userId, "promotion_campaign_cancelled", "promotion_campaign", req.params.id, null);
        res.json({ message: `Campaign cancelled. ${affected.rows.length} entr${affected.rows.length === 1 ? "y" : "ies"} withdrawn.` });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};
