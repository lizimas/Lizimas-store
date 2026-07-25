const PD_SPEC_LABELS = {
    material: "Material",
    color: "Color",
    sleeve: "Sleeve",
    style: "Style",
    length: "Length",
    fit: "Fit",
    pattern: "Pattern",
    care_instructions: "Care Instructions",
    occasion: "Occasion"
};

async function loadProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (!id) {
        document.getElementById("pd-name").textContent = "Product not found";
        return;
    }

    try {
        const res = await fetch(`/api/products/${id}`);
        if (!res.ok) throw new Error("Product not found");
        const product = await res.json();

        document.getElementById("pd-name").textContent = product.name || "";
        await loadGallery(id, product);
        await loadOptions(id, product);
        document.getElementById("pd-price").textContent = product.price
            ? `UGX ${Number(product.price).toLocaleString()}`
            : "";
        document.getElementById("pd-description").textContent = product.description || "No description available.";



        document.getElementById("pd-add-to-cart-btn").onclick = () => {
            addToCart(product.id, product.name, product.price, product.image, product.description);
        };

        document.getElementById("pd-fullscreen-share").onclick = () => sharePdProduct(product);

    } catch (err) {
        console.error(err);
        document.getElementById("pd-name").textContent = "Failed to load product";
    }
}

async function loadGallery(id, product) {
    const scrollContainer = document.getElementById("pd-gallery-scroll");
    const counter = document.getElementById("pd-gallery-counter");
    scrollContainer.innerHTML = "";

    let images = [];
    try {
        const res = await fetch(`/api/products/${id}/images`);
        if (res.ok) images = await res.json();
    } catch (err) {
        console.error("Failed to load gallery images", err);
    }

    const imagePaths = images.length > 0
        ? images.map(img => img.image_path)
        : [product.image];

    pdGalleryImages = imagePaths;
    pdGalleryAlt = product.name || "";

    imagePaths.forEach((src, index) => {
        const img = document.createElement("img");
        img.src = src || "";
        img.alt = product.name || "";
        img.onclick = () => openFullscreenViewer(index);
        scrollContainer.appendChild(img);
    });

    counter.textContent = `1/${imagePaths.length}`;
    counter.onclick = () => openFullscreenViewer(getCurrentGalleryIndex());

    scrollContainer.onscroll = () => {
        const index = getCurrentGalleryIndex();
        counter.textContent = `${index + 1}/${imagePaths.length}`;
    };
}

function getCurrentGalleryIndex() {
    const scrollContainer = document.getElementById("pd-gallery-scroll");
    return Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth);
}

let pdGalleryImages = [];
let pdGalleryAlt = "";
let pdTouchStartY = 0;

function openFullscreenViewer(startIndex) {
    const viewer = document.getElementById("pd-fullscreen-viewer");
    const scrollContainer = document.getElementById("pd-fullscreen-scroll");
    const counter = document.getElementById("pd-fullscreen-counter");

    scrollContainer.innerHTML = "";
    pdGalleryImages.forEach(src => {
        const img = document.createElement("img");
        img.src = src || "";
        img.alt = pdGalleryAlt;
        img.onclick = closeFullscreenViewer;
        scrollContainer.appendChild(img);
    });

    viewer.classList.remove("hidden");

    requestAnimationFrame(() => {
        scrollContainer.scrollLeft = startIndex * scrollContainer.clientWidth;
        counter.textContent = `${startIndex + 1}/${pdGalleryImages.length}`;
    });

    scrollContainer.onscroll = () => {
        const index = Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth);
        counter.textContent = `${index + 1}/${pdGalleryImages.length}`;
    };

    viewer.addEventListener("touchstart", handleFullscreenTouchStart);
    viewer.addEventListener("touchend", handleFullscreenTouchEnd);
}

function closeFullscreenViewer() {
    const viewer = document.getElementById("pd-fullscreen-viewer");
    viewer.classList.add("hidden");
    viewer.removeEventListener("touchstart", handleFullscreenTouchStart);
    viewer.removeEventListener("touchend", handleFullscreenTouchEnd);
}

function handleFullscreenTouchStart(e) {
    pdTouchStartY = e.touches[0].clientY;
}

function handleFullscreenTouchEnd(e) {
    const deltaY = e.changedTouches[0].clientY - pdTouchStartY;
    if (deltaY > 80) {
        closeFullscreenViewer();
    }
}

document.getElementById("pd-fullscreen-close").onclick = closeFullscreenViewer;

async function sharePdProduct(product) {
    const shareData = {
        title: product.name || "Check out this product",
        text: `${product.name || "Check this out"} - UGX ${Number(product.price).toLocaleString()}`,
        url: window.location.href
    };

    if (navigator.share) {
        try {
            await navigator.share(shareData);
        } catch (err) {
            console.log("Share cancelled or failed", err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(shareData.url);
            alert("Link copied to clipboard!");
        } catch (err) {
            console.error("Copy failed", err);
        }
    }
}

let pdSelectedColorId = null;
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

    renderSpecs(data.specs || []);

    if (data.colors.length === 0 && data.sizes.length === 0) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    section.innerHTML = "";

    if (data.colors.length > 0) {
        const colorRow = document.createElement("div");
        colorRow.className = "pd-selector-row";
        colorRow.innerHTML = `<span class="pd-selector-label">Color<span id="pd-selected-color-name" class="pd-selected-color-name"></span></span><div id="pd-color-swatches" class="pd-color-swatches"></div>`;
        section.appendChild(colorRow);

        const swatchContainer = colorRow.querySelector("#pd-color-swatches");
        data.colors.forEach(color => {
            const swatch = document.createElement("div");
            swatch.className = "pd-color-swatch";
            swatch.innerHTML = `<img src="${color.image_path || ''}" alt="${color.name}">`;
            swatch.onclick = () => selectColor(color.id, color.image_path, color.name);
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

function selectColor(colorId, imagePath, colorName) {
    pdSelectedColorId = colorId;
    document.querySelectorAll(".pd-color-swatch").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.colorId) === colorId);
    });
    const nameEl = document.getElementById("pd-selected-color-name");
    if (nameEl) nameEl.textContent = colorName ? `: ${colorName}` : "";
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

function renderSpecs(specs) {
    const table = document.getElementById("pd-specs-table");
    table.innerHTML = "";

    specs.forEach(spec => {
        if (spec.value && spec.value.toString().trim() !== "") {
            const row = document.createElement("tr");
            row.innerHTML = `<td class="pd-spec-label">${spec.label}</td><td class="pd-spec-value">${spec.value}</td>`;
            table.appendChild(row);
        }
    });

    if (table.children.length === 0) {
        table.innerHTML = `<tr><td colspan="2">No specifications listed for this product.</td></tr>`;
    }
}

document.addEventListener("DOMContentLoaded", loadProductDetail);
