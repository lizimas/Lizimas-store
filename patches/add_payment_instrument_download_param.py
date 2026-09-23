import shutil, datetime, sys

path = "server/controllers/vendorPaymentInstrumentsController.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# Vendor's own evidence URL
anchors.append((
'''exports.getMyPaymentInstrumentEvidenceUrl = async (req, res) => {
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
        res.json({ url });''',
'''exports.getMyPaymentInstrumentEvidenceUrl = async (req, res) => {
    try {
        const vendor = await getVendorForUser(req.user.userId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { id } = req.params;
        const { download } = req.query;
        const docRow = await pool.query(
            "SELECT evidence_cloudinary_public_id, evidence_resource_type, evidence_format FROM vendor_payment_instruments WHERE id = $1 AND vendor_id = $2",
            [id, vendor.id]
        );
        if (docRow.rows.length === 0 || !docRow.rows[0].evidence_cloudinary_public_id) {
            return res.status(404).json({ error: "No evidence document on file for this instrument." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.evidence_cloudinary_public_id, doc.evidence_resource_type, doc.evidence_format, download === "true");
        res.json({ url });'''
))

# Admin's view of an instrument's evidence URL
anchors.append((
'''exports.getPaymentInstrumentEvidenceUrlAdmin = async (req, res) => {
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
        res.json({ url });''',
'''exports.getPaymentInstrumentEvidenceUrlAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { download } = req.query;
        const docRow = await pool.query(
            "SELECT evidence_cloudinary_public_id, evidence_resource_type, evidence_format FROM vendor_payment_instruments WHERE id = $1",
            [id]
        );
        if (docRow.rows.length === 0 || !docRow.rows[0].evidence_cloudinary_public_id) {
            return res.status(404).json({ error: "No evidence document on file for this instrument." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.evidence_cloudinary_public_id, doc.evidence_resource_type, doc.evidence_format, download === "true");
        res.json({ url });'''
))

problems = []
for i, (old, new) in enumerate(anchors, 1):
    n = content.count(old)
    if n != 1:
        problems.append(f"  anchor {i}: found {n}x (expected 1)")

if problems:
    print("ABORT: one or more anchors did not match exactly once. No changes made.")
    print("\n".join(problems))
    sys.exit(1)

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
for old, new in anchors:
    content = content.replace(old, new, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print(f"Patched all {len(anchors)} anchors. Backup at " + backup)
