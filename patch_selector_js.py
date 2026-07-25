path = "client/js/product-detail.js"

with open(path, "r") as f:
    content = f.read()

# Hook loadOptions into the main load flow, right after gallery loads
old1 = '''        await loadGallery(id, product);
        document.getElementById("pd-price").textContent = product.price'''

count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)

new1 = '''        await loadGallery(id, product);
        await loadOptions(id, product);
        document.getElementById("pd-price").textContent = product.price'''

content = content.replace(old1, new1)

# Add the loadOptions function and selection state, before renderSpecs
old2 = "function renderSpecs(product) {"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)

new2 = '''let pdSelectedColorId = null;
let pdSelectedSizeId = null;
let pdVariants = [];
let pdColors = [];

async function loadOptions(id, product) {
    const section = document.getElementById("pd-selector-section");

    let data = { colors: [], sizes: [], variants: [] };
    try {
        const res = await fetch(`/api/products/${id}/options`);
        if (res.ok) data = await res.json();
    } catch (err) {
        console.error("Failed to load product options", err);
    }

    pdColors = data.colors;
    pdVariants = data.variants;

    if (data.colors.length === 0 && data.sizes.length === 0) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    section.innerHTML = "";

    if (data.colors.length > 0) {
        const colorRow = document.createElement("div");
        colorRow.className = "pd-selector-row";
        colorRow.innerHTML = `<span class="pd-selector-label">Color</span><div id="pd-color-swatches" class="pd-color-swatches"></div>`;
        section.appendChild(colorRow);

        const swatchContainer = colorRow.querySelector("#pd-color-swatches");
        data.colors.forEach(color => {
            const swatch = document.createElement("div");
            swatch.className = "pd-color-swatch";
            swatch.innerHTML = `<img src="${color.image_path || ''}" alt="${color.name}">`;
            swatch.onclick = () => selectColor(color.id, color.image_path);
            swatch.dataset.colorId = color.id;
            swatchContainer.appendChild(swatch);
        });
    }

    if (data.sizes.length > 0) {
        const sizeRow = document.createElement("div");
        sizeRow.className = "pd-selector-row";
        sizeRow.innerHTML = `<span class="pd-selector-label">Size</span><div id="pd-size-buttons" class="pd-size-buttons"></div>`;
        section.appendChild(sizeRow);

        const sizeContainer = sizeRow.querySelector("#pd-size-buttons");
        data.sizes.forEach(size => {
            const btn = document.createElement("button");
            btn.className = "pd-size-btn";
            btn.textContent = size.name;
            btn.dataset.sizeId = size.id;
            btn.onclick = () => selectSize(size.id);
            sizeContainer.appendChild(btn);
        });
    }

    updateSizeAvailability();
}

function selectColor(colorId, imagePath) {
    pdSelectedColorId = colorId;
    document.querySelectorAll(".pd-color-swatch").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.colorId) === colorId);
    });
    if (imagePath) {
        const scrollContainer = document.getElementById("pd-gallery-scroll");
        const firstImg = scrollContainer.querySelector("img");
        if (firstImg) firstImg.src = imagePath;
    }
    updateSizeAvailability();
}

function selectSize(sizeId) {
    const btn = document.querySelector(`.pd-size-btn[data-size-id="${sizeId}"]`);
    if (btn && btn.classList.contains("disabled")) return;
    pdSelectedSizeId = sizeId;
    document.querySelectorAll(".pd-size-btn").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.sizeId) === sizeId);
    });
}

function updateSizeAvailability() {
    document.querySelectorAll(".pd-size-btn").forEach(btn => {
        const sizeId = Number(btn.dataset.sizeId);
        const variant = pdVariants.find(v =>
            v.size_id === sizeId && (pdSelectedColorId === null || v.color_id === pdSelectedColorId)
        );
        const outOfStock = variant && Number(variant.stock) <= 0;
        btn.classList.toggle("disabled", !!outOfStock);
    });
}

function renderSpecs(product) {'''

content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: selector JS added")
