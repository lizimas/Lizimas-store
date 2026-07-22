
const API_URL = "";

let allProducts = [];

async function loadProducts() {
    try {
        const response = await fetch(`${API_URL}/api/products`);
        allProducts = await response.json();
        console.log("Lizimas Products Loaded:", allProducts);
        displayProducts(allProducts);
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

    products.forEach(product => {
        const card = document.createElement("div");
        card.className = "product-card";
        card.style.cursor = "pointer";
        card.onclick = (event) => {
            if (event.target.closest(".add-to-cart-btn")) {
                return;
            }
            openProductModal(product.id);
        };

        const outOfStock = product.stock !== undefined && Number(product.stock) <= 0;

        card.innerHTML = `
            <div class="product-image-wrapper">
                ${buildBadge(product)}
                <img
                    src="${product.image}"
                    alt="${product.name}"
                    class="product-image"
                    loading="lazy"
                >
            </div>

            <h3 class="product-name">${product.name}</h3>

            ${buildRatingStars(product.rating)}

            ${buildPriceHtml(product)}

            <button
                class="add-to-cart-btn"
                onclick="handleAddToCart(${product.id})"
                ${outOfStock ? "disabled" : ""}
            >
                ${outOfStock ? "Unavailable" : "Add To Cart 🛒"}
            </button>
        `;

        container.appendChild(card);
    });
}

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
        displayProducts(allProducts);
        return;
    }

    const filteredProducts = allProducts.filter(product => {
        const name = (product.name || "").toLowerCase();
        const category = (product.category || "").toLowerCase();
        const description = (product.description || "").toLowerCase();

        return (
            name.includes(searchValue) ||
            category.includes(searchValue) ||
            description.includes(searchValue)
        );
    });

    displayProducts(filteredProducts);

    clearTimeout(searchLogTimeout);
    searchLogTimeout = setTimeout(() => {
        logSearchToServer(searchValue);
    }, 800);
}

function displayFeaturedProducts(products, limit = 8) {
    const container = document.getElementById("featured-products");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const featured = products.slice(0, limit);

    if (featured.length === 0) {
        container.innerHTML = `<p class="no-products-message">No products found.</p>`;
        return;
    }

    featured.forEach(product => {
        const card = document.createElement("div");
        card.className = "product-card";
        card.style.cursor = "pointer";
        card.onclick = (event) => {
            if (event.target.closest(".add-to-cart-btn")) {
                return;
            }
            openProductModal(product.id);
        };

        const outOfStock = product.stock !== undefined && Number(product.stock) <= 0;

        card.innerHTML = `
            <div class="product-image-wrapper">
                ${buildBadge(product)}
                <img
                    src="${product.image}"
                    alt="${product.name}"
                    class="product-image"
                    loading="lazy"
                >
            </div>

            <h3 class="product-name">${product.name}</h3>

            ${buildRatingStars(product.rating)}

            ${buildPriceHtml(product)}

            <button
                class="add-to-cart-btn"
                onclick="handleAddToCart(${product.id})"
                ${outOfStock ? "disabled" : ""}
            >
                ${outOfStock ? "Unavailable" : "Add To Cart 🛒"}
            </button>
        `;

        container.appendChild(card);
    });
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
        openProductModal(Number(openProductId));
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

    let touchStartX = 0;
    const SWIPE_THRESHOLD = 40;

    mainImage.ontouchstart = (e) => {
        touchStartX = e.changedTouches[0].screenX;
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

    mainImage.style.touchAction = "pan-y";

    document.getElementById("product-modal").classList.remove("hidden");
}

function closeProductModal() {
    if (cameFromCart) {
        window.location.href = "cart.html";
        return;
    }
    document.getElementById("product-modal").classList.add("hidden");
}
