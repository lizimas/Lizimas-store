
const API_URL = "";

let allProducts = [];

async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/api/products`);
        allProducts = await response.json();
        console.log("Lizimas Products Loaded:", allProducts);

        // A category tile on the homepage links here with ?category=Name.
        // Applied before the first render so the filtered view is what paints.
        const requestedCategory = new URLSearchParams(window.location.search).get("category");
        if (requestedCategory) {
            // Tiles link to parent categories, but every product is filed under
            // a leaf. Matching on the name alone therefore found nothing and
            // silently fell through to the whole catalogue.
            // The server resolves the whole subtree, so a parent tile returns
            // everything filed beneath it. An empty category returns an empty
            // list rather than falling through to the full catalogue.
            let scoped = [];
            try {
                const r = await fetch(`${API_URL}/api/products?category=${encodeURIComponent(requestedCategory)}`);
                if (r.ok) scoped = await r.json();
            } catch (error) {
                console.error("Category load failed:", error);
            }
            displayProducts(scoped);
            renderCategoryHeading(requestedCategory, scoped.length);
            return;
        }

        // A brand link on a product page arrives here with ?brand=Name. Same
        // shape as the category branch above: the server does the matching so
        // an unknown brand yields an empty grid rather than the full catalogue.
        const requestedBrand = new URLSearchParams(window.location.search).get("brand");
        if (requestedBrand) {
            let branded = [];
            try {
                const r = await fetch(`${API_URL}/api/products?brand=${encodeURIComponent(requestedBrand)}`);
                if (r.ok) branded = await r.json();
            } catch (error) {
                console.error("Brand load failed:", error);
            }
            displayProducts(branded);
            renderCategoryHeading(requestedBrand, branded.length);
            return;
        }

        // Arriving from the header search: seed the existing input and let
        // searchProducts() do the matching, so behaviour is identical to
        // typing the term here directly.
        const requestedQuery = new URLSearchParams(window.location.search).get("q");
        if (requestedQuery) {
            const input = document.getElementById("search-input");
            if (input) {
                input.value = requestedQuery;
                searchProducts();
                displayFeaturedProducts(allProducts);
                return;
            }
        }

        renderCatalogue();
        displayFeaturedProducts(allProducts);
    } catch (error) {
        console.error("Product loading error:", error);
    }
}

function buildRatingStars(rating) {
    const value = Number(rating) || 4;
    const fullStars = Math.floor(value);
    const hasHalfStar = value % 1 >= 0.5;
    let starsHtml = "";

    for (let i = 0; i < fullStars; i++) {
        starsHtml += "★";
    }
    if (hasHalfStar) {
        starsHtml += "☆";
    }
    while (starsHtml.length < 5) {
        starsHtml += "☆";
    }

    return `<span class="product-rating" title="${value} out of 5">${starsHtml}</span>`;
}

function buildBadge(product) {
    if (product.stock !== undefined && Number(product.stock) <= 0) {
        return `<span class="product-badge out-of-stock">Out of Stock</span>`;
    }
    if (product.isNew) {
        return `<span class="product-badge new">New</span>`;
    }
    if (product.discount) {
        return `<span class="product-badge sale">-${product.discount}%</span>`;
    }
    return "";
}

function buildPriceHtml(product) {
    const price = Number(product.price);
    const priceFormatted = price.toLocaleString();

    if (product.originalPrice && Number(product.originalPrice) > price) {
        const originalFormatted = Number(product.originalPrice).toLocaleString();
        return `
            <p class="product-price">
                UGX ${priceFormatted}
                <span class="product-price-original">UGX ${originalFormatted}</span>
            </p>
        `;
    }

    return `<p class="product-price">UGX ${priceFormatted}</p>`;
}

// Builds one product card. Extracted so grouped sections and search results
// render identical markup - editing one used to leave the other behind.
function buildProductCard(product) {
    const card = document.createElement("div");
    card.className = "product-card";
    card.style.cursor = "pointer";
    card.onclick = (event) => {
        if (event.target.closest(".add-to-cart-btn")) {
            return;
        }
        window.location.href = `/product/${product.id}`;
    };

    const outOfStock = product.stock !== undefined && Number(product.stock) <= 0;

    card.innerHTML = `
        <div class="product-image-wrapper">
            ${buildBadge(product)}
            <img
                src="${product.card_image || product.image}"
                alt="${product.name}"
                class="product-image product-image-primary"
                loading="lazy"
            >
            ${product.hover_image ? `<img
                src="${product.hover_image}"
                alt="${product.name} alternate view"
                class="product-image product-image-hover"
                loading="lazy"
            >` : ""}
            <button
                type="button"
                class="quick-add-btn"
                data-quick-add="${product.id}"
                aria-label="${outOfStock ? "Unavailable" : "Add " + product.name + " to cart"}"
                ${outOfStock ? "disabled" : ""}
            >${outOfStock ? "×" : "+"}</button>
        </div>

        <div class="product-card-body">
            <h3 class="product-name">${product.name}</h3>
            ${buildPriceHtml(product)}
        </div>
    `;

    return card;
}

// Flat grid. Used for search results and for a single selected category.
function displayProducts(products) {
    const container = document.getElementById("products-container");

    if (!container) {
        console.error("Products container missing");
        return;
    }

    container.innerHTML = "";

    if (!products || products.length === 0) {
        container.innerHTML = `<p class="no-products-message">No products found.</p>`;
        return;
    }

    const grid = document.createElement("div");
    grid.className = "product-grid";
    products.forEach(product => grid.appendChild(buildProductCard(product)));
    container.appendChild(grid);
}

// ---------------------------------------------------------------------------
// Catalogue grouping
// ---------------------------------------------------------------------------

const ALL_CATEGORIES = "All";
let activeCategory = ALL_CATEGORIES;

function categoryNameOf(product) {
    return (product.category || "Uncategorised").trim() || "Uncategorised";
}

// Categories ordered by how much stock sits in them, so the fullest sections
// lead and single-product ones trail instead of interrupting the page.
function groupByCategory(products) {
    const groups = new Map();

    products.forEach(product => {
        const name = categoryNameOf(product);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(product);
    });

    return Array.from(groups.entries())
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

function renderCategoryChips(products) {
    const row = document.getElementById("category-chips");
    if (!row) return;

    const groups = groupByCategory(products);
    const names = [ALL_CATEGORIES, ...groups.map(g => g.name)];

    row.innerHTML = names.map(name => `
        <button
            type="button"
            class="category-chip"
            data-category="${name}"
            aria-pressed="${name === activeCategory}"
        >${name}</button>
    `).join("");
}

function renderGroupedCatalogue(products) {
    const container = document.getElementById("products-container");
    if (!container) return;

    container.innerHTML = "";

    if (!products || products.length === 0) {
        container.innerHTML = `<p class="no-products-message">No products found.</p>`;
        return;
    }

    groupByCategory(products).forEach(group => {
        const section = document.createElement("section");
        section.className = "category-section";

        const head = document.createElement("div");
        head.className = "category-section-head";
        head.innerHTML = `
            <h2 class="category-section-title">${group.name}</h2>
            <span class="category-section-count">${group.items.length} item${group.items.length === 1 ? "" : "s"}</span>
        `;
        section.appendChild(head);

        const grid = document.createElement("div");
        grid.className = "product-grid";
        group.items.forEach(product => grid.appendChild(buildProductCard(product)));
        section.appendChild(grid);

        container.appendChild(section);
    });
}

// Single entry point for the catalogue view. Search is handled separately
// because it has its own empty state.
function renderCatalogue() {
    renderCategoryChips(allProducts);

    if (activeCategory === ALL_CATEGORIES) {
        renderGroupedCatalogue(allProducts);
    } else {
        displayProducts(allProducts.filter(p => categoryNameOf(p) === activeCategory));
    }
}

function setActiveCategory(name) {
    activeCategory = name;

    const searchInput = document.getElementById("search-input");
    if (searchInput && searchInput.value.trim() !== "") {
        // A chip change while searching re-runs the search in the new scope.
        searchProducts();
        renderCategoryChips(allProducts);
        return;
    }

    renderCatalogue();
}

document.addEventListener("click", event => {
    const chip = event.target.closest(".category-chip");
    if (chip) {
        setActiveCategory(chip.dataset.category);
        return;
    }

    const widen = event.target.closest("#widen-search-btn");
    if (widen) {
        setActiveCategory(ALL_CATEGORIES);
    }
});

// ---------------------------------------------------------------------------
// Quick add
// ---------------------------------------------------------------------------

// Options are fetched per tap rather than flagged on every product in the list.
// The list is going to grow into the thousands, and most cards are never tapped.
const quickAddOptionsCache = new Map();

async function fetchProductOptions(productId) {
    if (quickAddOptionsCache.has(productId)) {
        return quickAddOptionsCache.get(productId);
    }

    const res = await fetch(`${API_URL}/api/products/${productId}/options`);
    if (!res.ok) throw new Error(`Options request failed: ${res.status}`);

    const options = await res.json();
    quickAddOptionsCache.set(productId, options);
    return options;
}

async function handleQuickAdd(productId, button) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    if (button) {
        button.disabled = true;
        button.classList.add("is-loading");
    }

    try {
        const options = await fetchProductOptions(productId);
        const colors = options.colors || [];
        const sizes = options.sizes || [];

        if (colors.length === 0 && sizes.length === 0) {
            addToCart(product.id, product.name, product.price, product.image, product.description, null, null, null, null);
            showAddToCartFeedback(product.name);
        } else {
            openVariantSheet(product, colors, sizes);
        }
    } catch (error) {
        console.error("Quick add failed:", error);
        // Falling back to the detail page is better than a silent failure -
        // the customer can still choose properly there.
        window.location.href = `/product/${productId}`;
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove("is-loading");
        }
    }
}

let sheetSelection = { colorId: null, colorName: null, sizeId: null, sizeName: null };

function openVariantSheet(product, colors, sizes) {
    closeVariantSheet();

    sheetSelection = { colorId: null, colorName: null, sizeId: null, sizeName: null };

    const overlay = document.createElement("div");
    overlay.className = "variant-sheet-overlay";
    overlay.id = "variant-sheet-overlay";

    const colorBlock = colors.length ? `
        <div class="variant-sheet-group">
            <span class="variant-sheet-label">Colour<span id="sheet-color-name" class="variant-sheet-chosen"></span></span>
            <div class="variant-sheet-options">
                ${colors.map(c => `
                    <button type="button" class="variant-option" data-color-id="${c.id}" data-color-name="${c.name}">${c.name}</button>
                `).join("")}
            </div>
        </div>` : "";

    const sizeBlock = sizes.length ? `
        <div class="variant-sheet-group">
            <span class="variant-sheet-label">Size<span id="sheet-size-name" class="variant-sheet-chosen"></span></span>
            <div class="variant-sheet-options">
                ${sizes.map(s => `
                    <button type="button" class="variant-option" data-size-id="${s.id}" data-size-name="${s.name}">${s.name}</button>
                `).join("")}
            </div>
        </div>` : "";

    overlay.innerHTML = `
        <div class="variant-sheet" role="dialog" aria-modal="true" aria-label="Choose options for ${product.name}">
            <div class="variant-sheet-head">
                <img src="${product.card_image || product.image}" alt="" class="variant-sheet-thumb">
                <div>
                    <p class="variant-sheet-name">${product.name}</p>
                    <p class="variant-sheet-price">${buildPriceHtml(product)}</p>
                </div>
                <button type="button" class="variant-sheet-close" id="variant-sheet-close" aria-label="Close">×</button>
            </div>
            ${colorBlock}
            ${sizeBlock}
            <p class="variant-sheet-hint" id="variant-sheet-hint"></p>
            <button type="button" class="variant-sheet-confirm" id="variant-sheet-confirm">Add to cart</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.classList.add("sheet-open");

    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeVariantSheet();
    });

    document.getElementById("variant-sheet-close").onclick = closeVariantSheet;

    overlay.querySelectorAll(".variant-option").forEach(btn => {
        btn.addEventListener("click", () => {
            const isColor = btn.dataset.colorId !== undefined;
            const group = btn.closest(".variant-sheet-group");

            group.querySelectorAll(".variant-option").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");

            if (isColor) {
                sheetSelection.colorId = Number(btn.dataset.colorId);
                sheetSelection.colorName = btn.dataset.colorName;
                const label = document.getElementById("sheet-color-name");
                if (label) label.textContent = ` · ${btn.dataset.colorName}`;
            } else {
                sheetSelection.sizeId = Number(btn.dataset.sizeId);
                sheetSelection.sizeName = btn.dataset.sizeName;
                const label = document.getElementById("sheet-size-name");
                if (label) label.textContent = ` · ${btn.dataset.sizeName}`;
            }

            const hint = document.getElementById("variant-sheet-hint");
            if (hint) hint.textContent = "";
        });
    });

    document.getElementById("variant-sheet-confirm").onclick = () => {
        const hint = document.getElementById("variant-sheet-hint");

        // Every option shown has to be chosen. Adding a dress with no size
        // picked is the exact mis-sell this sheet exists to prevent.
        if (colors.length && sheetSelection.colorId === null) {
            if (hint) hint.textContent = "Choose a colour first.";
            return;
        }
        if (sizes.length && sheetSelection.sizeId === null) {
            if (hint) hint.textContent = "Choose a size first.";
            return;
        }

        addToCart(
            product.id,
            product.name,
            product.price,
            product.image,
            product.description,
            sheetSelection.colorId,
            sheetSelection.colorName,
            sheetSelection.sizeId,
            sheetSelection.sizeName
        );

        closeVariantSheet();

        const parts = [sheetSelection.colorName, sheetSelection.sizeName].filter(Boolean);
        showAddToCartFeedback(parts.length ? `${product.name} (${parts.join(", ")})` : product.name);
    };
}

function closeVariantSheet() {
    const existing = document.getElementById("variant-sheet-overlay");
    if (existing) existing.remove();
    document.body.classList.remove("sheet-open");
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeVariantSheet();
});

document.addEventListener("click", event => {
    const btn = event.target.closest("[data-quick-add]");
    if (!btn) return;

    // The card itself navigates to the detail page, so the "+" must not bubble.
    event.stopPropagation();
    event.preventDefault();

    handleQuickAdd(Number(btn.dataset.quickAdd), btn);
});

function handleAddToCart(productId, variant = null) {
    const product = allProducts.find(p => p.id === productId);

    if (!product) {
        console.error("Product not found:", productId);
        return;
    }

    if (typeof addToCart !== "function") {
        console.error("addToCart function not found — make sure cart.js is loaded before products.js");
        return;
    }

    if (variant) {
        const cartId = `${product.id}-v${variant.id}`;
        const cartName = `${product.name} — ${variant.variant_name}`;
        addToCart(cartId, cartName, variant.price, variant.image_path || product.image, product.description);
        showAddToCartFeedback(cartName);
    } else {
        addToCart(product.id, product.name, product.price, product.image, product.description);
        showAddToCartFeedback(product.name);
    }

    if (cameFromCart) {
        window.location.href = "cart.html";
    }
}

function showAddToCartFeedback(productName) {
    const existingToast = document.querySelector(".cart-toast");
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement("div");
    toast.className = "cart-toast";
    toast.textContent = `${productName} added to cart`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2000);
}

let searchLogTimeout = null;

function logSearchToServer(query) {
    fetch(`${API_URL}/api/search/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    }).catch(error => console.error("Search log error:", error));
}

function searchProducts() {
    const searchValue = document
        .getElementById("search-input")
        .value
        .toLowerCase()
        .trim();

    if (searchValue === "") {
        renderCatalogue();
        return;
    }

    // Terms customers type rarely match the catalogue word for word. Kept as a
    // flat list per concept: any term in a group expands to all the others.
    const SYNONYMS = [
        ["tv", "tvs", "television", "televisions"],
        ["phone", "phones", "smartphone", "smartphones", "mobile"],
        ["fridge", "fridges", "refrigerator", "refrigerators"],
        ["speaker", "speakers", "soundbar", "soundbars"],
        ["laptop", "laptops", "notebook", "computer"]
    ];

    const expand = term => {
        const group = SYNONYMS.find(g => g.includes(term));
        return group ? group : [term];
    };

    const terms = expand(searchValue);

    // A category hit outranks a name hit, because that is what separates a
    // television from an accessory that merely mentions one. Without it,
    // "LG Soundbar for TV" scores as highly as an actual TV.
    const scoreOf = product => {
        const name = (product.name || "").toLowerCase();
        const category = (product.category || "").toLowerCase();
        const description = (product.description || "").toLowerCase();
        let best = 0;

        for (const term of terms) {
            let score = 0;
            const whole = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");

            if (category.includes(term)) score += 100;
            if (name.startsWith(term)) score += 70;
            else if (whole.test(name)) score += 60;
            else if (name.includes(term)) score += 40;
            if (description.includes(term)) score += 20;

            if (score > best) best = score;
        }

        return best;
    };

    const scored = allProducts
        .map(p => ({ product: p, score: scoreOf(p) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score);

    const allMatches = scored.map(entry => entry.product);
    const scopedMatches = activeCategory === ALL_CATEGORIES
        ? allMatches
        : allMatches.filter(p => categoryNameOf(p) === activeCategory);

    // A scoped search that finds nothing looks like "we don't stock this".
    // If the item exists in another category, say so and offer a way through.
    if (scopedMatches.length === 0 && allMatches.length > 0) {
        const container = document.getElementById("products-container");
        if (container) {
            container.innerHTML = `
                <div class="search-widen">
                    <p class="no-products-message">
                        Nothing matching "${searchValue}" in ${activeCategory}.
                        ${allMatches.length} result${allMatches.length === 1 ? "" : "s"} in other categories.
                    </p>
                    <button type="button" id="widen-search-btn" class="widen-search-btn">
                        Search all categories
                    </button>
                </div>
            `;
        }
    } else {
        displayProducts(scopedMatches);
    }

    clearTimeout(searchLogTimeout);
    searchLogTimeout = setTimeout(() => {
        logSearchToServer(searchValue);
    }, 800);
}

// Homepage product rows: one horizontal carousel per level-2 category that
// has stock. Replaces the old single "Featured Products" grid.
// Slot 4 tiles, keyed by the level-2 category they are pinned to.
// Fetched once per page load alongside the rows themselves.
async function loadRowTiles() {
    try {
        const response = await fetch("/api/promotions");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const all = await response.json();
        // Every tile pinned to a category becomes a slide in that row, in
        // display_order. One tile is simply a carousel of length one.
        const byCategory = new Map();
        for (const p of all) {
            // A video tile has no image_url, so the presence check has to
            // follow media_type rather than assuming a still.
            const hasMedia = p.media_type === "video" ? !!p.video_url : !!p.image_url;
            if (p.layout !== "row_tile" || !p.category_id || !hasMedia) continue;
            if (!byCategory.has(p.category_id)) byCategory.set(p.category_id, []);
            byCategory.get(p.category_id).push(p);
        }
        return byCategory;
    } catch (error) {
        console.error("Load row tiles:", error);
        return new Map();
    }
}

// A tile eats two card slots, so a thin row would be mostly advert.
const LS_ROW_TILE_MIN_ITEMS = 4;

// Cards to place before the tile. Two rows, so column N is card N*2.
const LS_ROW_TILE_OFFSET = 3;

// Slides advance every 5 seconds and can be swiped or tapped through, matching
// the banner carousels in categories.js so the page has one timing everywhere.
const LS_TILE_INTERVAL = 5000;

// A video slide is not on a clock: it holds until the clip ends. This is only
// a backstop, so a clip that stalls or never fires "ended" cannot pin the row
// on one tile indefinitely.
const LS_TILE_VIDEO_MAX = 60000;

function buildRowTile(slides, side) {
    const box = document.createElement("div");
    box.className = "ls-row-promo" + (side === "left" ? " ls-row-promo--left" : "");

    const track = document.createElement("div");
    track.className = "ls-row-promo-track";

    for (const slide of slides) {
        const cell = slide.link_url
            ? document.createElement("a")
            : document.createElement("span");
        cell.className = "ls-row-promo-slide";
        if (slide.link_url) cell.href = slide.link_url;
        cell.setAttribute("aria-label", slide.title || "Promotion");
        if (slide.media_type === "video" && slide.video_url) {
            // muted and playsinline are both required or iOS refuses to
            // autoplay at all. preload none keeps the clip off the wire
            // until the row is actually scrolled into view.
            const video = document.createElement("video");
            video.src = slide.video_url;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.controls = false;
            video.preload = "none";
            video.setAttribute("muted", "");
            video.setAttribute("playsinline", "");
            video.setAttribute("webkit-playsinline", "");
            if (slide.poster_url) video.poster = slide.poster_url;
            cell.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.src = slide.image_url;
            img.alt = slide.title || "";
            img.loading = "lazy";
            cell.appendChild(img);
        }
        track.appendChild(cell);
    }
    box.appendChild(track);

    if (slides.length > 1) {
        const dots = document.createElement("div");
        dots.className = "ls-row-promo-dots";
        slides.forEach((_, i) => {
            const dot = document.createElement("button");
            dot.className = "ls-row-promo-dot" + (i === 0 ? " active" : "");
            dot.dataset.i = String(i);
            dot.setAttribute("aria-label", `Slide ${i + 1}`);
            dots.appendChild(dot);
        });
        box.appendChild(dots);
        startTileCarousel(box, track, dots, slides.length);
    } else {
        // A single slide never gets a carousel, but a lone video still has to
        // be told when to run: loop while on screen, pause when it is not.
        startSoloVideo(box, track);
    }

    return box;
}

function startSoloVideo(box, track) {
    const video = track.querySelector("video");
    if (!video) return;
    video.loop = true;

    const play = () => {
        const played = video.play();
        if (played && typeof played.catch === "function") played.catch(() => {});
    };

    if (typeof IntersectionObserver === "function") {
        new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting && !document.hidden) play();
                else video.pause();
            }
        }, { threshold: 0.25 }).observe(box);
    } else {
        play();
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) video.pause();
    });
}

function startTileCarousel(box, track, dots, count) {
    let index = 0;
    let timer = null;
    let onScreen = false;

    const cells = track.querySelectorAll(".ls-row-promo-slide");
    const videoAt = i => (cells[i] ? cells[i].querySelector("video") : null);

    // Arms the wait for whatever slide is showing. An image gets the fixed
    // 5 seconds. A video gets no clock of its own: it advances on "ended",
    // and the timer here is only a backstop against a clip that stalls.
    const arm = fromStart => {
        clearTimeout(timer);
        if (!onScreen || document.hidden) return;

        const video = videoAt(index);
        if (!video) {
            timer = setTimeout(() => show(index + 1), LS_TILE_INTERVAL);
            return;
        }

        if (fromStart) video.currentTime = 0;
        const played = video.play();
        if (played && typeof played.catch === "function") {
            // Autoplay refused (data saver, low power mode). Treat the clip
            // as a still so the row keeps moving instead of sitting dead.
            played.catch(() => {
                clearTimeout(timer);
                timer = setTimeout(() => show(index + 1), LS_TILE_INTERVAL);
            });
        }
        timer = setTimeout(() => show(index + 1), LS_TILE_VIDEO_MAX);
    };

    // Pausing rather than resetting: scrolling back should pick the clip up
    // where it left off, not restart it.
    const halt = () => {
        clearTimeout(timer);
        const video = videoAt(index);
        if (video) video.pause();
    };

    const show = i => {
        const leaving = videoAt(index);
        if (leaving) {
            leaving.pause();
            leaving.currentTime = 0;
        }
        index = (i + count) % count;
        track.style.transform = `translateX(-${index * 100}%)`;
        dots.querySelectorAll(".ls-row-promo-dot").forEach((d, n) =>
            d.classList.toggle("active", n === index));
        arm(true);
    };

    // Guarded on the index so a clip that ends after the user has already
    // swiped past it cannot advance the row a second time.
    cells.forEach((cell, n) => {
        const video = cell.querySelector("video");
        if (!video) return;
        video.addEventListener("ended", () => {
            if (n === index) show(index + 1);
        });
    });

    dots.addEventListener("click", e => {
        const dot = e.target.closest(".ls-row-promo-dot");
        if (!dot) return;
        show(Number(dot.dataset.i));
    });

    // Horizontal swipe moves a slide. The threshold keeps a sloppy vertical
    // page scroll from counting as a swipe.
    let startX = null;
    let startY = null;
    box.addEventListener("touchstart", e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    box.addEventListener("touchend", e => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            show(index + (dx < 0 ? 1 : -1));
        }
        startX = null;
        startY = null;
    }, { passive: true });

    // Nothing rotates and no video downloads until the row is on screen,
    // which matters most for a shopper on mobile data.
    if (typeof IntersectionObserver === "function") {
        new IntersectionObserver(entries => {
            for (const entry of entries) {
                onScreen = entry.isIntersecting;
                if (onScreen) arm(false);
                else halt();
            }
        }, { threshold: 0.25 }).observe(box);
    } else {
        onScreen = true;
        arm(true);
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) halt();
        else arm(false);
    });
}

async function displayFeaturedProducts(products) {
    const host = document.getElementById("ls-product-rows");
    if (!host) return;

    let categories;
    try {
        const response = await fetch("/api/categories");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        categories = await response.json();
    } catch (error) {
        console.error("Load categories for product rows:", error);
        return;
    }

    const byId = new Map(categories.map(c => [c.id, c]));
    const topIds = new Set(categories.filter(c => !c.parent_id).map(c => c.id));

    // A product sits on level 3; walk up one step to find its level-2 group.
    const level2Of = product => {
        const own = byId.get(product.category_id);
        if (!own) return null;
        if (topIds.has(own.parent_id)) return own;          // already level 2
        const parent = byId.get(own.parent_id);
        return parent && topIds.has(parent.parent_id) ? parent : null;
    };

    const groups = new Map();
    for (const product of products) {
        const group = level2Of(product);
        if (!group) continue;
        if (!groups.has(group.id)) groups.set(group.id, { category: group, items: [] });
        groups.get(group.id).items.push(product);
    }

    const ordered = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
    const rowTiles = await loadRowTiles();

    host.innerHTML = "";
    let tileIndex = 0;
    for (const { category, items } of ordered) {
        const section = document.createElement("section");
        section.className = "ls-row";
        section.innerHTML = `
            <div class="ls-row-head">
                <h2 class="ls-row-title">${category.name}</h2>
                <div class="ls-row-controls">
                    <a class="ls-row-viewall"
                       href="products.html?category=${encodeURIComponent(category.name)}">View all &#8594;</a>
                </div>
            </div>
            <div class="ls-row-body">
                <div class="ls-row-scroll"></div>
            </div>`;

        const scroll = section.querySelector(".ls-row-scroll");
        items.forEach(product => scroll.appendChild(buildProductCard(product)));

        const slides = rowTiles.get(category.id);
        const hasTile = Boolean(slides && slides.length
            && items.length >= LS_ROW_TILE_MIN_ITEMS);
        if (hasTile) {
            // Sides alternate across rows that actually carry a tile, so the
            // zig-zag holds even when tiled categories are not adjacent.
            const side = tileIndex % 2 === 0 ? "right" : "left";
            // The tile is a sibling of the scroller, not a child: products
            // slide past underneath while the tile itself stays put.
            scroll.classList.add("ls-row-scroll--split");
            section.querySelector(".ls-row-body")
                .appendChild(buildRowTile(slides, side));
            tileIndex++;
        }

        host.appendChild(section);

        // A tiled row already has one thing moving on its own. Drifting the
        // products as well reads as clutter, so they wait for a swipe.
        if (!hasTile) autoScrollRow(scroll);
    }
}

// Nudges a row one card to the right every 5 seconds, looping back at the end.
// Pauses while the customer is touching it, and while the tab is hidden.
function autoScrollRow(scroll) {
    let timer = null;
    let paused = false;

    const step = () => {
        if (paused) return;

        const card = scroll.firstElementChild;
        if (!card) return;

        const stride = card.getBoundingClientRect().width + 14;   // card + gap
        const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 4;

        scroll.scrollTo({ left: atEnd ? 0 : scroll.scrollLeft + stride, behavior: "smooth" });
    };

    const start = () => { clearInterval(timer); timer = setInterval(step, 5000); };

    ["pointerdown", "touchstart", "mouseenter"].forEach(evt =>
        scroll.addEventListener(evt, () => { paused = true; }, { passive: true }));

    ["pointerup", "touchend", "mouseleave"].forEach(evt =>
        scroll.addEventListener(evt, () => {
            paused = false;
            start();
        }, { passive: true }));

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) clearInterval(timer);
        else start();
    });

    start();
}

let cameFromCart = false;

document.addEventListener("DOMContentLoaded", async () => {
    await loadProducts();

    const searchInput = document.getElementById("search-input");
    if (searchInput) {
        searchInput.addEventListener("input", searchProducts);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const openProductId = urlParams.get("openProduct");
    if (openProductId) {
        cameFromCart = true;
        window.location.href = `/product/${openProductId}`;
    }
});

async function openProductModal(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) {
        console.error("Product not found:", productId);
        return;
    }

    document.getElementById("modal-product-name").textContent = product.name;
    document.getElementById("modal-product-rating").innerHTML = buildRatingStars(product.rating);
    document.getElementById("modal-product-description").textContent = product.description || "";
    renderProductExtras(productId, product);
    renderProductReviews(productId);

    const mainImage = document.getElementById("modal-main-image");
    const priceEl = document.getElementById("modal-product-price");
    const addBtn = document.getElementById("modal-add-to-cart-btn");
    const thumbnailsContainer = document.getElementById("modal-thumbnails");
    const variantLabel = document.getElementById("modal-selected-variant");

    let galleryItems = [];
    let currentIndex = 0;

    function applySelection(stock, price, image, variant) {
        mainImage.src = image;
        mainImage.alt = product.name;
        priceEl.innerHTML = buildPriceHtml({ price, originalPrice: null });
        variantLabel.textContent = variant ? `Selected: ${variant.variant_name}` : "";

        const outOfStock = stock !== undefined && Number(stock) <= 0;
        addBtn.disabled = outOfStock;
        addBtn.textContent = outOfStock ? "Unavailable" : "Add To Cart 🛒";
        addBtn.onclick = () => {
            handleAddToCart(product.id, variant);
        };
    }

    function updateActiveThumbnail(index) {
        const thumbs = thumbnailsContainer.querySelectorAll("img");
        thumbs.forEach(t => t.classList.remove("active-thumbnail"));
        if (thumbs[index]) {
            thumbs[index].classList.add("active-thumbnail");
        }
    }

    function showGalleryItem(index) {
        if (galleryItems.length === 0) return;
        const wrapped = (index + galleryItems.length) % galleryItems.length;
        const item = galleryItems[wrapped];
        applySelection(item.stock, item.price, item.image, item.variant);
        currentIndex = wrapped;
        updateActiveThumbnail(wrapped);
    }

    applySelection(product.stock, product.price, product.image, null);

    thumbnailsContainer.innerHTML = "";

    galleryItems.push({ stock: product.stock, price: product.price, image: product.image, variant: null });

    const baseThumb = document.createElement("img");
    baseThumb.src = product.image;
    baseThumb.alt = product.name;
    baseThumb.classList.add("active-thumbnail");
    baseThumb.onclick = () => showGalleryItem(0);
    thumbnailsContainer.appendChild(baseThumb);

    try {
        const response = await fetch(`${API_URL}/api/variants/product/${productId}`);
        const variants = await response.json();

        if (Array.isArray(variants)) {
            variants.forEach(variant => {
                const idx = galleryItems.length;
                galleryItems.push({ stock: variant.stock, price: variant.price, image: variant.image_path || product.image, variant });

                const thumb = document.createElement("img");
                thumb.src = variant.image_path || product.image;
                thumb.alt = `${product.name} - ${variant.variant_name}`;
                thumb.title = variant.variant_name;
                thumb.onclick = () => showGalleryItem(idx);
                thumbnailsContainer.appendChild(thumb);
            });
        }
    } catch (error) {
        console.error("Could not load variants:", error);
    }

    try {
        const galleryResponse = await fetch(`${API_URL}/api/products/${productId}/images`);
        const galleryImages = await galleryResponse.json();

        if (Array.isArray(galleryImages)) {
            galleryImages.forEach(img => {
                const idx = galleryItems.length;
                galleryItems.push({ stock: product.stock, price: product.price, image: img.image_path, variant: null });

                const thumb = document.createElement("img");
                thumb.src = img.image_path;
                thumb.alt = product.name;
                thumb.onclick = () => showGalleryItem(idx);
                thumbnailsContainer.appendChild(thumb);
            });
        }
    } catch (error) {
        console.error("Could not load gallery images:", error);
    }

    currentIndex = 0;
    updateActiveThumbnail(0);

    const fsOverlay = document.getElementById("fullscreen-viewer");
    const fsImage = document.getElementById("fullscreen-image");
    const fsClose = document.getElementById("fullscreen-close");

    let fsScale = 1;
    let fsTranslateX = 0;
    let fsTranslateY = 0;
    let fsPinchStartDist = 0;
    let fsPinchStartScale = 1;
    let fsLastTapTime = 0;
    let fsVelocityX = 0;
    let fsVelocityY = 0;
    let fsLastMoveTime = 0;
    let fsMomentumRaf = null;

    function stopMomentum() {
        if (fsMomentumRaf) {
            cancelAnimationFrame(fsMomentumRaf);
            fsMomentumRaf = null;
        }
    }

    function clampTranslate() {
        const containerWidth = fsOverlay.clientWidth;
        const containerHeight = fsOverlay.clientHeight;
        const scaledWidth = fsImage.offsetWidth * fsScale;
        const scaledHeight = fsImage.offsetHeight * fsScale;
        const maxX = Math.max(0, (scaledWidth - containerWidth) / 2);
        const maxY = Math.max(0, (scaledHeight - containerHeight) / 2);
        fsTranslateX = Math.min(maxX, Math.max(-maxX, fsTranslateX));
        fsTranslateY = Math.min(maxY, Math.max(-maxY, fsTranslateY));
    }

    function startMomentum() {
        stopMomentum();
        function step() {
            fsTranslateX += fsVelocityX * 16;
            fsTranslateY += fsVelocityY * 16;
            fsVelocityX *= 0.93;
            fsVelocityY *= 0.93;
            clampTranslate();
            applyZoomTransform();
            if (Math.abs(fsVelocityX) > 0.02 || Math.abs(fsVelocityY) > 0.02) {
                fsMomentumRaf = requestAnimationFrame(step);
            } else {
                fsMomentumRaf = null;
            }
        }
        fsMomentumRaf = requestAnimationFrame(step);
    }

    function applyZoomTransform() {
        fsImage.style.transform = `translate(${fsTranslateX}px, ${fsTranslateY}px) scale(${fsScale})`;
    }

    function resetZoom() {
        stopMomentum();
        fsScale = 1;
        fsTranslateX = 0;
        fsTranslateY = 0;
        fsVelocityX = 0;
        fsVelocityY = 0;
        applyZoomTransform();
    }

    function getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function openFullscreenViewer() {
        fsImage.src = mainImage.src;
        fsImage.alt = product.name;
        fsImage.style.touchAction = "none";
        resetZoom();
        fsOverlay.classList.remove("hidden");
    }

    function closeFullscreenViewer() {
        fsOverlay.classList.add("hidden");
        resetZoom();
    }

    fsClose.onclick = closeFullscreenViewer;

    let touchStartX = 0;
    let wasSwipe = false;
    const SWIPE_THRESHOLD = 40;

    mainImage.ontouchstart = (e) => {
        touchStartX = e.changedTouches[0].screenX;
        wasSwipe = false;
    };

    mainImage.ontouchmove = (e) => {
        const currentX = e.changedTouches[0].screenX;
        if (Math.abs(currentX - touchStartX) > 10) {
            wasSwipe = true;
        }
    };

    mainImage.ontouchend = (e) => {
        const touchEndX = e.changedTouches[0].screenX;
        const deltaX = touchEndX - touchStartX;
        if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
            if (deltaX < 0) {
                showGalleryItem(currentIndex + 1);
            } else {
                showGalleryItem(currentIndex - 1);
            }
        }
    };

    mainImage.onclick = () => {
        if (!wasSwipe) {
            openFullscreenViewer();
        }
    };

    mainImage.style.touchAction = "pan-y";

    let fsStartX = 0;
    let fsStartY = 0;
    let fsWasSwipe = false;

    fsImage.ontouchstart = (e) => {
        stopMomentum();

        if (e.touches.length === 2) {
            fsPinchStartDist = getTouchDistance(e.touches);
            fsPinchStartScale = fsScale;
            fsWasSwipe = true;
            return;
        }

        fsStartX = e.changedTouches[0].screenX;
        fsStartY = e.changedTouches[0].screenY;
        fsLastMoveTime = Date.now();
        fsVelocityX = 0;
        fsVelocityY = 0;
        fsWasSwipe = false;

        const now = Date.now();
        if (now - fsLastTapTime < 300) {
            if (fsScale > 1) {
                resetZoom();
            } else {
                fsScale = 2.5;
                applyZoomTransform();
            }
            fsWasSwipe = true;
        }
        fsLastTapTime = now;
    };

    fsImage.ontouchmove = (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDistance(e.touches);
            fsScale = Math.min(Math.max(fsPinchStartScale * (dist / fsPinchStartDist), 1), 4);
            applyZoomTransform();
            return;
        }

        const curX = e.changedTouches[0].screenX;
        const curY = e.changedTouches[0].screenY;

        if (fsScale > 1) {
            e.preventDefault();
            const now = Date.now();
            const dt = Math.max(now - fsLastMoveTime, 1);
            fsVelocityX = (curX - fsStartX) / dt;
            fsVelocityY = (curY - fsStartY) / dt;
            fsLastMoveTime = now;

            fsTranslateX += (curX - fsStartX);
            fsTranslateY += (curY - fsStartY);
            fsStartX = curX;
            fsStartY = curY;
            clampTranslate();
            applyZoomTransform();
            fsWasSwipe = true;
            return;
        }

        if (Math.abs(curX - fsStartX) > 10 || Math.abs(curY - fsStartY) > 10) {
            fsWasSwipe = true;
        }
    };

    fsImage.ontouchend = (e) => {
        if (fsScale > 1) {
            if (Math.abs(fsVelocityX) > 0.05 || Math.abs(fsVelocityY) > 0.05) {
                startMomentum();
            }
            return;
        }

        const endX = e.changedTouches[0].screenX;
        const endY = e.changedTouches[0].screenY;
        const deltaX = endX - fsStartX;
        const deltaY = endY - fsStartY;

        if (deltaY > 60 && Math.abs(deltaY) > Math.abs(deltaX)) {
            closeFullscreenViewer();
            fsWasSwipe = true;
            return;
        }

        if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
            if (deltaX < 0) {
                showGalleryItem(currentIndex + 1);
            } else {
                showGalleryItem(currentIndex - 1);
            }
            fsImage.src = mainImage.src;
            resetZoom();
        }
    };

    fsImage.onclick = () => {
        if (!fsWasSwipe) {
            closeFullscreenViewer();
        }
    };

    document.getElementById("product-modal").classList.remove("hidden");
}

function closeProductModal() {
    if (cameFromCart) {
        window.location.href = "cart.html";
        return;
    }
    document.getElementById("product-modal").classList.add("hidden");
}


const ATTR_LABELS = {
    material: "Material",
    color: "Color",
    sleeve: "Sleeve",
    style: "Style",
    length: "Length",
    fit: "Fit",
    pattern: "Pattern",
    occasion: "Occasion",
    care_instructions: "Care Instructions",
    product_weight_kg: "Weight (kg)",
    package_size: "Package Size"
};

async function renderProductExtras(productId, product) {
    const descSection = document.getElementById("modal-description-section");
    const specsSection = document.getElementById("modal-specs-section");
    if (!specsSection) return;

    if (descSection) {
        const text = (product.description || "").trim();
        descSection.style.display = text ? "" : "none";
    }

    let detail = product;
    let specs = [];
    let sizes = [];

    try {
        const r = await fetch(`${API_URL}/api/products/${productId}`);
        if (r.ok) {
            const d = await r.json();
            if (d && typeof d === "object") detail = Object.assign({}, product, d);
        }
    } catch (e) {
        console.error("Could not load product detail:", e);
    }

    try {
        const r = await fetch(`${API_URL}/api/products/${productId}/options`);
        if (r.ok) {
            const d = await r.json();
            if (d && Array.isArray(d.specs)) specs = d.specs;
            if (d && Array.isArray(d.sizes)) sizes = d.sizes;
        }
    } catch (e) {
        console.error("Could not load product specs:", e);
    }

    const rows = [];
    Object.keys(ATTR_LABELS).forEach(key => {
        const val = detail[key];
        if (val !== null && val !== undefined && String(val).trim() !== "") {
            rows.push([ATTR_LABELS[key], String(val).trim()]);
        }
    });
    specs.forEach(s => {
        if (s.label && s.value) rows.push([String(s.label), String(s.value)]);
    });

    if (rows.length === 0) {
        specsSection.style.display = "none";
        specsSection.innerHTML = "";
        return;
    }

    specsSection.style.display = "";

    const preview = rows.slice(0, 3).map(r =>
        '<div class="pd-cell">' +
            '<div class="pd-cell-label">' + escapeHtml(r[0]) + '</div>' +
            '<div class="pd-cell-value">' + escapeHtml(r[1]) + '</div>' +
        '</div>'
    ).join('');

    const sizeLabels = sizes
        .map(x => x.label || x.name || x.size || x.size_label || '')
        .filter(Boolean).join(', ');

    const sizeRow = sizeLabels
        ? '<button type="button" class="pd-size-guide" onclick="openSizeGuide()">' +
              '<span>&#128207; Size guide</span>' +
              '<span>' + escapeHtml(sizeLabels) + ' &rsaquo;</span>' +
          '</button>'
        : '';

    specsSection.innerHTML =
        '<div class="pd-card">' +
            '<div class="pd-head">' +
                '<h3 class="pd-title">Product details</h3>' +
                '<div class="pd-actions">' +
                    '<button type="button" class="pd-action" onclick="toggleSaveProduct(' + productId + ')">&#9825; Save</button>' +
                    '<span class="pd-sep"></span>' +
                    '<button type="button" class="pd-action" onclick="reportProduct(' + productId + ')">&#9998; Report</button>' +
                '</div>' +
            '</div>' +
            '<div class="pd-grid">' + preview + '</div>' +
            '<button type="button" class="pd-see-all" onclick="openAllDetails()">See all details &rsaquo;</button>' +
            sizeRow +
        '</div>';

    const full = rows.map(r =>
        '<tr><th>' + escapeHtml(r[0]) + '</th><td>' + escapeHtml(r[1]) + '</td></tr>'
    ).join('');
    const sheetBody = document.getElementById("pd-sheet-body");
    if (sheetBody) {
        sheetBody.innerHTML = '<table class="modal-specs-table"><tbody>' + full + '</tbody></table>';
    }
}

function openAllDetails() {
    const el = document.getElementById("pd-sheet");
    if (el) el.classList.remove("hidden");
}

function closeAllDetails() {
    const el = document.getElementById("pd-sheet");
    if (el) el.classList.add("hidden");
}

function openSizeGuide() {
    openAllDetails();
}

function toggleSaveProduct(productId) {
    try {
        const list = JSON.parse(localStorage.getItem("savedProducts") || "[]");
        const i = list.indexOf(productId);
        if (i === -1) { list.push(productId); alert("Saved to your list"); }
        else { list.splice(i, 1); alert("Removed from your list"); }
        localStorage.setItem("savedProducts", JSON.stringify(list));
    } catch (e) {
        console.error("Save failed:", e);
    }
}

function reportProduct(productId) {
    alert("Thanks - this product has been flagged for review.");
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function starRow(n) {
    let out = "";
    for (let i = 1; i <= 5; i++) out += i <= n ? "\u2605" : "\u2606";
    return out;
}

async function renderProductReviews(productId) {
    const box = document.getElementById("modal-reviews-section");
    if (!box) return;
    box.innerHTML = '<h3 class="modal-section-title">Customer Reviews</h3><p class="reviews-empty">Loading...</p>';

    let data = null;
    try {
        const r = await fetch(`${API_URL}/api/reviews/product/${productId}`);
        if (r.ok) data = await r.json();
    } catch (e) {
        console.error("Could not load reviews:", e);
    }

    if (!data) {
        box.innerHTML = '<h3 class="modal-section-title">Customer Reviews</h3><p class="reviews-empty">Reviews unavailable.</p>';
        return;
    }

    const s = data.summary || {};
    const total = Number(s.total) || 0;
    const avg = Number(s.average) || 0;

    const ratingEl = document.getElementById("modal-product-rating");
    if (ratingEl) {
        ratingEl.innerHTML = total
            ? '<span class="rating-stars">' + starRow(Math.round(avg)) + '</span> <span class="rating-count">' + avg + ' (' + total + ')</span>'
            : '<span class="rating-count">No ratings yet</span>';
    }

    let html = '<h3 class="modal-section-title">Customer Reviews</h3>';

    if (total === 0) {
        html += '<p class="reviews-empty">No reviews yet. Be the first to review this product.</p>';
    } else {
        html += '<div class="reviews-summary"><div class="reviews-avg">' + avg + '<small>/5</small></div><div class="reviews-bars">';
        [["five",5],["four",4],["three",3],["two",2],["one",1]].forEach(function (pair) {
            const c = Number(s[pair[0]]) || 0;
            const pct = total ? Math.round((c / total) * 100) : 0;
            html += '<div class="reviews-bar-row"><span>' + pair[1] + '\u2605</span><div class="reviews-bar"><i style="width:' + pct + '%"></i></div><span>' + c + '</span></div>';
        });
        html += '</div></div>';

        html += '<ul class="reviews-list">';
        (data.reviews || []).forEach(function (rv) {
            const when = rv.created_at ? new Date(rv.created_at).toLocaleDateString() : "";
            const badge = rv.verified_purchase ? '<span class="verified-badge">Verified Purchase</span>' : "";
            html += '<li class="review-item"><div class="review-head"><span class="review-stars">' + starRow(rv.rating) + '</span><span class="review-author">' + escapeHtml(rv.reviewer_name || "Customer") + '</span>' + badge + '</div>';
            if (rv.comment) html += '<p class="review-body">' + escapeHtml(rv.comment) + '</p>';
            html += '<span class="review-date">' + when + '</span></li>';
        });
        html += '</ul>';
    }

    if (localStorage.getItem("userToken")) {
        html += '<div class="review-form"><h4>Write a review</h4>' +
            '<div class="star-picker" id="review-star-picker">' +
            '<span data-v="1">\u2606</span><span data-v="2">\u2606</span><span data-v="3">\u2606</span><span data-v="4">\u2606</span><span data-v="5">\u2606</span>' +
            '</div>' +
            '<textarea id="review-comment" rows="3" placeholder="Share your thoughts..."></textarea>' +
            '<button type="button" id="review-submit-btn" class="add-to-cart-btn">Submit Review</button>' +
            '<p class="review-msg" id="review-msg"></p></div>';
    } else {
        html += '<p class="reviews-empty">Log in to write a review.</p>';
    }

    box.innerHTML = html;

    const picker = document.getElementById("review-star-picker");
    if (!picker) return;
    let chosen = 0;
    picker.querySelectorAll("span").forEach(function (el) {
        el.onclick = function () {
            chosen = Number(el.dataset.v);
            picker.querySelectorAll("span").forEach(function (x) {
                x.textContent = Number(x.dataset.v) <= chosen ? "\u2605" : "\u2606";
            });
        };
    });

    document.getElementById("review-submit-btn").onclick = async function () {
        const msg = document.getElementById("review-msg");
        if (!chosen) { msg.textContent = "Please pick a star rating."; return; }
        msg.textContent = "Submitting...";
        try {
            const r = await fetch(`${API_URL}/api/reviews/product/${productId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + localStorage.getItem("userToken")
                },
                body: JSON.stringify({ rating: chosen, comment: document.getElementById("review-comment").value })
            });
            const out = await r.json();
            if (!r.ok) { msg.textContent = out.error || "Could not submit."; return; }
            renderProductReviews(productId);
        } catch (e) {
            msg.textContent = "Network error.";
        }
    };
}


function renderCategoryHeading(name, count) {
    const row = document.getElementById("category-chips");
    if (!row) return;
    row.innerHTML = `<h2 class="category-section-title">${name}</h2>
        <span class="category-section-count">${count} item${count === 1 ? "" : "s"}</span>`;
}
