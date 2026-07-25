path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = '''    document.getElementById("product-image").value = "";
    document.getElementById("product-form-title").textContent = "Add Product";'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    document.getElementById("product-image").value = "";
    document.getElementById("spec-material").value = "";
    document.getElementById("spec-color").value = "";
    document.getElementById("spec-sleeve").value = "";
    document.getElementById("spec-style").value = "";
    document.getElementById("spec-length").value = "";
    document.getElementById("spec-fit").value = "";
    document.getElementById("spec-pattern").value = "";
    document.getElementById("spec-occasion").value = "";
    document.getElementById("spec-care-instructions").value = "";
    document.getElementById("product-form-title").textContent = "Add Product";'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_PRODUCT_SPECS_RESET")
