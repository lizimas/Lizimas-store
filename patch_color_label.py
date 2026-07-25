path = "client/js/product-detail.js"

with open(path, "r") as f:
    content = f.read()

old = '''        colorRow.innerHTML = `<span class="pd-selector-label">Color</span><div id="pd-color-swatches" class="pd-color-swatches"></div>`;'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        colorRow.innerHTML = `<span class="pd-selector-label">Color<span id="pd-selected-color-name" class="pd-selected-color-name"></span></span><div id="pd-color-swatches" class="pd-color-swatches"></div>`;'''

content = content.replace(old, new)

old2 = '''    swatch.onclick = () => selectColor(color.id, color.image_path);'''
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
new2 = '''    swatch.onclick = () => selectColor(color.id, color.image_path, color.name);'''
content = content.replace(old2, new2)

old3 = '''function selectColor(colorId, imagePath) {
    pdSelectedColorId = colorId;
    document.querySelectorAll(".pd-color-swatch").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.colorId) === colorId);
    });'''
count3 = content.count(old3)
if count3 != 1:
    print(f"ABORT: expected 1 occurrence of old3, found {count3}")
    exit(1)
new3 = '''function selectColor(colorId, imagePath, colorName) {
    pdSelectedColorId = colorId;
    document.querySelectorAll(".pd-color-swatch").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.colorId) === colorId);
    });
    const nameEl = document.getElementById("pd-selected-color-name");
    if (nameEl) nameEl.textContent = colorName ? `: ${colorName}` : "";'''
content = content.replace(old3, new3)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: color label added")
