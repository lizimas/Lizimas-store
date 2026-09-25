// Fulfillment-by-Lizimas: vendor-side request flow (Jumia Vendor Center
// comparison, September 2026 - see migrations/110_vendor_consignments.sql's
// header for the full design and what is deliberately NOT built here yet).

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");

// The vendor's own consignments, most recent first, each with its items.
exports.listMyConsignments = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { rows: consignments } = await pool.query(
            `SELECT c.*, dp.name AS dropoff_point_name, dp.address AS dropoff_point_address,
                    u.name AS requested_by_name
             FROM vendor_consignments c
             JOIN dropoff_points dp ON dp.id = c.dropoff_point_id
             LEFT JOIN vendors v ON v.id = c.vendor_id
             LEFT JOIN users u ON u.id = v.user_id
             WHERE c.vendor_id = $1
             ORDER BY c.created_at DESC`,
            [vendorId]
        );
        if (consignments.length === 0) return res.json([]);

        const ids = consignments.map((c) => c.id);
        const { rows: items } = await pool.query(
            `SELECT ci.*, p.name AS product_name, p.sku AS product_sku,
                    p.lizimas_sku AS product_lizimas_sku, p.price AS product_price
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

// Vendor requests a new consignment: a hub to ship to, plus product/quantity
// lines from their own catalogue. Doesn't touch stock/fulfillment_type yet -
// that only happens once admin actually counts the shipment in (see
// adminConsignmentController.js's receiveConsignment).
exports.createConsignment = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { dropoff_point_id, vendor_notes, items } = req.body;
        if (!dropoff_point_id) {
            return res.status(400).json({ error: "dropoff_point_id is required." });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "At least one product/quantity line is required." });
        }

        const hubRow = await pool.query(
            "SELECT id, is_hub FROM dropoff_points WHERE id = $1 AND is_active = true",
            [dropoff_point_id]
        );
        if (hubRow.rows.length === 0) {
            return res.status(400).json({ error: "That drop-off point isn't available." });
        }
        if (!hubRow.rows[0].is_hub) {
            return res.status(400).json({ error: "Consignments can only be shipped to a central hub, not a regular drop-off point." });
        }

        const cleanedItems = [];
        for (const raw of items) {
            const productId = Number(raw.product_id);
            const quantity = Number(raw.quantity);
            if (!productId || !quantity || quantity <= 0) {
                return res.status(400).json({ error: "Each line needs a valid product_id and a positive quantity." });
            }
            cleanedItems.push({ productId, quantity });
        }

        const productIds = cleanedItems.map((i) => i.productId);
        const { rows: ownProducts } = await pool.query(
            `SELECT id FROM products WHERE id = ANY($1::int[]) AND vendor_id = $2 AND deleted_at IS NULL`,
            [productIds, vendorId]
        );
        const ownedIds = new Set(ownProducts.map((r) => r.id));
        const notOwned = productIds.filter((id) => !ownedIds.has(id));
        if (notOwned.length > 0) {
            return res.status(403).json({ error: `Product id(s) ${notOwned.join(", ")} don't belong to your account.` });
        }

        const client = await pool.connect();
        let consignment;
        try {
            await client.query("BEGIN");
            const consignmentResult = await client.query(
                `INSERT INTO vendor_consignments (vendor_id, dropoff_point_id, vendor_notes)
                 VALUES ($1, $2, $3) RETURNING *`,
                [vendorId, dropoff_point_id, vendor_notes || null]
            );
            consignment = consignmentResult.rows[0];

            for (const item of cleanedItems) {
                await client.query(
                    `INSERT INTO vendor_consignment_items (consignment_id, product_id, quantity_requested)
                     VALUES ($1, $2, $3)`,
                    [consignment.id, item.productId, item.quantity]
                );
            }
            await client.query("COMMIT");
        } catch (txError) {
            await client.query("ROLLBACK");
            throw txError;
        } finally {
            client.release();
        }

        logActivity(req.user.userId, "created_consignment", "vendor_consignment", consignment.id,
            `Requested consignment of ${cleanedItems.length} product line(s) to drop-off point #${dropoff_point_id}`);

        res.status(201).json({ message: "Consignment requested.", consignment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor marks a still-in-their-hands consignment as physically shipped.
exports.markConsignmentInTransit = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query(
            "SELECT id, status FROM vendor_consignments WHERE id = $1 AND vendor_id = $2",
            [id, vendorId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: "Consignment not found." });
        if (existing.rows[0].status !== "requested") {
            return res.status(400).json({ error: `Can't mark as shipped from status "${existing.rows[0].status}".` });
        }

        const result = await pool.query(
            "UPDATE vendor_consignments SET status = 'in_transit', updated_at = now() WHERE id = $1 RETURNING *",
            [id]
        );
        res.json({ message: "Marked as shipped.", consignment: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor cancels a request before it's shipped or received.
exports.cancelConsignment = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query(
            "SELECT id, status FROM vendor_consignments WHERE id = $1 AND vendor_id = $2",
            [id, vendorId]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: "Consignment not found." });
        if (!["requested", "in_transit"].includes(existing.rows[0].status)) {
            return res.status(400).json({ error: `Can't cancel a consignment that's already "${existing.rows[0].status}".` });
        }

        const result = await pool.query(
            "UPDATE vendor_consignments SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *",
            [id]
        );
        res.json({ message: "Consignment cancelled.", consignment: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
