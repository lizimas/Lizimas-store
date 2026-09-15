// Vendor Brand Authorization (Phase 7, Ryan Sept 2026 - modelled on
// Jumia's brand authorization tiers: Official Brand Store vs Authorized
// Distributor). Shape deliberately mirrors vendorKycController.js -
// vendor self-service (list/submit/upload docs) plus admin review - see
// server/utils/vendorBrandAuth.js for the tier/status rules used here and
// migrations/101_vendor_brand_authorizations.sql /
// 102_vendor_brand_authorization_documents.sql for the schema.

const pool = require("../config/database");
const {
    isValidBrandAuthTier,
    isValidBrandAuthDocumentType,
    isValidAdminBrandAuthTransition,
    canVendorEditBrandAuth,
    requiredDocumentsForTier,
    hasRequiredDocuments,
    BRAND_AUTH_TIER_LABELS
} = require("../utils/vendorBrandAuth");
const { logActivity } = require("../utils/activityLog");
const { uploadPrivateDocument, privateDocumentViewUrl, destroyPrivateDocument } = require("../utils/cloudinaryUpload");
const { createVendorNotification } = require("./vendorController");

async function getVendorIdForUser(userId) {
    const { rows } = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [userId]);
    return rows.length > 0 ? rows[0].id : null;
}

// --- Vendor-self --------------------------------------------------------

// Every brand authorization this vendor has ever requested, each with its
// own documents and status.
exports.getMyBrandAuthorizations = async (req, res) => {
    try {
        const vendorId = await getVendorIdForUser(req.user.userId);
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { rows: authRows } = await pool.query(
            `SELECT id, brand_name, tier, status, review_note, reviewed_at, created_at, updated_at
             FROM vendor_brand_authorizations
             WHERE vendor_id = $1
             ORDER BY updated_at DESC`,
            [vendorId]
        );

        const { rows: docRows } = await pool.query(
            `SELECT brand_authorization_id, document_type, original_filename, review_status,
                    rejection_reason, action_required_reason, uploaded_at
             FROM vendor_brand_authorization_documents
             WHERE vendor_id = $1`,
            [vendorId]
        );

        const authorizations = authRows.map((a) => ({
            ...a,
            tier_label: BRAND_AUTH_TIER_LABELS[a.tier] || a.tier,
            required_documents: requiredDocumentsForTier(a.tier),
            editable: canVendorEditBrandAuth(a.status),
            documents: docRows.filter((d) => d.brand_authorization_id === a.id)
        }));

        res.json({ authorizations });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Vendor requests (or resubmits) authorization for one brand. Creating a
// new row is allowed any time (a vendor can always ask about a new
// brand); resubmitting an existing row is only allowed while it's in an
// editable state, same rule as vendor KYC.
exports.submitBrandAuthorization = async (req, res) => {
    try {
        const vendorId = await getVendorIdForUser(req.user.userId);
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const brandName = (req.body.brand_name || "").trim();
        const tier = req.body.tier;

        if (!brandName) return res.status(400).json({ error: "brand_name is required." });
        if (!isValidBrandAuthTier(tier)) {
            return res.status(400).json({ error: "tier must be official_store or authorized_distributor." });
        }

        const existing = await pool.query(
            "SELECT id, status FROM vendor_brand_authorizations WHERE vendor_id = $1 AND lower(brand_name) = lower($2)",
            [vendorId, brandName]
        );

        let authorizationId;
        let fromStatus;

        if (existing.rows.length > 0) {
            const current = existing.rows[0];
            if (!canVendorEditBrandAuth(current.status)) {
                return res.status(409).json({
                    error: `Your ${brandName} authorization can't be changed while it's ${current.status.replace(/_/g, " ")}. Contact support if something needs correcting.`
                });
            }
            authorizationId = current.id;
            fromStatus = current.status;
        }

        const uploadedDocs = await pool.query(
            existing.rows.length > 0
                ? "SELECT document_type FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1"
                : "SELECT document_type FROM vendor_brand_authorization_documents WHERE brand_authorization_id = -1",
            existing.rows.length > 0 ? [authorizationId] : []
        );
        if (!hasRequiredDocuments(tier, uploadedDocs.rows.map((d) => d.document_type))) {
            return res.status(400).json({
                error: "missing_documents",
                message: `Upload all required documents for ${BRAND_AUTH_TIER_LABELS[tier]} before submitting.`,
                required_documents: requiredDocumentsForTier(tier)
            });
        }

        if (authorizationId) {
            await pool.query(
                `UPDATE vendor_brand_authorizations
                 SET tier = $1, status = 'submitted', review_note = NULL,
                     reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
                 WHERE id = $2`,
                [tier, authorizationId]
            );
        } else {
            const inserted = await pool.query(
                `INSERT INTO vendor_brand_authorizations (vendor_id, brand_name, tier, status)
                 VALUES ($1, $2, $3, 'submitted')
                 RETURNING id`,
                [vendorId, brandName, tier]
            );
            authorizationId = inserted.rows[0].id;
            fromStatus = "not_started";
        }

        await pool.query(
            `INSERT INTO vendor_brand_authorization_audit_log (brand_authorization_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, 'submitted', NULL, 'Vendor submitted brand authorization request.')`,
            [authorizationId, fromStatus]
        );

        res.json({ message: "Submitted for review.", authorization_id: authorizationId, status: "submitted" });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "You already have an authorization request on file for this brand." });
        }
        res.status(500).json({ error: error.message });
    }
};

// Vendor uploads (or replaces) one document backing a specific brand
// authorization request. Only allowed while that request is editable.
exports.uploadMyBrandAuthDocument = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded." });

        const vendorId = await getVendorIdForUser(req.user.userId);
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { authorizationId } = req.params;
        const documentType = req.body.document_type;
        if (!isValidBrandAuthDocumentType(documentType)) {
            return res.status(400).json({ error: "Unrecognized document_type." });
        }

        const authRow = await pool.query(
            "SELECT id, status FROM vendor_brand_authorizations WHERE id = $1 AND vendor_id = $2",
            [authorizationId, vendorId]
        );
        if (authRow.rows.length === 0) return res.status(404).json({ error: "Brand authorization request not found." });
        const currentStatus = authRow.rows[0].status;
        if (!canVendorEditBrandAuth(currentStatus)) {
            return res.status(409).json({
                error: `Documents can't be changed while this request is ${currentStatus.replace(/_/g, " ")}. Contact support if something needs correcting.`
            });
        }

        const priorRow = await pool.query(
            "SELECT cloudinary_public_id, resource_type FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1 AND document_type = $2",
            [authorizationId, documentType]
        );

        const uploaded = await uploadPrivateDocument(req.file.buffer, req.file.originalname, "lizimas-store/vendor-brand-auth");

        await pool.query(
            `INSERT INTO vendor_brand_authorization_documents
                (brand_authorization_id, vendor_id, document_type, cloudinary_public_id, resource_type, format, original_filename, bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (brand_authorization_id, document_type) DO UPDATE SET
                cloudinary_public_id = $4,
                resource_type = $5,
                format = $6,
                original_filename = $7,
                bytes = $8,
                uploaded_at = now(),
                review_status = 'pending',
                rejection_reason = NULL,
                action_required_reason = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL`,
            [authorizationId, vendorId, documentType, uploaded.public_id, uploaded.resource_type, uploaded.format, req.file.originalname, uploaded.bytes]
        );

        if (priorRow.rows.length > 0) {
            destroyPrivateDocument(priorRow.rows[0].cloudinary_public_id, priorRow.rows[0].resource_type)
                .catch((err) => console.error("Failed to clean up replaced brand-auth document:", err.message));
        }

        res.json({ message: "Document uploaded.", document_type: documentType });
    } catch (error) {
        if (error.code === "INVALID_FILE_TYPE") {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
};

// Vendor requests a fresh signed URL to view their own already-uploaded document.
exports.getMyBrandAuthDocumentUrl = async (req, res) => {
    try {
        const vendorId = await getVendorIdForUser(req.user.userId);
        if (!vendorId) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { authorizationId } = req.params;
        const { document_type } = req.query;

        const docRow = await pool.query(
            `SELECT cloudinary_public_id, resource_type, format
             FROM vendor_brand_authorization_documents
             WHERE brand_authorization_id = $1 AND vendor_id = $2 AND document_type = $3`,
            [authorizationId, vendorId, document_type]
        );
        if (docRow.rows.length === 0) return res.status(404).json({ error: "No document on file." });

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.cloudinary_public_id, doc.resource_type, doc.format);
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin ---------------------------------------------------------------

// Every brand authorization request across all vendors, for the admin
// review queue. Optionally filtered by status.
exports.listBrandAuthorizationsAdmin = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [];
        let where = "";
        if (status) {
            params.push(status);
            where = "WHERE a.status = $1";
        }
        const { rows } = await pool.query(
            `SELECT a.id, a.vendor_id, a.brand_name, a.tier, a.status, a.reviewed_at,
                    v.business_name, u.name AS owner_name, u.email AS owner_email
             FROM vendor_brand_authorizations a
             JOIN vendors v ON v.id = a.vendor_id
             JOIN users u ON u.id = v.user_id
             ${where}
             ORDER BY
                CASE a.status
                    WHEN 'submitted' THEN 0
                    WHEN 'under_review' THEN 1
                    WHEN 'action_required' THEN 2
                    ELSE 3
                END, a.updated_at DESC`,
            params
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Full detail for one brand authorization request, plus its documents and
// audit trail, for the admin review screen.
exports.getBrandAuthorizationAdminDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const authRow = await pool.query(
            `SELECT a.id, a.vendor_id, a.brand_name, a.tier, a.status, a.review_note,
                    a.reviewed_at, a.created_at, a.updated_at,
                    v.business_name, u.name AS owner_name, u.email AS owner_email
             FROM vendor_brand_authorizations a
             JOIN vendors v ON v.id = a.vendor_id
             JOIN users u ON u.id = v.user_id
             WHERE a.id = $1`,
            [id]
        );
        if (authRow.rows.length === 0) return res.status(404).json({ error: "Brand authorization request not found." });

        const docRows = await pool.query(
            `SELECT document_type, original_filename, review_status, rejection_reason,
                    action_required_reason, uploaded_at
             FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1`,
            [id]
        );
        const auditRows = await pool.query(
            `SELECT l.from_status, l.to_status, l.note, l.created_at, u.name AS changed_by_name
             FROM vendor_brand_authorization_audit_log l
             LEFT JOIN users u ON u.id = l.changed_by
             WHERE l.brand_authorization_id = $1
             ORDER BY l.created_at DESC`,
            [id]
        );

        const authorization = authRow.rows[0];
        res.json({
            ...authorization,
            tier_label: BRAND_AUTH_TIER_LABELS[authorization.tier] || authorization.tier,
            required_documents: requiredDocumentsForTier(authorization.tier),
            documents: docRows.rows,
            audit_log: auditRows.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Move a brand authorization request to a new status, with a note.
exports.reviewBrandAuthorizationAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note } = req.body;

        const authRow = await pool.query("SELECT id, vendor_id, status, brand_name, tier FROM vendor_brand_authorizations WHERE id = $1", [id]);
        if (authRow.rows.length === 0) return res.status(404).json({ error: "Brand authorization request not found." });
        const current = authRow.rows[0];

        if (!isValidAdminBrandAuthTransition(current.status, status)) {
            return res.status(400).json({ error: `Can't move brand authorization status from ${current.status} to ${status}.` });
        }

        // Can't verify without every required document present and accepted.
        if (status === "verified") {
            const docRows = await pool.query(
                "SELECT document_type, review_status FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1",
                [id]
            );
            const required = requiredDocumentsForTier(current.tier);
            const accepted = new Set(docRows.rows.filter((d) => d.review_status === "accepted").map((d) => d.document_type));
            const missing = required.filter((docType) => !accepted.has(docType));
            if (missing.length > 0) {
                return res.status(409).json({
                    error: "documents_not_accepted",
                    message: "Every required document must be individually accepted before this request can be verified.",
                    missing_or_unaccepted: missing
                });
            }
        }

        await pool.query(
            `UPDATE vendor_brand_authorizations SET
                status = $1, review_note = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
             WHERE id = $4`,
            [status, note || null, req.user.userId, id]
        );

        await pool.query(
            `INSERT INTO vendor_brand_authorization_audit_log (brand_authorization_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, current.status, status, req.user.userId, note || null]
        );

        await createVendorNotification(current.vendor_id, "compliance_action", {
            subject: `Brand authorization for ${current.brand_name}: ${status.replace(/_/g, " ")}`,
            note: note || null
        });

        logActivity(req.user.userId, "vendor_brand_authorization_review", "vendor", current.vendor_id,
            `${current.brand_name} (${current.tier}) ${current.status} -> ${status}`);

        res.json({ message: "Brand authorization status updated.", status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Review a single document (accept/reject/action_required/pending),
// mirroring reviewVendorKycDocumentAdmin's auto-flip behavior: any
// rejected/action_required document flips the overall request to
// action_required; once every document is accepted/pending again and the
// overall status was action_required, it flips back to under_review.
exports.reviewBrandAuthDocumentAdmin = async (req, res) => {
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
            "SELECT id FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1 AND document_type = $2",
            [id, documentType]
        );
        if (docRow.rows.length === 0) return res.status(404).json({ error: "No document on file for this request and type." });

        await pool.query(
            `UPDATE vendor_brand_authorization_documents
             SET review_status = $1, rejection_reason = $2, action_required_reason = $3,
                 reviewed_by = $4, reviewed_at = now()
             WHERE brand_authorization_id = $5 AND document_type = $6`,
            [decision, decision === "rejected" ? reason : null, decision === "action_required" ? reason : null,
             req.user.userId, id, documentType]
        );

        const summary = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE review_status = 'rejected') AS rejected_count,
                COUNT(*) FILTER (WHERE review_status = 'action_required') AS action_count
             FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1`,
            [id]
        );
        const authRow = await pool.query("SELECT status, vendor_id, brand_name FROM vendor_brand_authorizations WHERE id = $1", [id]);
        const currentStatus = authRow.rows[0] ? authRow.rows[0].status : null;
        let newOverallStatus = currentStatus;
        const { rejected_count, action_count } = summary.rows[0];

        if (rejected_count > 0 || action_count > 0) {
            newOverallStatus = "action_required";
        } else if (currentStatus === "action_required") {
            newOverallStatus = "under_review";
        }

        if (newOverallStatus !== currentStatus && currentStatus) {
            await pool.query(
                "UPDATE vendor_brand_authorizations SET status = $1, updated_at = now() WHERE id = $2",
                [newOverallStatus, id]
            );
            await pool.query(
                `INSERT INTO vendor_brand_authorization_audit_log (brand_authorization_id, from_status, to_status, changed_by, note)
                 VALUES ($1, $2, $3, $4, $5)`,
                [id, currentStatus, newOverallStatus, req.user.userId, `Auto-flip from document review: ${documentType} -> ${decision}`]
            );
        }

        await pool.query(
            `INSERT INTO vendor_brand_authorization_audit_log (brand_authorization_id, from_status, to_status, changed_by, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, currentStatus || "unknown", newOverallStatus || currentStatus || "unknown",
             req.user.userId, `Document ${documentType}: ${decision}${reason ? " - " + reason : ""}`]
        );

        logActivity(req.user.userId, "vendor_brand_authorization_document_review", "vendor",
            authRow.rows[0] ? authRow.rows[0].vendor_id : null, `Document ${documentType}: ${decision}`);

        res.json({ message: "Document review recorded.", decision, overall_status: newOverallStatus, auto_flipped: newOverallStatus !== currentStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin views a vendor's uploaded brand-auth document via a freshly-minted
// signed URL.
exports.getBrandAuthDocumentAdmin = async (req, res) => {
    try {
        const { id, documentType } = req.params;
        const docRow = await pool.query(
            "SELECT cloudinary_public_id, resource_type, format FROM vendor_brand_authorization_documents WHERE brand_authorization_id = $1 AND document_type = $2",
            [id, documentType]
        );
        if (docRow.rows.length === 0) return res.status(404).json({ error: "No document on file." });

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.cloudinary_public_id, doc.resource_type, doc.format);
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
