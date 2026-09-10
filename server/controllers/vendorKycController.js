// Vendor KYC & Compliance Profile (Ryan, Sept 2026 - modelled on Jumia's
// KYC/verification approach: identity/business-registration data kept
// separate from the normal vendor profile, encrypted at rest, reviewed
// through an explicit status workflow with an audit trail). See
// migrations/079_vendor_kyc.sql for the schema and why a hash column
// sits alongside each encrypted value, and server/utils/vendorKyc.js for
// the status-transition rules used here.
//
// This is deliberately a separate controller/table from vendorController's
// getMyVendorProfile/updateMyVendorProfile (which now only handle
// momo_number/physical_address) - vendors.national_id_number/
// registration_number are legacy/frozen columns as of this change, kept
// in place for rollback safety but no longer read or written by the app.
// See scripts/backfill-vendor-kyc.js for the one-time move of existing
// values into this encrypted table.

const pool = require("../config/database");
const { encryptField, decryptField, hashForLookup } = require("../utils/encryption");
const { isValidAdminKycTransition, canVendorEditKyc } = require("../utils/vendorKyc");
const { logActivity } = require("../utils/activityLog");

// --- Vendor-self ------------------------------------------------------------

// The vendor's own KYC status, and (if they have one on file) their
// current number decrypted just for themselves - never returned to
// anyone else, and never through any public-facing endpoint.
exports.getMyKyc = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, account_type FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];

        const kycRow = await pool.query(
            `SELECT kyc_status, identity_verified, business_verified, national_id_number_enc,
                    registration_number_enc, review_note, reviewed_at
             FROM vendor_kyc WHERE vendor_id = $1`,
            [vendor.id]
        );

        if (kycRow.rows.length === 0) {
            return res.json({
                kyc_status: "not_started",
                identity_verified: false,
                business_verified: false,
                account_type: vendor.account_type,
                national_id_number: null,
                registration_number: null,
                review_note: null,
                reviewed_at: null,
                editable: true
            });
        }

        const kyc = kycRow.rows[0];
        res.json({
            kyc_status: kyc.kyc_status,
            identity_verified: kyc.identity_verified,
            business_verified: kyc.business_verified,
            account_type: vendor.account_type,
            national_id_number: decryptField(kyc.national_id_number_enc),
            registration_number: decryptField(kyc.registration_number_enc),
            review_note: kyc.review_note,
            reviewed_at: kyc.reviewed_at,
            editable: canVendorEditKyc(kyc.kyc_status)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor submits/resubmits their identity or business-registration
// number. Only allowed while their KYC is in an editable state
// (not_started, action_required, rejected) - a verified or in-review
// vendor can't silently swap their ID number without going through
// admin again.
exports.updateMyKyc = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, account_type FROM vendors WHERE user_id = $1",
            [req.user.userId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];

        const existing = await pool.query(
            "SELECT kyc_status FROM vendor_kyc WHERE vendor_id = $1",
            [vendor.id]
        );
        const currentStatus = existing.rows.length > 0 ? existing.rows[0].kyc_status : "not_started";
        if (!canVendorEditKyc(currentStatus)) {
            return res.status(409).json({
                error: `Your KYC information can't be changed while it's ${currentStatus.replace(/_/g, " ")}. Contact support if something needs correcting.`
            });
        }

        const { national_id_number, registration_number } = req.body;

        if (vendor.account_type === "company" && !registration_number) {
            return res.status(400).json({ error: "Registration number is required." });
        }
        if (vendor.account_type === "individual" && !national_id_number) {
            return res.status(400).json({ error: "National ID number is required." });
        }

        const natIdHash = hashForLookup(national_id_number);
        const regNumHash = hashForLookup(registration_number);

        // Same one-account-per-business dedup as the old plaintext check
        // (migration 054), now against the verified-hash unique index
        // instead of comparing plaintext directly.
        if (natIdHash) {
            const dupe = await pool.query(
                "SELECT vendor_id FROM vendor_kyc WHERE kyc_status = 'verified' AND vendor_id != $1 AND national_id_number_hash = $2",
                [vendor.id, natIdHash]
            );
            if (dupe.rows.length > 0) {
                return res.status(409).json({ error: "This national ID is already associated with another verified vendor account." });
            }
        }
        if (regNumHash) {
            const dupe = await pool.query(
                "SELECT vendor_id FROM vendor_kyc WHERE kyc_status = 'verified' AND vendor_id != $1 AND registration_number_hash = $2",
                [vendor.id, regNumHash]
            );
            if (dupe.rows.length > 0) {
                return res.status(409).json({ error: "This registration number is already associated with another verified vendor account." });
            }
        }

        const natIdEnc = national_id_number ? encryptField(national_id_number) : null;
        const regNumEnc = registration_number ? encryptField(registration_number) : null;

        await pool.query(
            `INSERT INTO vendor_kyc (vendor_id, kyc_status, national_id_number_enc, national_id_number_hash, registration_number_enc, registration_number_hash)
             VALUES ($1, 'submitted', $2, $3, $4, $5)
             ON CONFLICT (vendor_id) DO UPDATE SET
                kyc_status = 'submitted',
                national_id_number_enc = COALESCE($2, vendor_kyc.national_id_number_enc),
                national_id_number_hash = COALESCE($3, vendor_kyc.national_id_number_hash),
                registration_number_enc = COALESCE($4, vendor_kyc.registration_number_enc),
                registration_number_hash = COALESCE($5, vendor_kyc.registration_number_hash),
                review_note = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL,
                updated_at = now()`,
            [vendor.id, natIdEnc, natIdHash, regNumEnc, regNumHash]
        );

        await pool.query(
            `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, 'submitted', NULL, 'Vendor submitted KYC information.')`,
            [vendor.id, currentStatus]
        );

        res.json({ message: "Submitted for review.", kyc_status: "submitted" });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "This ID or registration number is already associated with another verified vendor account." });
        }
        res.status(500).json({ error: error.message });
    }
};

// --- Admin -------------------------------------------------------------

// List every vendor with their KYC status (optionally filtered by
// status), for the admin KYC review screen. LEFT JOINs vendor_kyc since
// a vendor who never submitted anything has no row there yet.
exports.listVendorKycAdmin = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [];
        let where = "";
        if (status) {
            params.push(status);
            where = "WHERE COALESCE(k.kyc_status, 'not_started') = $1";
        }
        const result = await pool.query(
            `SELECT v.id AS vendor_id, v.business_name, v.account_type, v.status AS vendor_status,
                    v.phone, v.submitted_at, u.name AS owner_name, u.email AS owner_email,
                    COALESCE(k.kyc_status, 'not_started') AS kyc_status,
                    k.identity_verified, k.business_verified, k.reviewed_at
             FROM vendors v
             JOIN users u ON u.id = v.user_id
             LEFT JOIN vendor_kyc k ON k.vendor_id = v.id
             ${where}
             ORDER BY
                CASE COALESCE(k.kyc_status, 'not_started')
                    WHEN 'submitted' THEN 0
                    WHEN 'under_review' THEN 1
                    WHEN 'action_required' THEN 2
                    ELSE 3
                END, v.business_name`,
            params
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Full KYC detail for one vendor, decrypted for admin review, plus the
// audit trail of every status change.
exports.getVendorKycAdminDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const vendorRow = await pool.query(
            `SELECT v.id, v.business_name, v.account_type, v.phone, v.submitted_at,
                    u.name AS owner_name, u.email AS owner_email
             FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
            [id]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const vendor = vendorRow.rows[0];

        const kycRow = await pool.query(
            `SELECT kyc_status, identity_verified, business_verified, national_id_number_enc,
                    registration_number_enc, review_note, reviewed_by, reviewed_at, created_at, updated_at
             FROM vendor_kyc WHERE vendor_id = $1`,
            [id]
        );
        const auditRows = await pool.query(
            `SELECT a.from_status, a.to_status, a.note, a.created_at, u.name AS changed_by_name
             FROM vendor_kyc_audit_log a
             LEFT JOIN users u ON u.id = a.changed_by
             WHERE a.vendor_id = $1
             ORDER BY a.created_at DESC`,
            [id]
        );

        const kyc = kycRow.rows[0] || null;

        res.json({
            vendor_id: vendor.id,
            business_name: vendor.business_name,
            account_type: vendor.account_type,
            owner_name: vendor.owner_name,
            owner_email: vendor.owner_email,
            phone: vendor.phone,
            submitted_at: vendor.submitted_at,
            kyc_status: kyc ? kyc.kyc_status : "not_started",
            identity_verified: kyc ? kyc.identity_verified : false,
            business_verified: kyc ? kyc.business_verified : false,
            national_id_number: kyc ? decryptField(kyc.national_id_number_enc) : null,
            registration_number: kyc ? decryptField(kyc.registration_number_enc) : null,
            review_note: kyc ? kyc.review_note : null,
            reviewed_at: kyc ? kyc.reviewed_at : null,
            audit_log: auditRows.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Move a vendor's KYC to a new status, with a note. Sets identity_verified/
// business_verified appropriately when moving to 'verified' (based on
// which number this vendor's account_type actually supplies), and clears
// both on any other status.
exports.reviewVendorKycAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { kyc_status, note } = req.body;

        const vendorRow = await pool.query("SELECT id, account_type FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const vendor = vendorRow.rows[0];

        const existing = await pool.query("SELECT kyc_status FROM vendor_kyc WHERE vendor_id = $1", [id]);
        if (existing.rows.length === 0) {
            return res.status(409).json({ error: "This vendor hasn't submitted any KYC information yet." });
        }
        const currentStatus = existing.rows[0].kyc_status;

        if (!isValidAdminKycTransition(currentStatus, kyc_status)) {
            return res.status(400).json({ error: `Can't move KYC status from ${currentStatus} to ${kyc_status}.` });
        }

        const identityVerified = kyc_status === "verified" && vendor.account_type === "individual";
        const businessVerified = kyc_status === "verified" && vendor.account_type === "company";

        await pool.query(
            `UPDATE vendor_kyc SET
                kyc_status = $1,
                identity_verified = $2,
                business_verified = $3,
                review_note = $4,
                reviewed_by = $5,
                reviewed_at = now(),
                updated_at = now()
             WHERE vendor_id = $6`,
            [kyc_status, identityVerified, businessVerified, note || null, req.user.userId, id]
        );

        await pool.query(
            `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, currentStatus, kyc_status, req.user.userId, note || null]
        );

        logActivity(req.user.userId, "vendor_kyc_review", "vendor", id, `KYC ${currentStatus} -> ${kyc_status}`);

        res.json({ message: "KYC status updated.", kyc_status });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "Can't mark verified: this ID/registration number is already verified on another vendor account." });
        }
        res.status(500).json({ error: error.message });
    }
};
