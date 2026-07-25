path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = '''    await loadCategories();
    await loadMyProducts();
}'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    await loadCategories();
    await loadSizeCatalog();
    await loadColorCatalog();
    await loadMyProducts();

    const imageInput = document.getElementById("product-image");
    if (imageInput) {
        imageInput.addEventListener("change", handleImagePreview);
    }
}

let pdLocalPreviews = [];
let pdSelectedSizes = [];
let pdSelectedColors = {};

function handleImagePreview(e) {
    pdLocalPreviews = Array.from(e.target.files).map(file => URL.createObjectURL(file));
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => renderThumbOptions(picker));
}

async function loadSizeCatalog() {
    try {
        const response = await fetch(`${API_URL}/api/products/catalog/sizes`);
        const sizes = await response.json();
        const container = document.getElementById("size-checkbox-list");
        container.innerHTML = sizes.map(s => `
            <label style="display:flex; align-items:center; gap:4px; font-size:13px; border:1px solid #ccc; border-radius:16px; padding:4px 10px; cursor:pointer;">
                <input type="checkbox" value="${s.name}" onchange="toggleSizeSelection(this)"> ${s.name}
            </label>
        `).join("");
    } catch (error) {
        console.error("Load size catalog error:", error);
    }
}

function toggleSizeSelection(checkbox) {
    if (checkbox.checked) {
        pdSelectedSizes.push(checkbox.value);
    } else {
        pdSelectedSizes = pdSelectedSizes.filter(s => s !== checkbox.value);
    }
}

async function loadColorCatalog() {
    try {
        const response = await fetch(`${API_URL}/api/products/catalog/colors`);
        const colors = await response.json();
        const container = document.getElementById("color-checkbox-list");
        container.innerHTML = colors.map(c => `
            <div>
                <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
                    <input type="checkbox" value="${c.name}" onchange="toggleColorSelection(this)"> ${c.name}
                </label>
                <select class="pd-color-thumb-picker" data-color-name="${c.name}" style="display:none; margin-top:4px; padding:6px; border-radius:6px; border:1px solid #ccc;" onchange="setColorImage('${c.name}', this.value)"></select>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load color catalog error:", error);
    }
}

function toggleColorSelection(checkbox) {
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

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: options form JS added")
