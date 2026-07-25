path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = 'res.json({ message, product: newProduct });'

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = 'res.json({ message, product: newProduct, images: imagePaths });'

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: addProduct now returns images array")
