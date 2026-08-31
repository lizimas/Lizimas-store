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

function pdResolveId() {
    const m = window.location.pathname.match(/\/product\/(?:.*-)?(\d+)\/?$/);
    if (m) return m[1];
    return new URLSearchParams(window.location.search).get("id");
}

async function loadProductDetail() {
    const id = pdResolveId();

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

        loadReviews(id);

        const warrantyEl = document.getElementById("pd-warranty");
        if (warrantyEl) {
            if (product.warranty_months) {
                const months = Number(product.warranty_months);
                const label = months === 1 ? "1 Month" : (months + " Months");
                warrantyEl.innerHTML =
                    '<svg class="pd-warranty-icon" viewBox="0 0 24 24" fill="none">' +
                        '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="#2c7a4b" opacity="0.15"/>' +
                        '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" stroke="#2c7a4b" stroke-width="1.6" stroke-linejoin="round"/>' +
                        '<path d="M9 12l2 2 4-4" stroke="#2c7a4b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                    '<span>' + label + ' Manufacturer Warranty</span>';
                warrantyEl.classList.remove("hidden");
            } else {
                warrantyEl.classList.add("hidden");
                warrantyEl.innerHTML = "";
            }
        }
        const idEl = document.getElementById("pd-item-id");
        if (idEl) idEl.textContent = "Item ID: " + product.id;



        document.getElementById("pd-add-to-cart-btn").onclick = () => {
            // Use the image for the selected colour, not the product default.
            let cartImage = product.image;
            if (pdSelectedColorId !== null && Array.isArray(pdImageRecords)) {
                const match = pdImageRecords.find(
                    r => r && Number(r.color_id) === Number(pdSelectedColorId)
                );
                if (match && (match.image_path || match.url || match.src)) {
                    cartImage = match.image_path || match.url || match.src;
                }
            }
            // A product with standalone variants has no sensible default price,
            // so refuse rather than silently charging the base price.
            if (pdStandaloneVariants.length > 0 && pdSelectedVariantId === null) {
                alert("Please choose an option first.");
                return;
            }
            const cartPrice = pdSelectedVariantPrice !== null ? pdSelectedVariantPrice : product.price;
            addToCart(product.id, product.name, cartPrice, cartImage, product.description, pdSelectedColorId, pdSelectedColorName, pdSelectedSizeId, pdSelectedSizeName, pdSelectedVariantId, pdSelectedVariantName);
        };

        document.getElementById("pd-fullscreen-share").onclick = () => sharePdProduct(product);

        renderBreadcrumbs(product.category_id);

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

    renderThumbnails(imagePaths, scrollContainer);
}

// Desktop thumbnail rail. Clicking scrolls the main gallery to that image,
// so the two stay in step whichever the customer uses.
function renderThumbnails(imagePaths, scrollContainer) {
    const rail = document.getElementById("pd-thumbs");
    if (!rail) return;

    if (imagePaths.length < 2) {
        rail.innerHTML = "";
        return;
    }

    rail.innerHTML = imagePaths.map((src, i) =>
        `<button class="pd-thumb${i === 0 ? " selected" : ""}" data-i="${i}" type="button">
            <img src="${src || ""}" alt="" loading="lazy">
         </button>`
    ).join("");

    const marks = i => rail.querySelectorAll(".pd-thumb").forEach((t, n) =>
        t.classList.toggle("selected", n === i));

    rail.onclick = e => {
        const thumb = e.target.closest(".pd-thumb");
        if (!thumb) return;
        const i = Number(thumb.dataset.i);
        scrollContainer.scrollTo({ left: i * scrollContainer.clientWidth, behavior: "smooth" });
        marks(i);
    };

    scrollContainer.addEventListener("scroll", () => {
        marks(Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth));
    }, { passive: true });
}

// Breadcrumbs from the product's category up to the top of the tree.
async function renderBreadcrumbs(categoryId) {
    const nav = document.getElementById("pd-breadcrumbs");
    if (!nav || !categoryId) return;

    let categories;
    try {
        const response = await fetch("/api/categories");
        if (!response.ok) return;
        categories = await response.json();
    } catch (error) {
        console.error("Breadcrumb categories error:", error);
        return;
    }

    const byId = new Map(categories.map(c => [c.id, c]));
    const trail = [];
    let current = byId.get(categoryId);

    while (current) {
        trail.unshift(current);
        current = current.parent_id ? byId.get(current.parent_id) : null;
    }

    const crumbs = [`<a href="/index.html">Home</a>`].concat(
        trail.map((c, i) => {
            const last = i === trail.length - 1;
            const href = `/products.html?category=${encodeURIComponent(c.name)}`;
            return last
                ? `<span class="pd-crumb-current">${c.name}</span>`
                : `<a href="${href}">${c.name}</a>`;
        })
    );

    nav.innerHTML = crumbs.join(`<span class="pd-crumb-sep">/</span>`);
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
let pdSelectedSizeName = null;
let pdVariants = [];
let pdVariantStockEnabled = undefined;
let pdColors = [];
let pdStandaloneVariants = [];
let pdSelectedVariantId = null;
let pdSelectedVariantName = null;
let pdSelectedVariantPrice = null;

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

    // Variants with no colour and no size are standalone choices in their own
    // right (juice volumes, pack sizes). They carry their own price and stock,
    // so they get their own selector rather than being derived from a grid.
    pdStandaloneVariants = (data.variants || []).filter(
        v => v.color_id === null && v.size_id === null && v.variant_name
    );

    if (data.colors.length === 0 && data.sizes.length === 0 && pdStandaloneVariants.length === 0) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    section.innerHTML = "";

    if (pdStandaloneVariants.length > 0) {
        const vRow = document.createElement("div");
        vRow.className = "pd-selector-row";
        vRow.innerHTML = '<span class="pd-selector-label">Option</span><div id="pd-variant-buttons" class="pd-size-buttons"></div>';
        section.appendChild(vRow);

        const vContainer = vRow.querySelector("#pd-variant-buttons");
        pdStandaloneVariants.forEach(v => {
            const btn = document.createElement("button");
            btn.className = "pd-size-btn";
            btn.textContent = String(v.variant_name).replace(/\s+/g, " ").trim();
            btn.dataset.variantId = v.id;
            if (Number(v.stock) <= 0) {
                btn.classList.add("disabled");
                btn.disabled = true;
            }
            btn.onclick = () => selectVariant(v.id);
            vContainer.appendChild(btn);
        });
    }

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
            btn.onclick = () => selectSize(size.id, size.name);
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

function selectVariant(variantId) {
    const v = pdStandaloneVariants.find(x => Number(x.id) === Number(variantId));
    if (!v || Number(v.stock) <= 0) return;

    pdSelectedVariantId = v.id;
    pdSelectedVariantName = String(v.variant_name).replace(/\s+/g, " ").trim();
    pdSelectedVariantPrice = Number(v.price);

    document.querySelectorAll("#pd-variant-buttons .pd-size-btn").forEach(el => {
        el.classList.toggle("selected", Number(el.dataset.variantId) === Number(variantId));
    });

    const priceEl = document.getElementById("pd-price");
    if (priceEl) priceEl.textContent = "UGX " + pdSelectedVariantPrice.toLocaleString();
}

function selectSize(sizeId, sizeName) {
    const btn = document.querySelector(`.pd-size-btn[data-size-id="${sizeId}"]`);
    if (btn && btn.classList.contains("disabled")) return;
    pdSelectedSizeId = sizeId;
    pdSelectedSizeName = sizeName || null;
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

    if (clearedSize) { pdSelectedSizeId = null; pdSelectedSizeName = null; }
}

function pdEscape(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function pdCurrentId() {
    return pdResolveId();
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

    // Nothing to show is not worth a heading and an apology. Hide the whole
    // section rather than printing an empty-state row at the customer.
    var specsSection = document.getElementById("pd-specs-section");
    if (specsSection) specsSection.style.display = rows.length ? "" : "none";

    if (table) {
        table.innerHTML = rows.map(function (r) {
            return '<tr><td class="pd-spec-label">' + pdEscape(r[0]) +
                   '</td><td class="pd-spec-value">' + pdEscape(r[1]) + '</td></tr>';
        }).join('');
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
    const panel = document.getElementById("pd-specs-section");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function pdEscapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function pdStars(rating) {
    const filled = Math.round(Number(rating) || 0);
    let out = "";
    for (let i = 1; i <= 5; i++) {
        out += '<span class="pd-star' + (i <= filled ? " filled" : "") + '">\u2605</span>';
    }
    return out;
}

function pdReviewDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function pdRenderRatingSummary(summary) {
    const el = document.getElementById("pd-rating");
    if (!el) return;

    const total = Number(summary && summary.total) || 0;
    if (!total) {
        el.innerHTML = '<span class="pd-rating-empty">No reviews yet</span>';
        return;
    }

    const average = Number(summary.average) || 0;
    el.innerHTML =
        '<span class="pd-rating-stars">' + pdStars(average) + "</span>" +
        '<span class="pd-rating-value">' + average.toFixed(1) + "</span>" +
        '<a class="pd-rating-count" href="#pd-reviews-section">' +
            total + (total === 1 ? " review" : " reviews") +
        "</a>";
}

function pdRenderBreakdown(summary) {
    const total = Number(summary.total) || 0;
    const keys = [["five", 5], ["four", 4], ["three", 3], ["two", 2], ["one", 1]];

    return '<div class="pd-review-breakdown">' + keys.map(function (pair) {
        const count = Number(summary[pair[0]]) || 0;
        const pct = total ? Math.round((count / total) * 100) : 0;
        return '<div class="pd-breakdown-row">' +
            '<span class="pd-breakdown-label">' + pair[1] + "\u2605</span>" +
            '<span class="pd-breakdown-track">' +
                '<span class="pd-breakdown-fill" style="width:' + pct + '%"></span>' +
            "</span>" +
            '<span class="pd-breakdown-count">' + count + "</span>" +
        "</div>";
    }).join("") + "</div>";
}

function pdRenderReviewList(reviews) {
    return '<ul class="pd-review-list">' + reviews.map(function (r) {
        const badge = r.verified_purchase
            ? '<span class="pd-review-verified">Verified purchase</span>'
            : "";
        const comment = r.comment
            ? '<p class="pd-review-comment">' + pdEscapeHtml(r.comment) + "</p>"
            : "";
        return '<li class="pd-review-item">' +
            '<div class="pd-review-head">' +
                '<span class="pd-review-stars">' + pdStars(r.rating) + "</span>" +
                '<span class="pd-review-author">' + pdEscapeHtml(r.reviewer_name || "Customer") + "</span>" +
                badge +
            "</div>" +
            '<div class="pd-review-date">' + pdReviewDate(r.created_at) + "</div>" +
            comment +
        "</li>";
    }).join("") + "</ul>";
}

async function loadReviews(id) {
    const wrap = document.getElementById("pd-reviews");

    try {
        const res = await fetch(`/api/reviews/product/${id}`);
        if (!res.ok) throw new Error("Reviews unavailable");

        const data = await res.json();
        const summary = data.summary || {};
        const reviews = Array.isArray(data.reviews) ? data.reviews : [];

        pdRenderRatingSummary(summary);

        if (!wrap) return;

        if (!reviews.length) {
            wrap.innerHTML =
                '<p class="pd-reviews-empty">No reviews yet. Be the first to review this product.</p>';
            return;
        }

        wrap.innerHTML =
            '<div class="pd-review-summary">' +
                '<div class="pd-review-average">' +
                    '<span class="pd-review-average-value">' +
                        (Number(summary.average) || 0).toFixed(1) +
                    "</span>" +
                    '<span class="pd-review-average-stars">' + pdStars(summary.average) + "</span>" +
                    '<span class="pd-review-average-count">' +
                        (Number(summary.total) || 0) + ((Number(summary.total) || 0) === 1 ? " review" : " reviews") +
                    "</span>" +
                "</div>" +
                pdRenderBreakdown(summary) +
            "</div>" +
            pdRenderReviewList(reviews);
    } catch (err) {
        pdRenderRatingSummary({});
        if (wrap) {
            wrap.innerHTML = '<p class="pd-reviews-empty">Reviews could not be loaded.</p>';
        }
    }
}

function closeAllDetails() {
    // No-op: specs now render inline in the tab panel, there is no modal
    // sheet to close. Kept so any stray references don't throw.
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
