import shutil, datetime, sys

path = "client/vendor/dashboard.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# 1. KYC panel: add TIN/VAT groups, work-permit checkbox, and change the
#    single-document row into a multi-document container.
anchors.append((
'''                    <div class="panel" id="vendor-kyc-panel">
                        <h2>Identity &amp; Business Verification</h2>
                        <p class="admin-page-subtitle">Verifying your ID or business registration lets Lizimas Store confirm you're a real, trustworthy seller.</p>

                        <div style="margin-bottom:12px;">
                            <span id="vendor-kyc-status-badge" class="status-badge">Loading...</span>
                        </div>

                        <p id="vendor-kyc-review-note" class="hidden" style="background:#FEF3C7; color:#92400E; padding:10px 12px; border-radius:8px; font-size:13px; margin:0 0 12px 0;"></p>

                        <div id="vendor-kyc-documents" style="margin-bottom:14px;">
                            <h3 style="margin:0 0 8px; font-size:13.5px; color:#333;">Supporting Document</h3>
                            <div id="vendor-kyc-document-row">Loading...</div>
                        </div>

                        <div id="vendor-kyc-form" class="hidden" style="display:flex; flex-direction:column; gap:12px; max-width:420px;">
                            <div class="hidden" id="vendor-kyc-regnum-group">
                                <label style="font-size:13px; font-weight:600; color:#333;">URSB Business Registration Number</label>
                                <input type="text" id="vendor-kyc-regnum" placeholder="Your registered business number" style="padding:10px; border:1px solid #ccc; border-radius:8px; width:100%; box-sizing:border-box;">
                            </div>

                            <div class="hidden" id="vendor-kyc-natid-group">
                                <label style="font-size:13px; font-weight:600; color:#333;">National ID Number</label>
                                <input type="text" id="vendor-kyc-natid" placeholder="For identity verification (KYC)" style="padding:10px; border:1px solid #ccc; border-radius:8px; width:100%; box-sizing:border-box;">
                            </div>

                            <p id="vendor-kyc-status-msg" style="color:#DC2626; font-size:13px; margin:0;"></p>

                            <button onclick="submitVendorKyc()" style="background:#16264f; color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer; width:fit-content;">Submit for review</button>
                        </div>

                        <div id="vendor-kyc-locked-view" class="hidden">
                            <p id="vendor-kyc-locked-text" style="font-size:13px; color:#555; margin:0;"></p>
                        </div>
                    </div>''',
'''                    <div class="panel" id="vendor-kyc-panel">
                        <h2>Identity &amp; Business Verification</h2>
                        <p class="admin-page-subtitle">Verifying your ID or business registration lets Lizimas Store confirm you're a real, trustworthy seller.</p>

                        <div style="margin-bottom:12px;">
                            <span id="vendor-kyc-status-badge" class="status-badge">Loading...</span>
                        </div>

                        <p id="vendor-kyc-review-note" class="hidden" style="background:#FEF3C7; color:#92400E; padding:10px 12px; border-radius:8px; font-size:13px; margin:0 0 12px 0;"></p>

                        <div id="vendor-kyc-documents" style="margin-bottom:14px;">
                            <h3 style="margin:0 0 8px; font-size:13.5px; color:#333;">Supporting Documents</h3>
                            <div id="vendor-kyc-document-rows">Loading...</div>
                        </div>

                        <div id="vendor-kyc-form" class="hidden" style="display:flex; flex-direction:column; gap:12px; max-width:420px;">
                            <div class="hidden" id="vendor-kyc-regnum-group">
                                <label style="font-size:13px; font-weight:600; color:#333;">URSB Business Registration Number</label>
                                <input type="text" id="vendor-kyc-regnum" placeholder="Your registered business number" style="padding:10px; border:1px solid #ccc; border-radius:8px; width:100%; box-sizing:border-box;">
                            </div>

                            <div class="hidden" id="vendor-kyc-tin-group">
                                <label style="font-size:13px; font-weight:600; color:#333;">TIN (Tax Identification Number)</label>
                                <input type="text" id="vendor-kyc-tin" placeholder="Your TIN" style="padding:10px; border:1px solid #ccc; border-radius:8px; width:100%; box-sizing:border-box;">
                            </div>

                            <div class="hidden" id="vendor-kyc-vat-group">
                                <label style="font-size:13px; font-weight:600; color:#333;">VAT Number</label>
                                <input type="text" id="vendor-kyc-vat" placeholder="Your VAT number" style="padding:10px; border:1px solid #ccc; border-radius:8px; width:100%; box-sizing:border-box;">
                            </div>

                            <div class="hidden" id="vendor-kyc-natid-group">
                                <label style="font-size:13px; font-weight:600; color:#333;">National ID Number</label>
                                <input type="text" id="vendor-kyc-natid" placeholder="For identity verification (KYC)" style="padding:10px; border:1px solid #ccc; border-radius:8px; width:100%; box-sizing:border-box;">
                            </div>

                            <label style="font-size:13px; display:flex; align-items:center; gap:8px;">
                                <input type="checkbox" id="vendor-kyc-work-permit-checkbox" onchange="vdToggleWorkPermitField()">
                                I am not a Ugandan citizen and need a work permit
                            </label>

                            <p id="vendor-kyc-status-msg" style="color:#DC2626; font-size:13px; margin:0;"></p>

                            <button onclick="submitVendorKyc()" style="background:#16264f; color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer; width:fit-content;">Submit for review</button>
                        </div>

                        <div id="vendor-kyc-locked-view" class="hidden">
                            <p id="vendor-kyc-locked-text" style="font-size:13px; color:#555; margin:0;"></p>
                        </div>
                    </div>'''
))

# 2. Payment instruments header row: add an Evidence column heading.
anchors.append((
'''                        <h2>Payment Information</h2>
                        <p class="admin-page-subtitle">Reviewed payout accounts. A pending or approved instrument can't be edited directly - only a rejected one can be corrected and resubmitted.</p>
                        <div id="vendor-payment-instruments-list">Loading...</div>''',
'''                        <h2>Payment Information</h2>
                        <p class="admin-page-subtitle">Reviewed payout accounts. A pending or approved instrument can't be edited directly - only a rejected one can be corrected and resubmitted. Upload a bank certificate or MoMo statement as evidence before it can be approved.</p>
                        <div id="vendor-payment-instruments-list">Loading...</div>'''
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
