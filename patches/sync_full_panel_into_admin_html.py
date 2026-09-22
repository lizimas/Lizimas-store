import shutil, datetime, sys

with open("client/admin-support-control-center.partial.html", encoding="utf-8") as f:
    new_partial = f.read()
with open("client/admin.html", encoding="utf-8") as f:
    admin_content = f.read()

start_marker = '<section id="tab-support-team" class="tab-content hidden">'
end_marker = '<section id="tab-staff" class="tab-content hidden">'

if admin_content.count(start_marker) != 1:
    print(f"ABORT: start marker found {admin_content.count(start_marker)}x (expected 1).")
    sys.exit(1)
if admin_content.count(end_marker) != 1:
    print(f"ABORT: end marker found {admin_content.count(end_marker)}x (expected 1).")
    sys.exit(1)

start = admin_content.index(start_marker)
end = admin_content.index(end_marker)
if end <= start:
    print("ABORT: end marker appears before start marker. No changes made.")
    sys.exit(1)

backup = "client/admin.html.bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy("client/admin.html", backup)

new_admin_content = admin_content[:start] + new_partial + "\n\n                " + admin_content[end:]
with open("client/admin.html", "w", encoding="utf-8") as f:
    f.write(new_admin_content)
print("Synced the full panel (canned edit + agent edit/skills + business hours) into admin.html.")
print("Backup at " + backup)
