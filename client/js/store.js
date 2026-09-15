// Public vendor storefront (client/store.html). Reads the vendor slug from
// the pretty URL server/routes/store-page.js serves (/store/<slug>), or from
// a ?slug= query string as a fallback for local testing, then renders the
// vendor's about text, delivery/payment method badge, and their live
// catalogue. No logo/banner - removed from the storefront on Ryan's
// instruction (Sept 2026).
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
    const sponsoredBadge = product.is_sponsored ? `<span class="product-badge sponsored">Sponsored</span>` : "";
    const priceFormatted = Number(product.price).toLocaleString();

    card.innerHTML = `
        <div class="product-image-wrapper">
            ${sponsoredBadge}
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

const STORE_DELIVERY_LABELS = {
    cash_on_delivery: { text: "\ud83d\ude9a Cash on Delivery", className: "cod" },
    payment_first: { text: "\ud83d\udcb3 Payment First", className: "prepay" }
};

function stRenderBadges(badges, brandAuthorizations) {
    const container = document.getElementById("store-verified-badges");
    if (!container) return;
    container.innerHTML = "";
    if (!badges) return;

    if (badges.is_registered_business) {
        const b = document.createElement("span");
        b.className = "store-badge store-badge-registered";
        b.style.cssText = "display:inline-flex; align-items:center; gap:4px; background:#059669; color:#fff; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-top:4px;";
        b.textContent = "✓ Registered Business";
        container.appendChild(b);
    } else if (badges.is_verified) {
        const b = document.createElement("span");
        b.className = "store-badge store-badge-verified";
        b.style.cssText = "display:inline-flex; align-items:center; gap:4px; background:#16264f; color:#fff; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-top:4px;";
        b.textContent = "✓ Verified Seller";
        container.appendChild(b);
    }

    // Phase 7: one small badge per brand this vendor is verified to sell.
    // Official Brand Store reads as the brand itself; Authorized
    // Distributor is deliberately a lighter-weight chip so it never reads
    // as "this store IS the brand" - see server/utils/vendorBrandAuth.js.
    (brandAuthorizations || []).forEach((auth) => {
        const b = document.createElement("span");
        const isOfficial = auth.tier === "official_store";
        b.className = "store-badge store-badge-brand-auth";
        b.style.cssText = `display:inline-flex; align-items:center; gap:4px; background:${isOfficial ? "#b45309" : "#f3f4f6"}; color:${isOfficial ? "#fff" : "#374151"}; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-top:4px; margin-left:6px; border:${isOfficial ? "none" : "1px solid #d1d5db"};`;
        b.textContent = isOfficial
            ? `✓ ${auth.brand_name} Official Store`
            : `${auth.brand_name} – Authorized Distributor`;
        container.appendChild(b);
    });
}

function stRenderVendor(vendor, badges, brandAuthorizations) {
    document.getElementById("store-name").textContent = vendor.business_name || "";
    document.title = `${vendor.business_name} | Lizimas Store`;
    stRenderBadges(badges, brandAuthorizations);

    const badgeEl = document.getElementById("store-delivery-badge");
    const badgeInfo = STORE_DELIVERY_LABELS[vendor.delivery_method];
    if (badgeInfo) {
        badgeEl.textContent = badgeInfo.text;
        badgeEl.className = `store-delivery-badge ${badgeInfo.className}`;
        badgeEl.hidden = false;
    } else {
        badgeEl.hidden = true;
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
        stRenderVendor(data.vendor, data.badges, data.brand_authorizations);
        stRenderProducts(data.products);
        document.getElementById("store-content").hidden = false;

        const sellerPanel = document.getElementById("store-seller-panel");
        if (sellerPanel) {
            await renderSellerPanel(sellerPanel, data, { showVisitLink: false });
            sellerPanel.hidden = false;
        }
    } catch (error) {
        console.error("Store load error:", error);
        stShowNotFound();
    }
}

document.addEventListener("DOMContentLoaded", loadStore);
