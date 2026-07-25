path = "server/routes/products.js"

with open(path, "r") as f:
    content = f.read()

old1 = "    getProductOptions,"
count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)
content = content.replace(old1, "    getProductOptions,\n    getSizeCatalog,\n    getColorCatalog,\n    saveProductOptions,")

old2 = 'router.get("/:id/options", getProductOptions);'
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
new2 = '''router.get("/:id/options", getProductOptions);
router.get("/catalog/sizes", getSizeCatalog);
router.get("/catalog/colors", getColorCatalog);
router.post("/:id/options", requireAuth, requireStaffOrAdmin, saveProductOptions);'''
content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: catalog + save-options routes added")
