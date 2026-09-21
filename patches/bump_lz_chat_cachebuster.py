import datetime, shutil, sys

files = [
    "client/categories.html",
    "client/contact.html",
    "client/faq.html",
    "client/help.html",
    "client/index.html",
    "client/privacy.html",
    "client/report.html",
    "client/returns.html",
    "client/terms.html",
]

old = '<script src="js/lz-chat.js?v=17"></script>'
new = '<script src="js/lz-chat.js?v=18"></script>'

# Check every file first -- all-or-nothing, so a stray already-bumped or
# already-different file doesn't leave the site half on the new widget and
# half on the cached old one.
problems = []
for path in files:
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        problems.append(f"  {path}: file not found")
        continue
    n = content.count(old)
    if n != 1:
        problems.append(f"  {path}: found {n}x (expected 1)")

if problems:
    print("ABORT: not every file matched exactly once. No changes made.")
    print("\n".join(problems))
    sys.exit(1)

stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
for path in files:
    with open(path, encoding="utf-8") as f:
        content = f.read()
    shutil.copy(path, path + ".bak." + stamp)
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

print(f"Bumped lz-chat.js to ?v=18 in all {len(files)} files. Backups suffixed .bak.{stamp}")
