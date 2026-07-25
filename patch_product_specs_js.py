path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = '''    formData.append("price", price);
    formData.append("stock", stock);
    for (const file of imageFiles) {
        formData.append("images", file);
    }'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    formData.append("price", price);
    formData.append("stock", stock);
    formData.append("material", document.getElementById("spec-material").value.trim());
    formData.append("color", document.getElementById("spec-color").value.trim());
    formData.append("sleeve", document.getElementById("spec-sleeve").value.trim());
    formData.append("style", document.getElementById("spec-style").value.trim());
    formData.append("length", document.getElementById("spec-length").value.trim());
    formData.append("fit", document.getElementById("spec-fit").value.trim());
    formData.append("pattern", document.getElementById("spec-pattern").value.trim());
    formData.append("occasion", document.getElementById("spec-occasion").value.trim());
    formData.append("care_instructions", document.getElementById("spec-care-instructions").value.trim());
    for (const file of imageFiles) {
        formData.append("images", file);
    }'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_PRODUCT_SPECS_JS")
