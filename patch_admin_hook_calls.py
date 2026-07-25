path = "client/js/admin.js"

with open(path, "r") as f:
    content = f.read()

old = "        await loadCategories();"
count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = "        await loadCategories();\n        await loadSizeCatalog();\n        await loadColorCatalog();"
content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_ADMIN_HOOK_CALLS")
