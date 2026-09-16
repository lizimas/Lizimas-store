// Manage Pickers (Jumia Vendor Center comparison, Sept 2026) - vendor-side
// CRUD for the people authorized to hand over packages on their behalf.
// See migrations/111_vendor_pickers.sql for what this is (and isn't).

const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");

exports.listMyPickers = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { rows } = await pool.query(
            `SELECT * FROM vendor_pickers WHERE vendor_id = $1 ORDER BY is_active DESC, full_name ASC`,
            [vendorId]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createMyPicker = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { full_name, phone, id_number } = req.body;
        if (!full_name || !full_name.trim()) return res.status(400).json({ error: "Full name is required." });
        if (!phone || !phone.trim()) return res.status(400).json({ error: "Phone number is required." });

        const result = await pool.query(
            `INSERT INTO vendor_pickers (vendor_id, full_name, phone, id_number, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [vendorId, full_name.trim(), phone.trim(), (id_number || "").trim() || null, req.user.userId]
        );

        logActivity(req.user.userId, "created_picker", "vendor_picker", result.rows[0].id, `Added picker "${full_name.trim()}"`);
        res.status(201).json({ message: "Picker added.", picker: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateMyPicker = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const { full_name, phone, id_number } = req.body;
        if (!full_name || !full_name.trim()) return res.status(400).json({ error: "Full name is required." });
        if (!phone || !phone.trim()) return res.status(400).json({ error: "Phone number is required." });

        const existing = await pool.query("SELECT id FROM vendor_pickers WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Picker not found." });

        const result = await pool.query(
            `UPDATE vendor_pickers SET full_name = $1, phone = $2, id_number = $3, updated_at = now()
             WHERE id = $4 RETURNING *`,
            [full_name.trim(), phone.trim(), (id_number || "").trim() || null, id]
        );
        res.json({ message: "Picker updated.", picker: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.togglePickerActive = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const { is_active } = req.body;

        const existing = await pool.query("SELECT id FROM vendor_pickers WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Picker not found." });

        const result = await pool.query(
            "UPDATE vendor_pickers SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING *",
            [!!is_active, id]
        );
        res.json({ message: is_active ? "Picker re-enabled." : "Picker disabled.", picker: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteMyPicker = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query("SELECT id, full_name FROM vendor_pickers WHERE id = $1 AND vendor_id = $2", [id, vendorId]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Picker not found." });

        await pool.query("DELETE FROM vendor_pickers WHERE id = $1", [id]);
        logActivity(req.user.userId, "deleted_picker", "vendor_picker", Number(id), `Removed picker "${existing.rows[0].full_name}"`);
        res.json({ message: "Picker removed." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
