const pool = require("../config/database");
const { slugify } = require("../utils/slugify");
const { computeSellerScore } = require("../utils/sellerScore");
const { deriveVendorOrderStage, STAGE_LABELS, isValidStage, canAdvanceStage } = require("../utils/vendorOrderStage");
const { logActivity } = require("../utils/activityLog");
const {
    MIN_PAYOUT_UGX,
    classifyOrderItemForWallet,
    summarizeVendorWallet,
    canRequestPayout
} = require("../utils/vendorWallet");
const { deriveReturnResolutionStatus } = require("../utils/vendorReturns");
const { canApplyComplianceAction, COMPLIANCE_ACTION_LABELS } = require("../utils/vendorCompliance");
const {
    MAX_VENDOR_DISCOUNT_PERCENT,
    validateProposedPrice,
    isValidPromotionWindow,
    deriveVendorPromotionStatus
} = require("../utils/vendorPromotions");
const { buildNotification } = require("../utils/vendorNotifications");
const {
    MAX_ABOUT_LENGTH,
    isValidAboutText,
    isValidDeliveryMethod,
    findStorefrontContactViolation
} = require("../utils/vendorStorefront");
const {
    MAX_SUBJECT_LENGTH,
    MAX_BODY_LENGTH,
    isValidMessageSubject,
    isValidMessageBody,
    isValidMessageAdminView,
    deriveStatusAfterReply
} = require("../utils/vendorMessages");

// The logged-in vendor's own business profile and review status.
// registration_number/national_id_number moved to the separate,
// encrypted vendor_kyc table (GET /api/vendors/me/kyc) - Sept 2026's
// Vendor KYC rework. vendors.registration_number/national_id_number
// columns still exist but are legacy/frozen; nothing reads them here
// anymore.
exports.getMyVendorProfile = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, business_name, account_type, phone,
                    physical_address, momo_number, referral_source, status, rejection_reason,
                    submitted_at, reviewed_at, slug, about, delivery_method
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

// A vendor's own storefront presentation (Tasks #68/#74/#75) - the about
// blurb and delivery/payment method shown on their public store page
// (getPublicStorefront below). Kept separate from updateMyVendorProfile on
// purpose: that endpoint is KYC/business-profile data (registration
// number, MoMo number, address), this one is pure storefront presentation
// - different concerns, different validation rules, no reason to overload
// one endpoint for both.
//
// No logo/banner upload here - removed from the storefront on Ryan's
// instruction (Sept 2026); the page shows only business name + delivery
// method + about text + the existing seller score/followers panel. Plain
// JSON body now that there's nothing to upload.
//
// `about` is partial by design: omitting it entirely leaves it untouched
// (so a vendor can update just their delivery method without resending
// their bio); sending an empty string clears it. `about` also runs through
// findStorefrontContactViolation (see PENDING.md) so a bio can't be used
// to hand out a phone number or address off-platform.
exports.updateVendorStorefront = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, about, delivery_method FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];

        const aboutProvided = req.body.about !== undefined;
        const about = aboutProvided ? req.body.about : vendor.about;
        if (aboutProvided && !isValidAboutText(about)) {
            return res.status(400).json({ error: `About text must be ${MAX_ABOUT_LENGTH} characters or fewer.` });
        }
        if (aboutProvided) {
            const violation = findStorefrontContactViolation(about);
            if (violation) {
                return res.status(400).json({
                    error: `Your store bio can't include ${violation}. Customers should reach you through Lizimas Store, not directly.`
                });
            }
        }

        const deliveryMethodProvided = req.body.delivery_method !== undefined;
        const deliveryMethod = deliveryMethodProvided
            ? (req.body.delivery_method || null)
            : vendor.delivery_method;
        if (deliveryMethodProvided && !isValidDeliveryMethod(deliveryMethod)) {
            return res.status(400).json({ error: "Delivery method must be 'cash_on_delivery' or 'payment_first'." });
        }

        const result = await pool.query(
            `UPDATE vendors SET about = $1, delivery_method = $2 WHERE id = $3
             RETURNING id, business_name, slug, about, delivery_method`,
            [about, deliveryMethod, vendor.id]
        );
        res.json({ message: "Storefront updated.", vendor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Payout number and address - identity/business-registration numbers
// moved to the separate, encrypted vendor_kyc table (PATCH
// /api/vendors/me/kyc) as of the Sept 2026 Vendor KYC rework. Kept
// separate from registration so a prospective vendor can create an
// account and sign in before setting these up.
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

        const { momo_number, physical_address } = req.body;

        const result = await pool.query(
            `UPDATE vendors SET
                momo_number = COALESCE($1, momo_number),
                physical_address = COALESCE($2, physical_address)
             WHERE id = $3
             RETURNING id, business_name, account_type,
                       phone, physical_address, momo_number, referral_source, status, rejection_reason,
                       submitted_at, reviewed_at`,
            [momo_number || null, physical_address || null, vendor.id]
        );

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// pg's default type parser returns DATE columns as JS Date objects (UTC
// midnight), which JSON.stringify would otherwise expand into a full
// "...T00:00:00.000Z" timestamp - this keeps the API's startDate/endDate
// as plain "YYYY-MM-DD" strings, matching what an <input type="date">
// sends and expects back.
function formatDateOnly(value) {
    if (!value) return null;
    if (typeof value === "string") return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
}

// --- Shop Activation & Holiday Mode (migration 081) -----------------------
// Two whole-shop visibility switches for the mobile vendor app's Menu >
// Settings > Seller Settings screen. Both gate every one of the vendor's
// products out of public listings, search, and their own storefront page
// (see the WHERE clauses in productController.js and getPublicStorefront
// above) without touching products.is_active, which stays a per-product
// decision the vendor keeps full control of underneath either switch.

exports.getVendorShopStatus = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            `SELECT shop_active, holiday_mode_active, holiday_mode_start_date, holiday_mode_end_date
             FROM vendors WHERE user_id = $1`,
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const row = vendorRow.rows[0];
        res.json({
            shopActive: row.shop_active,
            holidayMode: {
                active: row.holiday_mode_active,
                startDate: formatDateOnly(row.holiday_mode_start_date),
                endDate: formatDateOnly(row.holiday_mode_end_date)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateVendorShopActive = async (req, res) => {
    try {
        const { active } = req.body;
        if (typeof active !== "boolean") {
            return res.status(400).json({ error: "active must be true or false." });
        }
        const result = await pool.query(
            `UPDATE vendors SET shop_active = $1 WHERE user_id = $2 RETURNING id, shop_active`,
            [active, req.user.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        res.json({ shopActive: result.rows[0].shop_active });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateVendorHolidayMode = async (req, res) => {
    try {
        const { active } = req.body;
        if (typeof active !== "boolean") {
            return res.status(400).json({ error: "active must be true or false." });
        }

        if (active) {
            const { startDate, endDate } = req.body;
            if (!startDate || !endDate) {
                return res.status(400).json({ error: "startDate and endDate are required to turn Holiday Mode on." });
            }
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
                return res.status(400).json({ error: "startDate and endDate must be valid dates." });
            }
            if (end < start) {
                return res.status(400).json({ error: "endDate cannot be before startDate." });
            }
            const todayStr = new Date().toISOString().slice(0, 10);
            if (startDate < todayStr) {
                return res.status(400).json({ error: "startDate cannot be in the past." });
            }

            const result = await pool.query(
                `UPDATE vendors SET holiday_mode_active = true, holiday_mode_start_date = $1, holiday_mode_end_date = $2
                 WHERE user_id = $3
                 RETURNING id, holiday_mode_active, holiday_mode_start_date, holiday_mode_end_date`,
                [startDate, endDate, req.user.userId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: "No vendor profile found for this account." });
            }
            return res.json({
                holidayMode: {
                    active: result.rows[0].holiday_mode_active,
                    startDate: formatDateOnly(result.rows[0].holiday_mode_start_date),
                    endDate: formatDateOnly(result.rows[0].holiday_mode_end_date)
                }
            });
        }

        const result = await pool.query(
            `UPDATE vendors SET holiday_mode_active = false, holiday_mode_start_date = NULL, holiday_mode_end_date = NULL
             WHERE user_id = $1
             RETURNING id`,
            [req.user.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        res.json({ holidayMode: { active: false, startDate: null, endDate: null } });
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

// Cap mirrors Jumia's own Vendor Center bulk-action limit (Ryan referenced
// their "up to 100 products per operation" behaviour, Sept 2026) - keeps a
// single request's classification loop and UPDATE bounded.
const BULK_PRODUCT_MAX_IDS = 100;

exports.bulkUpdateVendorProducts = async (req, res) => {
    try {
        const { productIds, action } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: "productIds must be a non-empty array." });
        }
        if (!BULK_PRODUCT_ACTIONS.includes(action)) {
            return res.status(400).json({ error: `action must be one of: ${BULK_PRODUCT_ACTIONS.join(", ")}.` });
        }

        const ids = [...new Set(productIds.map(Number).filter(n => Number.isInteger(n) && n > 0))];
        if (ids.length === 0) {
            return res.status(400).json({ error: "No valid product ids given." });
        }
        if (ids.length > BULK_PRODUCT_MAX_IDS) {
            return res.status(400).json({ error: `You can select at most ${BULK_PRODUCT_MAX_IDS} products per bulk action.` });
        }

        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        // One lookup covering every requested id (including already-deleted
        // ones, so those are reported as "already deleted" rather than a
        // bare "not found") - classification below happens in JS so the
        // vendor sees exactly why each product was or wasn't changed,
        // matching the successful/failed/skipped breakdown Jumia's Vendor
        // Center shows after a bulk action.
        const rowsResult = await pool.query(
            `SELECT id, name, status, is_active, admin_restricted, deleted_at
             FROM products WHERE id = ANY($1::int[]) AND vendor_id = $2`,
            [ids, vendorId]
        );
        const byId = new Map(rowsResult.rows.map(r => [r.id, r]));

        const successful = [];
        const failed = [];
        const skipped = [];
        const toChange = [];

        for (const id of ids) {
            const row = byId.get(id);
            if (!row) {
                failed.push({ id, name: null, reason: "Not found - it may belong to another vendor." });
                continue;
            }
            if (row.deleted_at) {
                if (action === "delete") {
                    skipped.push({ id, name: row.name, reason: "Already deleted." });
                } else {
                    failed.push({ id, name: row.name, reason: "This product has been deleted." });
                }
                continue;
            }
            if (action === "activate") {
                if (row.admin_restricted) {
                    failed.push({ id, name: row.name, reason: "Restricted by admin." });
                } else if (row.status === "rejected") {
                    failed.push({ id, name: row.name, reason: "Rejected - fix and resubmit before activating." });
                } else if (row.status === "pending") {
                    failed.push({ id, name: row.name, reason: "Pending approval - not live until admin approves it." });
                } else if (row.is_active) {
                    skipped.push({ id, name: row.name, reason: "Already active." });
                } else {
                    toChange.push(id);
                    successful.push({ id, name: row.name });
                }
            } else if (action === "deactivate") {
                if (!row.is_active) {
                    skipped.push({ id, name: row.name, reason: "Already inactive." });
                } else {
                    toChange.push(id);
                    successful.push({ id, name: row.name });
                }
            } else {
                toChange.push(id);
                successful.push({ id, name: row.name });
            }
        }

        if (toChange.length > 0) {
            if (action === "delete") {
                await pool.query(
                    `UPDATE products SET deleted_at = now() WHERE id = ANY($1::int[]) AND vendor_id = $2`,
                    [toChange, vendorId]
                );
            } else {
                await pool.query(
                    `UPDATE products SET is_active = $1 WHERE id = ANY($2::int[]) AND vendor_id = $3`,
                    [action === "activate", toChange, vendorId]
                );
            }
        }

        logActivity(req.user.userId, `bulk_${action}_products`, "product", null,
            `${successful.length} succeeded, ${failed.length} failed, ${skipped.length} skipped (${action})`);

        res.json({
            message: `${successful.length} product(s) ${action}d.`,
            updatedIds: toChange,
            successful,
            failed,
            skipped,
            summary: {
                total: ids.length,
                successCount: successful.length,
                failedCount: failed.length,
                skippedCount: skipped.length
            }
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
// The charges figure prefers each order_item's own locked-in
// commission_rate_applied/fixed_fee_applied (Task #67, migration 072),
// snapshotted at checkout - falling back to the product's CURRENT snapshot
// only for orders placed before that migration existed, so old numbers
// don't change and new ones stay accurate even if a rate or product price
// changes later.
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
                        CASE WHEN COALESCE(oi.commission_rate_applied, p.commission_rate_applied) IS NOT NULL
                            THEN (oi.price * oi.quantity) * COALESCE(oi.commission_rate_applied, p.commission_rate_applied)
                                 + COALESCE(oi.fixed_fee_applied, p.fixed_fee_applied, 0) * oi.quantity
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

// Every vendor regardless of status - the admin compliance panel's list.
// getPendingVendors above stays scoped to 'pending' for the applications
// queue; this is the broader "look up a vendor to act on" view.
exports.getAllVendors = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT v.id, v.business_name, v.status, v.payout_frozen, v.phone,
                    u.name AS owner_name, u.email AS owner_email
             FROM vendors v
             JOIN users u ON u.id = v.user_id
             ORDER BY v.business_name ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

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

// Generates a unique storefront slug (lizimasstore.com/store/:slug) for a
// vendor that doesn't have one yet. Migration 062 backfilled every vendor
// that existed at the time it ran, but nothing generated one for a vendor
// approved AFTER that migration - so a product's "Sold by" panel on the
// storefront (client/js/product-detail.js's loadSellerPanel, which only
// fires when product.vendor_slug is truthy) silently never appeared for
// any vendor approved since then, even though the vendor was fully
// approved. Mirrors the migration's own base-slug/uniqueness-suffix logic,
// reusing the shared slugify() helper instead of duplicating it.
async function ensureVendorSlug(vendorId, businessName) {
    const base = slugify(businessName) === "product" ? `vendor-${vendorId}` : slugify(businessName);
    let candidate = base;
    let suffix = 2;
    while (true) {
        const existing = await pool.query(
            `SELECT id FROM vendors WHERE slug = $1 AND id <> $2`,
            [candidate, vendorId]
        );
        if (existing.rows.length === 0) break;
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }
    await pool.query(`UPDATE vendors SET slug = $1 WHERE id = $2`, [candidate, vendorId]);
    return candidate;
}

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
        let vendor = result.rows[0];
        if (!vendor.slug) {
            vendor = { ...vendor, slug: await ensureVendorSlug(vendor.id, vendor.business_name) };
        }
        logActivity(req.user.userId, "vendor_approved", "vendor", id, vendor.business_name);
        res.json({ message: "Vendor approved.", vendor });
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
        logActivity(req.user.userId, "vendor_rejected", "vendor", id, reason);
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
            `SELECT id, business_name, slug, about, delivery_method,
                    shop_active, holiday_mode_active, holiday_mode_start_date, holiday_mode_end_date
             FROM vendors WHERE slug = $1 AND status = 'approved' LIMIT 1`,
            [slug]
        );
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({ error: "Store not found." });
        }
        const { shop_active, holiday_mode_active, holiday_mode_start_date, holiday_mode_end_date, ...vendor } = vendorResult.rows[0];

        // Holiday Mode / Shop Activation (migration 081): the storefront
        // page itself still resolves - a shopper following an old link
        // should see why the shop is unavailable, not a bare 404 - but its
        // product list is empty for as long as either switch says so. The
        // same window check backs productController.js's public listing
        // and getProductById, so a shopper can never reach a product page
        // directly during either state either.
        const today = new Date().toISOString().slice(0, 10);
        const onHoliday = holiday_mode_active
            && holiday_mode_start_date && holiday_mode_end_date
            && today >= holiday_mode_start_date.toISOString().slice(0, 10)
            && today <= holiday_mode_end_date.toISOString().slice(0, 10);
        const shopUnavailable = shop_active === false || onHoliday;

        const [productsResult, followerResult, sellerScore] = await Promise.all([
            shopUnavailable
                ? Promise.resolve({ rows: [] })
                : pool.query(
                    `SELECT id, name, price, image, stock, public_code,
                            EXISTS (
                                SELECT 1 FROM vendor_promotions vp
                                WHERE vp.product_id = products.id AND vp.sponsored = true
                                  AND vp.status = 'approved' AND vp.starts_at <= now() AND vp.ends_at >= now()
                            ) AS is_sponsored
                     FROM products
                     WHERE vendor_id = $1 AND status = 'approved' AND is_active = true AND admin_restricted = false AND deleted_at IS NULL
                     ORDER BY is_sponsored DESC, created_at DESC`,
                    [vendor.id]
                ),
            pool.query(`SELECT COUNT(*)::int AS n FROM vendor_followers WHERE vendor_id = $1`, [vendor.id]),
            computeSellerScore(vendor.id)
        ]);

        res.json({
            vendor,
            products: productsResult.rows,
            followerCount: followerResult.rows[0].n,
            sellerScore,
            shopUnavailable
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

// --- Vendor Wallet & Payouts (Task #61) --------------------------------
//
// The balance shown here is DERIVED on every read from order_items + each
// product's current commission fields - see server/utils/vendorWallet.js
// for the full rationale and the pure functions this wraps. Only money
// actually paid out (vendor_payouts) and manual admin adjustments
// (vendor_ledger_adjustments) are real, stored facts.
//
// Currency amounts only, never a rate or percentage - the "sellers must
// never see the commission %" rule (Ryan, Sept 2026) applies here exactly
// as it does to the dashboard earnings summary.

// Shared by the vendor-facing and admin-facing wallet endpoints: builds the
// plain-object inputs summarizeVendorWallet() expects from this vendor's
// order_items, vendor_payouts and vendor_ledger_adjustments rows.
async function loadVendorWalletData(vendorId) {
    const [itemsRes, payoutsRes, adjustmentsRes] = await Promise.all([
        pool.query(
            `SELECT o.status AS order_status, oi.handover_status,
                    oi.price, oi.quantity,
                    COALESCE(oi.commission_rate_applied, p.commission_rate_applied) AS commission_rate_applied,
                    COALESCE(oi.fixed_fee_applied, p.fixed_fee_applied) AS fixed_fee_applied
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             WHERE p.vendor_id = $1`,
            [vendorId]
        ),
        pool.query(
            `SELECT id, amount, method, momo_number, status, reference, notes, requested_at, paid_at
             FROM vendor_payouts WHERE vendor_id = $1 ORDER BY requested_at DESC`,
            [vendorId]
        ),
        pool.query(
            `SELECT id, amount, reason, created_at
             FROM vendor_ledger_adjustments WHERE vendor_id = $1 ORDER BY created_at DESC`,
            [vendorId]
        )
    ]);

    const items = itemsRes.rows.map(row => {
        const saleAmount = Number(row.price) * Number(row.quantity);
        const chargeAmount = row.commission_rate_applied !== null
            ? saleAmount * Number(row.commission_rate_applied) + Number(row.fixed_fee_applied || 0) * Number(row.quantity)
            : 0;
        return {
            saleAmount,
            chargeAmount,
            classification: classifyOrderItemForWallet({
                orderStatus: row.order_status,
                handoverStatus: row.handover_status
            })
        };
    });

    const payouts = payoutsRes.rows.map(row => ({ amount: Number(row.amount), status: row.status }));
    const adjustments = adjustmentsRes.rows.map(row => ({ amount: Number(row.amount) }));

    const summary = summarizeVendorWallet(items, payouts, adjustments);
    const hasOutstandingRequest = payoutsRes.rows.some(row => row.status === "requested");

    return { summary, hasOutstandingRequest, payoutRows: payoutsRes.rows, adjustmentRows: adjustmentsRes.rows };
}

function walletResponsePayload(vendor, walletData) {
    const { summary, hasOutstandingRequest, payoutRows, adjustmentRows } = walletData;
    const eligibility = canRequestPayout(summary.availableBalance, hasOutstandingRequest);

    return {
        momoNumber: vendor.momo_number || null,
        minPayout: MIN_PAYOUT_UGX,
        balance: {
            pending: summary.pendingBalance,
            available: summary.availableBalance,
            netEarned: summary.netEarned,
            paidOutTotal: summary.paidOutTotal,
            requestedTotal: summary.requestedTotal
        },
        breakdown: summary.breakdown,
        eligibility,
        payouts: payoutRows.map(row => ({
            id: row.id,
            amount: Number(row.amount),
            method: row.method,
            momoNumber: row.momo_number,
            status: row.status,
            reference: row.reference,
            notes: row.notes,
            requestedAt: row.requested_at,
            paidAt: row.paid_at
        })),
        adjustments: adjustmentRows.map(row => ({
            id: row.id,
            amount: Number(row.amount),
            reason: row.reason,
            createdAt: row.created_at
        }))
    };
}

// The logged-in vendor's own wallet: available/pending balance, payout
// history and manual adjustment history.
exports.getVendorWallet = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, momo_number FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];
        const walletData = await loadVendorWalletData(vendor.id);
        res.json(walletResponsePayload(vendor, walletData));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A vendor asks to be paid out. Defaults to their full available balance;
// an explicit `amount` may request less (but never more than what's
// available). MoMo number is snapshotted from the vendor's profile at
// request time so a later profile edit can't silently redirect money
// already requested.
exports.requestVendorPayout = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, momo_number, payout_frozen FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];
        if (vendor.payout_frozen) {
            return res.status(403).json({ error: "Payouts are currently frozen on your account. Contact Lizimas Store support." });
        }
        if (!vendor.momo_number) {
            return res.status(400).json({ error: "Add your MoMo number in your profile before requesting a payout." });
        }

        const walletData = await loadVendorWalletData(vendor.id);
        const eligibility = canRequestPayout(walletData.summary.availableBalance, walletData.hasOutstandingRequest);
        if (!eligibility.allowed) {
            return res.status(400).json({ error: eligibility.reason });
        }

        let amount = walletData.summary.availableBalance;
        if (req.body.amount !== undefined) {
            const requested = Number(req.body.amount);
            if (!Number.isFinite(requested) || requested <= 0) {
                return res.status(400).json({ error: "amount must be a positive number." });
            }
            if (requested > walletData.summary.availableBalance) {
                return res.status(400).json({ error: "amount cannot exceed your available balance." });
            }
            amount = requested;
        }

        const result = await pool.query(
            `INSERT INTO vendor_payouts (vendor_id, amount, method, momo_number, status)
             VALUES ($1, $2, 'momo', $3, 'requested') RETURNING *`,
            [vendor.id, amount, vendor.momo_number]
        );

        logActivity(req.user.userId, "vendor_payout_requested", "vendor_payout", result.rows[0].id,
            `UGX ${amount.toLocaleString()} requested via MoMo ${vendor.momo_number}`);

        const refreshed = await loadVendorWalletData(vendor.id);
        res.status(201).json(walletResponsePayload(vendor, refreshed));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin side ----------------------------------------------------------

// Every payout request currently awaiting admin action, oldest first -
// mirrors getPendingVendors' shape/ordering for the same "queue" feel.
exports.getVendorPayoutRequests = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT vp.id, vp.vendor_id, vp.amount, vp.method, vp.momo_number, vp.status,
                    vp.requested_at, v.business_name, v.phone
             FROM vendor_payouts vp
             JOIN vendors v ON v.id = vp.vendor_id
             WHERE vp.status = 'requested'
             ORDER BY vp.requested_at ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin confirms the MoMo transfer was actually sent.
exports.markVendorPayoutPaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { reference, notes } = req.body;
        const result = await pool.query(
            `UPDATE vendor_payouts
             SET status = 'paid', paid_at = now(), paid_by = $1, reference = $2, notes = $3
             WHERE id = $4 AND status = 'requested' RETURNING *`,
            [req.user.userId, reference || null, notes || null, id]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Payout request is not awaiting payment." });
        }
        logActivity(req.user.userId, "vendor_payout_paid", "vendor_payout", id,
            `UGX ${Number(result.rows[0].amount).toLocaleString()} marked paid`);
        await createVendorNotification(result.rows[0].vendor_id, "payout_update", {
            status: "paid", amount: result.rows[0].amount
        });
        res.json({ message: "Payout marked as paid.", payout: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin declines a payout request - the money simply stays in the
// vendor's available balance (nothing to reverse; it was never stored
// anywhere but as a 'requested' row).
exports.rejectVendorPayout = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ error: "A rejection reason is required." });
        }
        const result = await pool.query(
            `UPDATE vendor_payouts SET status = 'rejected', notes = $1
             WHERE id = $2 AND status = 'requested' RETURNING *`,
            [reason, id]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Payout request is not awaiting review." });
        }
        logActivity(req.user.userId, "vendor_payout_rejected", "vendor_payout", id, reason);
        await createVendorNotification(result.rows[0].vendor_id, "payout_update", {
            status: "rejected", amount: result.rows[0].amount
        });
        res.json({ message: "Payout request rejected.", payout: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A one-off manual credit/debit to a vendor's balance (goodwill credit,
// dispute correction). amount is signed: positive = credit, negative =
// debit. Always requires a reason - shown to the vendor alongside it.
exports.createVendorLedgerAdjustment = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount === 0) {
            return res.status(400).json({ error: "amount must be a non-zero number." });
        }
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: "A reason is required." });
        }

        const vendorExists = await pool.query("SELECT id FROM vendors WHERE id = $1", [id]);
        if (vendorExists.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }

        const result = await pool.query(
            `INSERT INTO vendor_ledger_adjustments (vendor_id, amount, reason, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, numericAmount, reason, req.user.userId]
        );
        logActivity(req.user.userId, "vendor_ledger_adjustment", "vendor", id,
            `UGX ${numericAmount.toLocaleString()}: ${reason}`);
        res.status(201).json({ message: "Adjustment recorded.", adjustment: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin's view of one vendor's full wallet - same shape as the vendor's
// own view, for reviewing a payout request or investigating a dispute.
exports.getVendorWalletAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const vendorRow = await pool.query("SELECT id, business_name, momo_number FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const vendor = vendorRow.rows[0];
        const walletData = await loadVendorWalletData(vendor.id);
        res.json({ vendor: { id: vendor.id, businessName: vendor.business_name }, ...walletResponsePayload(vendor, walletData) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Returns & Refunds Center (Task #62), vendor side --------------------
// A dedicated financial/decision view of this vendor's returns, separate
// from the logistics-only Returns tab (getMyReturns/vendorMarkHandedOver
// in fulfilmentController.js, which is about collecting the physical item
// back). This is: why it came back, the evidence photo, Lizimas' decision,
// and the vendor's own response to that decision.
exports.getMyReturnsRefunds = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, oi.price,
                    oi.return_reason, oi.returned_at, oi.return_evidence_image,
                    oi.refund_decision, oi.refund_amount, oi.refund_notes, oi.refund_decided_at,
                    oi.vendor_response, oi.vendor_responded_at,
                    p.name AS product_name, p.image AS product_image
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE p.vendor_id = $1 AND oi.return_reason IS NOT NULL
             ORDER BY oi.returned_at DESC`,
            [vendorId]
        );

        const rows = result.rows.map(row => ({
            ...row,
            resolutionStatus: deriveReturnResolutionStatus({
                returnReason: row.return_reason,
                refundDecision: row.refund_decision
            })
        }));

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A vendor's own comment/dispute on a return - visible to admin, never
// changes the refund decision itself (Lizimas/admin retains final
// authority). Can be updated any time there's an active return recorded;
// deliberately not locked to "before decision only" - a vendor may want
// to respond to Lizimas' decision after it's made just as much as before.
exports.respondToReturn = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { response } = req.body;
        if (!response || !String(response).trim()) {
            return res.status(400).json({ error: "response is required." });
        }

        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const result = await pool.query(
            `UPDATE order_items oi
             SET vendor_response = $1, vendor_responded_at = now()
             FROM products p
             WHERE oi.product_id = p.id AND oi.id = $2 AND p.vendor_id = $3 AND oi.return_reason IS NOT NULL
             RETURNING oi.id, oi.vendor_response, oi.vendor_responded_at`,
            [response, orderItemId, vendorId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No recorded return found for this item on your account." });
        }
        res.json({ message: "Response saved.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin compliance actions against a vendor (Task #63) ---------------
// warn/suspend/reinstate/freeze-payout/unfreeze-payout, all writing to
// vendor_compliance_actions - one table that is both the admin audit
// trail and the vendor's own notice feed (a warning has no other schema
// effect to show it happened). Suspend reuses vendors.status, which
// already supported 'suspended' but nothing ever set it - a suspended
// vendor's storefront already 404s (getPublicStorefront requires
// status = 'approved'); this makes the status itself reachable.

async function insertComplianceAction(vendorId, actionType, reason, adminUserId) {
    const result = await pool.query(
        `INSERT INTO vendor_compliance_actions (vendor_id, action_type, reason, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [vendorId, actionType, reason, adminUserId]
    );
    await createVendorNotification(vendorId, "compliance_action", {
        actionLabel: COMPLIANCE_ACTION_LABELS[actionType] || actionType,
        reason
    });
    return result;
}

exports.warnVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: "A reason is required." });
        }
        const vendorExists = await pool.query("SELECT id FROM vendors WHERE id = $1", [id]);
        if (vendorExists.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const action = await insertComplianceAction(id, "warn", reason, req.user.userId);
        logActivity(req.user.userId, "vendor_warned", "vendor", id, reason);
        res.status(201).json({ message: "Warning recorded.", action: action.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.suspendVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: "A reason is required." });
        }
        const vendorRow = await pool.query("SELECT status FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const eligibility = canApplyComplianceAction("suspend", { vendorStatus: vendorRow.rows[0].status });
        if (!eligibility.allowed) {
            return res.status(409).json({ error: eligibility.reason });
        }

        const result = await pool.query(
            `UPDATE vendors SET status = 'suspended' WHERE id = $1 RETURNING *`,
            [id]
        );
        await insertComplianceAction(id, "suspend", reason, req.user.userId);
        logActivity(req.user.userId, "vendor_suspended", "vendor", id, reason);
        res.json({ message: "Vendor suspended.", vendor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reinstateVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const reason = req.body.reason || "Reinstated.";
        const vendorRow = await pool.query("SELECT status FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const eligibility = canApplyComplianceAction("reinstate", { vendorStatus: vendorRow.rows[0].status });
        if (!eligibility.allowed) {
            return res.status(409).json({ error: eligibility.reason });
        }

        const result = await pool.query(
            `UPDATE vendors SET status = 'approved' WHERE id = $1 RETURNING *`,
            [id]
        );
        await insertComplianceAction(id, "reinstate", reason, req.user.userId);
        logActivity(req.user.userId, "vendor_reinstated", "vendor", id, reason);
        res.json({ message: "Vendor reinstated.", vendor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.freezeVendorPayouts = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: "A reason is required." });
        }
        const vendorRow = await pool.query("SELECT payout_frozen FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const eligibility = canApplyComplianceAction("freeze_payout", { payoutFrozen: vendorRow.rows[0].payout_frozen });
        if (!eligibility.allowed) {
            return res.status(409).json({ error: eligibility.reason });
        }

        const result = await pool.query(
            `UPDATE vendors SET payout_frozen = true WHERE id = $1 RETURNING *`,
            [id]
        );
        await insertComplianceAction(id, "freeze_payout", reason, req.user.userId);
        logActivity(req.user.userId, "vendor_payouts_frozen", "vendor", id, reason);
        res.json({ message: "Payouts frozen for this vendor.", vendor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.unfreezeVendorPayouts = async (req, res) => {
    try {
        const { id } = req.params;
        const reason = req.body.reason || "Payouts unfrozen.";
        const vendorRow = await pool.query("SELECT payout_frozen FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const eligibility = canApplyComplianceAction("unfreeze_payout", { payoutFrozen: vendorRow.rows[0].payout_frozen });
        if (!eligibility.allowed) {
            return res.status(409).json({ error: eligibility.reason });
        }

        const result = await pool.query(
            `UPDATE vendors SET payout_frozen = false WHERE id = $1 RETURNING *`,
            [id]
        );
        await insertComplianceAction(id, "unfreeze_payout", reason, req.user.userId);
        logActivity(req.user.userId, "vendor_payouts_unfrozen", "vendor", id, reason);
        res.json({ message: "Payouts unfrozen for this vendor.", vendor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin's full compliance history for one vendor - warnings, suspensions,
// product restrictions, payout freezes, all in one timeline.
// A vendor's products for the admin compliance panel - just enough to
// pick one to restrict/unrestrict, not the full catalogue-management view.
exports.getVendorProductsAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT id, name, image, status, is_active, admin_restricted, restricted_reason
             FROM products WHERE vendor_id = $1 AND deleted_at IS NULL
             ORDER BY name ASC`,
            [id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getVendorComplianceHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT vca.id, vca.action_type, vca.reason, vca.product_id, vca.created_at,
                    p.name AS product_name, u.name AS admin_name
             FROM vendor_compliance_actions vca
             LEFT JOIN products p ON p.id = vca.product_id
             LEFT JOIN users u ON u.id = vca.created_by
             WHERE vca.vendor_id = $1
             ORDER BY vca.created_at DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// The vendor's own view of the same history - their "Notices" feed. Same
// query, scoped to their own vendor_id instead of an admin-supplied id.
exports.getMyComplianceNotices = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `SELECT vca.id, vca.action_type, vca.reason, vca.product_id, vca.created_at, p.name AS product_name
             FROM vendor_compliance_actions vca
             LEFT JOIN products p ON p.id = vca.product_id
             WHERE vca.vendor_id = $1
             ORDER BY vca.created_at DESC`,
            [vendorRow.rows[0].id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor Promotions: propose (Task #64) --------------------------------
// A vendor proposes a time-boxed sale price on one of their own products.
// The discount, once approved, is honored at checkout regardless of
// homepage placement (see checkoutController.js) - homepage_featured only
// controls whether it also shows in the existing flash-sale homepage
// section (see setVendorPromotionFeatured below).

exports.proposeVendorPromotion = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const { product_id, proposed_sale_price, starts_at, ends_at } = req.body;
        const productRow = await pool.query(
            `SELECT id, price FROM products WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
            [product_id, vendorId]
        );
        if (productRow.rows.length === 0) {
            return res.status(404).json({ error: "Product not found on your account." });
        }
        const originalPrice = Number(productRow.rows[0].price);
        const salePrice = Number(proposed_sale_price);

        const priceCheck = validateProposedPrice(originalPrice, salePrice, MAX_VENDOR_DISCOUNT_PERCENT);
        if (!priceCheck.allowed) {
            return res.status(400).json({ error: priceCheck.reason });
        }
        const windowCheck = isValidPromotionWindow(starts_at, ends_at);
        if (!windowCheck.allowed) {
            return res.status(400).json({ error: windowCheck.reason });
        }

        const existing = await pool.query(
            `SELECT id FROM vendor_promotions
             WHERE product_id = $1
               AND (status = 'pending' OR (status = 'approved' AND ends_at > now()))
             LIMIT 1`,
            [product_id]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "This product already has a pending or active promotion." });
        }

        const result = await pool.query(
            `INSERT INTO vendor_promotions (vendor_id, product_id, original_price, proposed_sale_price, starts_at, ends_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [vendorId, product_id, originalPrice, salePrice, starts_at, ends_at]
        );
        res.status(201).json({ message: "Promotion submitted for review.", promotion: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// The vendor's own promotions, most recent first.
exports.getMyVendorPromotions = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `SELECT vp.*, p.name AS product_name, p.image AS product_image
             FROM vendor_promotions vp
             JOIN products p ON p.id = vp.product_id
             WHERE vp.vendor_id = $1
             ORDER BY vp.created_at DESC`,
            [vendorRow.rows[0].id]
        );
        const rows = result.rows.map(row => ({
            ...row,
            resolutionStatus: deriveVendorPromotionStatus(
                { status: row.status, startsAt: row.starts_at, endsAt: row.ends_at }
            )
        }));
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor Promotions: admin review (Task #64) --------------------------

exports.getPendingVendorPromotions = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT vp.*, p.name AS product_name, v.business_name AS vendor_business_name
             FROM vendor_promotions vp
             JOIN products p ON p.id = vp.product_id
             JOIN vendors v ON v.id = vp.vendor_id
             WHERE vp.status = 'pending'
             ORDER BY vp.created_at ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Approved promotions - live, scheduled, or expired - for the admin
// homepage/sponsored controls. Expired ones stay listed (read-only in the
// UI) as a short recent history rather than vanishing outright.
exports.getApprovedVendorPromotions = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT vp.*, p.name AS product_name, v.business_name AS vendor_business_name
             FROM vendor_promotions vp
             JOIN products p ON p.id = vp.product_id
             JOIN vendors v ON v.id = vp.vendor_id
             WHERE vp.status = 'approved'
             ORDER BY vp.ends_at DESC
             LIMIT 100`
        );
        const rows = result.rows.map(row => ({
            ...row,
            resolutionStatus: deriveVendorPromotionStatus(
                { status: row.status, startsAt: row.starts_at, endsAt: row.ends_at }
            )
        }));
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.approveVendorPromotion = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE vendor_promotions
             SET status = 'approved', reviewed_by = $1, reviewed_at = now()
             WHERE id = $2 AND status = 'pending' RETURNING *`,
            [req.user.userId, id]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Promotion is not awaiting review." });
        }
        logActivity(req.user.userId, "vendor_promotion_approved", "vendor_promotion", id, null);
        res.json({ message: "Promotion approved.", promotion: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Also usable to cancel a promotion that was already approved and is
// currently live - clears any homepage feature materialization first, so
// there's one "shut this down" action rather than two.
exports.rejectVendorPromotion = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: "A reason is required." });
        }

        const current = await pool.query(
            `SELECT status, flash_sale_item_id FROM vendor_promotions WHERE id = $1`,
            [id]
        );
        if (current.rows.length === 0) {
            return res.status(404).json({ error: "Promotion not found." });
        }
        if (!["pending", "approved"].includes(current.rows[0].status)) {
            return res.status(409).json({ error: "Promotion has already been rejected." });
        }

        if (current.rows[0].flash_sale_item_id) {
            await removeVendorPromotionFeature(current.rows[0].flash_sale_item_id);
        }

        const result = await pool.query(
            `UPDATE vendor_promotions
             SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = now(),
                 homepage_featured = false, flash_sale_item_id = NULL
             WHERE id = $3 RETURNING *`,
            [reason, req.user.userId, id]
        );
        logActivity(req.user.userId, "vendor_promotion_rejected", "vendor_promotion", id, reason);
        res.json({ message: "Promotion rejected.", promotion: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Deletes the single-item flash_sale campaign a featured promotion
// created, and its flash_sale_items row - both were created only for this
// promotion's own homepage placement, so nothing else references them.
async function removeVendorPromotionFeature(flashSaleItemId) {
    const item = await pool.query(`SELECT flash_sale_id FROM flash_sale_items WHERE id = $1`, [flashSaleItemId]);
    if (item.rows.length === 0) return;
    await pool.query(`DELETE FROM flash_sales WHERE id = $1`, [item.rows[0].flash_sale_id]);
}

// Admin-only: whether an approved promotion also shows in the existing
// homepage flash-sale section. Materializes/removes a dedicated single-
// item flash_sale campaign matching the promotion's own time window -
// reuses the already-built, already-tested homepage rendering rather than
// a second one. Does NOT affect whether the discount is honored at
// checkout (see checkoutController.js) - only whether it's marketed there.
exports.setVendorPromotionFeatured = async (req, res) => {
    try {
        const { id } = req.params;
        const { featured } = req.body;

        const current = await pool.query(
            `SELECT vp.*, p.name AS product_name FROM vendor_promotions vp
             JOIN products p ON p.id = vp.product_id WHERE vp.id = $1`,
            [id]
        );
        if (current.rows.length === 0) {
            return res.status(404).json({ error: "Promotion not found." });
        }
        const promo = current.rows[0];
        if (promo.status !== "approved") {
            return res.status(409).json({ error: "Only an approved promotion can be featured." });
        }

        if (featured) {
            if (promo.flash_sale_item_id) {
                return res.status(409).json({ error: "Already featured." });
            }
            const flashSale = await pool.query(
                `INSERT INTO flash_sales (title, subtitle, starts_at, ends_at, is_active, created_by)
                 VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
                [`${promo.product_name} Deal`, "Vendor promotion", promo.starts_at, promo.ends_at, req.user.userId]
            );
            const item = await pool.query(
                `INSERT INTO flash_sale_items (flash_sale_id, product_id, sale_price)
                 VALUES ($1, $2, $3) RETURNING id`,
                [flashSale.rows[0].id, promo.product_id, promo.proposed_sale_price]
            );
            const result = await pool.query(
                `UPDATE vendor_promotions SET homepage_featured = true, flash_sale_item_id = $1
                 WHERE id = $2 RETURNING *`,
                [item.rows[0].id, id]
            );
            logActivity(req.user.userId, "vendor_promotion_featured", "vendor_promotion", id, null);
            res.json({ message: "Promotion featured on the homepage.", promotion: result.rows[0] });
        } else {
            if (promo.flash_sale_item_id) {
                await removeVendorPromotionFeature(promo.flash_sale_item_id);
            }
            const result = await pool.query(
                `UPDATE vendor_promotions SET homepage_featured = false, flash_sale_item_id = NULL
                 WHERE id = $1 RETURNING *`,
                [id]
            );
            logActivity(req.user.userId, "vendor_promotion_unfeatured", "vendor_promotion", id, null);
            res.json({ message: "Promotion removed from the homepage.", promotion: result.rows[0] });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin-only flag (Task #73 wires the actual placement effect): while a
// promotion is sponsored=true AND active (approved, within its window),
// getProducts/getPublicStorefront boost it to the top of listings and
// tag its card "Sponsored" - see isSponsoredAndActive in
// vendorPromotions.js for the exact predicate those queries mirror.
exports.setVendorPromotionSponsored = async (req, res) => {
    try {
        const { id } = req.params;
        const { sponsored } = req.body;
        const result = await pool.query(
            `UPDATE vendor_promotions SET sponsored = $1 WHERE id = $2 RETURNING *`,
            [!!sponsored, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Promotion not found." });
        }
        res.json({ message: sponsored ? "Marked sponsored." : "Sponsored flag cleared.", promotion: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor Notifications (Task #65) --------------------------------------
// One shared helper other controllers call directly (checkoutController.js
// for new_order/low_stock, productController.js for product approved/
// rejected) plus the compliance/payout hooks right below it. Everything
// funnels through buildNotification() so the copy lives in one place.

async function createVendorNotification(vendorId, type, context) {
    const built = buildNotification(type, context);
    if (!built) return null;
    const result = await pool.query(
        `INSERT INTO vendor_notifications (vendor_id, type, title, message, link_tab)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [vendorId, type, built.title, built.message, built.linkTab]
    );
    return result.rows[0];
}
exports.createVendorNotification = createVendorNotification;

exports.getMyVendorNotifications = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `SELECT id, type, title, message, link_tab, read_at, created_at
             FROM vendor_notifications WHERE vendor_id = $1
             ORDER BY created_at DESC LIMIT 100`,
            [vendorRow.rows[0].id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getMyVendorNotificationsUnreadCount = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `SELECT COUNT(*)::int AS n FROM vendor_notifications WHERE vendor_id = $1 AND read_at IS NULL`,
            [vendorRow.rows[0].id]
        );
        res.json({ unread: result.rows[0].n });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.markVendorNotificationRead = async (req, res) => {
    try {
        const { id } = req.params;
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `UPDATE vendor_notifications SET read_at = now()
             WHERE id = $1 AND vendor_id = $2 AND read_at IS NULL RETURNING id, read_at`,
            [id, vendorRow.rows[0].id]
        );
        res.json({ message: "Marked read.", notification: result.rows[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.markAllVendorNotificationsRead = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `UPDATE vendor_notifications SET read_at = now()
             WHERE vendor_id = $1 AND read_at IS NULL RETURNING id`,
            [vendorRow.rows[0].id]
        );
        res.json({ message: `${result.rows.length} notification(s) marked read.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor Reports (Task #65) -------------------------------------------
// Basic sales/orders/payouts reporting, fixed to the last 30 days - no
// custom date-range picker in this pass (admin's analytics/performance
// tabs already have one; this is deliberately simpler).

exports.getVendorReports = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const [dailyRes, topProductsRes, statusRes, payoutsRes] = await Promise.all([
            pool.query(
                `SELECT o.created_at::date AS day,
                        COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE o.status = 'delivered'), 0) AS sales,
                        COUNT(DISTINCT o.id) FILTER (WHERE o.status != 'cancelled') AS orders
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1 AND o.created_at >= now() - INTERVAL '30 days'
                 GROUP BY o.created_at::date
                 ORDER BY day ASC`,
                [vendorId]
            ),
            pool.query(
                `SELECT p.id, p.name, COUNT(*) AS units_sold,
                        COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1 AND o.status = 'delivered' AND o.created_at >= now() - INTERVAL '30 days'
                 GROUP BY p.id, p.name
                 ORDER BY revenue DESC
                 LIMIT 5`,
                [vendorId]
            ),
            pool.query(
                `SELECT o.status, COUNT(DISTINCT o.id) AS n
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1 AND o.created_at >= now() - INTERVAL '30 days'
                 GROUP BY o.status`,
                [vendorId]
            ),
            pool.query(
                `SELECT status, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
                 FROM vendor_payouts WHERE vendor_id = $1 AND requested_at >= now() - INTERVAL '30 days'
                 GROUP BY status`,
                [vendorId]
            )
        ]);

        res.json({
            rangeDays: 30,
            dailySales: dailyRes.rows.map(r => ({ day: r.day, sales: Number(r.sales), orders: Number(r.orders) })),
            topProducts: topProductsRes.rows.map(r => ({ id: r.id, name: r.name, unitsSold: Number(r.units_sold), revenue: Number(r.revenue) })),
            orderStatusBreakdown: statusRes.rows.map(r => ({ status: r.status, count: Number(r.n) })),
            payoutSummary: payoutsRes.rows.map(r => ({ status: r.status, count: Number(r.n), total: Number(r.total) }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor-to-Admin Messaging (Task #71) ---------------------------------
// A minimal ticket/thread channel so a vendor can reach admin outside the
// specific structured flows that already exist (return responses,
// compliance notices, promotion proposals). See PENDING.md for the design
// notes - one open thread per issue, status is admin-managed triage, and
// the vendor's existing notification bell (not a second unread system)
// is what tells them an admin reply landed.

// The vendor's own list of threads, most recently active first.
exports.getMyVendorMessages = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const result = await pool.query(
            `SELECT vm.id, vm.subject, vm.status, vm.created_at, vm.updated_at,
                    (SELECT COUNT(*) FROM vendor_message_replies r WHERE r.vendor_message_id = vm.id)::int AS reply_count
             FROM vendor_messages vm
             WHERE vm.vendor_id = $1
             ORDER BY vm.updated_at DESC`,
            [vendorRow.rows[0].id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// One of the vendor's own threads, with its full reply history.
exports.getMyVendorMessageThread = async (req, res) => {
    try {
        const { id } = req.params;
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const threadRes = await pool.query(
            `SELECT id, subject, status, created_at, updated_at FROM vendor_messages WHERE id = $1 AND vendor_id = $2`,
            [id, vendorRow.rows[0].id]
        );
        if (threadRes.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        const repliesRes = await pool.query(
            `SELECT id, sender_role, body, created_at FROM vendor_message_replies
             WHERE vendor_message_id = $1 ORDER BY created_at ASC`,
            [id]
        );
        res.json({ thread: threadRes.rows[0], replies: repliesRes.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A vendor opens a new thread - a subject plus the first message, created
// together so a thread never exists without at least one reply in it.
exports.createVendorMessage = async (req, res) => {
    try {
        const { subject, body } = req.body;
        if (!isValidMessageSubject(subject)) {
            return res.status(400).json({ error: `Subject is required and must be ${MAX_SUBJECT_LENGTH} characters or fewer.` });
        }
        if (!isValidMessageBody(body)) {
            return res.status(400).json({ error: `Message is required and must be ${MAX_BODY_LENGTH} characters or fewer.` });
        }
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const threadRes = await pool.query(
            `INSERT INTO vendor_messages (vendor_id, subject) VALUES ($1, $2) RETURNING *`,
            [vendorId, subject.trim()]
        );
        const thread = threadRes.rows[0];
        const replyRes = await pool.query(
            `INSERT INTO vendor_message_replies (vendor_message_id, sender_role, body) VALUES ($1, 'vendor', $2) RETURNING *`,
            [thread.id, body.trim()]
        );
        res.json({ message: "Message sent.", thread, reply: replyRes.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// A vendor replies to one of their own threads. Reopens it automatically
// if it was resolved (deriveStatusAfterReply) - a vendor following up on
// a closed thread means it isn't actually closed.
exports.replyToVendorMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { body } = req.body;
        if (!isValidMessageBody(body)) {
            return res.status(400).json({ error: `Message is required and must be ${MAX_BODY_LENGTH} characters or fewer.` });
        }
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const threadRes = await pool.query(
            `SELECT id, status FROM vendor_messages WHERE id = $1 AND vendor_id = $2`,
            [id, vendorRow.rows[0].id]
        );
        if (threadRes.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        const newStatus = deriveStatusAfterReply(threadRes.rows[0].status, "vendor");
        await pool.query(
            `UPDATE vendor_messages SET status = $1, updated_at = now() WHERE id = $2`,
            [newStatus, id]
        );
        const replyRes = await pool.query(
            `INSERT INTO vendor_message_replies (vendor_message_id, sender_role, body) VALUES ($1, 'vendor', $2) RETURNING *`,
            [id, body.trim()]
        );
        res.json({ message: "Reply sent.", reply: replyRes.rows[0], status: newStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Support/admin's merged inbox across every vendor (Task #76 - vendors
// route to customer_support by default, admin sees the same inbox via
// requireSupportOrAdmin). Open threads by default; ?view=escalated shows
// threads a support agent flagged for admin regardless of status,
// ?view=resolved the resolved ones. Most recently active first (escalated
// view sorts by escalation time instead, so the newest flag is on top).
exports.getVendorMessagesAdmin = async (req, res) => {
    try {
        const view = isValidMessageAdminView(req.query.view) ? req.query.view : "open";
        let whereClause = "vm.status = 'open'";
        let orderClause = "vm.updated_at DESC";
        if (view === "resolved") {
            whereClause = "vm.status = 'resolved'";
        } else if (view === "escalated") {
            whereClause = "vm.escalated_at IS NOT NULL";
            orderClause = "vm.escalated_at DESC";
        }
        const result = await pool.query(
            `SELECT vm.id, vm.subject, vm.status, vm.escalated_at, vm.created_at, vm.updated_at,
                    v.id AS vendor_id, v.business_name AS vendor_business_name,
                    (SELECT COUNT(*) FROM vendor_message_replies r WHERE r.vendor_message_id = vm.id)::int AS reply_count
             FROM vendor_messages vm
             JOIN vendors v ON v.id = vm.vendor_id
             WHERE ${whereClause}
             ORDER BY ${orderClause}`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Any vendor's thread, with its full reply history - admin can view
// across vendors, unlike getMyVendorMessageThread's own-vendor scoping.
exports.getVendorMessageThreadAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const threadRes = await pool.query(
            `SELECT vm.id, vm.subject, vm.status, vm.escalated_at, vm.created_at, vm.updated_at,
                    v.id AS vendor_id, v.business_name AS vendor_business_name
             FROM vendor_messages vm
             JOIN vendors v ON v.id = vm.vendor_id
             WHERE vm.id = $1`,
            [id]
        );
        if (threadRes.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        const repliesRes = await pool.query(
            `SELECT id, sender_role, body, created_at FROM vendor_message_replies
             WHERE vendor_message_id = $1 ORDER BY created_at ASC`,
            [id]
        );
        res.json({ thread: threadRes.rows[0], replies: repliesRes.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin replies to a vendor's thread. Never changes status on its own
// (deriveStatusAfterReply) - resolving/reopening is a separate, explicit
// action below - and pings the vendor's notification bell so they know
// to check their Messages tab.
exports.replyToVendorMessageAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { body } = req.body;
        if (!isValidMessageBody(body)) {
            return res.status(400).json({ error: `Message is required and must be ${MAX_BODY_LENGTH} characters or fewer.` });
        }
        const threadRes = await pool.query(
            `SELECT id, vendor_id, subject, status FROM vendor_messages WHERE id = $1`,
            [id]
        );
        if (threadRes.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        const thread = threadRes.rows[0];
        const newStatus = deriveStatusAfterReply(thread.status, "admin");
        await pool.query(
            `UPDATE vendor_messages SET status = $1, updated_at = now() WHERE id = $2`,
            [newStatus, id]
        );
        const replyRes = await pool.query(
            `INSERT INTO vendor_message_replies (vendor_message_id, sender_role, sender_user_id, body)
             VALUES ($1, 'admin', $2, $3) RETURNING *`,
            [id, req.user.userId, body.trim()]
        );
        await createVendorNotification(thread.vendor_id, "admin_message", { subject: thread.subject });
        res.json({ message: "Reply sent.", reply: replyRes.rows[0], status: newStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.resolveVendorMessageAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE vendor_messages SET status = 'resolved', updated_at = now() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        res.json({ message: "Thread marked resolved.", thread: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reopenVendorMessageAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE vendor_messages SET status = 'open', updated_at = now() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        res.json({ message: "Thread reopened.", thread: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Escalation (Task #76) - a support agent (or admin) flags a thread for
// admin attention. Purely a flag, not a reassignment: the thread stays in
// the same shared inbox, escalated_at just makes it show up in the
// Escalated view for whoever is watching. Doesn't touch status - an
// escalated thread can still be open or resolved.
exports.escalateVendorMessageAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE vendor_messages SET escalated_at = now() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        res.json({ message: "Thread escalated to admin.", thread: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.unescalateVendorMessageAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE vendor_messages SET escalated_at = NULL WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Message thread not found." });
        }
        res.json({ message: "Thread un-escalated.", thread: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
