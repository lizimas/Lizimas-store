// Vendor KYC & Compliance Profile (Ryan, Sept 2026 -
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
//
// parity extension (migration 122): TIN/VAT number fields, a
// requires_work_permit flag, and Form 20/work permit document types.
// requiredDocumentTypesForKyc() (server/utils/vendorKyc.js) is the single
// source of truth for what's required per account_type - both the
// submission gate below and the vendor dashboard UI read from it.

const pool = require("../config/database");
const { encryptField, decryptField, hashForLookup } = require("../utils/encryption");
const { isValidAdminKycTransition, canVendorEditKyc, requiredDocumentTypesForKyc, KYC_DOCUMENT_LABELS } = require("../utils/vendorKyc");
const { logActivity } = require("../utils/activityLog");
const { uploadPrivateDocument, privateDocumentViewUrl, destroyPrivateDocument } = require("../utils/cloudinaryUpload");
const { createVendorNotification } = require("./vendorController");

// --- Vendor-self ------------------------------------------------------------

// The vendor's own KYC status, and (if they have one on file) their
// current number decrypted just for themselves - never returned to
// anyone else, and never through any public-facing endpoint.
exports.getMyKyc = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, account_type FROM vendors WHERE id = $1",
            [req.vendorId]
        );
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];

        const kycRow = await pool.query(
            `SELECT kyc_status, identity_verified, business_verified, national_id_number_enc,
                    registration_number_enc, tin_number_enc, vat_number_enc, requires_work_permit,
                    review_note, reviewed_at
             FROM vendor_kyc WHERE vendor_id = $1`,
            [vendor.id]
        );

        const docRows = await pool.query(
            `SELECT document_type, original_filename, uploaded_at, review_status, rejection_reason, action_required_reason
             FROM vendor_kyc_documents WHERE vendor_id = $1`,
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
                tin_number: null,
                vat_number: null,
                requires_work_permit: false,
                review_note: null,
                reviewed_at: null,
                editable: true,
                documents: docRows.rows,
                required_documents: requiredDocumentTypesForKyc({ accountType: vendor.account_type, requiresWorkPermit: false })
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
            tin_number: decryptField(kyc.tin_number_enc),
            vat_number: decryptField(kyc.vat_number_enc),
            requires_work_permit: kyc.requires_work_permit,
            review_note: kyc.review_note,
            reviewed_at: kyc.reviewed_at,
            editable: canVendorEditKyc(kyc.kyc_status),
            documents: docRows.rows,
            required_documents: requiredDocumentTypesForKyc({ accountType: vendor.account_type, requiresWorkPermit: kyc.requires_work_permit })
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor submits/resubmits their identity or business-registration
// number (now also TIN/VAT for company vendors, and a work-permit
// declaration for non-Ugandans). Only allowed while their KYC is in an
// editable state (not_started, action_required, rejected) - a verified
// or in-review vendor can't silently swap their ID number without going
// through admin again.
exports.updateMyKyc = async (req, res) => {
    try {
        const vendorRow = await pool.query(
            "SELECT id, account_type FROM vendors WHERE id = $1",
            [req.vendorId]
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

        const { national_id_number, registration_number, tin_number, vat_number, requires_work_permit } = req.body;
        const requiresWorkPermit = Boolean(requires_work_permit);

        if (vendor.account_type === "company") {
            if (!registration_number) {
                return res.status(400).json({ error: "Registration number is required." });
            }
            if (!tin_number) {
                return res.status(400).json({ error: "TIN (tax identification number) is required." });
            }
            if (!vat_number) {
                return res.status(400).json({ error: "VAT number is required." });
            }
        }
        if (vendor.account_type === "individual" && !national_id_number) {
            return res.status(400).json({ error: "National ID number is required." });
        }

        const requiredDocTypes = requiredDocumentTypesForKyc({ accountType: vendor.account_type, requiresWorkPermit });
        const docCheck = await pool.query(
            "SELECT document_type FROM vendor_kyc_documents WHERE vendor_id = $1 AND document_type = ANY($2)",
            [vendor.id, requiredDocTypes]
        );
        const uploadedTypes = new Set(docCheck.rows.map((r) => r.document_type));
        const missingDocTypes = requiredDocTypes.filter((t) => !uploadedTypes.has(t));
        if (missingDocTypes.length > 0) {
            return res.status(400).json({
                error: `Upload the following document(s) before submitting: ${missingDocTypes.map((t) => KYC_DOCUMENT_LABELS[t] || t).join(", ")}.`,
                missing_documents: missingDocTypes
            });
        }

        const natIdHash = hashForLookup(national_id_number);
        const regNumHash = hashForLookup(registration_number);
        const tinHash = hashForLookup(tin_number);
        const vatHash = hashForLookup(vat_number);

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
        if (tinHash) {
            const dupe = await pool.query(
                "SELECT vendor_id FROM vendor_kyc WHERE kyc_status = 'verified' AND vendor_id != $1 AND tin_number_hash = $2",
                [vendor.id, tinHash]
            );
            if (dupe.rows.length > 0) {
                return res.status(409).json({ error: "This TIN is already associated with another verified vendor account." });
            }
        }
        if (vatHash) {
            const dupe = await pool.query(
                "SELECT vendor_id FROM vendor_kyc WHERE kyc_status = 'verified' AND vendor_id != $1 AND vat_number_hash = $2",
                [vendor.id, vatHash]
            );
            if (dupe.rows.length > 0) {
                return res.status(409).json({ error: "This VAT number is already associated with another verified vendor account." });
            }
        }

        const natIdEnc = national_id_number ? encryptField(national_id_number) : null;
        const regNumEnc = registration_number ? encryptField(registration_number) : null;
        const tinEnc = tin_number ? encryptField(tin_number) : null;
        const vatEnc = vat_number ? encryptField(vat_number) : null;

        await pool.query(
            `INSERT INTO vendor_kyc (
                vendor_id, kyc_status, national_id_number_enc, national_id_number_hash,
                registration_number_enc, registration_number_hash,
                tin_number_enc, tin_number_hash, vat_number_enc, vat_number_hash, requires_work_permit
             )
             VALUES ($1, 'submitted', $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (vendor_id) DO UPDATE SET
                kyc_status = 'submitted',
                national_id_number_enc = COALESCE($2, vendor_kyc.national_id_number_enc),
                national_id_number_hash = COALESCE($3, vendor_kyc.national_id_number_hash),
                registration_number_enc = COALESCE($4, vendor_kyc.registration_number_enc),
                registration_number_hash = COALESCE($5, vendor_kyc.registration_number_hash),
                tin_number_enc = COALESCE($6, vendor_kyc.tin_number_enc),
                tin_number_hash = COALESCE($7, vendor_kyc.tin_number_hash),
                vat_number_enc = COALESCE($8, vendor_kyc.vat_number_enc),
                vat_number_hash = COALESCE($9, vendor_kyc.vat_number_hash),
                requires_work_permit = $10,
                review_note = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL,
                updated_at = now()`,
            [vendor.id, natIdEnc, natIdHash, regNumEnc, regNumHash, tinEnc, tinHash, vatEnc, vatHash, requiresWorkPermit]
        );

        await pool.query(
            `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, 'submitted', NULL, 'Vendor submitted KYC information.')`,
            [vendor.id, currentStatus]
        );

        res.json({ message: "Submitted for review.", kyc_status: "submitted" });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "This ID, registration, TIN, or VAT number is already associated with another verified vendor account." });
        }
        res.status(500).json({ error: error.message });
    }
};

// Vendor uploads (or replaces) a document backing their KYC submission.
// document_type must be one accepted for their account_type -
// individuals get national_id/work_permit, companies get
// business_registration/tax_certificate/vat_certificate/form_20/work_permit
// (see requiredDocumentTypesForKyc). work_permit is always accepted for
// either account type regardless of whether requires_work_permit has
// been declared yet - what's actually REQUIRED for submission is
// enforced separately, in updateMyKyc's docCheck above. Only allowed
// while KYC itself is still editable (same rule as updateMyKyc), so a
// verified/in-review vendor can't swap their evidence out from under an
// in-flight or completed review. Stored privately in Cloudinary (see
// server/utils/cloudinaryUpload.js) - never publicly reachable like
// every other upload in this codebase.
exports.uploadMyKycDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        const vendorRow = await pool.query(
            "SELECT id, account_type FROM vendors WHERE id = $1",
            [req.vendorId]
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
                error: `Documents can't be changed while your KYC is ${currentStatus.replace(/_/g, " ")}. Contact support if something needs correcting.`
            });
        }

        const documentType = req.body.document_type;
        // tax_certificate is also accepted (optional) for individual accounts -
        // the shop-setup Company Information step shows the TIN upload to
        // every vendor.
        const allowedTypes = [...new Set([...requiredDocumentTypesForKyc({ accountType: vendor.account_type, requiresWorkPermit: true }), "tax_certificate"])];
        if (!allowedTypes.includes(documentType)) {
            return res.status(400).json({
                error: `${KYC_DOCUMENT_LABELS[documentType] || documentType} isn't a document type accepted for a ${vendor.account_type} account. Accepted: ${allowedTypes.map((t) => KYC_DOCUMENT_LABELS[t] || t).join(", ")}.`
            });
        }

        const priorRow = await pool.query(
            "SELECT cloudinary_public_id, resource_type FROM vendor_kyc_documents WHERE vendor_id = $1 AND document_type = $2",
            [vendor.id, documentType]
        );

        const uploaded = await uploadPrivateDocument(req.file.buffer, req.file.originalname);

        await pool.query(
            `INSERT INTO vendor_kyc_documents (vendor_id, document_type, cloudinary_public_id, resource_type, format, original_filename, bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (vendor_id, document_type) DO UPDATE SET
                cloudinary_public_id = $3,
                resource_type = $4,
                format = $5,
                original_filename = $6,
                bytes = $7,
                uploaded_at = now(),
                review_status = 'pending',
                rejection_reason = NULL,
                action_required_reason = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL`,
            [vendor.id, documentType, uploaded.public_id, uploaded.resource_type, uploaded.format, req.file.originalname, uploaded.bytes]
        );

        // Best-effort cleanup of the replaced asset - never let a Cloudinary
        // hiccup here block the new document from being saved (already is).
        if (priorRow.rows.length > 0) {
            destroyPrivateDocument(priorRow.rows[0].cloudinary_public_id, priorRow.rows[0].resource_type)
                .catch((err) => console.error("Failed to clean up replaced KYC document:", err.message));
        }

        res.json({ message: "Document uploaded.", document_type: documentType });
    } catch (error) {
        if (error.code === "INVALID_FILE_TYPE") {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
};

// Vendor requests a fresh signed URL to view their own already-uploaded
// document. The URL expires in ~5 minutes - callers must fetch a new one
// on every view rather than storing it anywhere.
exports.getMyKycDocumentUrl = async (req, res) => {
    try {
        const { document_type, download } = req.query;
        const vendorId = req.vendorId;
        if (!vendorId) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const docRow = await pool.query(
            "SELECT cloudinary_public_id, resource_type, format FROM vendor_kyc_documents WHERE vendor_id = $1 AND document_type = $2",
            [vendorId, document_type]
        );
        if (docRow.rows.length === 0) {
            return res.status(404).json({ error: "No document on file." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.cloudinary_public_id, doc.resource_type, doc.format, download === "true");
        res.json({ url });
    } catch (error) {
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
                    registration_number_enc, tin_number_enc, vat_number_enc, requires_work_permit,
                    review_note, reviewed_by, reviewed_at, created_at, updated_at,
                    ursb_verified, ursb_verified_at, ursb_verified_by, ursb_evidence_url
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
        const docRows = await pool.query(
            `SELECT document_type, original_filename, uploaded_at
             FROM vendor_kyc_documents WHERE vendor_id = $1`,
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
            tin_number: kyc ? decryptField(kyc.tin_number_enc) : null,
            vat_number: kyc ? decryptField(kyc.vat_number_enc) : null,
            requires_work_permit: kyc ? kyc.requires_work_permit : false,
            review_note: kyc ? kyc.review_note : null,
            reviewed_at: kyc ? kyc.reviewed_at : null,
            ursb_verified: kyc ? kyc.ursb_verified : null,
            ursb_verified_at: kyc ? kyc.ursb_verified_at : null,
            ursb_verified_by: kyc ? kyc.ursb_verified_by : null,
            ursb_evidence_url: kyc ? kyc.ursb_evidence_url : null,
            documents: docRows.rows,
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

        // Company vendors must have URSB verification recorded before they
        // can be marked verified (see migration 091).
        if (kyc_status === "verified" && vendor.account_type === "company") {
            const ursbRow = await pool.query(
                "SELECT ursb_verified FROM vendor_kyc WHERE vendor_id = $1",
                [id]
            );
            const ursb = ursbRow.rows[0] ? ursbRow.rows[0].ursb_verified : null;
            if (ursb !== true) {
                return res.status(409).json({
                    error: "ursb_not_verified",
                    message: "Cannot mark this company vendor as verified: URSB registration check has not been confirmed. Use the URSB verification panel first."
                });
            }
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

        await createVendorNotification(id, "kyc_status_change", {
            status: kyc_status,
            note: note || null
        });

        logActivity(req.user.userId, "vendor_kyc_review", "vendor", id, `KYC ${currentStatus} -> ${kyc_status}`);

        res.json({ message: "KYC status updated.", kyc_status });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "Can't mark verified: this ID/registration number is already verified on another vendor account." });
        }
        res.status(500).json({ error: error.message });
    }
};
// Admin views a vendor's uploaded KYC document via a freshly-minted signed
// URL - never a stored/static link, and this is the only path (besides the
// vendor's own getMyKycDocumentUrl) that can ever reach the document's
// content. getPublicStorefront never joins this table.
exports.getVendorKycDocumentAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { document_type, download } = req.query;

        const docRow = await pool.query(
            "SELECT cloudinary_public_id, resource_type, format FROM vendor_kyc_documents WHERE vendor_id = $1 AND document_type = $2",
            [id, document_type]
        );
        if (docRow.rows.length === 0) {
            return res.status(404).json({ error: "No document on file." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.cloudinary_public_id, doc.resource_type, doc.format, download === "true");
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Record the outcome of a manual URSB eRegistry lookup for a company
// vendor. Required before kyc_status can become 'verified' when the
// vendor's account_type is 'company'. Individual vendors are unaffected.
exports.updateVendorUrsbVerification = async (req, res) => {
    try {
        const { id } = req.params;
        const { ursb_verified, ursb_evidence_url } = req.body;

        if (typeof ursb_verified !== "boolean") {
            return res.status(400).json({ error: "ursb_verified must be true or false." });
        }

        const vendorRow = await pool.query("SELECT id, account_type FROM vendors WHERE id = $1", [id]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "Vendor not found." });
        }
        const vendor = vendorRow.rows[0];
        if (vendor.account_type !== "company") {
            return res.status(400).json({ error: "URSB verification only applies to company vendors." });
        }

        const existing = await pool.query("SELECT vendor_id FROM vendor_kyc WHERE vendor_id = $1", [id]);
        if (existing.rows.length === 0) {
            return res.status(409).json({ error: "This vendor hasn't submitted any KYC information yet." });
        }

        await pool.query(
            `UPDATE vendor_kyc SET
                ursb_verified = $1,
                ursb_verified_at = now(),
                ursb_verified_by = $2,
                ursb_evidence_url = $3,
                updated_at = now()
             WHERE vendor_id = $4`,
            [ursb_verified, req.user.userId, ursb_evidence_url || null, id]
        );

        await pool.query(
            `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id,
             (await pool.query("SELECT kyc_status FROM vendor_kyc WHERE vendor_id = $1", [id])).rows[0].kyc_status,
             (await pool.query("SELECT kyc_status FROM vendor_kyc WHERE vendor_id = $1", [id])).rows[0].kyc_status,
             req.user.userId,
             `URSB check: ${ursb_verified ? "verified" : "NOT verified"}${ursb_evidence_url ? " - " + ursb_evidence_url : ""}`]
        );

        logActivity(req.user.userId, "vendor_kyc_ursb_check", "vendor", id,
            `URSB check recorded: ${ursb_verified ? "verified" : "not verified"}`);

        res.json({ message: "URSB verification recorded.", ursb_verified });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Review a single KYC document. Accepts, rejects, or flags a document as
// needing action from the vendor. When decision is 'rejected' or
// 'action_required' (Q1=A), the overall KYC status is auto-flipped to
// 'action_required' so the admin doesn't have to remember to do it.
// Only 'action_required' -> 'under_review' is a legal reverse transition,
// done automatically when all docs are accepted or pending.
exports.reviewVendorKycDocumentAdmin = async (req, res) => {
    try {
        const { id, documentType } = req.params;
        const { decision, reason } = req.body;

        if (!["accepted", "rejected", "action_required", "pending"].includes(decision)) {
            return res.status(400).json({ error: "decision must be accepted, rejected, action_required, or pending." });
        }
        if ((decision === "rejected" || decision === "action_required") && (!reason || !reason.trim())) {
            return res.status(400).json({ error: "A reason is required when rejecting or asking for action." });
        }

        const docRow = await pool.query(
            "SELECT id FROM vendor_kyc_documents WHERE vendor_id = $1 AND document_type = $2",
            [id, documentType]
        );
        if (docRow.rows.length === 0) {
            return res.status(404).json({ error: "No document on file for this vendor and type." });
        }

        await pool.query(
            `UPDATE vendor_kyc_documents
             SET review_status = $1,
                 rejection_reason = $2,
                 action_required_reason = $3,
                 reviewed_by = $4,
                 reviewed_at = now()
             WHERE vendor_id = $5 AND document_type = $6`,
            [
                decision,
                decision === "rejected" ? reason : null,
                decision === "action_required" ? reason : null,
                req.user.userId,
                id,
                documentType
            ]
        );

        // Auto-flip overall KYC status per Q1=A:
        //  - rejected OR action_required on any doc -> overall action_required
        //  - all docs accepted/pending -> overall under_review (if currently action_required)
        const docSummary = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE review_status = 'rejected') AS rejected_count,
                COUNT(*) FILTER (WHERE review_status = 'action_required') AS action_count,
                COUNT(*) FILTER (WHERE review_status IN ('accepted','pending')) AS ok_count
             FROM vendor_kyc_documents WHERE vendor_id = $1`,
            [id]
        );
        const summary = docSummary.rows[0];
        const kycRow = await pool.query("SELECT kyc_status FROM vendor_kyc WHERE vendor_id = $1", [id]);
        const currentStatus = kycRow.rows[0] ? kycRow.rows[0].kyc_status : null;
        let newOverallStatus = currentStatus;

        if (summary.rejected_count > 0 || summary.action_count > 0) {
            newOverallStatus = "action_required";
        } else if (currentStatus === "action_required") {
            newOverallStatus = "under_review";
        }

        if (newOverallStatus !== currentStatus && currentStatus) {
            await pool.query(
                `UPDATE vendor_kyc SET kyc_status = $1, updated_at = now() WHERE vendor_id = $2`,
                [newOverallStatus, id]
            );
            await pool.query(
                `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
                 VALUES ($1, $2, $3, $4, $5)`,
                [id, currentStatus, newOverallStatus, req.user.userId,
                 `Auto-flip from document review: ${documentType} -> ${decision}`]
            );
        }

        // Always log the document action itself
        await pool.query(
            `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, currentStatus || "unknown", newOverallStatus || currentStatus || "unknown",
             req.user.userId,
             `Document ${documentType}: ${decision}${reason ? " - " + reason : ""}`]
        );

        logActivity(req.user.userId, "vendor_kyc_document_review", "vendor", id,
            `Document ${documentType}: ${decision}`);

        res.json({
            message: "Document review recorded.",
            decision,
            overall_kyc_status: newOverallStatus,
            auto_flipped: newOverallStatus !== currentStatus
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
