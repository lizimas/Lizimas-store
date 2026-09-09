const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { uploadBuffer } = require("../utils/cloudinaryUpload");
const { canRecordRefundDecision } = require("../utils/vendorReturns");

// --- Drop-off points (admin-managed) ---------------------------------

exports.listDropoffPoints = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, address, is_hub, is_active, created_at
             FROM dropoff_points ORDER BY is_hub ASC, name ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Active-only, minimal fields: what a vendor needs to pick a location at handover.
exports.listActiveDropoffPoints = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, address, is_hub FROM dropoff_points
             WHERE is_active = true ORDER BY is_hub ASC, name ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createDropoffPoint = async (req, res) => {
    try {
        const { name, address, is_hub } = req.body;
        if (!name || !address) {
            return res.status(400).json({ error: "Name and address are required." });
        }
        const result = await pool.query(
            `INSERT INTO dropoff_points (name, address, is_hub) VALUES ($1, $2, $3) RETURNING *`,
            [name, address, !!is_hub]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateDropoffPoint = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, is_hub, is_active } = req.body;
        const result = await pool.query(
            `UPDATE dropoff_points
             SET name = COALESCE($1, name),
                 address = COALESCE($2, address),
                 is_hub = COALESCE($3, is_hub),
                 is_active = COALESCE($4, is_active)
             WHERE id = $5 RETURNING *`,
            [name || null, address || null, is_hub === undefined ? null : !!is_hub,
                is_active === undefined ? null : !!is_active, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Drop-off point not found." });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor side: handover and returns collection --------------------

async function resolveVendorId(userId) {
    const row = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [userId]);
    return row.rows.length ? row.rows[0].id : null;
}

// Vendor marks a line item as physically handed over to a drop-off point.
// Only the owning vendor can do this, and only from a state where handover
// is meaningful (freshly ordered, or re-preparing after a rejection).
exports.vendorMarkHandedOver = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { dropoff_point_id } = req.body;

        if (!dropoff_point_id) {
            return res.status(400).json({ error: "dropoff_point_id is required." });
        }

        const vendorId = await resolveVendorId(req.user.userId);
        if (!vendorId) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }

        const itemRow = await pool.query(
            `SELECT oi.id, oi.handover_status, oi.vendor_fulfilment_stage, p.vendor_id
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
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
        if (!["pending_handover", "rejected"].includes(item.handover_status)) {
            return res.status(409).json({
                error: `Item cannot be handed over from its current state (${item.handover_status}).`
            });
        }
        // The vendor must have walked the item through New -> Accepted ->
        // Processing -> Ready for Handover (Task #59) before handing it over -
        // see utils/vendorOrderStage.js and PATCH /order-items/:id/stage.
        if ((item.vendor_fulfilment_stage || "new") !== "ready_for_handover") {
            return res.status(409).json({
                error: "Mark this item Ready for Handover in your Orders tab before handing it over."
            });
        }

        const result = await pool.query(
            `UPDATE order_items
             SET handover_status = 'handed_over', dropoff_point_id = $1, handed_over_at = now(),
                 inspected_by = NULL, inspected_at = NULL, rejection_reason = NULL
             WHERE id = $2 RETURNING *`,
            [dropoff_point_id, orderItemId]
        );

        res.json({ message: "Marked as handed over. Lizimas Store will inspect it at the drop-off point.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor's items currently out for return collection, with the 21-day window.
exports.getMyReturns = async (req, res) => {
    try {
        const vendorId = await resolveVendorId(req.user.userId);
        if (!vendorId) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }

        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.product_id, p.name AS product_name,
                    oi.quantity, oi.return_reason, oi.returned_at, oi.collection_deadline,
                    dp.name AS dropoff_point_name, dp.address AS dropoff_point_address,
                    (oi.returned_at + INTERVAL '7 days' <= now()) AS moved_to_hub,
                    (oi.collection_deadline <= now()) AS overdue
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN dropoff_points dp ON dp.id = oi.dropoff_point_id
             WHERE p.vendor_id = $1 AND oi.handover_status = 'returned_for_collection'
             ORDER BY oi.returned_at ASC`,
            [vendorId]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin side: inspection and returns management --------------------

exports.getPendingHandovers = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, oi.handed_over_at,
                    p.name AS product_name, v.business_name AS vendor_business_name,
                    dp.name AS dropoff_point_name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN vendors v ON v.id = p.vendor_id
             LEFT JOIN dropoff_points dp ON dp.id = oi.dropoff_point_id
             WHERE oi.handover_status = 'handed_over'
             ORDER BY oi.handed_over_at ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.acceptHandover = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const result = await pool.query(
            `UPDATE order_items
             SET handover_status = 'accepted', inspected_by = $1, inspected_at = now()
             WHERE id = $2 AND handover_status = 'handed_over' RETURNING *`,
            [req.user.userId, orderItemId]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Item is not awaiting inspection." });
        }
        res.json({ message: "Handover accepted. Lizimas Store now owns delivery for this item.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.rejectHandover = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ error: "A rejection reason is required." });
        }
        const result = await pool.query(
            `UPDATE order_items
             SET handover_status = 'rejected', inspected_by = $1, inspected_at = now(), rejection_reason = $2,
                 vendor_fulfilment_stage = 'new'
             WHERE id = $3 AND handover_status = 'handed_over' RETURNING *`,
            [req.user.userId, reason, orderItemId]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Item is not awaiting inspection." });
        }
        res.json({ message: "Handover rejected.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Failed delivery or customer return: opens the vendor's 21-day collection
// window (7 days at the original drop-off point, 14 more at the hub).
exports.markReturned = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { return_reason } = req.body;
        const allowedReasons = ["failed_delivery", "customer_return", "damaged", "defective", "expired"];
        if (!allowedReasons.includes(return_reason)) {
            return res.status(400).json({ error: `return_reason must be one of: ${allowedReasons.join(", ")}` });
        }
        const result = await pool.query(
            `UPDATE order_items
             SET handover_status = 'returned_for_collection', return_reason = $1,
                 returned_at = now(), collection_deadline = now() + INTERVAL '21 days'
             WHERE id = $2 AND handover_status = 'accepted' RETURNING *`,
            [return_reason, orderItemId]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Only an accepted item can be marked returned." });
        }
        res.json({ message: "Item marked returned. Vendor has 21 days to collect it.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getPendingReturns = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, oi.return_reason,
                    oi.returned_at, oi.collection_deadline,
                    p.name AS product_name, v.business_name AS vendor_business_name,
                    dp.name AS dropoff_point_name,
                    (oi.returned_at + INTERVAL '7 days' <= now()) AS moved_to_hub,
                    (oi.collection_deadline <= now()) AS overdue
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN vendors v ON v.id = p.vendor_id
             LEFT JOIN dropoff_points dp ON dp.id = oi.dropoff_point_id
             WHERE oi.handover_status = 'returned_for_collection'
             ORDER BY oi.collection_deadline ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.markCollected = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const result = await pool.query(
            `UPDATE order_items
             SET handover_status = 'collected', collected_at = now()
             WHERE id = $1 AND handover_status = 'returned_for_collection' RETURNING *`,
            [orderItemId]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Item is not awaiting collection." });
        }
        res.json({ message: "Marked collected by vendor.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Only past the 21-day window - enforced here, not just by the dashboard
// hiding a button, so forfeiture can't be applied early by mistake.
exports.markForfeited = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const result = await pool.query(
            `UPDATE order_items
             SET handover_status = 'forfeited', forfeited_at = now()
             WHERE id = $1 AND handover_status = 'returned_for_collection'
               AND collection_deadline <= now() RETURNING *`,
            [orderItemId]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Item is not yet eligible for forfeiture." });
        }
        res.json({ message: "Item forfeited.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Returns & Refunds Center (Task #62) --------------------------------
//
// The physical side (getPendingReturns/markCollected/markForfeited above)
// tracks getting an item back from the customer. These cover the
// financial/decision side that was missing entirely: an evidence photo,
// Lizimas' approve/deny call on refunding the customer, and the recorded
// amount. refund_amount is a RECORDED figure - what Lizimas actually
// refunded the customer via the payment gateway/MoMo dashboard - not an
// automatic gateway refund call, same manual-confirmation pattern as
// vendor payouts.

// Every return awaiting a refund decision, oldest first.
exports.getReturnsAwaitingRefundDecision = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, oi.price,
                    oi.return_reason, oi.returned_at, oi.return_evidence_image,
                    oi.vendor_response, oi.vendor_responded_at,
                    p.name AS product_name, v.business_name AS vendor_business_name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN vendors v ON v.id = p.vendor_id
             WHERE oi.return_reason IS NOT NULL AND oi.refund_decision IS NULL
             ORDER BY oi.returned_at ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Already-decided returns, most recent first - a resolution history.
exports.getReturnsRefundHistory = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.quantity, oi.price,
                    oi.return_reason, oi.returned_at, oi.return_evidence_image,
                    oi.refund_decision, oi.refund_amount, oi.refund_notes, oi.refund_decided_at,
                    oi.vendor_response, oi.vendor_responded_at,
                    p.name AS product_name, v.business_name AS vendor_business_name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             LEFT JOIN vendors v ON v.id = p.vendor_id
             WHERE oi.refund_decision IS NOT NULL
             ORDER BY oi.refund_decided_at DESC
             LIMIT 200`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin attaches a photo of the returned item's condition - separate from
// the decision itself, so evidence can be added as soon as the item is
// inspected, before Lizimas has decided anything.
exports.uploadReturnEvidence = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }
        const { orderItemId } = req.params;
        const existing = await pool.query(
            `SELECT id FROM order_items WHERE id = $1 AND return_reason IS NOT NULL`,
            [orderItemId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "No recorded return for this item." });
        }

        const uploaded = await uploadBuffer(req.file.buffer, "lizimas-store/returns");
        const result = await pool.query(
            `UPDATE order_items SET return_evidence_image = $1 WHERE id = $2 RETURNING id, return_evidence_image`,
            [uploaded.url, orderItemId]
        );
        res.json({ message: "Evidence photo saved.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lizimas approves refunding the customer. The decision is final once
// made (canRecordRefundDecision) - Lizimas/admin retains final authority,
// and a genuine after-the-fact correction should go through the vendor's
// manual ledger adjustment, not a second call here.
exports.approveReturnRefund = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { amount, notes } = req.body;
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: "amount must be a positive number." });
        }

        const current = await pool.query(
            `SELECT return_reason, refund_decision FROM order_items WHERE id = $1`,
            [orderItemId]
        );
        if (current.rows.length === 0 || !current.rows[0].return_reason) {
            return res.status(404).json({ error: "No recorded return for this item." });
        }
        const eligibility = canRecordRefundDecision(current.rows[0].refund_decision);
        if (!eligibility.allowed) {
            return res.status(409).json({ error: eligibility.reason });
        }

        const result = await pool.query(
            `UPDATE order_items
             SET refund_decision = 'approved', refund_amount = $1, refund_notes = $2,
                 refund_decided_at = now(), refund_decided_by = $3
             WHERE id = $4 RETURNING *`,
            [numericAmount, notes || null, req.user.userId, orderItemId]
        );
        logActivity(req.user.userId, "return_refund_approved", "order_item", orderItemId,
            `UGX ${numericAmount.toLocaleString()} approved`);
        res.json({ message: "Refund approved.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lizimas decides against refunding the customer for this item.
exports.denyReturnRefund = async (req, res) => {
    try {
        const { orderItemId } = req.params;
        const { notes } = req.body;
        if (!notes || !String(notes).trim()) {
            return res.status(400).json({ error: "notes explaining the denial is required." });
        }

        const current = await pool.query(
            `SELECT return_reason, refund_decision FROM order_items WHERE id = $1`,
            [orderItemId]
        );
        if (current.rows.length === 0 || !current.rows[0].return_reason) {
            return res.status(404).json({ error: "No recorded return for this item." });
        }
        const eligibility = canRecordRefundDecision(current.rows[0].refund_decision);
        if (!eligibility.allowed) {
            return res.status(409).json({ error: eligibility.reason });
        }

        const result = await pool.query(
            `UPDATE order_items
             SET refund_decision = 'denied', refund_notes = $1,
                 refund_decided_at = now(), refund_decided_by = $2
             WHERE id = $3 RETURNING *`,
            [notes, req.user.userId, orderItemId]
        );
        logActivity(req.user.userId, "return_refund_denied", "order_item", orderItemId, notes);
        res.json({ message: "Refund denied.", item: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
