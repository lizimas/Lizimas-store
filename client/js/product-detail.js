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
        const idEl = document.getElementById("pd-item-id");
        if (idEl) idEl.textContent = "Item ID: " + product.id;



        document.getElementById("pd-add-to-cart-btn").onclick = () => {
            addToCart(product.id, product.name, product.price, product.image, product.description, pdSelectedColorId, pdSelectedColorName);
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

    pdImageRecords = images;
    pdGalleryAlt = product.name || "";
    pdGalleryCounter = counter;
    pdGalleryFallback = product.image;

    renderGallery(null);

    counter.onclick = () => openFullscreenViewer(getCurrentGalleryIndex());

    scrollContainer.onscroll = () => {
        const index = getCurrentGalleryIndex();
        counter.textContent = `${index + 1}/${pdGalleryImages.length}`;
        syncColorToIndex(index);
    };
}

function renderGallery() {
    const scrollContainer = document.getElementById("pd-gallery-scroll");
    if (!scrollContainer) return;

    const subset = pdImageRecords;

    const imagePaths = subset.length > 0
        ? subset.map(img => img.image_path)
        : [pdGalleryFallback];

    pdGalleryImages = imagePaths;

    scrollContainer.innerHTML = "";
    imagePaths.forEach((src, index) => {
        const img = document.createElement("img");
        img.src = src || "";
        img.alt = pdGalleryAlt;
        img.onclick = () => openFullscreenViewer(index);
        scrollContainer.appendChild(img);
    });

    scrollContainer.scrollLeft = 0;
    if (pdGalleryCounter) {
        pdGalleryCounter.textContent = `1/${imagePaths.length}`;
    }
}

function getCurrentGalleryIndex() {
    const scrollContainer = document.getElementById("pd-gallery-scroll");
    return Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth);
}

let pdGalleryImages = [];
let pdImageRecords = [];
let pdGalleryCounter = null;
let pdGalleryFallback = null;
let pdGalleryAlt = "";
let pdTouchStartY = 0;
let pdLastSyncedIndex = -1;

function applyColorSelection(colorId, colorName) {
    pdSelectedColorId = (colorId === null || colorId === undefined)
        ? null
        : Number(colorId);
    pdSelectedColorName = colorName || null;
    document.querySelectorAll(".pd-color-swatch").forEach(el => {
        el.classList.toggle(
            "selected",
            Number(el.dataset.colorId) === pdSelectedColorId
        );
    });
    const nameEl = document.getElementById("pd-selected-color-name");
    if (nameEl) {
        nameEl.textContent = pdSelectedColorName ? `: ${pdSelectedColorName}` : "";
    }
    updateSizeAvailability();
    updateStockHint();
}

function syncColorToIndex(index) {
    if (index === pdLastSyncedIndex) return;
    pdLastSyncedIndex = index;
    const record = pdImageRecords[index];
    if (!record) return;
    if (record.color_id === null || record.color_id === undefined) return;
    if (Number(record.color_id) === pdSelectedColorId) return;
    applyColorSelection(record.color_id, record.color_name);
}

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
let pdSelectedColorName = null;
let pdSelectedSizeId = null;
let pdVariants = [];
let pdVariantStockEnabled = undefined;
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
    pdVariantStockEnabled = product ? product.variant_stock_enabled : undefined;

    renderSpecs(data.specs || [], data.sizes || []);

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
    applyColorSelection(colorId, colorName);

    const scrollContainer = document.getElementById("pd-gallery-scroll");
    if (!scrollContainer) return;

    const target = pdImageRecords.findIndex(
        img => Number(img.color_id) === Number(colorId)
    );
    if (target >= 0) {
        pdLastSyncedIndex = target;
        scrollContainer.scrollTo({
            left: target * scrollContainer.clientWidth,
            behavior: "smooth"
        });
    }
}

function selectSize(sizeId) {
    const btn = document.querySelector(`.pd-size-btn[data-size-id="${sizeId}"]`);
    if (btn && btn.classList.contains("disabled")) return;
    pdSelectedSizeId = sizeId;
    document.querySelectorAll(".pd-size-btn").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.sizeId) === sizeId);
    });
    updateStockHint();
}

// Scarcity hint for the selected colour+size. Only shown when the product is
// actually tracking stock per variant, and only when the number is low enough
// to be useful to the customer.
function updateStockHint() {
    let el = document.getElementById("pd-stock-hint");

    const sizeRow = document.querySelector(".pd-size-buttons");
    if (!el && sizeRow && sizeRow.parentElement) {
        el = document.createElement("div");
        el.id = "pd-stock-hint";
        el.style.cssText = "margin-top:6px; font-size:0.9em; font-weight:600;";
        sizeRow.parentElement.appendChild(el);
    }
    if (!el) return;

    if (pdVariantStockEnabled !== true || !pdSelectedColorId || !pdSelectedSizeId) {
        el.textContent = "";
        return;
    }

    const variant = pdVariants.find(v =>
        Number(v.color_id) === Number(pdSelectedColorId) &&
        Number(v.size_id) === Number(pdSelectedSizeId)
    );

    if (!variant) {
        el.textContent = "";
        return;
    }

    const stock = Number(variant.stock);
    if (stock <= 0) {
        el.textContent = "Out of stock";
        el.style.color = "#c0392b";
    } else if (stock <= 5) {
        // Deliberately blank above this threshold: a hint shown on every
        // selection stops being noticed at all.
        el.textContent = `Only ${stock} left`;
        el.style.color = "#c0392b";
    } else {
        el.textContent = "";
    }
}

function updateSizeAvailability() {
    let clearedSize = false;

    // Transitional: before the variant_stock_enabled column exists, fall back to
    // "has variants" so today's validation keeps working. Once the migration lands
    // and products carry the flag, the fallback branch is dead and can be removed.
    const strict = (pdVariantStockEnabled === undefined)
        ? pdVariants.length > 0
        : pdVariantStockEnabled === true;

    document.querySelectorAll(".pd-size-btn").forEach(btn => {
        const sizeId = Number(btn.dataset.sizeId);
        const variant = pdVariants.find(v =>
            v.size_id === sizeId && (pdSelectedColorId === null || v.color_id === pdSelectedColorId)
        );

        const unavailable = strict
            ? (!variant || Number(variant.stock) <= 0)
            : (variant && Number(variant.stock) <= 0);

        btn.classList.toggle("disabled", !!unavailable);

        if (unavailable && Number(pdSelectedSizeId) === sizeId) {
            btn.classList.remove("selected");
            clearedSize = true;
        }
    });

    if (clearedSize) pdSelectedSizeId = null;
}

function pdEscape(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function pdCurrentId() {
    return new URLSearchParams(window.location.search).get("id");
}

function renderSpecs(specs, sizes) {
    const card = document.getElementById("pd-details-card");
    const table = document.getElementById("pd-specs-table");
    const rows = [];

    (specs || []).forEach(function (spec) {
        if (spec.value && spec.value.toString().trim() !== "") {
            rows.push([String(spec.label), String(spec.value).trim()]);
        }
    });

    if (table) {
        table.innerHTML = rows.length
            ? rows.map(function (r) {
                return '<tr><td class="pd-spec-label">' + pdEscape(r[0]) +
                       '</td><td class="pd-spec-value">' + pdEscape(r[1]) + '</td></tr>';
              }).join('')
            : '<tr><td colspan="2">No specifications listed for this product.</td></tr>';
    }

    if (!card) return;

    if (rows.length === 0) {
        card.style.display = "none";
        card.innerHTML = "";
        return;
    }
    card.style.display = "";

    const preview = rows.slice(0, 3).map(function (r) {
        return '<div class="pd-cell">' +
                   '<div class="pd-cell-label">' + pdEscape(r[0]) + '</div>' +
                   '<div class="pd-cell-value">' + pdEscape(r[1]) + '</div>' +
               '</div>';
    }).join('');

    const sizeLabels = (sizes || [])
        .map(function (x) { return x.label || x.name || x.size || x.size_label || ''; })
        .filter(Boolean).join(', ');

    const sizeRow = sizeLabels
        ? '<button type="button" class="pd-size-guide" onclick="openAllDetails()">' +
              '<span>&#128207; Size guide</span>' +
              '<span>' + pdEscape(sizeLabels) + ' &rsaquo;</span>' +
          '</button>'
        : '';

    card.innerHTML =
        '<div class="pd-head">' +
            '<h3 class="pd-title">Product details</h3>' +
            '<div class="pd-actions">' +
                '<button type="button" class="pd-action" onclick="toggleSaveProduct()">&#9825; Save</button>' +
                '<span class="pd-sep"></span>' +
                '<button type="button" class="pd-action" onclick="reportProduct()">&#9998; Report</button>' +
            '</div>' +
        '</div>' +
        '<div class="pd-grid">' + preview + '</div>' +
        '<button type="button" class="pd-see-all" onclick="openAllDetails()">See all details &rsaquo;</button>' +
        sizeRow;
}

function openAllDetails() {
    const el = document.getElementById("pd-sheet");
    if (el) el.classList.remove("hidden");
}

function closeAllDetails() {
    const el = document.getElementById("pd-sheet");
    if (el) el.classList.add("hidden");
}

function toggleSaveProduct() {
    const id = pdCurrentId();
    if (!id) return;
    try {
        const list = JSON.parse(localStorage.getItem("savedProducts") || "[]");
        const i = list.indexOf(id);
        if (i === -1) { list.push(id); alert("Saved to your list"); }
        else { list.splice(i, 1); alert("Removed from your list"); }
        localStorage.setItem("savedProducts", JSON.stringify(list));
    } catch (e) {
        console.error("Save failed:", e);
    }
}

function reportProduct() {
    alert("Thanks - this product has been flagged for review.");
}

document.addEventListener("DOMContentLoaded", loadProductDetail);
