// Payment Instrument Approval (Phase 5, Ryan Sept 2026 - modelled on
// Jumia's Vendor Center payout-account verification). See
// server/utils/vendorPaymentInstruments.js for the name-match/edit-lock
// rules and migrations/103_vendor_payment_instruments.sql for the schema.
//
// Jumia-parity extension (migration 122): evidence document columns
// directly on vendor_payment_instruments (not vendor_kyc_documents - a
// vendor can hold several instruments, each needing its own proof).
// canApprovePaymentInstrument() (server/utils/vendorPaymentInstruments.js)
// gates approval on evidence being on file.

const pool = require("../config/database");
const {
    isValidMethod,
    canVendorEditInstrument,
    expectedLegalName,
    namesMatch,
    NAME_MISMATCH_REASON,
    missingFieldsForMethod,
    hasEvidence,
    canApprovePaymentInstrument
} = require("../utils/vendorPaymentInstruments");
const { logActivity } = require("../utils/activityLog");
const { uploadPrivateDocument, privateDocumentViewUrl, destroyPrivateDocument } = require("../utils/cloudinaryUpload");
const { createVendorNotification } = require("./vendorController");

async function getVendorForUser(userId) {
    const { rows } = await pool.query(
        `SELECT v.id, v.account_type, v.business_name, v.preferred_instrument_id, u.name AS owner_name
         FROM vendors v JOIN users u ON u.id = v.user_id
         WHERE v.user_id = $1`,
        [userId]
    );
    return rows.length > 0 ? rows[0] : null;
}

// --- Vendor-self --------------------------------------------------------

exports.getMyPaymentInstruments = async (req, res) => {
    try {
        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { rows } = await pool.query(
            `SELECT id, method, momo_number, bank_name, account_number, account_holder_name,
                    status, rejection_reason, is_preferred, reviewed_at, created_at,
                    evidence_cloudinary_public_id, evidence_original_filename
             FROM vendor_payment_instruments WHERE vendor_id = $1 ORDER BY created_at DESC`,
            [vendor.id]
        );

        res.json({
            instruments: rows.map((r) => ({
                ...r,
                editable: canVendorEditInstrument(r.status),
                has_evidence: hasEvidence(r)
            })),
            preferred_instrument_id: vendor.preferred_instrument_id
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor adds a new payment instrument. Auto-rejects immediately (no
// admin step) if the beneficiary name doesn't match their verified legal
// name - the whole point of this feature is that a mismatched name never
// even reaches the review queue as something that could later be
// rubber-stamped.
exports.addMyPaymentInstrument = async (req, res) => {
    try {
        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { method, momo_number, bank_name, account_number, account_holder_name } = req.body;

        if (!isValidMethod(method)) {
            return res.status(400).json({ error: "method must be momo or bank." });
        }
        const missing = missingFieldsForMethod(method, { momo_number, bank_name, account_number, account_holder_name });
        if (missing.length > 0) {
            return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}.` });
        }

        const legalName = expectedLegalName({
            accountType: vendor.account_type,
            businessName: vendor.business_name,
            ownerName: vendor.owner_name
        });
        const matches = namesMatch(account_holder_name, legalName);

        const inserted = await pool.query(
            `INSERT INTO vendor_payment_instruments
                (vendor_id, method, momo_number, bank_name, account_number, account_holder_name, status, rejection_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, status`,
            [
                vendor.id, method,
                method === "momo" ? momo_number : null,
                method === "bank" ? bank_name : null,
                method === "bank" ? account_number : null,
                account_holder_name,
                matches ? "pending" : "rejected",
                matches ? null : NAME_MISMATCH_REASON
            ]
        );
        const instrument = inserted.rows[0];

        await pool.query(
            `INSERT INTO vendor_payment_instrument_audit_log (instrument_id, from_status, to_status, changed_by, note)
             VALUES ($1, NULL, $2, NULL, $3)`,
            [instrument.id, instrument.status, matches ? "Vendor submitted payment instrument." : NAME_MISMATCH_REASON]
        );

        res.status(matches ? 201 : 422).json({
            message: matches ? "Submitted for review." : NAME_MISMATCH_REASON,
            instrument_id: instrument.id,
            status: instrument.status
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Edit + resubmit a REJECTED instrument only (canVendorEditInstrument) -
// pending/approved are locked, exactly the safety valve this feature
// exists for: a compromised session can't swap the account number on
// something already trusted or already in the queue.
exports.updateMyPaymentInstrument = async (req, res) => {
    try {
        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query(
            "SELECT id, method, status FROM vendor_payment_instruments WHERE id = $1 AND vendor_id = $2",
            [id, vendor.id]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: "Payment instrument not found." });
        const current = existing.rows[0];

        if (!canVendorEditInstrument(current.status)) {
            return res.status(409).json({
                error: `This instrument can't be edited while it's ${current.status}. Only a rejected instrument can be edited and resubmitted.`
            });
        }

        const method = req.body.method || current.method;
        const { momo_number, bank_name, account_number, account_holder_name } = req.body;

        if (!isValidMethod(method)) return res.status(400).json({ error: "method must be momo or bank." });
        const missing = missingFieldsForMethod(method, { momo_number, bank_name, account_number, account_holder_name });
        if (missing.length > 0) {
            return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}.` });
        }

        const legalName = expectedLegalName({
            accountType: vendor.account_type,
            businessName: vendor.business_name,
            ownerName: vendor.owner_name
        });
        const matches = namesMatch(account_holder_name, legalName);
        const newStatus = matches ? "pending" : "rejected";

        await pool.query(
            `UPDATE vendor_payment_instruments SET
                method = $1, momo_number = $2, bank_name = $3, account_number = $4,
                account_holder_name = $5, status = $6, rejection_reason = $7,
                reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
             WHERE id = $8`,
            [
                method,
                method === "momo" ? momo_number : null,
                method === "bank" ? bank_name : null,
                method === "bank" ? account_number : null,
                account_holder_name,
                newStatus,
                matches ? null : NAME_MISMATCH_REASON,
                id
            ]
        );

        await pool.query(
            `INSERT INTO vendor_payment_instrument_audit_log (instrument_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, NULL, $4)`,
            [id, current.status, newStatus, matches ? "Vendor resubmitted payment instrument." : NAME_MISMATCH_REASON]
        );

        res.json({ message: matches ? "Resubmitted for review." : NAME_MISMATCH_REASON, status: newStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor uploads (or replaces) the supporting evidence document for one
// of their own payment instruments - a bank certificate or MoMo
// statement proving the account is really theirs (Jumia-parity, migration
// 122). Allowed while the instrument is pending (the normal flow: create,
// then add evidence) or rejected (fixing/resubmitting evidence along with
// the account details); locked once approved, same as editing the
// account details themselves.
exports.uploadMyPaymentInstrumentEvidence = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const existing = await pool.query(
            "SELECT id, status, evidence_cloudinary_public_id, evidence_resource_type FROM vendor_payment_instruments WHERE id = $1 AND vendor_id = $2",
            [id, vendor.id]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: "Payment instrument not found." });
        const instrument = existing.rows[0];

        if (instrument.status === "approved") {
            return res.status(409).json({ error: "This instrument is already approved and locked. Contact support if something needs to change." });
        }

        const uploaded = await uploadPrivateDocument(req.file.buffer, req.file.originalname);

        await pool.query(
            `UPDATE vendor_payment_instruments SET
                evidence_cloudinary_public_id = $1,
                evidence_resource_type = $2,
                evidence_format = $3,
                evidence_original_filename = $4,
                evidence_bytes = $5,
                evidence_uploaded_at = now(),
                updated_at = now()
             WHERE id = $6`,
            [uploaded.public_id, uploaded.resource_type, uploaded.format, req.file.originalname, uploaded.bytes, id]
        );

        // Best-effort cleanup of the replaced asset - never let a Cloudinary
        // hiccup here block the new document from being saved (already is).
        if (instrument.evidence_cloudinary_public_id) {
            destroyPrivateDocument(instrument.evidence_cloudinary_public_id, instrument.evidence_resource_type)
                .catch((err) => console.error("Failed to clean up replaced payment instrument evidence:", err.message));
        }

        res.json({ message: "Evidence uploaded." });
    } catch (error) {
        if (error.code === "INVALID_FILE_TYPE") {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
};

// Vendor requests a fresh signed URL to view their own already-uploaded
// evidence document. Expires in ~5 minutes, same as every other private
// document view in this codebase - callers fetch a new one on every view.
exports.getMyPaymentInstrumentEvidenceUrl = async (req, res) => {
    try {
        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const docRow = await pool.query(
            "SELECT evidence_cloudinary_public_id, evidence_resource_type, evidence_format FROM vendor_payment_instruments WHERE id = $1 AND vendor_id = $2",
            [id, vendor.id]
        );
        if (docRow.rows.length === 0 || !docRow.rows[0].evidence_cloudinary_public_id) {
            return res.status(404).json({ error: "No evidence document on file for this instrument." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.evidence_cloudinary_public_id, doc.evidence_resource_type, doc.evidence_format);
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor picks which APPROVED instrument receives payouts. Refuses an
// unapproved target outright rather than letting a vendor "prefer" a
// pending/rejected account and have payouts silently stall - see
// markStatementPaid's guard in billingController.js for where this
// actually gets enforced.
exports.setPreferredPaymentInstrument = async (req, res) => {
    try {
        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { instrument_id } = req.body;
        const instrumentRow = await pool.query(
            "SELECT id, status FROM vendor_payment_instruments WHERE id = $1 AND vendor_id = $2",
            [instrument_id, vendor.id]
        );
        if (instrumentRow.rows.length === 0) return res.status(404).json({ error: "Payment instrument not found." });
        if (instrumentRow.rows[0].status !== "approved") {
            return res.status(409).json({ error: "Only an approved instrument can be set as preferred." });
        }

        await pool.query("UPDATE vendors SET preferred_instrument_id = $1 WHERE id = $2", [instrument_id, vendor.id]);
        await pool.query(
            "UPDATE vendor_payment_instruments SET is_preferred = (id = $1) WHERE vendor_id = $2",
            [instrument_id, vendor.id]
        );

        res.json({ message: "Preferred payment instrument updated.", preferred_instrument_id: Number(instrument_id) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin ---------------------------------------------------------------

// The review queue: every instrument, with a side-by-side of the
// vendor's verified legal name vs. what was submitted, so admin doesn't
// have to open a second screen to eyeball the name-match themselves.
exports.listPaymentInstrumentsAdmin = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [];
        let where = "";
        if (status) { params.push(status); where = "WHERE i.status = $1"; }

        const { rows } = await pool.query(
            `SELECT i.id, i.vendor_id, i.method, i.momo_number, i.bank_name, i.account_number,
                    i.account_holder_name, i.status, i.rejection_reason, i.is_preferred,
                    i.reviewed_at, i.created_at, i.evidence_cloudinary_public_id, i.evidence_original_filename,
                    v.business_name, v.account_type, u.name AS owner_name
             FROM vendor_payment_instruments i
             JOIN vendors v ON v.id = i.vendor_id
             JOIN users u ON u.id = v.user_id
             ${where}
             ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.created_at DESC`,
            params
        );

        const withLegalName = rows.map((r) => ({
            ...r,
            verified_legal_name: expectedLegalName({
                accountType: r.account_type,
                businessName: r.business_name,
                ownerName: r.owner_name
            }),
            has_evidence: hasEvidence(r),
            can_approve: canApprovePaymentInstrument(r)
        }));

        res.json(withLegalName);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Approve or reject one instrument, with a reason (required on reject).
// Approving requires evidence on file (Jumia-parity, migration 122) -
// rejecting never does, since an admin can reject an instrument that
// never got any evidence uploaded at all.
exports.reviewPaymentInstrumentAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { decision, reason } = req.body;

        if (!["approved", "rejected"].includes(decision)) {
            return res.status(400).json({ error: "decision must be approved or rejected." });
        }
        if (decision === "rejected" && (!reason || !reason.trim())) {
            return res.status(400).json({ error: "A reason is required when rejecting." });
        }

        const existing = await pool.query(
            "SELECT id, vendor_id, status, evidence_cloudinary_public_id FROM vendor_payment_instruments WHERE id = $1",
            [id]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: "Payment instrument not found." });
        const current = existing.rows[0];

        if (current.status !== "pending") {
            return res.status(409).json({ error: `This instrument is already ${current.status}, not pending review.` });
        }

        if (decision === "approved" && !canApprovePaymentInstrument(current)) {
            return res.status(409).json({ error: "Cannot approve: no supporting evidence document has been uploaded for this instrument yet." });
        }

        await pool.query(
            `UPDATE vendor_payment_instruments SET
                status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
             WHERE id = $4`,
            [decision, decision === "rejected" ? reason : null, req.user.userId, id]
        );

        await pool.query(
            `INSERT INTO vendor_payment_instrument_audit_log (instrument_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, current.status, decision, req.user.userId, reason || null]
        );

        await createVendorNotification(current.vendor_id, "compliance_action", {
            subject: `Payment instrument ${decision}`,
            note: reason || null
        });

        logActivity(req.user.userId, "vendor_payment_instrument_review", "vendor", current.vendor_id,
            `Instrument #${id}: ${decision}`);

        res.json({ message: "Reviewed.", status: decision });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin views a vendor's uploaded evidence document via a freshly-minted
// signed URL - same private-document pattern as vendor KYC documents.
exports.getPaymentInstrumentEvidenceUrlAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const docRow = await pool.query(
            "SELECT evidence_cloudinary_public_id, evidence_resource_type, evidence_format FROM vendor_payment_instruments WHERE id = $1",
            [id]
        );
        if (docRow.rows.length === 0 || !docRow.rows[0].evidence_cloudinary_public_id) {
            return res.status(404).json({ error: "No evidence document on file for this instrument." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.evidence_cloudinary_public_id, doc.evidence_resource_type, doc.evidence_format);
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
