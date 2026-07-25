path = "server/routes/products.js"

with open(path, "r") as f:
    content = f.read()

old1 = "    getProductImages,"
count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)
content = content.replace(old1, "    getProductImages,\n    getProductOptions,")

old2 = 'router.get("/:id/images", getProductImages);'
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
content = content.replace(old2, 'router.get("/:id/images", getProductImages);\nrouter.get("/:id/options", getProductOptions);')

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: options route added")
