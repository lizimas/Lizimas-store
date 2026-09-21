import shutil, datetime, sys

path = "client/admin.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''                    <div class="vd-nav-group" data-group="customers-communication">
                        <button class="vd-nav-parent" onclick="toggleAdminNavGroup('customers-communication')">
                            <span class="sidebar-icon">&#128101;</span>
                            <span class="vd-nav-label">Customers &amp; Communication</span>
                            <span class="vd-nav-badge" id="admin-sidebar-customers-badge" hidden>0</span>
                            <span class="vd-nav-chevron">&#8250;</span>
                        </button>
                        <div class="vd-nav-children">
                            <button class="tab-btn vd-sub-item" data-tab="customers">&#128101; Customers</button>
                            <button class="tab-btn vd-sub-item" data-tab="support">&#127908; Live Support</button>
                            <button class="tab-btn vd-sub-item" data-tab="team-messages">&#128233; Team Messages</button>
                            <button class="tab-btn vd-sub-item" data-tab="ad-campaigns-admin">&#128227; Ad Campaigns</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="admin-account">'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

new_group = '''                    <div class="vd-nav-group" data-group="customers-communication">
                        <button class="vd-nav-parent" onclick="toggleAdminNavGroup('customers-communication')">
                            <span class="sidebar-icon">&#128101;</span>
                            <span class="vd-nav-label">Customers &amp; Communication</span>
                            <span class="vd-nav-badge" id="admin-sidebar-customers-badge" hidden>0</span>
                            <span class="vd-nav-chevron">&#8250;</span>
                        </button>
                        <div class="vd-nav-children">
                            <button class="tab-btn vd-sub-item" data-tab="customers">&#128101; Customers</button>
                            <button class="tab-btn vd-sub-item" data-tab="support">&#127908; Live Support</button>
                            <button class="tab-btn vd-sub-item" data-tab="team-messages">&#128233; Team Messages</button>
                            <button class="tab-btn vd-sub-item" data-tab="ad-campaigns-admin">&#128227; Ad Campaigns</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="support-team">
                        <button class="vd-nav-parent" onclick="toggleAdminNavGroup('support-team')">
                            <span class="sidebar-icon">&#128188;</span>
                            <span class="vd-nav-label">Support Team</span>
                            <span class="vd-nav-chevron">&#8250;</span>
                        </button>
                        <div class="vd-nav-children">
                            <button class="tab-btn vd-sub-item" data-tab="support-team">&#128188; Support Team</button>
                        </div>
                    </div>

                    <div class="vd-nav-group" data-group="admin-account">'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, new_group, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
