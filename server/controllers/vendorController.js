const pool = require("../config/database");
const { computeSellerScore } = require("../utils/sellerScore");
const { deriveVendorOrderStage, STAGE_LABELS, isValidStage, canAdvanceStage } = require("../utils/vendorOrderStage");
const { logActivity } = require("../utils/activityLog");

// The logged-in vendor's own KYC/business profile and review status.
exports.getMyVendorProfile = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, business_name, account_type, registration_number, national_id_number, phone,
                    physical_address, momo_number, referral_source, status, rejection_reason,
                    submitted_at, reviewed_at
             FROM vendors WHERE user_id = $1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// The verification step that follows registration + first login: an
// Individual vendor supplies their national ID, a Company vendor supplies
// their URSB registration number, and either can add/update their MoMo
// payout number. Kept separate from registration so a prospective vendor
// can create an account and sign in before hunting down these documents.
exports.updateMyVendorProfile = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, account_type FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];

        const { registration_number, national_id_number, momo_number, physical_address } = req.body;

        if (vendor.account_type === "company" && registration_number !== undefined && !registration_number) {
            return res.status(400).json({ error: "Registration number cannot be blank." });
        }
        if (vendor.account_type === "individual" && national_id_number !== undefined && !national_id_number) {
            return res.status(400).json({ error: "National ID number cannot be blank." });
        }

        // One account per business: a registration number or national ID
        // that's already tied to another APPROVED vendor can't be reused.
        // Pending/rejected vendors don't block this - only an approved
        // account counts as "this business already has an account". The
        // partial unique index in migration 054 is the final authority;
        // this is just an earlier, friendlier version of the same check.
        if (registration_number) {
            const dupe = await pool.query(
                "SELECT id FROM vendors WHERE status = 'approved' AND id != $1 AND LOWER(TRIM(registration_number)) = LOWER(TRIM($2))",
                [vendor.id, registration_number]
            );
            if (dupe.rows.length > 0) {
                return res.status(409).json({
                    error: "This registration number is already associated with another approved vendor account."
                });
            }
        }
        if (national_id_number) {
            const dupe = await pool.query(
                "SELECT id FROM vendors WHERE status = 'approved' AND id != $1 AND LOWER(TRIM(national_id_number)) = LOWER(TRIM($2))",
                [vendor.id, national_id_number]
            );
            if (dupe.rows.length > 0) {
                return res.status(409).json({
                    error: "This national ID is already associated with another approved vendor account."
                });
            }
        }

        const result = await pool.query(
            `UPDATE vendors SET
                registration_number = COALESCE($1, registration_number),
                national_id_number = COALESCE($2, national_id_number),
                momo_number = COALESCE($3, momo_number),
                physical_address = COALESCE($4, physical_address)
             WHERE id = $5
             RETURNING id, business_name, account_type, registration_number, national_id_number,
                       phone, physical_address, momo_number, referral_source, status, rejection_reason,
                       submitted_at, reviewed_at`,
            [registration_number || null, national_id_number || null, momo_number || null,
                physical_address || null, vendor.id]
        );

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Bulk activate/deactivate/delete across the vendor's own products (Task
// #60: "bulk actions"). Delete reuses the same soft-delete deleteProduct
// already does for a single vendor product (straight to Trash, no admin
// deletion-request step - that step is store_manager-only, see
// productController.js deleteProduct); activate/deactivate flips the new
// is_active visibility column, which is entirely separate from admin
// approval status - it never needs re-review.
const BULK_PRODUCT_ACTIONS = ["activate", "deactivate", "delete"];

exports.bulkUpdateVendorProducts = async (req, res) => {
    try {
        const { productIds, action } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: "productIds must be a non-empty array." });
        }
        if (!BULK_PRODUCT_ACTIONS.includes(action)) {
            return res.status(400).json({ error: `action must be one of: ${BULK_PRODUCT_ACTIONS.join(", ")}.` });
        }

        const ids = productIds.map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (ids.length === 0) {
            return res.status(400).json({ error: "No valid product ids given." });
        }

        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const result = action === "delete"
            ? await pool.query(
                `UPDATE products SET deleted_at = now()
                 WHERE id = ANY($1::int[]) AND vendor_id = $2 AND deleted_at IS NULL
                 RETURNING id`,
                [ids, vendorId]
            )
            : await pool.query(
                `UPDATE products SET is_active = $1
                 WHERE id = ANY($2::int[]) AND vendor_id = $3 AND deleted_at IS NULL
                 RETURNING id`,
                [action === "activate", ids, vendorId]
            );

        logActivity(req.user.userId, `bulk_${action}_products`, "product", null,
            `${result.rows.length} product(s): ${action}`);

        res.json({
            message: `${result.rows.length} product(s) ${action}d.`,
            updatedIds: result.rows.map(r => r.id)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Order line items belonging to this vendor's products. An order can mix
// items from several vendors (and staff-added products), so this returns
// only the rows that are actually this vendor's, not whole orders.
//
// Deliberately excludes customer name/phone/delivery address: per the Vendor
// Data Protection Policy, a vendor's fulfilment role ends at handover to
// Lizimas Store, which owns the customer delivery step from there. A vendor
// only needs to know what to prepare and how many, not who it's going to.
// The vendor dashboard's "command center" numbers: order counts by stage,
// an earnings summary, product/low-stock counts, and the vendor's own
// seller score (previously only shown on the public storefront/product
// page). Earnings are shown as Sale / Marketplace charges / Net payable -
// currency amounts only, never a rate or percentage, per the "sellers must
// never see the commission %" rule (Ryan, Sept 2026).
//
// The charges figure uses each product's CURRENT commission_rate_applied/
// fixed_fee_applied rather than a rate locked at order time, because order-
// time commission locking isn't wired up yet (see PENDING.md) - this is an
// approximation inherited from that same known limitation, not a new one.
exports.getVendorDashboardSummary = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id, business_name, slug FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const [ordersRes, earningsRes, productsRes, sellerScore, followerRes] = await Promise.all([
            pool.query(
                `SELECT
                    COUNT(DISTINCT o.id) FILTER (WHERE o.created_at::date = CURRENT_DATE) AS today_orders,
                    COUNT(*) FILTER (WHERE o.status != 'cancelled' AND (oi.handover_status IS NULL OR oi.handover_status = 'pending_handover')) AS pending_handover,
                    COUNT(*) FILTER (WHERE o.status IN ('paid', 'shipped')) AS awaiting_delivery,
                    COUNT(*) FILTER (WHERE o.status = 'delivered') AS completed,
                    COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
                    COUNT(*) FILTER (WHERE oi.handover_status IN ('returned_for_collection', 'collected')) AS active_returns
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1`,
                [vendorId]
            ),
            pool.query(
                `SELECT
                    COALESCE(SUM(oi.price * oi.quantity), 0) AS sale_total,
                    COALESCE(SUM(
                        CASE WHEN p.commission_rate_applied IS NOT NULL
                            THEN (oi.price * oi.quantity) * p.commission_rate_applied + COALESCE(p.fixed_fee_applied, 0) * oi.quantity
                            ELSE 0
                        END
                    ), 0) AS charges_total
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1 AND o.status = 'delivered'`,
                [vendorId]
            ),
            pool.query(
                `SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE stock < 10 AND status = 'approved') AS low_stock
                 FROM products WHERE vendor_id = $1 AND deleted_at IS NULL`,
                [vendorId]
            ),
            computeSellerScore(vendorId),
            pool.query(`SELECT COUNT(*)::int AS n FROM vendor_followers WHERE vendor_id = $1`, [vendorId])
        ]);

        const saleTotal = Number(earningsRes.rows[0].sale_total);
        const chargesTotal = Number(earningsRes.rows[0].charges_total);

        res.json({
            vendor: vendorRow.rows[0],
            followerCount: followerRes.rows[0].n,
            orders: {
                today: Number(ordersRes.rows[0].today_orders),
                pendingHandover: Number(ordersRes.rows[0].pending_handover),
                awaitingDelivery: Number(ordersRes.rows[0].awaiting_delivery),
                completed: Number(ordersRes.rows[0].completed),
                cancelled: Number(ordersRes.rows[0].cancelled),
                activeReturns: Number(ordersRes.rows[0].active_returns)
            },
            earnings: {
                sale: saleTotal,
                charges: chargesTotal,
                net: saleTotal - chargesTotal
            },
            products: {
                total: Number(productsRes.rows[0].total),
                lowStock: Number(productsRes.rows[0].low_stock)
            },
            sellerScore
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getMyVendorOrders = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, oi.quantity, oi.price,
                    p.name AS product_name, p.image AS product_image,
                    o.status AS order_status, o.created_at,
                    oi.handover_status, oi.handed_over_at, oi.rejection_reason,
                    oi.vendor_fulfilment_stage, oi.dropoff_point_id, dp.name AS dropoff_point_name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN dropoff_points dp ON dp.id = oi.dropoff_point_id
             WHERE p.vendor_id = $1
             ORDER BY o.created_at DESC`,
            [vendorId]
        );

        // Combine order status, the vendor's own pre-handover progress, and
        // Lizimas' post-handover inspection/returns lifecycle into one
        // display-friendly stage per item (see utils/vendorOrderStage.js).
        const rows = result.rows.map(row => {
            const stage = deriveVendorOrderStage({
                orderStatus: row.order_status,
                vendorFulfilmentStage: row.vendor_fulfilment_stage,
                handoverStatus: row.handover_status
            });
            return { ...row, stage, stageLabel: STAGE_LABELS[stage] };
        });

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor advances their own pre-handover stage for one order line item:
// New -> Accepted -> Processing -> Ready for Handover, one step at a time
// (see utils/vendorOrderStage.js). Once at Ready for Handover, the existing
// POST /order-items/:orderItemId/handover call (fulfilmentController.js)
// takes over. Forward-only and scoped to the vendor's own items, same as
// vendorMarkHandedOver below it in the fulfilment controller.
exports.advanceVendorOrderStage = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { stage } = req.body;

        if (!isValidStage(stage)) {
            return res.status(400).json({
                error: "stage must be one of: new, accepted, processing, ready_for_handover."
            });
        }

        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const itemRow = await pool.query(
            `SELECT oi.id, oi.vendor_fulfilment_stage, oi.handover_status, p.vendor_id, o.status AS order_status
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.id = $1`,
            [orderItemId]
        );
        if (itemRow.rows.length === 0) {
            return res.status(404).json({ error: "Order item not found." });
        }
        const item = itemRow.rows[0];
        if (Number(item.vendor_id) !== Number(vendorId)) {
            return res.status(403).json({ error: "This item does not belong to your vendor account." });
        }
        if (item.order_status === "cancelled") {
            return res.status(409).json({ error: "This order has been cancelled." });
        }
        // Once handed over (or past that), the vendor's pre-handover stages
        // are done - handover_status is the record of what happens next.
        // 'rejected' is the one exception: a rejected item comes back to the
        // vendor to re-prepare, so it re-enters the New/Accepted/Processing/
        // Ready for Handover flow (see rejectHandover in fulfilmentController.js,
        // which resets vendor_fulfilment_stage back to 'new').
        if (item.handover_status && !["pending_handover", "rejected"].includes(item.handover_status)) {
            return res.status(409).json({ error: "This item has already moved past your pre-handover stages." });
        }

        const currentStage = item.vendor_fulfilment_stage || "new";
        if (!canAdvanceStage(currentStage, stage)) {
            return res.status(409).json({
                error: `Cannot move from "${STAGE_LABELS[currentStage] || currentStage}" to "${STAGE_LABELS[stage]}" - stages advance one step at a time (New \u2192 Accepted \u2192 Processing \u2192 Ready for Handover).`
            });
        }

        const result = await pool.query(
            `UPDATE order_items SET vendor_fulfilment_stage = $1 WHERE id = $2 RETURNING *`,
            [stage, orderItemId]
        );
        res.json({ message: `Marked as ${STAGE_LABELS[stage]}.`, item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


// --- Admin: vendor KYC review ------------------------------------------

exports.getPendingVendors = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.id, v.business_name, v.account_type, v.registration_number, v.national_id_number,
                    v.phone, v.physical_address, v.momo_number, v.referral_source, v.submitted_at,
                    u.name AS owner_name, u.email AS owner_email
             FROM vendors v
             JOIN users u ON u.id = v.user_id
             WHERE v.status = 'pending'
             ORDER BY v.submitted_at ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.approveVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE vendors SET status = 'approved', reviewed_at = now(), reviewed_by = $1
             WHERE id = $2 AND status = 'pending' RETURNING *`,
            [req.user.userId, id]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Vendor is not awaiting review." });
        }
        res.json({ message: "Vendor approved.", vendor: result.rows[0] });
    } catch (error) {
        // One account per business, enforced at the DB level (migration 054):
        // approving this vendor would create a second APPROVED account
        // sharing a shop name, registration number, or national ID with an
        // already-approved vendor. The soft checks at registration/
        // verification catch most of these earlier, but this is the final,
        // race-condition-safe authority.
        if (error.code === "23505") {
            return res.status(409).json({
                error: "Cannot approve: another approved vendor already uses the same shop name, registration number, or national ID. Reject this application or resolve the conflict first."
            });
        }
        res.status(500).json({ error: error.message });
    }
};

exports.rejectVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ error: "A rejection reason is required." });
        }
        const result = await pool.query(
            `UPDATE vendors SET status = 'rejected', rejection_reason = $1, reviewed_at = now(), reviewed_by = $2
             WHERE id = $3 AND status = 'pending' RETURNING *`,
            [reason, req.user.userId, id]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Vendor is not awaiting review." });
        }
        res.json({ message: "Vendor rejected.", vendor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
// Public storefront (spec section 17): anyone can view an approved vendor's
// page and their live catalogue, no auth required. A pending/rejected/
// suspended vendor has no public page - the slug 404s exactly like a vendor
// that doesn't exist, rather than leaking review status to shoppers.
exports.getPublicStorefront = async (req, res) => {
    try {
        const { slug } = req.params;

        const vendorResult = await pool.query(
            `SELECT id, business_name, slug, logo_url, banner_url, about
             FROM vendors WHERE slug = $1 AND status = 'approved' LIMIT 1`,
            [slug]
        );
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({ error: "Store not found." });
        }
        const vendor = vendorResult.rows[0];

        const [productsResult, followerResult, sellerScore] = await Promise.all([
            pool.query(
                `SELECT id, name, price, image, stock, public_code
                 FROM products
                 WHERE vendor_id = $1 AND status = 'approved' AND is_active = true AND deleted_at IS NULL
                 ORDER BY created_at DESC`,
                [vendor.id]
            ),
            pool.query(`SELECT COUNT(*)::int AS n FROM vendor_followers WHERE vendor_id = $1`, [vendor.id]),
            computeSellerScore(vendor.id)
        ]);

        res.json({
            vendor,
            products: productsResult.rows,
            followerCount: followerResult.rows[0].n,
            sellerScore
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A customer follows/unfollows a vendor's storefront. Any logged-in user
// may call these (requireAuth only, no role check) - following is a
// customer action, not something scoped to the vendor portal.
exports.followVendor = async (req, res) => {
    try {
        const vendorId = Number(req.params.id);
        const vendorExists = await pool.query(
            `SELECT id FROM vendors WHERE id = $1 AND status = 'approved'`,
            [vendorId]
        );
        if (vendorExists.rows.length === 0) {
            return res.status(404).json({ error: "Store not found." });
        }
        await pool.query(
            `INSERT INTO vendor_followers (vendor_id, user_id) VALUES ($1, $2)
             ON CONFLICT (vendor_id, user_id) DO NOTHING`,
            [vendorId, req.user.userId]
        );
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS n FROM vendor_followers WHERE vendor_id = $1`,
            [vendorId]
        );
        res.json({ following: true, followerCount: countResult.rows[0].n });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.unfollowVendor = async (req, res) => {
    try {
        const vendorId = Number(req.params.id);
        await pool.query(
            `DELETE FROM vendor_followers WHERE vendor_id = $1 AND user_id = $2`,
            [vendorId, req.user.userId]
        );
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS n FROM vendor_followers WHERE vendor_id = $1`,
            [vendorId]
        );
        res.json({ following: false, followerCount: countResult.rows[0].n });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getFollowStatus = async (req, res) => {
    try {
        const vendorId = Number(req.params.id);
        const result = await pool.query(
            `SELECT 1 FROM vendor_followers WHERE vendor_id = $1 AND user_id = $2`,
            [vendorId, req.user.userId]
        );
        res.json({ following: result.rows.length > 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
