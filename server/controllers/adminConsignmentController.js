// Fulfillment-by-Lizimas: admin-side receiving flow (Vendor Center
// comparison, Sept 2026 - see migrations/110_vendor_consignments.sql).
// This is where products.consigned_stock/fulfillment_type actually change -
// a vendor's request alone never touches stock.

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { createVendorNotification } = require("./vendorController");

exports.listConsignmentsAdmin = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [];
        let where = "";
        if (status) {
            params.push(status);
            where = `WHERE c.status = $${params.length}`;
        }

        const { rows: consignments } = await pool.query(
            `SELECT c.*, v.business_name AS vendor_business_name,
                    dp.name AS dropoff_point_name, dp.address AS dropoff_point_address
             FROM vendor_consignments c
             JOIN vendors v ON v.id = c.vendor_id
             JOIN dropoff_points dp ON dp.id = c.dropoff_point_id
             ${where}
             ORDER BY c.created_at DESC`,
            params
        );
        if (consignments.length === 0) return res.json([]);

        const ids = consignments.map((c) => c.id);
        const { rows: items } = await pool.query(
            `SELECT ci.*, p.name AS product_name, p.sku AS product_sku, p.lizimas_sku AS product_lizimas_sku
             FROM vendor_consignment_items ci
             JOIN products p ON p.id = ci.product_id
             WHERE ci.consignment_id = ANY($1::int[])
             ORDER BY ci.id ASC`,
            [ids]
        );
        const itemsByConsignment = new Map();
        for (const item of items) {
            if (!itemsByConsignment.has(item.consignment_id)) itemsByConsignment.set(item.consignment_id, []);
            itemsByConsignment.get(item.consignment_id).push(item);
        }

        res.json(consignments.map((c) => ({ ...c, items: itemsByConsignment.get(c.id) || [] })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin counts the shipment in: a quantity_received per line (can differ
// from what the vendor requested - short shipments, damaged units, etc.).
// Each item's quantity_received is ADDED to that product's consigned_stock,
// and the product flips to fulfillment_type='lizimas_fulfilled' the first
// time any stock is actually counted in for it. The consignment as a whole
// is 'received' if every line got its full requested quantity, otherwise
// 'partially_received'.
exports.receiveConsignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { items, admin_notes } = req.body; // items: [{ item_id, quantity_received }]
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "items (with quantity_received per line) is required." });
        }

        const consignmentRow = await pool.query(
            "SELECT * FROM vendor_consignments WHERE id = $1",
            [id]
        );
        if (consignmentRow.rows.length === 0) return res.status(404).json({ error: "Consignment not found." });
        const consignment = consignmentRow.rows[0];
        if (!["requested", "in_transit"].includes(consignment.status)) {
            return res.status(400).json({ error: `Can't receive a consignment that's already "${consignment.status}".` });
        }

        const { rows: existingItems } = await pool.query(
            "SELECT * FROM vendor_consignment_items WHERE consignment_id = $1",
            [id]
        );
        const itemById = new Map(existingItems.map((i) => [i.id, i]));

        for (const raw of items) {
            const item = itemById.get(Number(raw.item_id));
            if (!item) return res.status(400).json({ error: `Line item ${raw.item_id} does not belong to this consignment.` });
            const qty = Number(raw.quantity_received);
            if (isNaN(qty) || qty < 0) return res.status(400).json({ error: `quantity_received for item ${raw.item_id} must be a non-negative number.` });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            let fullyReceived = true;
            for (const raw of items) {
                const item = itemById.get(Number(raw.item_id));
                const qty = Number(raw.quantity_received);
                if (qty < item.quantity_requested) fullyReceived = false;

                await client.query(
                    "UPDATE vendor_consignment_items SET quantity_received = $1, updated_at = now() WHERE id = $2",
                    [qty, item.id]
                );
                if (qty > 0) {
                    await client.query(
                        `UPDATE products SET consigned_stock = consigned_stock + $1,
                                fulfillment_type = 'lizimas_fulfilled'
                         WHERE id = $2`,
                        [qty, item.product_id]
                    );
                }
            }

            const newStatus = fullyReceived ? "received" : "partially_received";
            const updated = await client.query(
                `UPDATE vendor_consignments
                 SET status = $1, admin_notes = COALESCE($2, admin_notes), reviewed_by = $3, received_at = now(), updated_at = now()
                 WHERE id = $4 RETURNING *`,
                [newStatus, admin_notes || null, req.user.userId, id]
            );

            await client.query("COMMIT");

            logActivity(req.user.userId, "received_consignment", "vendor_consignment", Number(id), `Marked ${newStatus}`);
            createVendorNotification(consignment.vendor_id, "consignment_status", {
                consignmentId: id,
                status: newStatus
            }).catch(() => {});

            res.json({ message: `Consignment marked ${newStatus}.`, consignment: updated.rows[0] });
        } catch (txError) {
            await client.query("ROLLBACK");
            throw txError;
        } finally {
            client.release();
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.rejectConsignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_notes } = req.body;

        const existing = await pool.query("SELECT * FROM vendor_consignments WHERE id = $1", [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Consignment not found." });
        if (!["requested", "in_transit"].includes(existing.rows[0].status)) {
            return res.status(400).json({ error: `Can't reject a consignment that's already "${existing.rows[0].status}".` });
        }

        const result = await pool.query(
            `UPDATE vendor_consignments SET status = 'rejected', admin_notes = $1, reviewed_by = $2, updated_at = now()
             WHERE id = $3 RETURNING *`,
            [admin_notes || null, req.user.userId, id]
        );

        logActivity(req.user.userId, "rejected_consignment", "vendor_consignment", Number(id), admin_notes || "");
        createVendorNotification(existing.rows[0].vendor_id, "consignment_status", {
            consignmentId: id,
            status: "rejected",
            note: admin_notes
        }).catch(() => {});

        res.json({ message: "Consignment rejected.", consignment: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
