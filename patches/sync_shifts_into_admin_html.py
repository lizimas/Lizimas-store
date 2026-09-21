import shutil, datetime, sys, glob

# The backup add_shifts_editor.py made just before patching -- that's the
# exact old (pre-Shifts-button) content, still embedded in admin.html.
backups = sorted(glob.glob("client/admin-support-control-center.partial.html.bak.*"))
if not backups:
    print("ABORT: no admin-support-control-center.partial.html.bak.* found. "
          "Run add_shifts_editor.py first (it creates this backup).")
    sys.exit(1)
old_partial_path = backups[-1]  # most recent, i.e. right before this round's edit

with open(old_partial_path, encoding="utf-8") as f:
    old_partial = f.read()
with open("client/admin-support-control-center.partial.html", encoding="utf-8") as f:
    new_partial = f.read()
with open("client/admin.html", encoding="utf-8") as f:
    admin_content = f.read()

n = admin_content.count(old_partial)
if n != 1:
    print(f"ABORT: old partial content found {n}x inside admin.html (expected 1). No changes made.")
    print(f"(Using backup file: {old_partial_path})")
    sys.exit(1)

backup = "client/admin.html.bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy("client/admin.html", backup)
admin_content = admin_content.replace(old_partial, new_partial, 1)
with open("client/admin.html", "w", encoding="utf-8") as f:
    f.write(admin_content)
print(f"Synced the Shifts editor into admin.html (using {old_partial_path}).")
print("Backup at " + backup)
