import shutil, datetime, sys

path = "client/js/admin.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# 1. KYC review modal: add TIN/VAT (company only) and work-permit rows to
#    the detail table. Document review and URSB sections already work
#    generically (renderDocumentsSection just iterates detail.documents),
#    so nothing there needs to change.
anchors.append((
'''            <table style="margin-bottom:14px;">
                <tbody>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Owner</td><td>${detail.owner_name || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Email</td><td>${detail.owner_email || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Phone</td><td>${detail.phone || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Applied</td><td>${detail.submitted_at ? new Date(detail.submitted_at).toLocaleDateString() : "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">${idLabel}</td><td>${idValue || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Account Type</td><td>${detail.account_type === "company" ? "Company" : "Individual"}</td></tr>
                </tbody>
            </table>''',
'''            <table style="margin-bottom:14px;">
                <tbody>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Owner</td><td>${detail.owner_name || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Email</td><td>${detail.owner_email || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Phone</td><td>${detail.phone || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Applied</td><td>${detail.submitted_at ? new Date(detail.submitted_at).toLocaleDateString() : "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">${idLabel}</td><td>${idValue || "-"}</td></tr>
                    ${detail.account_type === "company" ? `
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">TIN</td><td>${detail.tin_number || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">VAT Number</td><td>${detail.vat_number || "-"}</td></tr>
                    ` : ""}
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Work Permit Needed</td><td>${detail.requires_work_permit ? "Yes" : "No"}</td></tr>
                    <tr><td style="font-weight:600; padding:4px 12px 4px 0;">Account Type</td><td>${detail.account_type === "company" ? "Company" : "Individual"}</td></tr>
                </tbody>
            </table>'''
))

# 2. Payment instruments admin table: add an Evidence column, and disable
#    Approve (with an explanatory title) when the backend's can_approve
#    gate would refuse it - the backend already enforces this either way,
#    this is just making that visible before the admin clicks.
anchors.append((
'''        container.innerHTML = `
            <table>
                <thead><tr><th>Vendor</th><th>Method</th><th>Account Holder</th><th>Verified Legal Name</th><th>Account</th><th>Status</th><th></th></tr></thead>
                <tbody>
                    ${items.map(p => {
                        const match = paymentInstrumentNameMatches(p.account_holder_name, p.verified_legal_name);
                        const matchNote = match === null ? "" : match
                            ? `<div style="font-size:11px; color:#16A34A; margin-top:2px;">Matches</div>`
                            : `<div style="font-size:11px; color:#DC2626; margin-top:2px;">Does not match</div>`;
                        const statusCls = p.status === "approved" ? "status-paid" : p.status === "rejected" ? "status-cancelled" : "status-pending";
                        return `
                        <tr>
                            <td data-label="Vendor">${escapeHtml(p.business_name || "")}</td>
                            <td data-label="Method">${escapeHtml(p.method || "")}</td>
                            <td data-label="Account Holder">${escapeHtml(p.account_holder_name || "")}</td>
                            <td data-label="Verified Legal Name">${escapeHtml(p.verified_legal_name || "-")}${matchNote}</td>
                            <td data-label="Account">${escapeHtml(p.method === "momo" ? (p.momo_number || "") : (p.bank_name || "") + " · " + (p.account_number || ""))}</td>
                            <td data-label="Status"><span class="status-badge ${statusCls}">${escapeHtml(p.status || "")}</span></td>
                            <td data-label="">
                                ${p.status === "pending" ? `
                                    <button onclick="reviewPaymentInstrumentAdmin(${p.id}, 'approved')" style="background:#16A34A; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Approve</button>
                                    <button onclick="reviewPaymentInstrumentAdmin(${p.id}, 'rejected')" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Reject</button>
                                ` : (p.rejection_reason ? `<span style="font-size:12px; color:#888;">${escapeHtml(p.rejection_reason)}</span>` : "")}
                            </td>
                        </tr>
                    `; }).join("")}
                </tbody>
            </table>
        `;''',
'''        container.innerHTML = `
            <table>
                <thead><tr><th>Vendor</th><th>Method</th><th>Account Holder</th><th>Verified Legal Name</th><th>Account</th><th>Evidence</th><th>Status</th><th></th></tr></thead>
                <tbody>
                    ${items.map(p => {
                        const match = paymentInstrumentNameMatches(p.account_holder_name, p.verified_legal_name);
                        const matchNote = match === null ? "" : match
                            ? `<div style="font-size:11px; color:#16A34A; margin-top:2px;">Matches</div>`
                            : `<div style="font-size:11px; color:#DC2626; margin-top:2px;">Does not match</div>`;
                        const statusCls = p.status === "approved" ? "status-paid" : p.status === "rejected" ? "status-cancelled" : "status-pending";
                        const evidenceCell = p.has_evidence
                            ? `<a href="#" onclick="viewPaymentInstrumentEvidenceAdmin(${p.id}); return false;" style="font-size:12px;">View</a>`
                            : `<span style="font-size:12px; color:#DC2626;">None</span>`;
                        const approveDisabled = !p.can_approve;
                        const approveBtnStyle = approveDisabled
                            ? "background:#9CA3AF; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:not-allowed; margin-right:6px;"
                            : "background:#16A34A; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;";
                        const approveAttrs = approveDisabled ? `disabled title="No evidence document uploaded yet"` : "";
                        return `
                        <tr>
                            <td data-label="Vendor">${escapeHtml(p.business_name || "")}</td>
                            <td data-label="Method">${escapeHtml(p.method || "")}</td>
                            <td data-label="Account Holder">${escapeHtml(p.account_holder_name || "")}</td>
                            <td data-label="Verified Legal Name">${escapeHtml(p.verified_legal_name || "-")}${matchNote}</td>
                            <td data-label="Account">${escapeHtml(p.method === "momo" ? (p.momo_number || "") : (p.bank_name || "") + " · " + (p.account_number || ""))}</td>
                            <td data-label="Evidence">${evidenceCell}</td>
                            <td data-label="Status"><span class="status-badge ${statusCls}">${escapeHtml(p.status || "")}</span></td>
                            <td data-label="">
                                ${p.status === "pending" ? `
                                    <button onclick="reviewPaymentInstrumentAdmin(${p.id}, 'approved')" ${approveAttrs} style="${approveBtnStyle}">Approve</button>
                                    <button onclick="reviewPaymentInstrumentAdmin(${p.id}, 'rejected')" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Reject</button>
                                ` : (p.rejection_reason ? `<span style="font-size:12px; color:#888;">${escapeHtml(p.rejection_reason)}</span>` : "")}
                            </td>
                        </tr>
                    `; }).join("")}
                </tbody>
            </table>
        `;'''
))

# 3. New function: view a payment instrument's evidence document (admin
#    side) - same pattern as viewVendorKycDocument, just pointed at the
#    new evidence endpoint.
anchors.append((
'''async function reviewPaymentInstrumentAdmin(id, decision) {''',
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

async function reviewPaymentInstrumentAdmin(id, decision) {'''
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
