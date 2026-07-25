path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old1 = '''function toggleColorSelection(checkbox) {
    const picker = checkbox.closest("div").querySelector(".pd-color-thumb-picker");
    if (checkbox.checked) {
        pdSelectedColors[checkbox.value] = null;
        picker.style.display = "flex";
        renderThumbOptions(picker);
    } else {
        delete pdSelectedColors[checkbox.value];
        picker.style.display = "none";
    }
}'''

count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)

new1 = '''function toggleColorSelection(checkbox) {
    const picker = checkbox.closest("div").querySelector(".pd-color-thumb-picker");
    if (checkbox.checked) {
        pdSelectedColors[checkbox.value] = [];
        picker.style.display = "flex";
        renderThumbOptions(picker);
    } else {
        delete pdSelectedColors[checkbox.value];
        picker.style.display = "none";
    }
}'''

content = content.replace(old1, new1)

old2 = '''function selectColorThumb(imgEl, colorName) {
    const container = imgEl.parentElement;
    container.querySelectorAll("img").forEach(img => img.style.borderColor = "#ccc");
    imgEl.style.borderColor = "#ff6a00";
    setColorImage(colorName, imgEl.dataset.index);
}

function setColorImage(colorName, index) {
    pdSelectedColors[colorName] = index === "" ? null : Number(index);
}'''

count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)

new2 = '''function selectColorThumb(imgEl, colorName) {
    const index = Number(imgEl.dataset.index);
    if (!Array.isArray(pdSelectedColors[colorName])) pdSelectedColors[colorName] = [];

    const alreadySelected = pdSelectedColors[colorName].includes(index);
    if (alreadySelected) {
        pdSelectedColors[colorName] = pdSelectedColors[colorName].filter(i => i !== index);
        imgEl.style.borderColor = "#ccc";
    } else {
        pdSelectedColors[colorName].push(index);
        imgEl.style.borderColor = "#ff6a00";
    }
}'''

content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("DONE_MULTISELECT_PRODUCT")
