import shutil, datetime, sys

path = "client/store.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

targets = [
    ("vendor-register.html", 1),
    ("vendor-login.html", 1),
]

problems = []
for name, expected in targets:
    old = f'href="{name}"'
    n = content.count(old)
    if n != expected:
        problems.append(f"  href=\"{name}\": found {n}x (expected {expected})")

if problems:
    print("ABORT: one or more hrefs had an unexpected occurrence count. No changes made.")
    print("\n".join(problems))
    sys.exit(1)

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
for name, expected in targets:
    old = f'href="{name}"'
    new = f'href="/{name}"'
    content = content.replace(old, new)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print(f"Patched all {len(targets)} distinct hrefs. Backup at " + backup)
