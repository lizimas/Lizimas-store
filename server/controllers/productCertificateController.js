// Product certifications with proof (migration 151). A vendor ticks a
// certification on the product form and uploads the certificate; it shows
// on the product page only after an admin approves it.
// products.certifications always equals the approved rows for the product.
const pool = require("../config/database");
const Certifications = require("../../client/js/lz-certifications.js");
const { uploadPrivateDocument, privateDocumentViewUrl, destroyPrivateDocument } = require("../utils/cloudinaryUpload");
const { logActivity } = require("../utils/activityLog");

async function syncProductCertifications(db, productId) {
    await db.query(
        `UPDATE products SET certifications = COALESCE((
             SELECT array_agg(certification ORDER BY certification) FROM product_certificates
              WHERE product_id = $1 AND status = 'approved'), '{}')
          WHERE id = $1`, [productId]);
}

async function ownProduct(req, res) {
    const r = await pool.query("SELECT id FROM products WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL", [req.params.id, req.vendorId]);
    if (!r.rows.length) { res.status(404).json({ error: "Product not found on your account." }); return null; }
    return r.rows[0];
}

const PUBLIC_COLUMNS = "id, product_id, certification, original_filename, status, rejection_reason, uploaded_at, reviewed_at";

// --- Vendor -----------------------------------------------------------------
exports.listMyProductCertificates = async (req, res) => {
    try {
        if (!(await ownProduct(req, res))) return;
        const rows = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM product_certificates WHERE product_id = $1 ORDER BY certification`, [req.params.id]);
        res.json({ certificates: rows.rows });
    } catch (error) {
        if (error.code === "42P01") return res.json({ certificates: [] });
        res.status(500).json({ error: error.message });
    }
};

exports.uploadMyProductCertificate = async (req, res) => {
    try {
        if (!(await ownProduct(req, res))) return;
        const certification = Certifications.clean([req.body.certification])[0];
        if (!certification) return res.status(400).json({ error: "Choose a certification from the list." });
        if (!req.file) return res.status(400).json({ error: "Upload the certificate (a photo or a PDF)." });

        const prior = await pool.query(
            "SELECT cloudinary_public_id, resource_type FROM product_certificates WHERE product_id = $1 AND certification = $2",
            [req.params.id, certification]);
        const up = await uploadPrivateDocument(req.file.buffer, req.file.originalname);
        const saved = await pool.query(
            `INSERT INTO product_certificates (product_id, vendor_id, certification, cloudinary_public_id, resource_type, format, original_filename)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (product_id, certification) DO UPDATE SET
                cloudinary_public_id = $4, resource_type = $5, format = $6, original_filename = $7,
                status = 'pending', rejection_reason = NULL, uploaded_at = now(), reviewed_by = NULL, reviewed_at = NULL
             RETURNING ${PUBLIC_COLUMNS}`,
            [req.params.id, req.vendorId, certification, up.public_id, up.resource_type, up.format, req.file.originalname]);
        await syncProductCertifications(pool, req.params.id);   // a replaced certificate is hidden until re-approved
        if (prior.rows.length) {
            destroyPrivateDocument(prior.rows[0].cloudinary_public_id, prior.rows[0].resource_type)
                .catch((e) => console.error("Failed to remove a replaced certificate:", e.message));
        }
        res.status(201).json({ message: "Certificate uploaded. It will show on the product once Lizimas Store approves it.", certificate: saved.rows[0] });
    } catch (error) {
        if (error.code === "INVALID_FILE_TYPE") return res.status(400).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
};

exports.deleteMyProductCertificate = async (req, res) => {
    try {
        if (!(await ownProduct(req, res))) return;
        const gone = await pool.query(
            "DELETE FROM product_certificates WHERE id = $1 AND product_id = $2 RETURNING cloudinary_public_id, resource_type",
            [req.params.certId, req.params.id]);
        if (!gone.rows.length) return res.status(404).json({ error: "Certificate not found." });
        await syncProductCertifications(pool, req.params.id);
        destroyPrivateDocument(gone.rows[0].cloudinary_public_id, gone.rows[0].resource_type)
            .catch((e) => console.error("Failed to remove a certificate file:", e.message));
        res.json({ message: "Certification removed." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Admin ------------------------------------------------------------------
exports.listProductCertificatesAdmin = async (req, res) => {
    try {
        const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
        const rows = await pool.query(
            `SELECT c.id, c.product_id, c.certification, c.original_filename, c.status, c.rejection_reason, c.uploaded_at, c.reviewed_at,
                    p.name AS product_name, p.image AS product_image, v.id AS vendor_id, v.business_name
               FROM product_certificates c
               JOIN products p ON p.id = c.product_id
               JOIN vendors v ON v.id = c.vendor_id
              WHERE c.status = $1 AND p.deleted_at IS NULL
              ORDER BY c.uploaded_at ASC LIMIT 200`, [status]);
        const pending = await pool.query(
            `SELECT COUNT(*)::int AS n FROM product_certificates c JOIN products p ON p.id = c.product_id
              WHERE c.status = 'pending' AND p.deleted_at IS NULL`);
        res.json({ certificates: rows.rows, pending: pending.rows[0].n });
    } catch (error) {
        if (error.code === "42P01") return res.json({ certificates: [], pending: 0 });
        res.status(500).json({ error: error.message });
    }
};

exports.getProductCertificateUrlAdmin = async (req, res) => {
    try {
        const r = await pool.query("SELECT cloudinary_public_id, resource_type, format FROM product_certificates WHERE id = $1", [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ error: "Certificate not found." });
        const d = r.rows[0];
        res.json({ url: privateDocumentViewUrl(d.cloudinary_public_id, d.resource_type, d.format, false) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reviewProductCertificateAdmin = async (req, res) => {
    try {
        const decision = req.body.decision;
        const reason = String(req.body.reason || "").trim();
        if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "decision must be approved or rejected." });
        if (decision === "rejected" && !reason) return res.status(400).json({ error: "Write the reason - the vendor will see it." });
        const r = await pool.query(
            `UPDATE product_certificates SET status = $2, rejection_reason = $3, reviewed_by = $4, reviewed_at = now()
              WHERE id = $1 RETURNING id, product_id, vendor_id, certification, status`,
            [req.params.id, decision, decision === "rejected" ? reason : null, req.user.userId]);
        if (!r.rows.length) return res.status(404).json({ error: "Certificate not found." });
        const row = r.rows[0];
        await syncProductCertifications(pool, row.product_id);
        logActivity(req.user.userId, "product_certificate_" + decision, "product", row.product_id, `${row.certification}${reason ? " - " + reason : ""}`);
        res.json({ message: decision === "approved" ? "Approved - it now shows on the product." : "Rejected.", certificate: row });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.syncProductCertifications = syncProductCertifications;
