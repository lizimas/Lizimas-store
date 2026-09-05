const pool = require("../config/database");

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

// Order line items belonging to this vendor's products. An order can mix
// items from several vendors (and staff-added products), so this returns
// only the rows that are actually this vendor's, not whole orders.
//
// Deliberately excludes customer name/phone/delivery address: per the Vendor
// Data Protection Policy, a vendor's fulfilment role ends at handover to
// Lizimas Store, which owns the customer delivery step from there. A vendor
// only needs to know what to prepare and how many, not who it's going to.
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
                    oi.dropoff_point_id, dp.name AS dropoff_point_name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN dropoff_points dp ON dp.id = oi.dropoff_point_id
             WHERE p.vendor_id = $1
             ORDER BY o.created_at DESC`,
            [vendorId]
        );

        res.json(result.rows);
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
