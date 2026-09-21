import shutil, datetime, sys, os

admin_path = "client/admin.html"
partial_path = "client/admin-support-control-center.partial.html"

if not os.path.exists(partial_path):
    print(f"ABORT: {partial_path} not found. Make sure the whole package was extracted, not just this script.")
    sys.exit(1)

with open(admin_path, encoding="utf-8") as f:
    admin_content = f.read()
with open(partial_path, encoding="utf-8") as f:
    partial_content = f.read()

anchor = '''                        <div class="monitor-actions" id="monitor-actions"></div>
                    </div>
                </section>

                <section id="tab-staff" class="tab-content hidden">'''

n = admin_content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = (
    '''                        <div class="monitor-actions" id="monitor-actions"></div>
                    </div>
                </section>

'''
    + partial_content
    + '''
                <section id="tab-staff" class="tab-content hidden">'''
)

backup = admin_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(admin_path, backup)
admin_content = admin_content.replace(anchor, replacement, 1)
with open(admin_path, "w", encoding="utf-8") as f:
    f.write(admin_content)

print("Inserted the Support Team section between tab-support and tab-staff.")
print("Backup at " + backup)
