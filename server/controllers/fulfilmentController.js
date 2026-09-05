const pool = require("../config/database");

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
            `SELECT oi.id, oi.handover_status, p.vendor_id
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
             SET handover_status = 'rejected', inspected_by = $1, inspected_at = now(), rejection_reason = $2
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
