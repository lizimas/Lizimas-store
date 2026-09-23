import shutil, datetime, sys

path = "client/js/admin.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# 1. KYC document row: add a Download button next to View, and the new
#    downloadVendorKycDocument function right after viewVendorKycDocument.
anchors.append((
'''                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button onclick="viewVendorKycDocument(${vendorId}, '${d.document_type}')" style="background:#16264f; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">View</button>
                    <button onclick="reviewDocument(${vendorId}, '${d.document_type}', 'accepted')" style="background:#059669; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Accept</button>
                    <button onclick="reviewDocument(${vendorId}, '${d.document_type}', 'action_required')" style="background:#d97706; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Needs better</button>
                    <button onclick="reviewDocument(${vendorId}, '${d.document_type}', 'rejected')" style="background:#dc2626; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Reject</button>
                </div>''',
'''                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button onclick="viewVendorKycDocument(${vendorId}, '${d.document_type}')" style="background:#16264f; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">View</button>
                    <button onclick="downloadVendorKycDocument(${vendorId}, '${d.document_type}')" style="background:#fff; color:#16264f; border:1px solid #16264f; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Download</button>
                    <button onclick="reviewDocument(${vendorId}, '${d.document_type}', 'accepted')" style="background:#059669; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Accept</button>
                    <button onclick="reviewDocument(${vendorId}, '${d.document_type}', 'action_required')" style="background:#d97706; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Needs better</button>
                    <button onclick="reviewDocument(${vendorId}, '${d.document_type}', 'rejected')" style="background:#dc2626; color:#fff; border:none; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer;">Reject</button>
                </div>'''
))

anchors.append((
'''async function viewVendorKycDocument(vendorId, documentType) {
    try {
        const data = await authorizedFetch(`/api/admin/vendors/${vendorId}/kyc/documents/url?document_type=${encodeURIComponent(documentType)}`);
        if (data.error) {
            alert(data.error);
            return;
        }
        window.open(data.url, "_blank", "noopener");
    } catch (error) {
        console.error("View vendor KYC document error:", error);
        alert("Could not open this document.");
    }
}''',
'''async function viewVendorKycDocument(vendorId, documentType) {
    try {
        const data = await authorizedFetch(`/api/admin/vendors/${vendorId}/kyc/documents/url?document_type=${encodeURIComponent(documentType)}`);
        if (data.error) {
            alert(data.error);
            return;
        }
        window.open(data.url, "_blank", "noopener");
    } catch (error) {
        console.error("View vendor KYC document error:", error);
        alert("Could not open this document.");
    }
}

// Same as viewVendorKycDocument but with download=true, which makes
// Cloudinary send Content-Disposition: attachment - for Lizimas's own
// compliance record-keeping (Ryan).
async function downloadVendorKycDocument(vendorId, documentType) {
    try {
        const data = await authorizedFetch(`/api/admin/vendors/${vendorId}/kyc/documents/url?document_type=${encodeURIComponent(documentType)}&download=true`);
        if (data.error) {
            alert(data.error);
            return;
        }
        window.open(data.url, "_blank", "noopener");
    } catch (error) {
        console.error("Download vendor KYC document error:", error);
        alert("Could not download this document.");
    }
}'''
))

# 2. Payment instruments evidence cell: add a Download link next to View.
anchors.append((
'''                        const evidenceCell = p.has_evidence
                            ? `<a href="#" onclick="viewPaymentInstrumentEvidenceAdmin(${p.id}); return false;" style="font-size:12px;">View</a>`
                            : `<span style="font-size:12px; color:#DC2626;">None</span>`;''',
'''                        const evidenceCell = p.has_evidence
                            ? `<a href="#" onclick="viewPaymentInstrumentEvidenceAdmin(${p.id}); return false;" style="font-size:12px;">View</a> &middot; <a href="#" onclick="downloadPaymentInstrumentEvidenceAdmin(${p.id}); return false;" style="font-size:12px;">Download</a>`
                            : `<span style="font-size:12px; color:#DC2626;">None</span>`;'''
))

anchors.append((
'''async function viewPaymentInstrumentEvidenceAdmin(instrumentId) {
    try {
        const data = await authorizedFetch(`/api/admin/payment-instruments/${instrumentId}/evidence/url`);
        if (data.error) { alert(data.error); return; }
        window.open(data.url, "_blank", "noopener");
    } catch (error) {
        console.error("viewPaymentInstrumentEvidenceAdmin error:", error);
        alert("Could not open this document.");
    }
}''',
'''async function viewPaymentInstrumentEvidenceAdmin(instrumentId) {
    try {
        const data = await authorizedFetch(`/api/admin/payment-instruments/${instrumentId}/evidence/url`);
        if (data.error) { alert(data.error); return; }
        window.open(data.url, "_blank", "noopener");
    } catch (error) {
        console.error("viewPaymentInstrumentEvidenceAdmin error:", error);
        alert("Could not open this document.");
    }
}

// Same as viewPaymentInstrumentEvidenceAdmin but with download=true, for
// Lizimas's own compliance record-keeping (Ryan).
async function downloadPaymentInstrumentEvidenceAdmin(instrumentId) {
    try {
        const data = await authorizedFetch(`/api/admin/payment-instruments/${instrumentId}/evidence/url?download=true`);
        if (data.error) { alert(data.error); return; }
        window.open(data.url, "_blank", "noopener");
    } catch (error) {
        console.error("downloadPaymentInstrumentEvidenceAdmin error:", error);
        alert("Could not download this document.");
    }
}'''
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
