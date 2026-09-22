import shutil, datetime, sys

path = "client/admin.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# 1. Products & Inventory: drop Brand Authorizations (moving to the new
#    Vendors group). Prohibited Items stays -- it's general product-upload
#    policy (enforced in productController for any upload), not vendor-specific.
anchors.append((
'''                            <button class="tab-btn vd-sub-item" data-tab="flash-sales">&#128293; Flash Sales</button>
                            <button class="tab-btn vd-sub-item" data-tab="brand-authorizations-admin">&#127991; Brand Authorizations</button>
                            <button class="tab-btn vd-sub-item" data-tab="prohibited-items-admin">&#128683; Prohibited Items</button>''',
'''                            <button class="tab-btn vd-sub-item" data-tab="flash-sales">&#128293; Flash Sales</button>
                            <button class="tab-btn vd-sub-item" data-tab="prohibited-items-admin">&#128683; Prohibited Items</button>'''
))

# 2. Orders & Fulfillment: trim to just Orders, then insert the new Vendors
#    group right after it (before Customers & Communication).
anchors.append((
'''                        <div class="vd-nav-children">
                            <button class="tab-btn vd-sub-item" data-tab="orders">&#128203; Orders</button>
                            <button class="tab-btn vd-sub-item" data-tab="consignments-admin">&#128666; Consignments</button>
                            <button class="tab-btn vd-sub-item" data-tab="vendors">&#129309; Vendors</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="customers-communication">''',
'''                        <div class="vd-nav-children">
                            <button class="tab-btn vd-sub-item" data-tab="orders">&#128203; Orders</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="vendors">
                        <button class="vd-nav-parent" onclick="toggleAdminNavGroup('vendors')">
                            <span class="sidebar-icon">&#129309;</span>
                            <span class="vd-nav-label">Vendors</span>
                            <span class="vd-nav-chevron">&#8250;</span>
                        </button>
                        <div class="vd-nav-children">
                            <button class="tab-btn vd-sub-item" data-tab="vendors">&#129309; Vendors</button>
                            <button class="tab-btn vd-sub-item" data-tab="brand-authorizations-admin">&#127991; Brand Authorizations</button>
                            <button class="tab-btn vd-sub-item" data-tab="payment-instruments-admin">&#128179; Payment Instruments</button>
                            <button class="tab-btn vd-sub-item" data-tab="consignments-admin">&#128666; Consignments</button>
                            <button class="tab-btn vd-sub-item" data-tab="ad-campaigns-admin">&#128227; Ad Campaigns</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="customers-communication">'''
))

# 3. Customers & Communication: drop Ad Campaigns.
anchors.append((
'''                            <button class="tab-btn vd-sub-item" data-tab="team-messages">&#128233; Team Messages</button>
                            <button class="tab-btn vd-sub-item" data-tab="ad-campaigns-admin">&#128227; Ad Campaigns</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="support-team">''',
'''                            <button class="tab-btn vd-sub-item" data-tab="team-messages">&#128233; Team Messages</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="support-team">'''
))

# 4. Admin & Account: drop Payment Instruments.
anchors.append((
'''                            <button class="tab-btn vd-sub-item" data-tab="staff">&#9989; Staff &amp; Approvals</button>
                            <button class="tab-btn vd-sub-item" data-tab="payment-instruments-admin">&#128179; Payment Instruments</button>
                            <button class="tab-btn vd-sub-item" data-tab="security">&#128737; Security</button>''',
'''                            <button class="tab-btn vd-sub-item" data-tab="staff">&#9989; Staff &amp; Approvals</button>
                            <button class="tab-btn vd-sub-item" data-tab="security">&#128737; Security</button>'''
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
print(f"Patched all {len(anchors)} anchors -- vendor items consolidated into one group.")
print("Backup at " + backup)
