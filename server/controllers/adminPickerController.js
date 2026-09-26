// Manage Pickers (Sept 2026) - admin-side
// lookup for the hub desk: search a vendor's registered pickers by name or
// phone to verify someone claiming to hand over a package on a vendor's
// behalf. Read-only - only the vendor owner can add/edit/remove pickers
// (see vendorPickerController.js).

const pool = require("../config/database");

exports.searchPickersAdmin = async (req, res) => {
    try {
        const { q, vendorId } = req.query;
        const conditions = [];
        const params = [];

        if (vendorId) {
            params.push(vendorId);
            conditions.push(`vp.vendor_id = $${params.length}`);
        }
        if (q && q.trim()) {
            params.push(`%${q.trim()}%`);
            const idx = params.length;
            conditions.push(`(vp.full_name ILIKE $${idx} OR vp.phone ILIKE $${idx})`);
        }

        if (conditions.length === 0) {
            return res.status(400).json({ error: "Provide a search term (q) or a vendorId to look up." });
        }

        const { rows } = await pool.query(
            `SELECT vp.*, v.business_name AS vendor_business_name
             FROM vendor_pickers vp
             JOIN vendors v ON v.id = vp.vendor_id
             WHERE ${conditions.join(" AND ")}
             ORDER BY vp.is_active DESC, vp.full_name ASC
             LIMIT 50`,
            params
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
