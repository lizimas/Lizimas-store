import re

path = "client/js/products.js"

with open(path, "r") as f:
    content = f.read()

# Replace the two identical calls: openProductModal(product.id);
old1 = "openProductModal(product.id);"
count1 = content.count(old1)
if count1 != 2:
    print(f"ABORT: expected 2 occurrences of old1, found {count1}")
    exit(1)
new1 = "window.location.href = `product-detail.html?id=${product.id}`;"
content = content.replace(old1, new1)

# Replace the URL param deep-link call
old2 = "openProductModal(Number(openProductId));"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
new2 = "window.location.href = `product-detail.html?id=${openProductId}`;"
content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: patched both call sites")
