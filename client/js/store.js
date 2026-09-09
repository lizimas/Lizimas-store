// Public vendor storefront (client/store.html). Reads the vendor slug from
// the pretty URL server/routes/store-page.js serves (/store/<slug>), or from
// a ?slug= query string as a fallback for local testing, then renders the
// vendor's banner/logo/about and their live catalogue.
//
// Product cards are a deliberately simplified copy of buildProductCard()
// in products.js (same .product-card/.product-grid markup so the styling
// matches the rest of the site) rather than loading products.js itself,
// which auto-fetches and renders the ENTIRE catalogue on DOMContentLoaded -
// exactly what a single-vendor page must not do.

function stResolveSlug() {
    const m = window.location.pathname.match(/\/store\/([^\/]+)\/?$/);
    if (m) return decodeURIComponent(m[1]);
    return new URLSearchParams(window.location.search).get("slug");
}

function stEscape(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function stBuildProductCard(product) {
    const card = document.createElement("div");
    card.className = "product-card";
    card.style.cursor = "pointer";
    card.onclick = () => {
        window.location.href = `/product/${product.id}`;
    };

    const outOfStock = product.stock !== undefined && Number(product.stock) <= 0;
    const badge = outOfStock ? `<span class="product-badge out-of-stock">Out of Stock</span>` : "";
    const priceFormatted = Number(product.price).toLocaleString();

    card.innerHTML = `
        <div class="product-image-wrapper">
            ${badge}
            <img src="${stEscape(product.image)}" alt="${stEscape(product.name)}" class="product-image product-image-primary" loading="lazy">
        </div>
        <div class="product-card-body">
            <h3 class="product-name">${stEscape(product.name)}</h3>
            <p class="product-price">UGX ${priceFormatted}</p>
        </div>
    `;
    return card;
}

function stRenderVendor(vendor) {
    document.getElementById("store-name").textContent = vendor.business_name || "";
    document.title = `${vendor.business_name} | Lizimas Store`;

    const bannerEl = document.getElementById("store-banner");
    if (vendor.banner_url) {
        bannerEl.style.backgroundImage = `url("${vendor.banner_url}")`;
    }

    const logoImg = document.getElementById("store-logo-img");
    const logoFallback = document.getElementById("store-logo-fallback");
    if (vendor.logo_url) {
        logoImg.src = vendor.logo_url;
        logoImg.alt = vendor.business_name || "";
        logoImg.hidden = false;
        logoFallback.hidden = true;
    } else {
        logoFallback.textContent = (vendor.business_name || "?").trim().charAt(0).toUpperCase();
        logoFallback.hidden = false;
        logoImg.hidden = true;
    }

    const aboutEl = document.getElementById("store-about");
    if (vendor.about) {
        aboutEl.textContent = vendor.about;
        aboutEl.hidden = false;
    } else {
        aboutEl.hidden = true;
    }
}

function stRenderProducts(products) {
    const container = document.getElementById("store-products-container");
    container.innerHTML = "";

    if (!products || products.length === 0) {
        container.innerHTML = `<p class="no-products-message">This store hasn't listed any products yet.</p>`;
        return;
    }

    const grid = document.createElement("div");
    grid.className = "product-grid";
    products.forEach(product => grid.appendChild(stBuildProductCard(product)));
    container.appendChild(grid);
}

function stShowNotFound() {
    document.getElementById("store-content").hidden = true;
    document.getElementById("store-not-found").hidden = false;
}

async function loadStore() {
    const slug = stResolveSlug();
    if (!slug) {
        stShowNotFound();
        return;
    }

    try {
        const res = await fetch(`/api/vendors/store/${encodeURIComponent(slug)}`);
        if (!res.ok) {
            stShowNotFound();
            return;
        }
        const data = await res.json();
        stRenderVendor(data.vendor);
        stRenderProducts(data.products);
        document.getElementById("store-content").hidden = false;
    } catch (error) {
        console.error("Store load error:", error);
        stShowNotFound();
    }
}

document.addEventListener("DOMContentLoaded", loadStore);
