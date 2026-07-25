path = "client/js/staff-manager.js"

with open(path, "r") as f:
    content = f.read()

old1 = '''                <select class="pd-color-thumb-picker" data-color-name="${c.name}" style="display:none; margin-top:4px; padding:6px; border-radius:6px; border:1px solid #ccc;" onchange="setColorImage('${c.name}', this.value)"></select>'''

count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)

new1 = '''                <div class="pd-color-thumb-picker" data-color-name="${c.name}" style="display:none; flex-wrap:wrap; gap:6px; margin-top:6px;"></div>'''

content = content.replace(old1, new1)

old2 = '''function toggleColorSelection(checkbox) {
    const picker = checkbox.closest("div").querySelector(".pd-color-thumb-picker");
    if (checkbox.checked) {
        pdSelectedColors[checkbox.value] = null;
        picker.style.display = "block";
        renderThumbOptions(picker);
    } else {
        delete pdSelectedColors[checkbox.value];
        picker.style.display = "none";
    }
}

function renderThumbOptions(picker) {
    if (pdLocalPreviews.length === 0) {
        picker.innerHTML = `<option value="">Upload photos first</option>`;
        return;
    }
    picker.innerHTML = `<option value="">Choose photo for this color</option>` +
        pdLocalPreviews.map((url, i) => `<option value="${i}">Photo ${i + 1}</option>`).join("");
}

function setColorImage(colorName, index) {
    pdSelectedColors[colorName] = index === "" ? null : Number(index);
}'''

count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)

new2 = '''function toggleColorSelection(checkbox) {
    const picker = checkbox.closest("div").querySelector(".pd-color-thumb-picker");
    if (checkbox.checked) {
        pdSelectedColors[checkbox.value] = null;
        picker.style.display = "flex";
        renderThumbOptions(picker);
    } else {
        delete pdSelectedColors[checkbox.value];
        picker.style.display = "none";
    }
}

function renderThumbOptions(picker) {
    const colorName = picker.dataset.colorName;
    if (pdLocalPreviews.length === 0) {
        picker.innerHTML = `<span style="font-size:12px; color:#999;">Upload photos first</span>`;
        return;
    }
    picker.innerHTML = pdLocalPreviews.map((url, i) => `
        <img src="${url}" data-index="${i}" onclick="selectColorThumb(this, '${colorName}')" style="width:48px; height:48px; object-fit:cover; border-radius:6px; border:2px solid #ccc; cursor:pointer;">
    `).join("");
}

function selectColorThumb(imgEl, colorName) {
    const container = imgEl.parentElement;
    container.querySelectorAll("img").forEach(img => img.style.borderColor = "#ccc");
    imgEl.style.borderColor = "#ff6a00";
    setColorImage(colorName, imgEl.dataset.index);
}

function setColorImage(colorName, index) {
    pdSelectedColors[colorName] = index === "" ? null : Number(index);
}'''

content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: thumbnail picker added to staff-manager.js")
