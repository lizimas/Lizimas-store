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

// Fills the "Seller Information" box from the same public storefront
// endpoint the storefront page itself uses (GET /api/vendors/store/:slug) -
// separate, non-blocking fetch so a slow score calculation never holds up
// the rest of the product page rendering.
async function loadSellerPanel(product) {
    var panel = document.getElementById("pd-seller-panel");
    if (!panel) return;
    if (!product.vendor_id) { pdRenderOwnSeller(panel); return; }
    if (!product.vendor_slug) return;
    try {
        var data = await spFetchStore(product.vendor_slug);
        if (!data) return;
        await renderSellerPanel(panel, data, { showVisitLink: false });
        panel.hidden = false;
        var box = document.getElementById("pd-seller-box");
        if (box) box.hidden = false;
        var link = document.getElementById("pd-seller-link");
        if (link) link.href = "/store/" + encodeURIComponent(product.vendor_slug);
    } catch (error) {
        console.error("Seller panel load error:", error);
    }
}

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

        // Brands are free text on products, so the filter matches
        // case-insensitively server-side and no slug table is needed.
        var brandEl = document.getElementById("pd-brand");
        if (brandEl) {
            var brandName = (product.brand || "").trim();
            if (brandName) {
                var brandUrl = "/products?brand=" + encodeURIComponent(brandName);
                brandEl.innerHTML =
                    '<span class="pd-brand-label">Brand</span>' +
                    '<a class="pd-brand-name-link" href="' + brandUrl + '">' + pdEscape(brandName) + '</a>' +
                    '<span class="pd-brand-sep">|</span>' +
                    '<a class="pd-brand-viewall-link" href="' + brandUrl + '">View all products from ' + pdEscape(brandName) + '</a>';
                brandEl.hidden = false;
            } else {
                brandEl.hidden = true;
            }
        }

        // SKU is auto-generated for every product (server/utils/sku.js),
        // so it's shown independently of the specs section's own
        // show/hide logic (renderSpecs hides that whole section when
        // there are no manual specs - SKU should still show either way).
        var skuEl = document.getElementById("pd-sku");
        if (skuEl) {
            var skuValue = (product.sku || "").trim();
            if (skuValue) {
                skuEl.textContent = "SKU: " + skuValue;
                skuEl.hidden = false;
            } else {
                skuEl.hidden = true;
            }
        }
        loadSellerPanel(product);

        await loadGallery(id, product);
        await loadOptions(id, product);
        // Discount display (vendor_promotions, joined in getProductById) -
        // only applied to the base price shown on initial load. Selecting a
        // differently-priced variant (selectVariant()) intentionally shows
        // that variant's plain price with no discount math - promotions are
        // proposed against the product's base price, not any one variant,
        // and this system has no per-variant discount concept at all.
        var pdPriceEl = document.getElementById("pd-price");
        var pdOrigPriceEl = document.getElementById("pd-price-original");
        var pdDiscountBadgeEl = document.getElementById("pd-discount-badge");
        var pdSalePrice = product.sale_price ? Number(product.sale_price) : null;
        var pdOriginalPrice = product.original_price ? Number(product.original_price) : null;
        var pdHasDiscount = pdSalePrice && pdOriginalPrice && pdOriginalPrice > pdSalePrice;

        if (pdHasDiscount) {
            pdPriceEl.textContent = "UGX " + pdSalePrice.toLocaleString();
            if (pdOrigPriceEl) {
                pdOrigPriceEl.textContent = "UGX " + pdOriginalPrice.toLocaleString();
                pdOrigPriceEl.hidden = false;
            }
            if (pdDiscountBadgeEl) {
                var pdDiscountPct = Math.round((1 - pdSalePrice / pdOriginalPrice) * 100);
                pdDiscountBadgeEl.textContent = "-" + pdDiscountPct + "%";
                pdDiscountBadgeEl.hidden = false;
            }
        } else {
            pdPriceEl.textContent = product.price
                ? `UGX ${Number(product.price).toLocaleString()}`
                : "";
            if (pdOrigPriceEl) pdOrigPriceEl.hidden = true;
            if (pdDiscountBadgeEl) pdDiscountBadgeEl.hidden = true;
        }
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

        pdRenderStock(product);
        pdRenderBadges(product);
        pdSetupShare(product);
        pdRenderMini(product, pdHasDiscount ? pdSalePrice : Number(product.price), pdHasDiscount ? pdOriginalPrice : null);
        pdSetupAskLink(product);
        pdSetupDelivery(product.id);
        pdBuildHighlights(product);
        pdSetupDetailsPanel();



        const miniBtn = document.getElementById("pd-mini-btn");
        if (miniBtn) miniBtn.onclick = () => document.getElementById("pd-add-to-cart-btn").click();

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
            // Per-colour / per-size stock: the customer has to pick, and a
            // row with none left can't be added.
            if (pdVariantStockEnabled === true && pdVariants.some(v => v.color_id !== null || v.size_id !== null)) {
                if (pdColors.length && pdSelectedColorId === null) { alert("Please choose a colour first."); return; }
                if (document.querySelectorAll("#pd-size-buttons .pd-size-btn").length && !pdSelectedSizeId) { alert("Please choose a size first."); return; }
                const picked = pdPickedVariant();
                if (picked && Number(picked.stock) <= 0) { alert("Sorry, that one is out of stock."); return; }
            }
            // The cart shows what checkout will charge: the running sale or
            // discount price when there is one (checkout re-prices anyway).
            const pickPrice = pdColorSizeVariantPrice();
            const cartPrice = pdSelectedVariantPrice !== null ? pdSelectedVariantPrice
                : pickPrice !== null ? pickPrice
                : (pdHasDiscount ? pdSalePrice : product.price);
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
        pdUpdateGalleryArrows();
    };

    const go = step => {
        const n = pdGalleryImages.length;
        if (n < 2) return;
        const next = Math.min(n - 1, Math.max(0, getCurrentGalleryIndex() + step));
        scrollContainer.scrollTo({ left: next * scrollContainer.clientWidth, behavior: "smooth" });
    };
    const prev = document.getElementById("pd-gal-prev");
    const nextBtn = document.getElementById("pd-gal-next");
    if (prev) prev.onclick = () => go(-1);
    if (nextBtn) nextBtn.onclick = () => go(1);
    pdUpdateGalleryArrows();
}

// Previous / next arrows on the main photo (desktop). Hidden with a single
// photo, and each one fades out at its end of the row.
function pdUpdateGalleryArrows() {
    const prev = document.getElementById("pd-gal-prev");
    const next = document.getElementById("pd-gal-next");
    if (!prev || !next) return;
    const n = pdGalleryImages.length;
    prev.hidden = next.hidden = n < 2;
    if (n < 2) return;
    const i = getCurrentGalleryIndex();
    prev.disabled = i <= 0;
    next.disabled = i >= n - 1;
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

    const marks = i => rail.querySelectorAll(".pd-thumb").forEach((t, n) => {
        t.classList.toggle("selected", n === i);
        if (n === i && rail.scrollWidth > rail.clientWidth) {
            const left = t.offsetLeft - rail.offsetLeft;
            if (left < rail.scrollLeft || left + t.offsetWidth > rail.scrollLeft + rail.clientWidth) {
                rail.scrollTo({ left: Math.max(0, left - 8), behavior: "smooth" });
            }
        }
    });

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

    const crumbs = [`<a href="/">Home</a>`].concat(
        trail.map((c, i) => {
            const last = i === trail.length - 1;
            const href = `/products?category=${encodeURIComponent(c.name)}`;
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
        nameEl.textContent = pdSelectedColorName ? ` ${pdSelectedColorName}` : "";
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
        colorRow.innerHTML = `<span class="pd-selector-label">Color:<span id="pd-selected-color-name" class="pd-selected-color-name"></span></span><div id="pd-color-swatches" class="pd-color-swatches"></div>`;
        section.appendChild(colorRow);

        const swatchContainer = colorRow.querySelector("#pd-color-swatches");
        data.colors.forEach(color => {
            const swatch = document.createElement("div");
            // Temu-style tile: the colour's photo with its name under it; a
            // colour without a photo fills the tile with the colour itself.
            swatch.className = "pd-color-swatch pd-color-tile";
            swatch.title = color.name;
            swatch.setAttribute("role", "button");
            swatch.setAttribute("tabindex", "0");
            swatch.setAttribute("aria-label", color.name);
            swatch.innerHTML =
                `<span class="pd-tile-media">` +
                    (color.image_path
                        ? `<img src="${pdEscape(color.image_path)}" alt="" loading="lazy">`
                        : `<span class="pd-swatch-fill" style="background:${pdEscape(color.hex || "#e5e7eb")}"></span>`) +
                `</span>` +
                `<span class="pd-tile-name">` +
                    (color.hex && color.image_path ? `<span class="pd-tile-dot" style="background:${pdEscape(color.hex)}"></span>` : "") +
                    pdEscape(color.name) +
                `</span>`;
            swatch.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); swatch.click(); } });
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
    pdMarkSoldOutColors();
}

// Colour-only products with per-colour stock: a colour with none left is
// greyed out and says so.
function pdMarkSoldOutColors() {
    if (pdVariantStockEnabled !== true || document.querySelectorAll("#pd-size-buttons .pd-size-btn").length) return;
    document.querySelectorAll(".pd-color-swatch").forEach(el => {
        const v = pdVariants.find(x => Number(x.color_id) === Number(el.dataset.colorId) && x.size_id === null);
        const out = v && Number(v.stock) <= 0;
        el.classList.toggle("pd-soldout", !!out);
        if (out) el.title = el.getAttribute("aria-label") + " - out of stock";
    });
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
    pdApplyVariantPrice();
    let el = document.getElementById("pd-stock-hint");

    const sizeRow = document.querySelector(".pd-size-buttons") || document.getElementById("pd-color-swatches");
    if (!el && sizeRow && sizeRow.parentElement) {
        el = document.createElement("div");
        el.id = "pd-stock-hint";
        el.style.cssText = "margin-top:6px; font-size:0.9em; font-weight:600;";
        sizeRow.parentElement.appendChild(el);
    }
    if (!el) return;

    const variant = pdPickedVariant();

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

// The colour / size row the customer has picked (colour + size, colour
// only, or size only - whatever the product's variants are made of).
function pdPickedVariant() {
    if (pdVariantStockEnabled !== true) return null;
    const hasColors = pdColors.length > 0;
    const hasSizes = document.querySelectorAll("#pd-size-buttons .pd-size-btn").length > 0;
    if ((hasColors && !pdSelectedColorId) || (hasSizes && !pdSelectedSizeId)) return null;
    return pdVariants.find(x =>
        (hasColors ? Number(x.color_id) === Number(pdSelectedColorId) : x.color_id === null) &&
        (hasSizes ? Number(x.size_id) === Number(pdSelectedSizeId) : x.size_id === null)) || null;
}

// Per-variant prices: a picked row with its own price sells at that price
// (checkout charges the same). Returns null when the pick uses the product price.
function pdColorSizeVariantPrice() {
    const v = pdPickedVariant();
    return v && v.own_price && Number(v.price) > 0 ? Number(v.price) : null;
}

let pdBasePriceSnapshot = null;
function pdApplyVariantPrice() {
    const priceEl = document.getElementById("pd-price");
    if (!priceEl) return;
    const orig = document.getElementById("pd-price-original");
    const badge = document.getElementById("pd-discount-badge");
    const vp = pdColorSizeVariantPrice();
    if (vp === null) {
        if (pdBasePriceSnapshot) {
            priceEl.textContent = pdBasePriceSnapshot.text;
            if (orig) orig.hidden = pdBasePriceSnapshot.origHidden;
            if (badge) badge.hidden = pdBasePriceSnapshot.badgeHidden;
            pdBasePriceSnapshot = null;
        }
        return;
    }
    if (!pdBasePriceSnapshot) {
        pdBasePriceSnapshot = {
            text: priceEl.textContent,
            origHidden: orig ? orig.hidden : true,
            badgeHidden: badge ? badge.hidden : true
        };
    }
    priceEl.textContent = "UGX " + vp.toLocaleString();
    if (orig) orig.hidden = true;
    if (badge) badge.hidden = true;
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
    pdSpecRows = rows;
    var specsSection = document.getElementById("pd-specs-section");
    if (specsSection) specsSection.dataset.empty = rows.length ? "" : "1";

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
    pdOpenSection("pd-specs-section", true);
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



/* ------------------------------------------------------------------
   Page layout helpers (Sept 2026 redesign: Jumia-style right column,
   Lulu-style details panel under the photos).
   ------------------------------------------------------------------ */

let pdSpecRows = [];

function pdStore(key, value) {
    try {
        if (value === undefined) return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch (e) { /* private mode - just don't remember */ }
    return null;
}

// "8 items in stock" with a bar, like Jumia. Plenty of stock just says
// "In stock"; none says "Out of stock".
function pdRenderStock(product) {
    const el = document.getElementById("pd-stock");
    if (!el || product.stock === undefined || product.stock === null) return;
    // Per-colour / per-size stock: the total of the rows.
    const rows = pdVariantStockEnabled === true ? pdVariants.filter(v => v.color_id !== null || v.size_id !== null) : [];
    const n = rows.length ? rows.reduce((t, v) => t + (Number(v.stock) || 0), 0) : Number(product.stock);
    if (!Number.isFinite(n)) return;
    if (n <= 0) {
        el.innerHTML = '<span class="pd-stock-text pd-stock-out">Out of stock</span>';
    } else if (n <= 20) {
        const pct = Math.max(8, Math.round((n / 20) * 100));
        el.innerHTML = '<span class="pd-stock-text">' + n + (n === 1 ? " item" : " items") + ' in stock</span>' +
            '<span class="pd-stock-track"><span class="pd-stock-fill" style="width:' + pct + '%"></span></span>';
    } else {
        el.innerHTML = '<span class="pd-stock-text">In stock</span>';
    }
    el.hidden = false;
}

// Small buy card that stays in view in the right column while the shopper
// reads the details (desktop only - phones have the fixed bottom button).
function pdRenderMini(product, price, was) {
    const box = document.getElementById("pd-mini");
    if (!box) return;
    const img = document.getElementById("pd-mini-img");
    img.src = (pdGalleryImages && pdGalleryImages[0]) || product.image || "";
    img.alt = product.name || "";
    document.getElementById("pd-mini-name").textContent = product.name || "";
    document.getElementById("pd-mini-price").textContent = price ? "UGX " + Number(price).toLocaleString() : "";
    const wasEl = document.getElementById("pd-mini-was");
    if (was && price && was > price) {
        wasEl.innerHTML = '<s>UGX ' + Number(was).toLocaleString() + '</s> <span class="pd-mini-off">-' +
            Math.round((1 - price / was) * 100) + '%</span>';
        wasEl.hidden = false;
    }
    box.hidden = false;
}

function pdSetupAskLink(product) {
    const a = document.getElementById("pd-ask-link");
    if (!a) return;
    const text = "Hello Lizimas Store, I have a question about: " + (product.name || "") +
        " (Item ID " + product.id + ") " + window.location.href;
    a.href = "https://wa.me/256792363104?text=" + encodeURIComponent(text);
}

// Delivery & Returns: region -> district from the same zones checkout uses,
// then the door-delivery fee and time for this product. The last choice is
// remembered so the next product page shows it straight away.
async function pdSetupDelivery(productId) {
    const zoneSel = document.getElementById("pd-loc-zone");
    const distSel = document.getElementById("pd-loc-district");
    const out = document.getElementById("pd-del-door");
    if (!zoneSel || !distSel || !out) return;

    let districts = [];
    try {
        const res = await fetch("/api/delivery/districts");
        if (res.ok) districts = (await res.json()).districts || [];
    } catch (e) { /* leave the prompt text */ }
    if (!districts.length) {
        zoneSel.closest(".pd-side-box").classList.add("pd-no-zones");
        out.textContent = "Delivery fee and time are shown at checkout.";
        return;
    }

    const zones = [];
    districts.forEach(d => { if (d.zone && zones.indexOf(d.zone) === -1) zones.push(d.zone); });
    zoneSel.innerHTML = '<option value="">Region</option>' +
        zones.map(z => '<option>' + pdEscape(z) + '</option>').join("");

    const fillDistricts = zone => {
        const list = districts.filter(d => d.zone === zone);
        distSel.innerHTML = '<option value="">District</option>' +
            list.map(d => '<option>' + pdEscape(d.district) + '</option>').join("");
        distSel.disabled = !list.length;
    };

    const showFee = async district => {
        if (!district) {
            out.textContent = "Choose your location to see the delivery fee and time.";
            pdShipLine(null);
            return;
        }
        out.textContent = "Checking...";
        try {
            const res = await fetch("/api/delivery/fee?method=delivery&district=" +
                encodeURIComponent(district) + "&product_ids=" + encodeURIComponent(productId));
            const d = await res.json();
            if (!res.ok) { out.textContent = d.error || "Delivery is not yet available for that area."; return; }
            if (d.quoteRequired) { out.textContent = d.message; pdShipLine(null); return; }
            out.innerHTML = 'Delivery fee <strong>UGX ' + Number(d.fee || 0).toLocaleString() + '</strong>' +
                (d.eta ? '<br>Arrives in ' + pdEscape(d.eta) : '');
            pdShipLine(d.fee, d.district || district);
        } catch (e) {
            out.textContent = "Could not check delivery right now.";
        }
    };

    zoneSel.onchange = () => {
        fillDistricts(zoneSel.value);
        showFee("");
    };
    distSel.onchange = () => {
        pdStore("lzDelivery", JSON.stringify({ zone: zoneSel.value, district: distSel.value }));
        showFee(distSel.value);
    };

    let saved = null;
    try { saved = JSON.parse(pdStore("lzDelivery") || "null"); } catch (e) { saved = null; }
    if (saved && zones.indexOf(saved.zone) !== -1) {
        zoneSel.value = saved.zone;
        fillDistricts(saved.zone);
        if (districts.some(d => d.zone === saved.zone && d.district === saved.district)) {
            distSel.value = saved.district;
            showFee(saved.district);
        }
    }
}

// Product Highlights: bullet lines the seller wrote in the description
// ("- ", "• ", "✓ " ...) come first; otherwise the first few specifications.
// Nothing to show hides the tab.
function pdBuildHighlights(product) {
    const list = document.getElementById("pd-highlights");
    if (!list) return;
    const items = [];
    String(product.description || "").split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*(?:[-*\u2022\u2023\u25AA\u25CF\u2713\u2714\u2705]|\d+[.)])\s+(.{3,160})$/);
        if (m) items.push(m[1].trim());
    });
    if (!items.length) {
        pdSpecRows.slice(0, 6).forEach(r => items.push(r[0] + ": " + r[1]));
    }
    const tab = document.querySelector('.pd-dtab[data-sec="pd-highlights-section"]');
    if (!items.length) {
        if (tab) tab.hidden = true;
        return;
    }
    list.classList.toggle("pd-hl-two", items.length > 5);
    list.innerHTML = items.slice(0, 10).map(t =>
        '<li><span class="pd-hl-icon" aria-hidden="true">&#10022;</span><span>' + pdEscape(t) + '</span></li>'
    ).join("");
    if (tab) tab.hidden = false;
    document.getElementById("pd-highlights-section").dataset.empty = "";
}

function pdOpenSection(id, scroll) {
    const panel = document.getElementById("pd-dpanel");
    if (!panel) return;
    const tab = panel.querySelector('.pd-dtab[data-sec="' + id + '"]');
    if (!tab || tab.hidden) return;
    panel.querySelectorAll(".pd-dtab").forEach(t => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panel.querySelectorAll(".pd-dbody > .pd-section").forEach(sec => {
        sec.hidden = sec.id !== id;
    });
    document.querySelectorAll("#pd-side-nav a").forEach(a => {
        a.classList.toggle("active", a.dataset.sec === id);
    });
    if (scroll) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Details panel: tabs on the left, arrow to minimise the menu to icons
// (remembered), empty sections drop their tab.
function pdSetupDetailsPanel() {
    const panel = document.getElementById("pd-dpanel");
    if (!panel) return;

    panel.querySelectorAll(".pd-dbody > .pd-section").forEach(sec => {
        const tab = panel.querySelector('.pd-dtab[data-sec="' + sec.id + '"]');
        if (tab && sec.dataset.empty === "1") tab.hidden = true;
        const side = document.querySelector('#pd-side-nav a[data-sec="' + sec.id + '"]');
        if (side && sec.dataset.empty === "1") side.hidden = true;
    });

    panel.querySelectorAll(".pd-dtab").forEach(tab => {
        tab.onclick = () => pdOpenSection(tab.dataset.sec, false);
    });

    const toggle = document.getElementById("pd-dmenu-toggle");
    const setMin = min => {
        panel.classList.toggle("pd-dmenu-min", min);
        toggle.setAttribute("aria-label", min ? "Expand menu" : "Minimise menu");
        toggle.title = min ? "Expand menu" : "Minimise menu";
        toggle.setAttribute("aria-expanded", min ? "false" : "true");
    };
    setMin(pdStore("lzDetailsMenuMin") === "1");
    toggle.onclick = () => {
        const min = !panel.classList.contains("pd-dmenu-min");
        setMin(min);
        pdStore("lzDetailsMenuMin", min ? "1" : "0");
    };

    // Open the first section that has something in it.
    const first = Array.from(panel.querySelectorAll(".pd-dtab")).find(t => !t.hidden);
    if (first) pdOpenSection(first.dataset.sec, false);

    // "3 reviews" under the title and any #section link open that tab.
    document.addEventListener("click", e => {
        const a = e.target.closest('a[href^="#pd-"]');
        if (!a) return;
        const id = a.getAttribute("href").slice(1);
        if (!panel.querySelector('.pd-dtab[data-sec="' + id + '"]')) return;
        e.preventDefault();
        pdOpenSection(id, true);
    });
}


// "Official Store" badge above the title for Lizimas' own products. The
// warranty sits next to the price and gets its own row under Delivery &
// Returns.
function pdRenderBadges(product) {
    const el = document.getElementById("pd-badges");
    const months = Number(product.warranty_months) || 0;
    const label = months === 1 ? "1 Month" : months + " Months";
    const out = [];
    if (!product.vendor_id) out.push('<a class="pd-badge pd-badge-official" href="' + PD_OFFICIAL_URL + '" title="See all Official Store products">Official Store</a>');
    if (el && out.length) { el.innerHTML = out.join(""); el.hidden = false; }

    const row = document.getElementById("pd-warranty-row");
    if (row && months > 0) {
        document.getElementById("pd-warranty-text").textContent = label + " manufacturer warranty";
        row.hidden = false;
    }
}

// "+ delivery UGX 5,000 to Kampala" under the price once a location is chosen.
function pdShipLine(fee, district) {
    const el = document.getElementById("pd-ship-line");
    if (!el) return;
    if (fee === null || fee === undefined || !district) { el.hidden = true; return; }
    el.innerHTML = "+ delivery <strong>UGX " + Number(fee).toLocaleString() + "</strong> to " + pdEscape(district);
    el.hidden = false;
}

// Every product Lizimas sells itself (products page, ?seller=official).
const PD_OFFICIAL_URL = "/products?seller=official";

// Lizimas' own products: the store itself is the seller. The name and the
// "Official Store" badge both open the Official Store listing.
function pdRenderOwnSeller(panel) {
    panel.innerHTML =
        '<div class="seller-panel-head">' +
            '<a class="seller-panel-name pd-official-link" href="' + PD_OFFICIAL_URL + '">Lizimas Store</a>' +
            '<a class="seller-score-badge pd-official-link" href="' + PD_OFFICIAL_URL + '" title="See all Official Store products">Official Store &rsaquo;</a>' +
        '</div>' +
        '<ul class="seller-performance-list">' +
            '<li class="seller-perf-item seller-perf-excellent"><span class="seller-perf-dot"></span>Sold and delivered by Lizimas Store</li>' +
            '<li class="seller-perf-item seller-perf-excellent"><span class="seller-perf-dot"></span>Free pickup at our Bugolobi store</li>' +
            '<li class="seller-perf-item seller-perf-excellent"><span class="seller-perf-dot"></span>7-day returns on eligible items</li>' +
            '<li class="seller-perf-item seller-perf-excellent"><span class="seller-perf-dot"></span>Pay with Mobile Money or Cash on Delivery</li>' +
        '</ul>' +
        '<a class="pd-official-all" href="' + PD_OFFICIAL_URL + '">See all Official Store products &rsaquo;</a>';
    panel.hidden = false;
    const box = document.getElementById("pd-seller-box");
    if (box) { box.hidden = false; box.classList.add("pd-seller-own"); }
}

// Share buttons and the "Report incorrect product information" link
// (opens WhatsApp to Lizimas with the item already named).
function pdSetupShare(product) {
    const url = window.location.origin + window.location.pathname + window.location.search;
    const text = (product.name || "Lizimas Store") + " - UGX " + Number(product.price || 0).toLocaleString();
    const set = (id, href) => { const a = document.getElementById(id); if (a) a.href = href; };
    set("pd-share-fb", "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url));
    set("pd-share-x", "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url));
    set("pd-share-wa", "https://wa.me/?text=" + encodeURIComponent(text + " " + url));
    set("pd-report-link", "https://wa.me/256792363104?text=" + encodeURIComponent(
        "Hello Lizimas Store, some information on this product looks incorrect: " + (product.name || "") +
        " (Item ID " + product.id + ") " + url + "\nWhat is wrong: "));
}

document.addEventListener("DOMContentLoaded", loadProductDetail);
