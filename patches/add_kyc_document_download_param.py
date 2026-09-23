import shutil, datetime, sys

path = "server/controllers/vendorKycController.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# Vendor's own KYC document URL
anchors.append((
'''exports.getMyKycDocumentUrl = async (req, res) => {
    try {
        const { document_type } = req.query;
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
        const url = privateDocumentViewUrl(doc.cloudinary_public_id, doc.resource_type, doc.format);
        res.json({ url });''',
'''exports.getMyKycDocumentUrl = async (req, res) => {
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
        res.json({ url });'''
))

# Admin's view of a vendor's KYC document URL
anchors.append((
'''exports.getVendorKycDocumentAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { document_type } = req.query;

        const docRow = await pool.query(
            "SELECT cloudinary_public_id, resource_type, format FROM vendor_kyc_documents WHERE vendor_id = $1 AND document_type = $2",
            [id, document_type]
        );
        if (docRow.rows.length === 0) {
            return res.status(404).json({ error: "No document on file." });
        }

        const doc = docRow.rows[0];
        const url = privateDocumentViewUrl(doc.cloudinary_public_id, doc.resource_type, doc.format);
        res.json({ url });''',
'''exports.getVendorKycDocumentAdmin = async (req, res) => {
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
