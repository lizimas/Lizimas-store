path = "client/js/staff-manager.js"

with open(path, "r") as f:
    content = f.read()

old = '''function renderImagePreviews(fileList) {
    const preview = document.getElementById("product-image-preview");
    if (!preview) return;
    preview.innerHTML = "";'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''function renderImagePreviews(fileList) {
    const preview = document.getElementById("product-image-preview");
    if (!preview) return;
    preview.innerHTML = "";

    pdLocalPreviews = Array.from(fileList).map(f => URL.createObjectURL(f));
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => renderThumbOptions(picker));'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: preview hook added")
