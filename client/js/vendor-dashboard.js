const API_URL = "";
let vendorDropoffPoints = [];

function getVendorToken() {
    return localStorage.getItem("vendorToken");
}

function vendorLogout() {
    localStorage.removeItem("vendorToken");
    window.location.href = "../vendor-login.html";
}

async function vendorAuthorizedFetch(path, options = {}) {
    const token = getVendorToken();
    if (!token) {
        window.location.href = "../vendor-login.html";
        throw new Error("Not logged in");
    }

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        cache: "no-store",
        headers: {
            ...(options.headers || {}),
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem("vendorToken");
        window.location.href = "../vendor-login.html";
        throw new Error("Unauthorized");
    }

    const text = await response.text();
    try { return JSON.parse(text); } catch (e) { throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`); }
}

// --- Tabs -----------------------------------------------------------------

function setupVendorTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.add("hidden"));
            button.classList.add("active");
            document.getElementById(`tab-${button.dataset.tab}`).classList.remove("hidden");

            if (button.dataset.tab === "overview") loadVendorStatus();
            if (button.dataset.tab === "products") loadVendorProducts();
            if (button.dataset.tab === "add-product" && staffCategoriesLoaded === false) loadVendorCategories();
            if (button.dataset.tab === "orders") loadVendorOrders();
            if (button.dataset.tab === "returns") loadVendorReturns();
            if (button.dataset.tab === "refunds") loadVendorReturnsRefunds();
            if (button.dataset.tab === "wallet") loadVendorWallet();
            if (button.dataset.tab === "reviews") loadVendorReviews();
            if (button.dataset.tab === "account") loadVendorComplianceNotices();
        });
    });
}

// --- Overview ---------------------------------------------------------

function vendorStatusLabel(status) {
    const map = {
        pending: { text: "Pending Review", color: "#B45309", bg: "#FEF3C7" },
        approved: { text: "Approved", color: "#166534", bg: "#DCFCE7" },
        rejected: { text: "Rejected", color: "#991B1B", bg: "#FEE2E2" },
        suspended: { text: "Suspended", color: "#991B1B", bg: "#FEE2E2" }
    };
    return map[status] || { text: status, color: "#333", bg: "#eee" };
}

let vendorAccountType = null;

async function loadVendorStatus() {
    try {
        const v = await vendorAuthorizedFetch("/api/vendors/me");
        vendorAccountType = v.account_type;
        const banner = document.getElementById("vendor-status-banner");
        const s = vendorStatusLabel(v.status);

        let extra = "";
        if (v.status === "pending") {
            extra = "<p style=\"margin:6px 0 0; font-size:13px;\">Your application is awaiting review. You can still add products, but they won't go live until your account is approved.</p>";
        } else if (v.status === "rejected") {
            extra = `<p style="margin:6px 0 0; font-size:13px;">${v.rejection_reason ? "Reason: " + v.rejection_reason : "Contact support for details."}</p>`;
        }

        banner.innerHTML = `
            <div style="display:inline-block; padding:6px 14px; border-radius:999px; background:${s.bg}; color:${s.color}; font-weight:600; font-size:14px;">${s.text}</div>
            ${extra}
        `;

        const idLabel = v.account_type === "company" ? "Registration Number" : "National ID Number";
        const idValue = v.account_type === "company" ? v.registration_number : v.national_id_number;

        document.getElementById("vendor-profile-details").innerHTML = `
            <table>
                <tbody>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Shop Name</td><td>${v.business_name || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Account Type</td><td>${v.account_type === "company" ? "Company" : v.account_type === "individual" ? "Individual" : "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">${idLabel}</td><td>${idValue || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Phone</td><td>${v.phone || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Location</td><td>${v.physical_address || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">MoMo Payout Number</td><td>${v.momo_number || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Applied</td><td>${v.submitted_at ? new Date(v.submitted_at).toLocaleDateString() : "-"}</td></tr>
                </tbody>
            </table>
        `;

        const verificationPanel = document.getElementById("vendor-verification-panel");
        const needsRegNum = v.account_type === "company" && !v.registration_number;
        const needsNatId = v.account_type === "individual" && !v.national_id_number;

        if (needsRegNum || needsNatId) {
            verificationPanel.classList.remove("hidden");
            document.getElementById("vendor-verification-regnum-group").classList.toggle("hidden", !needsRegNum);
            document.getElementById("vendor-verification-natid-group").classList.toggle("hidden", !needsNatId);
            document.getElementById("vendor-verification-momo").value = v.momo_number || "";
        } else {
            verificationPanel.classList.add("hidden");
        }
    } catch (error) {
        console.error("Load vendor status error:", error);
    }
}

async function submitVendorVerification() {
    const statusEl = document.getElementById("vendor-verification-status");
    const momo_number = document.getElementById("vendor-verification-momo").value.trim();

    const body = { momo_number: momo_number || null };

    if (vendorAccountType === "company") {
        const registration_number = document.getElementById("vendor-verification-regnum").value.trim();
        if (!registration_number) {
            statusEl.textContent = "Please enter your URSB registration number.";
            return;
        }
        body.registration_number = registration_number;
    } else if (vendorAccountType === "individual") {
        const national_id_number = document.getElementById("vendor-verification-natid").value.trim();
        if (!national_id_number) {
            statusEl.textContent = "Please enter your national ID number.";
            return;
        }
        body.national_id_number = national_id_number;
    }

    statusEl.style.color = "#DC2626";
    statusEl.textContent = "Saving...";

    try {
        await vendorAuthorizedFetch("/api/vendors/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        statusEl.style.color = "#067647";
        statusEl.textContent = "Saved.";
        loadVendorStatus();
    } catch (error) {
        console.error("Submit vendor verification error:", error);
        statusEl.style.color = "#DC2626";
        statusEl.textContent = "Could not save. Please try again.";
    }
}

// --- Products -----------------------------------------------------------

let staffCategories = [];
let staffCategoriesLoaded = false;

async function loadVendorCategories() {
    try {
        const response = await fetch(`${API_URL}/api/products/categories`);
        staffCategories = await response.json();
        staffCategoriesLoaded = true;
        const select = document.getElementById("product-category");
        if (select) select.innerHTML = buildGroupedCategoryOptions(staffCategories);
    } catch (error) {
        console.error("Load categories error:", error);
    }
}

// Clearer status filtering (Task #60): combines the admin approval status
// with stock and the vendor's own is_active toggle into one badge/filter
// key per product, rather than just showing the raw approval status.
function vendorProductFilterKey(p) {
    if (p.status === "pending") return "pending";
    if (p.status === "rejected") return "rejected";
    if (!p.is_active) return "inactive";
    if (Number(p.stock) <= 0) return "out_of_stock";
    return "active";
}

const VENDOR_PRODUCT_FILTERS = [
    ["all", "All"],
    ["active", "Active"],
    ["pending", "Pending Approval"],
    ["rejected", "Rejected"],
    ["out_of_stock", "Out of Stock"],
    ["inactive", "Deactivated"]
];

function vendorProductStatusBadge(p) {
    const key = vendorProductFilterKey(p);
    const map = {
        pending: `<span class="status-badge status-pending">Pending Approval</span>`,
        rejected: `<span class="status-badge status-cancelled">Rejected</span>`,
        inactive: `<span class="status-badge status-forfeited">Deactivated</span>`,
        out_of_stock: `<span class="status-badge status-processing">Out of Stock</span>`,
        active: `<span class="status-badge status-paid">Active</span>`
    };
    return map[key];
}

let vendorProductsCache = [];
let vendorProductsFilter = "all";
let vendorProductsSelected = new Set();

function renderVendorProductFilters() {
    const container = document.getElementById("vendor-products-filters");
    if (!container) return;
    container.innerHTML = VENDOR_PRODUCT_FILTERS.map(([key, label]) => {
        const count = key === "all" ? vendorProductsCache.length : vendorProductsCache.filter(p => vendorProductFilterKey(p) === key).length;
        const active = vendorProductsFilter === key;
        return `<button onclick="setVendorProductsFilter('${key}')" style="padding:6px 12px; border-radius:999px; border:1px solid ${active ? "#1a1a2e" : "#ddd"}; background:${active ? "#1a1a2e" : "#fff"}; color:${active ? "#fff" : "#333"}; font-size:12px; cursor:pointer;">${label}${count ? ` (${count})` : ""}</button>`;
    }).join("");
}

function setVendorProductsFilter(key) {
    vendorProductsFilter = key;
    renderVendorProductFilters();
    renderVendorProductsTable();
}

function updateVendorProductsBulkBar() {
    const bar = document.getElementById("vendor-products-bulk-bar");
    const countEl = document.getElementById("vendor-products-selected-count");
    if (!bar || !countEl) return;
    bar.hidden = vendorProductsSelected.size === 0;
    countEl.textContent = `${vendorProductsSelected.size} selected`;
}

function toggleVendorProductSelect(id, checked) {
    if (checked) vendorProductsSelected.add(Number(id));
    else vendorProductsSelected.delete(Number(id));
    updateVendorProductsBulkBar();
}

function toggleAllVendorProductsSelect(checked, visibleIds) {
    if (checked) visibleIds.forEach(id => vendorProductsSelected.add(Number(id)));
    else visibleIds.forEach(id => vendorProductsSelected.delete(Number(id)));
    updateVendorProductsBulkBar();
    renderVendorProductsTable();
}

async function bulkVendorProductAction(action) {
    if (vendorProductsSelected.size === 0) return;
    const verb = { activate: "activate", deactivate: "deactivate", delete: "delete" }[action];
    if (!confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${vendorProductsSelected.size} product(s)?`)) return;

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/products/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productIds: Array.from(vendorProductsSelected), action })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        vendorProductsSelected.clear();
        updateVendorProductsBulkBar();
        loadVendorProducts();
    } catch (error) {
        console.error("Bulk product action error:", error);
        alert("Could not connect to server.");
    }
}

async function loadVendorProducts() {
    try {
        const products = await vendorAuthorizedFetch("/api/vendors/products");
        vendorProductsCache = products;
        vendorProductsSelected.clear();
        updateVendorProductsBulkBar();
        renderVendorProductFilters();
        renderVendorProductsTable();
    } catch (error) {
        console.error("Load vendor products error:", error);
    }
}

function renderVendorProductsTable() {
    const container = document.getElementById("vendor-products-list");
    if (!container) return;

    if (!vendorProductsCache || vendorProductsCache.length === 0) {
        container.innerHTML = `<p class="no-data">You haven't listed any products yet.</p>`;
        return;
    }

    const rows = vendorProductsFilter === "all"
        ? vendorProductsCache
        : vendorProductsCache.filter(p => vendorProductFilterKey(p) === vendorProductsFilter);

    if (rows.length === 0) {
        container.innerHTML = `<p class="no-data">No products in this view.</p>`;
        return;
    }

    const visibleIds = rows.map(p => p.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => vendorProductsSelected.has(Number(id)));

    container.innerHTML = `
        <table>
            <thead><tr>
                <th><input type="checkbox" ${allSelected ? "checked" : ""} onchange="toggleAllVendorProductsSelect(this.checked, ${JSON.stringify(visibleIds)})"></th>
                <th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
                ${rows.map(p => `
                    <tr>
                        <td><input type="checkbox" ${vendorProductsSelected.has(Number(p.id)) ? "checked" : ""} onchange="toggleVendorProductSelect(${p.id}, this.checked)"></td>
                        <td data-label="Product">${p.name}</td>
                        <td data-label="SKU">${p.sku || "—"}</td>
                        <td data-label="Price">UGX ${Number(p.price).toLocaleString()}</td>
                        <td data-label="Stock">${p.stock}</td>
                        <td data-label="Status">${vendorProductStatusBadge(p)}</td>
                        <td data-label="Actions">
                            <button onclick="editVendorProduct(${p.id})" style="background:#1a1a2e; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Edit</button>
                            ${p.status === "approved" ? `<button onclick="bulkVendorProductActionSingle(${p.id}, '${p.is_active ? "deactivate" : "activate"}')" style="background:${p.is_active ? "#B45309" : "#16A34A"}; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">${p.is_active ? "Deactivate" : "Activate"}</button>` : ""}
                            <button onclick="deleteVendorProduct(${p.id})" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Delete</button>
                        </td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

// Single-row equivalent of bulkVendorProductAction, for the per-row
// Activate/Deactivate button - reuses the same bulk endpoint with a
// one-item array rather than duplicating the request logic.
async function bulkVendorProductActionSingle(id, action) {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/products/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productIds: [id], action })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        loadVendorProducts();
    } catch (error) {
        console.error("Product action error:", error);
        alert("Could not connect to server.");
    }
}

function resetVendorProductForm() {
    document.getElementById("product-id").value = "";
    document.getElementById("product-name").value = "";
    document.getElementById("product-sku").value = "";
    document.getElementById("product-description").value = "";
    document.getElementById("product-payout").value = "";
    document.getElementById("product-stock").value = "";
    hideVendorPricingPreview();
    document.getElementById("product-package-size").value = "Small";
    document.getElementById("product-warranty-months").value = "";
    document.getElementById("product-brand").value = "";
    document.getElementById("product-gtin").value = "";
    document.getElementById("product-mpn").value = "";
    document.getElementById("product-images").value = "";
    document.getElementById("product-authenticity-confirm").checked = false;
    document.getElementById("product-submit-btn").textContent = "Submit for Approval";
    document.getElementById("product-form-status").textContent = "";
    hideVendorVariantsPanel();
}


// --- Variants (Task #60: "basic variant support") --------------------------
// A vendor-scoped, free-text version of the admin variant system in
// admin.js (colours/sizes there come from a global catalogue with a
// per-colour thumbnail picker - this is the simpler cut: type comma-
// separated colour/size names, generate the colour x size grid, enter
// stock per row. Same three backend endpoints admin.js uses
// (saveProductOptions / generateProductVariants / updateVariantStock /
// setVariantStockMode), now also mounted under /api/vendors/products/:id/...
// with ownership enforced by the same canEditProduct() check the admin
// routes rely on internally.

let vendorVariantProductId = null;
let vendorVariantStockEnabled = false;

function hideVendorVariantsPanel() {
    const panel = document.getElementById("vendor-variants-panel");
    if (panel) panel.hidden = true;
    vendorVariantProductId = null;
    document.getElementById("vendor-variant-colors").value = "";
    document.getElementById("vendor-variant-sizes").value = "";
    document.getElementById("vendor-variant-options-status").textContent = "";
    document.getElementById("vendor-variant-stock-area").innerHTML = "";
}

async function loadVendorVariantOptions(productId) {
    vendorVariantProductId = productId;
    const panel = document.getElementById("vendor-variants-panel");
    if (panel) panel.hidden = false;

    try {
        const [optRes, productRes] = await Promise.all([
            fetch(`${API_URL}/api/products/${productId}/options`),
            Promise.resolve(vendorProductsCache.find(p => Number(p.id) === Number(productId)))
        ]);
        const opts = await optRes.json();

        document.getElementById("vendor-variant-colors").value = (opts.colors || []).map(c => c.name).join(", ");
        document.getElementById("vendor-variant-sizes").value = (opts.sizes || []).map(s => s.name).join(", ");
        vendorVariantStockEnabled = !!(productRes && productRes.variant_stock_enabled);

        renderVendorVariantStockArea(opts.colors || [], opts.sizes || [], opts.variants || []);
    } catch (error) {
        console.error("Load vendor variant options error:", error);
    }
}

function renderVendorVariantStockArea(colors, sizes, variants) {
    const area = document.getElementById("vendor-variant-stock-area");
    if (!area) return;

    const colorName = {};
    colors.forEach(c => { colorName[c.id] = c.name; });
    const sizeName = {};
    sizes.forEach(s => { sizeName[s.id] = s.name; });

    const mode = vendorVariantStockEnabled
        ? `<span style="color:#166534; font-weight:600;">Variant stock active</span>`
        : `<span style="color:#B45309; font-weight:600;">Simple stock (the Stock field above)</span>`;

    if (variants.length === 0) {
        const canGenerate = colors.length > 0 && sizes.length > 0;
        area.innerHTML = `
            <p style="font-size:13px; margin:0 0 10px;">Mode: ${mode}</p>
            <p style="font-size:13px; margin:0 0 10px;">
                No variants yet.${canGenerate ? ` Generating creates one row per colour and size - ${colors.length} × ${sizes.length} = ${colors.length * sizes.length} rows, all starting at zero stock.` : " Save at least one colour and one size first."}
            </p>
            ${canGenerate ? `<button onclick="generateVendorVariants()" style="background:#1a1a2e; color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer;">Generate Variants</button>` : ""}
        `;
        return;
    }

    const inStock = variants.filter(v => Number(v.stock) > 0).length;

    area.innerHTML = `
        <p style="font-size:13px; margin:0 0 10px;">Mode: ${mode}</p>
        <table style="width:100%; margin-bottom:12px;">
            <thead><tr><th>Colour</th><th>Size</th><th>Stock</th></tr></thead>
            <tbody>
                ${variants.map(v => `
                    <tr>
                        <td data-label="Colour">${colorName[v.color_id] || "—"}</td>
                        <td data-label="Size">${sizeName[v.size_id] || "—"}</td>
                        <td data-label="Stock"><input type="number" min="0" step="1" data-variant-id="${v.id}" value="${Number(v.stock) || 0}" class="vendor-variant-stock-input" style="width:80px; padding:6px; border:1px solid #ccc; border-radius:6px;"></td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
        <p style="font-size:13px; color:#666; margin:0 0 10px;">${variants.length} variants, ${inStock} with stock.</p>
        <button onclick="saveVendorVariantStock()" style="background:#1a1a2e; color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer; margin-right:8px;">Save Stock</button>
        <button onclick="generateVendorVariants()" style="background:#fff; color:#1a1a2e; border:1px solid #1a1a2e; border-radius:8px; padding:10px 16px; cursor:pointer; margin-right:8px;">Re-generate Missing</button>
        <button onclick="toggleVendorVariantStockMode()" style="background:${vendorVariantStockEnabled ? "#B45309" : "#16A34A"}; color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer;">${vendorVariantStockEnabled ? "Revert to Simple Stock" : "Enable Variant Stock"}</button>
    `;
}

async function saveVendorProductOptions() {
    if (!vendorVariantProductId) return;
    const statusEl = document.getElementById("vendor-variant-options-status");
    const colors = document.getElementById("vendor-variant-colors").value
        .split(",").map(s => s.trim()).filter(Boolean).map(name => ({ name }));
    const sizes = document.getElementById("vendor-variant-sizes").value
        .split(",").map(s => s.trim()).filter(Boolean);

    statusEl.textContent = "Saving...";
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/products/${vendorVariantProductId}/options`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ colors, sizes })
        });
        if (data.error) {
            statusEl.textContent = data.error;
            return;
        }
        statusEl.textContent = "Saved.";
        await loadVendorVariantOptions(vendorVariantProductId);
    } catch (error) {
        console.error("Save vendor product options error:", error);
        statusEl.textContent = "Could not connect to server.";
    }
}

async function generateVendorVariants() {
    if (!vendorVariantProductId) return;
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/products/${vendorVariantProductId}/variants/generate`, {
            method: "POST"
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        alert(`${data.created} created, ${data.skipped} already existed.`);
        await loadVendorVariantOptions(vendorVariantProductId);
    } catch (error) {
        console.error("Generate vendor variants error:", error);
        alert("Could not connect to server.");
    }
}

async function saveVendorVariantStock() {
    if (!vendorVariantProductId) return;
    const updates = Array.from(document.querySelectorAll(".vendor-variant-stock-input")).map(el => ({
        variant_id: Number(el.dataset.variantId),
        stock: Number(el.value)
    }));

    if (updates.some(u => !Number.isInteger(u.stock) || u.stock < 0)) {
        alert("Stock values must be whole numbers of zero or more.");
        return;
    }

    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/products/${vendorVariantProductId}/variants/stock`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        alert(`Saved. ${data.in_stock} of ${data.total} variants have stock (${data.total_stock} units).`);
        await loadVendorVariantOptions(vendorVariantProductId);
    } catch (error) {
        console.error("Save vendor variant stock error:", error);
        alert("Could not connect to server.");
    }
}

async function toggleVendorVariantStockMode() {
    if (!vendorVariantProductId) return;
    const target = !vendorVariantStockEnabled;
    if (target && !confirm("Enable variant stock? The storefront will use per-variant quantities instead of your product's Stock field.")) return;
    if (!target && !confirm("Revert to simple stock? The storefront will use your product's Stock field again.")) return;

    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/products/${vendorVariantProductId}/variant-stock`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: target })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        alert(data.message);
        await loadVendorVariantOptions(vendorVariantProductId);
    } catch (error) {
        console.error("Toggle vendor variant stock mode error:", error);
        alert("Could not connect to server.");
    }
}

// --- Live pricing preview --------------------------------------------------
// "Vendors enter what they want to earn. Lizimas calculates what the
// customer pays" (spec section 83) - this just shows the vendor that math
// as they type, using the same POST /api/vendors/pricing/preview endpoint
// the submit itself relies on server-side (client math is display-only;
// the server always recomputes it on save).

let vendorPricingPreviewTimer = null;

function hideVendorPricingPreview() {
    document.getElementById("pricing-preview").style.display = "none";
    document.getElementById("pricing-preview-error").style.display = "none";
}

function scheduleVendorPricingPreview() {
    clearTimeout(vendorPricingPreviewTimer);
    vendorPricingPreviewTimer = setTimeout(updateVendorPricingPreview, 400);
}

async function updateVendorPricingPreview() {
    const payoutRaw = document.getElementById("product-payout").value;
    const categoryId = document.getElementById("product-category").value;
    const previewEl = document.getElementById("pricing-preview");
    const errorEl = document.getElementById("pricing-preview-error");

    const payout = Number(payoutRaw);
    if (!payoutRaw || !(payout > 0)) {
        hideVendorPricingPreview();
        return;
    }

    try {
        const result = await vendorAuthorizedFetch("/api/vendors/pricing/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ desired_payout: payout, category_id: categoryId || null })
        });

        if (result.error) {
            errorEl.textContent = result.error;
            errorEl.style.display = "block";
            previewEl.style.display = "none";
            return;
        }

        // Deliberately no commission rate/amount here - sellers must never
        // be able to see or derive Lizimas' take rate (Ryan, Sept 2026); the
        // server only ever sends customerPrice/vendorPayout to this endpoint.
        document.getElementById("preview-customer-price").textContent = Number(result.customerPrice).toLocaleString();
        document.getElementById("preview-payout").textContent = Number(result.vendorPayout).toLocaleString();
        previewEl.style.display = "block";
        errorEl.style.display = "none";
    } catch (error) {
        console.error("Pricing preview error:", error);
        hideVendorPricingPreview();
    }
}

async function editVendorProduct(id) {
    const product = vendorProductsCache.find(p => Number(p.id) === Number(id));
    if (!product) return;

    if (!staffCategoriesLoaded) await loadVendorCategories();

    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    document.querySelector('.tab-btn[data-tab="add-product"]').classList.add("active");
    document.getElementById("tab-add-product").classList.remove("hidden");

    document.getElementById("product-id").value = product.id;
    document.getElementById("product-name").value = product.name || "";
    document.getElementById("product-sku").value = product.sku || "";
    document.getElementById("product-description").value = product.description || "";
    // Older listings (added before the commission engine) never recorded
    // vendor_desired_payout - fall back to the current price so the field
    // isn't blank, though re-saving will recompute it from that number.
    document.getElementById("product-payout").value = product.vendor_desired_payout || product.price || "";
    document.getElementById("product-stock").value = product.stock || "";
    document.getElementById("product-package-size").value = product.package_size || "Small";
    document.getElementById("product-warranty-months").value = product.warranty_months || "";
    document.getElementById("product-brand").value = product.brand || "";
    document.getElementById("product-gtin").value = product.gtin || "";
    document.getElementById("product-mpn").value = product.mpn || "";
    document.getElementById("product-authenticity-confirm").checked = false;
    const categorySelect = document.getElementById("product-category");
    if (categorySelect) categorySelect.innerHTML = buildGroupedCategoryOptions(staffCategories, product.category_id);
    document.getElementById("product-submit-btn").textContent = "Save Changes";
    document.getElementById("product-form-status").textContent = "Editing an approved product returns it to pending review.";
    scheduleVendorPricingPreview();
    loadVendorVariantOptions(product.id);
}

async function deleteVendorProduct(id) {
    if (!confirm("Delete this product?")) return;
    try {
        const token = getVendorToken();
        const response = await fetch(`${API_URL}/api/vendors/products/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not delete product.");
            return;
        }
        loadVendorProducts();
    } catch (error) {
        console.error("Delete product error:", error);
        alert("Could not connect to server.");
    }
}

async function submitVendorProductForm() {
    const id = document.getElementById("product-id").value;
    const name = document.getElementById("product-name").value.trim();
    const sku = document.getElementById("product-sku").value.trim();
    const category_id = document.getElementById("product-category").value;
    const description = document.getElementById("product-description").value.trim();
    const desiredPayout = document.getElementById("product-payout").value;
    const stock = document.getElementById("product-stock").value;
    const packageSize = document.getElementById("product-package-size").value;
    const warrantyMonths = document.getElementById("product-warranty-months").value.trim();
    const brand = document.getElementById("product-brand").value.trim();
    const gtin = document.getElementById("product-gtin").value.trim();
    const mpn = document.getElementById("product-mpn").value.trim();
    const imageFiles = document.getElementById("product-images").files;
    const statusEl = document.getElementById("product-form-status");
    const submitBtn = document.getElementById("product-submit-btn");

    if (!name || !desiredPayout || !stock) {
        statusEl.textContent = "Name, payout, and stock are required.";
        return;
    }

    if (!document.getElementById("product-authenticity-confirm").checked) {
        statusEl.textContent = "Please confirm the authenticity statement to continue.";
        return;
    }

    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.6";

    const formData = new FormData();
    formData.append("name", name);
    formData.append("sku", sku);
    formData.append("category_id", category_id);
    formData.append("description", description);
    formData.append("desired_payout", desiredPayout);
    formData.append("stock", stock);
    formData.append("package_size", packageSize);
    formData.append("warranty_months", warrantyMonths);
    formData.append("brand", brand);
    formData.append("gtin", gtin);
    formData.append("mpn", mpn);
    for (const file of imageFiles) {
        formData.append("images", file);
    }

    try {
        const token = getVendorToken();
        const url = id ? `${API_URL}/api/vendors/products/${id}` : `${API_URL}/api/vendors/products`;
        const method = id ? "PUT" : "POST";

        const response = await fetch(url, {
            method,
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });

        const data = await response.json();
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";

        if (!response.ok) {
            statusEl.textContent = data.error || "Could not save product.";
            return;
        }

        statusEl.textContent = data.message || "Saved.";
        resetVendorProductForm();
        document.querySelector('.tab-btn[data-tab="products"]').click();

    } catch (error) {
        console.error("Submit product error:", error);
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        statusEl.textContent = "Could not connect to server.";
    }
}

// --- Orders (Task #59: New -> Accepted -> Processing -> Ready for
// Handover -> Handed Over -> In Delivery -> Delivered, plus the
// Cancelled/Rejected/Returned/Forfeited exceptions) ------------------------

let vendorOrdersCache = [];
let vendorOrdersFilter = "all";

const VENDOR_STAGE_BADGE_CLASS = {
    new: "status-new",
    accepted: "status-accepted",
    processing: "status-processing",
    ready_for_handover: "status-ready",
    handed_over: "status-shipped",
    in_delivery: "status-shipped",
    completed: "status-delivered",
    rejected: "status-cancelled",
    return_in_progress: "status-pending",
    forfeited: "status-forfeited",
    cancelled: "status-cancelled"
};

const VENDOR_STAGE_FILTERS = [
    ["all", "All"],
    ["new", "New"],
    ["accepted", "Accepted"],
    ["processing", "Processing"],
    ["ready_for_handover", "Ready for Handover"],
    ["handed_over", "Handed Over"],
    ["in_delivery", "In Delivery"],
    ["completed", "Delivered"],
    ["rejected", "Rejected"],
    ["return_in_progress", "Returned"],
    ["cancelled", "Cancelled"]
];

// Forward-only, one step at a time - mirrors server/utils/vendorOrderStage.js.
const VENDOR_NEXT_STAGE = {
    new: "accepted",
    accepted: "processing",
    processing: "ready_for_handover"
};

const VENDOR_NEXT_STAGE_BUTTON_LABEL = {
    accepted: "Accept Order",
    processing: "Start Processing",
    ready_for_handover: "Mark Ready for Handover"
};

async function loadVendorDropoffPointsIfNeeded() {
    if (vendorDropoffPoints.length > 0) return;
    try {
        vendorDropoffPoints = await vendorAuthorizedFetch("/api/vendors/dropoff-points");
    } catch (error) {
        console.error("Load dropoff points error:", error);
    }
}

function dropoffPointOptions() {
    return vendorDropoffPoints.map(dp =>
        `<option value="${dp.id}">${dp.name}${dp.is_hub ? " (hub)" : ""}</option>`
    ).join("");
}

function renderVendorOrderFilters() {
    const container = document.getElementById("vendor-orders-filters");
    if (!container) return;
    container.innerHTML = VENDOR_STAGE_FILTERS.map(([key, label]) => {
        const count = key === "all" ? vendorOrdersCache.length : vendorOrdersCache.filter(o => o.stage === key).length;
        const active = vendorOrdersFilter === key;
        return `<button onclick="setVendorOrdersFilter('${key}')" style="padding:6px 12px; border-radius:999px; border:1px solid ${active ? "#1a1a2e" : "#ddd"}; background:${active ? "#1a1a2e" : "#fff"}; color:${active ? "#fff" : "#333"}; font-size:12px; cursor:pointer;">${label}${count ? ` (${count})` : ""}</button>`;
    }).join("");
}

function setVendorOrdersFilter(key) {
    vendorOrdersFilter = key;
    renderVendorOrderFilters();
    renderVendorOrdersTable();
}

async function loadVendorOrders() {
    try {
        await loadVendorDropoffPointsIfNeeded();
        vendorOrdersCache = await vendorAuthorizedFetch("/api/vendors/orders");
        renderVendorOrderFilters();
        renderVendorOrdersTable();
    } catch (error) {
        console.error("Load orders error:", error);
    }
}

function renderVendorOrdersTable() {
    const container = document.getElementById("vendor-orders-list");
    if (!container) return;

    const rows = vendorOrdersFilter === "all"
        ? vendorOrdersCache
        : vendorOrdersCache.filter(o => o.stage === vendorOrdersFilter);

    if (rows.length === 0) {
        container.innerHTML = `<p class="no-data">No orders in this view.</p>`;
        return;
    }

    container.innerHTML = `
        <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Order Date</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
                ${rows.map(o => vendorOrderRow(o)).join("")}
            </tbody>
        </table>
    `;
}

function vendorOrderRow(o) {
    const badgeClass = VENDOR_STAGE_BADGE_CLASS[o.stage] || "status-pending";
    const rejectedNote = o.stage === "rejected"
        ? `<div style="font-size:12px; color:#991B1B; margin-top:4px;">Rejected: ${o.rejection_reason || "no reason given"} - re-prepare and re-submit.</div>`
        : "";

    let action = "-";
    if (o.stage in VENDOR_NEXT_STAGE) {
        const next = VENDOR_NEXT_STAGE[o.stage];
        action = `<button onclick="advanceVendorOrderStage(${o.order_item_id}, '${next}')" style="background:#16264f; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">${VENDOR_NEXT_STAGE_BUTTON_LABEL[next]}</button>`;
    } else if (o.stage === "ready_for_handover") {
        action = `
            <select id="dropoff-select-${o.order_item_id}" style="padding:6px; border:1px solid #ccc; border-radius:6px; margin-right:6px;">
                <option value="">Choose drop-off point</option>
                ${dropoffPointOptions()}
            </select>
            <button onclick="markVendorHandedOver(${o.order_item_id})" style="background:#16A34A; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Mark Handed Over</button>`;
    }

    return `
        <tr>
            <td data-label="Product">${o.product_name}${rejectedNote}</td>
            <td data-label="Qty">${o.quantity}</td>
            <td data-label="Order Date">${new Date(o.created_at).toLocaleDateString()}</td>
            <td data-label="Status"><span class="status-badge ${badgeClass}">${o.stageLabel}</span></td>
            <td data-label="Action">${action}</td>
        </tr>`;
}

async function advanceVendorOrderStage(orderItemId, stage) {
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/order-items/${orderItemId}/stage`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        loadVendorOrders();
    } catch (error) {
        console.error("Advance order stage error:", error);
        alert("Could not connect to server.");
    }
}

async function markVendorHandedOver(orderItemId) {
    const select = document.getElementById(`dropoff-select-${orderItemId}`);
    const dropoff_point_id = select ? select.value : null;

    if (!dropoff_point_id) {
        alert("Please choose a drop-off point first.");
        return;
    }

    try {
        const token = getVendorToken();
        const response = await fetch(`${API_URL}/api/vendors/order-items/${orderItemId}/handover`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ dropoff_point_id })
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not mark as handed over.");
            return;
        }
        loadVendorOrders();
    } catch (error) {
        console.error("Mark handed over error:", error);
        alert("Could not connect to server.");
    }
}

// --- Returns ---------------------------------------------------------

async function loadVendorReturns() {
    try {
        const returns = await vendorAuthorizedFetch("/api/vendors/returns");
        const container = document.getElementById("vendor-returns-list");

        if (!returns || returns.length === 0) {
            container.innerHTML = `<p class="no-data">Nothing awaiting collection right now.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Product</th><th>Qty</th><th>Reason</th><th>Collect From</th><th>Deadline</th></tr></thead>
                <tbody>
                    ${returns.map(r => {
                        const deadline = new Date(r.collection_deadline);
                        const badgeColor = r.overdue ? "status-cancelled" : "status-pending";
                        return `
                            <tr>
                                <td data-label="Product">${r.product_name}</td>
                                <td data-label="Qty">${r.quantity}</td>
                                <td data-label="Reason">${(r.return_reason || "").replace(/_/g, " ")}</td>
                                <td data-label="Collect From">${r.moved_to_hub ? (r.dropoff_point_name || "Central hub") + " (moved to hub)" : (r.dropoff_point_name || "Original drop-off point")}</td>
                                <td data-label="Deadline"><span class="status-badge ${badgeColor}">${r.overdue ? "Overdue" : deadline.toLocaleDateString()}</span></td>
                            </tr>`;
                    }).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load returns error:", error);
    }
}

// --- Active promotions (read-only) -----------------------------------
// Admin-only to create; vendors just get to see what is currently running.
// Both endpoints are public and unauthenticated - no vendor token needed.

function vendorFmtUgx(n) {
    return "UGX " + Number(n || 0).toLocaleString();
}

// Escapes admin-entered free text (flash sale title/subtitle, discount code
// description) before it goes into innerHTML - none of it is restricted to
// a safe character set server-side, unlike the code itself.
const vendorEsc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function loadVendorPromotions() {
    const box = document.getElementById("vendor-promotions-panel");
    if (!box) return;

    let codes = [];
    let flashSale = null;
    try {
        const [codesRes, flashRes] = await Promise.all([
            fetch("/api/discounts/active"),
            fetch("/api/flash-sales/active")
        ]);
        if (codesRes.ok) codes = await codesRes.json();
        if (flashRes.ok) flashSale = await flashRes.json();
    } catch (error) {
        console.error("Load vendor promotions error:", error);
        box.innerHTML = `<p style="color:#6b7280">Could not load current promotions.</p>`;
        return;
    }

    if (codes.length === 0 && !flashSale) {
        box.innerHTML = `<p style="color:#6b7280">No store-wide promotions are running right now.</p>`;
        return;
    }

    let html = "";

    if (flashSale) {
        html += `<div style="margin-bottom:16px; padding:12px; background:#fef3d8; border-radius:8px;">
            <strong>${vendorEsc(flashSale.title || "Flash Sale")}</strong>
            ${flashSale.subtitle ? `<p style="margin:4px 0 0; font-size:13px; color:#4a5568;">${vendorEsc(flashSale.subtitle)}</p>` : ""}
            <p style="margin:4px 0 0; font-size:13px; color:#4a5568;">
                Ends ${new Date(flashSale.ends_at).toLocaleString()} &middot;
                ${(flashSale.items || []).length} product${(flashSale.items || []).length === 1 ? "" : "s"}
            </p>
        </div>`;
    }

    if (codes.length > 0) {
        html += `<table class="admin-table"><thead><tr>
                <th>Code</th><th>Discount</th><th>Min Order</th><th>Ends</th>
            </tr></thead><tbody>` +
            codes.map(c => {
                const value = c.discount_type === "percent" ? `${Number(c.value)}%` : vendorFmtUgx(c.value);
                return `<tr>
                    <td data-label="Code"><strong>${vendorEsc(c.code)}</strong>${c.description ? ` <span style="color:#6b7280; font-size:12px;">${vendorEsc(c.description)}</span>` : ""}</td>
                    <td data-label="Discount">${value}</td>
                    <td data-label="Min Order">${c.min_order_amount ? vendorFmtUgx(c.min_order_amount) : "—"}</td>
                    <td data-label="Ends">${c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "No end date"}</td>
                </tr>`;
            }).join("") +
            `</tbody></table>`;
    }

    box.innerHTML = html;
}

// --- Dashboard summary (Store Snapshot / Earnings / Seller Score) --------

function vendorKpiCard(label, value, warning) {
    return `<div class="stat-card${warning ? " warning" : ""}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function vendorFmtUgxAmount(n) {
    return "UGX " + Number(n || 0).toLocaleString();
}

async function loadVendorDashboardSummary() {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/dashboard-summary");
        if (data.error) return;

        const o = data.orders;
        document.getElementById("vendor-kpi-grid").innerHTML = [
            vendorKpiCard("Today's Orders", o.today),
            vendorKpiCard("Pending Handover", o.pendingHandover, o.pendingHandover > 0),
            vendorKpiCard("Awaiting Delivery", o.awaitingDelivery),
            vendorKpiCard("Completed", o.completed),
            vendorKpiCard("Cancelled", o.cancelled),
            vendorKpiCard("Active Returns", o.activeReturns, o.activeReturns > 0),
            vendorKpiCard("Products", data.products.total),
            vendorKpiCard("Low Stock", data.products.lowStock, data.products.lowStock > 0)
        ].join("");

        // Deliberately currency amounts only, never a rate or percentage -
        // sellers must never see the commission % (Ryan, Sept 2026).
        const e = data.earnings;
        document.getElementById("vendor-earnings-summary").innerHTML = `
            <div style="display:flex; gap:24px; flex-wrap:wrap; margin-top:6px;">
                <div><div style="font-size:12px; color:#888;">Sale</div><div style="font-size:20px; font-weight:700; color:#1a1a2e;">${vendorFmtUgxAmount(e.sale)}</div></div>
                <div><div style="font-size:12px; color:#888;">Marketplace charges</div><div style="font-size:20px; font-weight:700; color:#B45309;">- ${vendorFmtUgxAmount(e.charges)}</div></div>
                <div><div style="font-size:12px; color:#888;">Net payable</div><div style="font-size:20px; font-weight:700; color:#166534;">${vendorFmtUgxAmount(e.net)}</div></div>
            </div>
        `;

        const scoreContainer = document.getElementById("vendor-seller-score-container");
        if (scoreContainer && data.vendor) {
            await renderSellerPanel(scoreContainer, {
                vendor: data.vendor,
                sellerScore: data.sellerScore,
                followerCount: data.followerCount
            }, { showVisitLink: true, hideFollow: true });
        }
    } catch (error) {
        console.error("Load vendor dashboard summary error:", error);
    }
}

// --- Wallet & Payouts (Task #61) ----------------------------------------
// Balance figures are currency amounts only, never a rate or percentage -
// same "sellers must never see the commission %" rule as the dashboard
// earnings summary above.

const VENDOR_PAYOUT_STATUS_LABEL = { requested: "Awaiting review", paid: "Paid", rejected: "Rejected" };
const VENDOR_PAYOUT_STATUS_CLASS = { requested: "status-pending", paid: "status-paid", rejected: "status-cancelled" };

async function loadVendorWallet() {
    const summaryBox = document.getElementById("vendor-wallet-summary");
    const historyBox = document.getElementById("vendor-payout-history");
    const adjustmentsBox = document.getElementById("vendor-ledger-adjustments");
    if (!summaryBox) return;

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/wallet");
        if (data.error) {
            summaryBox.innerHTML = `<p>${vendorEsc(data.error)}</p>`;
            return;
        }

        const b = data.balance;
        summaryBox.innerHTML = `
            <div style="display:flex; gap:24px; flex-wrap:wrap; margin-bottom:18px;">
                <div><div style="font-size:12px; color:#888;">Available Balance</div><div style="font-size:24px; font-weight:700; color:#166534;">${vendorFmtUgx(b.available)}</div></div>
                <div><div style="font-size:12px; color:#888;">Pending (not yet delivered)</div><div style="font-size:20px; font-weight:700; color:#B45309;">${vendorFmtUgx(b.pending)}</div></div>
                <div><div style="font-size:12px; color:#888;">Requested (awaiting review)</div><div style="font-size:20px; font-weight:700; color:#1a1a2e;">${vendorFmtUgx(b.requestedTotal)}</div></div>
                <div><div style="font-size:12px; color:#888;">Paid Out to Date</div><div style="font-size:20px; font-weight:700; color:#1a1a2e;">${vendorFmtUgx(b.paidOutTotal)}</div></div>
            </div>
            <p style="font-size:13px; color:#666; margin:0 0 14px;">
                MoMo number on file: ${data.momoNumber ? vendorEsc(data.momoNumber) : '<span style="color:#DC2626;">none - add one in Account before requesting a payout</span>'}
                &middot; Minimum payout: ${vendorFmtUgx(data.minPayout)}
            </p>
            <button id="vendor-request-payout-btn" onclick="requestVendorPayout()"
                style="background:#1a1a2e; color:#fff; border:none; border-radius:8px; padding:10px 16px; cursor:pointer;"
                ${data.eligibility.allowed ? "" : "disabled"}>
                Request Payout
            </button>
            ${!data.eligibility.allowed ? `<p style="font-size:13px; color:#888; margin:8px 0 0;">${vendorEsc(data.eligibility.reason)}</p>` : ""}
        `;

        historyBox.innerHTML = data.payouts.length === 0
            ? `<p>No payout requests yet.</p>`
            : `<table style="width:100%;">
                <thead><tr><th>Date</th><th>Amount</th><th>MoMo Number</th><th>Status</th><th>Reference</th></tr></thead>
                <tbody>
                    ${data.payouts.map(p => `
                        <tr>
                            <td data-label="Date">${new Date(p.requestedAt).toLocaleDateString()}</td>
                            <td data-label="Amount">${vendorFmtUgx(p.amount)}</td>
                            <td data-label="MoMo Number">${vendorEsc(p.momoNumber || "-")}</td>
                            <td data-label="Status"><span class="status-badge ${VENDOR_PAYOUT_STATUS_CLASS[p.status] || ""}">${VENDOR_PAYOUT_STATUS_LABEL[p.status] || p.status}</span></td>
                            <td data-label="Reference">${vendorEsc(p.reference || "-")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>`;

        adjustmentsBox.innerHTML = data.adjustments.length === 0
            ? `<p>No balance adjustments.</p>`
            : `<table style="width:100%;">
                <thead><tr><th>Date</th><th>Amount</th><th>Reason</th></tr></thead>
                <tbody>
                    ${data.adjustments.map(a => `
                        <tr>
                            <td data-label="Date">${new Date(a.createdAt).toLocaleDateString()}</td>
                            <td data-label="Amount" style="color:${a.amount >= 0 ? '#166534' : '#DC2626'};">${a.amount >= 0 ? "+" : ""}${vendorFmtUgx(a.amount)}</td>
                            <td data-label="Reason">${vendorEsc(a.reason)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>`;
    } catch (error) {
        console.error("Load vendor wallet error:", error);
        summaryBox.innerHTML = "<p>Could not connect to server.</p>";
    }
}

async function requestVendorPayout() {
    if (!confirm("Request a payout of your full available balance via MoMo?")) return;
    const btn = document.getElementById("vendor-request-payout-btn");
    if (btn) btn.disabled = true;

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/wallet/payout-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        if (data.error) {
            alert(data.error);
            if (btn) btn.disabled = false;
            return;
        }
        alert("Payout requested. Lizimas will review it and send your MoMo transfer.");
        await loadVendorWallet();
    } catch (error) {
        console.error("Request vendor payout error:", error);
        alert("Could not connect to server.");
        if (btn) btn.disabled = false;
    }
}

// --- Returns & Refunds Center (Task #62) --------------------------------
// A financial/decision view of returns, separate from the collection-
// logistics-only Returns tab (loadVendorReturns above). Lizimas makes the
// final call on every refund - this only shows the vendor what happened
// and lets them add their own response, never changes the decision.

const VENDOR_RETURN_REASON_LABEL = {
    failed_delivery: "Failed delivery",
    customer_return: "Customer return",
    damaged: "Damaged",
    defective: "Defective",
    expired: "Expired"
};

const VENDOR_RESOLUTION_LABEL = {
    awaiting_decision: "Awaiting Lizimas' decision",
    refund_approved: "Refund approved",
    refund_denied: "Refund denied"
};
const VENDOR_RESOLUTION_CLASS = {
    awaiting_decision: "status-pending",
    refund_approved: "status-paid",
    refund_denied: "status-cancelled"
};

async function loadVendorReturnsRefunds() {
    const box = document.getElementById("vendor-returns-refunds-list");
    if (!box) return;

    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/returns-refunds");
        if (rows.error) {
            box.innerHTML = `<p>${vendorEsc(rows.error)}</p>`;
            return;
        }
        if (rows.length === 0) {
            box.innerHTML = `<p class="no-data">No returns recorded.</p>`;
            return;
        }

        box.innerHTML = rows.map(r => `
            <div class="panel" style="border:1px solid #eee; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; align-items:flex-start;">
                    <div>
                        <strong>${vendorEsc(r.product_name)}</strong> &times; ${r.quantity}
                        <div style="font-size:12px; color:#888; margin-top:2px;">
                            ${VENDOR_RETURN_REASON_LABEL[r.return_reason] || r.return_reason}
                            &middot; Returned ${new Date(r.returned_at).toLocaleDateString()}
                        </div>
                    </div>
                    <span class="status-badge ${VENDOR_RESOLUTION_CLASS[r.resolutionStatus] || ""}">${VENDOR_RESOLUTION_LABEL[r.resolutionStatus] || r.resolutionStatus}</span>
                </div>

                ${r.return_evidence_image ? `<img src="${vendorEsc(r.return_evidence_image)}" alt="Return evidence" style="max-width:200px; border-radius:8px; margin-top:10px;">` : ""}

                ${r.refund_decision ? `
                    <div style="margin-top:10px; font-size:13px;">
                        ${r.refund_decision === "approved"
                            ? `<span style="color:#166534; font-weight:600;">Refund approved: ${vendorFmtUgx(r.refund_amount)}</span>`
                            : `<span style="color:#DC2626; font-weight:600;">Refund denied</span>`}
                        ${r.refund_notes ? `<div style="color:#666; margin-top:4px;">${vendorEsc(r.refund_notes)}</div>` : ""}
                    </div>
                ` : ""}

                <div style="margin-top:12px; border-top:1px solid #f0f0f0; padding-top:10px;">
                    <label style="font-size:12px; font-weight:600; display:block; margin-bottom:6px;">Your response</label>
                    ${r.vendor_response ? `<p style="font-size:13px; color:#333; margin:0 0 8px;">${vendorEsc(r.vendor_response)}</p>` : ""}
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="vendor-return-response-${r.order_item_id}" placeholder="Add or update your response..." value="${r.vendor_response ? vendorEsc(r.vendor_response) : ""}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:13px;">
                        <button onclick="submitVendorReturnResponse(${r.order_item_id})" style="background:#1a1a2e; color:#fff; border:none; border-radius:6px; padding:8px 14px; cursor:pointer; font-size:13px;">Save</button>
                    </div>
                </div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load vendor returns/refunds error:", error);
        box.innerHTML = "<p>Could not connect to server.</p>";
    }
}

async function submitVendorReturnResponse(orderItemId) {
    const input = document.getElementById(`vendor-return-response-${orderItemId}`);
    if (!input || !input.value.trim()) {
        alert("Enter a response first.");
        return;
    }
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/order-items/${orderItemId}/return-response`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response: input.value.trim() })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        await loadVendorReturnsRefunds();
    } catch (error) {
        console.error("Submit vendor return response error:", error);
        alert("Could not connect to server.");
    }
}

// --- Reviews (Task #63) --------------------------------------------------
// Every review on the vendor's own products, with a public reply box.
// Admin keeps the power to remove a review outright - this only replies.

function vendorStarString(rating) {
    const n = Number(rating) || 0;
    return "&#9733;".repeat(n) + "&#9734;".repeat(5 - n);
}

async function loadVendorReviews() {
    const box = document.getElementById("vendor-reviews-list");
    if (!box) return;

    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/reviews");
        if (rows.error) {
            box.innerHTML = `<p>${vendorEsc(rows.error)}</p>`;
            return;
        }
        if (rows.length === 0) {
            box.innerHTML = `<p class="no-data">No reviews yet.</p>`;
            return;
        }

        box.innerHTML = rows.map(r => `
            <div class="panel" style="border:1px solid #eee; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                    <div>
                        <strong>${vendorEsc(r.product_name)}</strong>
                        <div style="color:#F59E0B; font-size:14px; margin-top:2px;">${vendorStarString(r.rating)}</div>
                        <div style="font-size:12px; color:#888; margin-top:2px;">
                            ${vendorEsc(r.reviewer_name)} ${r.verified_purchase ? "&middot; Verified purchase" : ""}
                            &middot; ${new Date(r.created_at).toLocaleDateString()}
                        </div>
                    </div>
                </div>
                ${r.comment ? `<p style="font-size:13px; color:#333; margin-top:10px;">${vendorEsc(r.comment)}</p>` : ""}

                <div style="margin-top:12px; border-top:1px solid #f0f0f0; padding-top:10px;">
                    <label style="font-size:12px; font-weight:600; display:block; margin-bottom:6px;">Your public reply</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="vendor-review-response-${r.id}" placeholder="Reply to this review..." value="${r.vendor_response ? vendorEsc(r.vendor_response) : ""}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:13px;">
                        <button onclick="submitVendorReviewResponse(${r.id})" style="background:#1a1a2e; color:#fff; border:none; border-radius:6px; padding:8px 14px; cursor:pointer; font-size:13px;">Save</button>
                    </div>
                </div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load vendor reviews error:", error);
        box.innerHTML = "<p>Could not connect to server.</p>";
    }
}

async function submitVendorReviewResponse(reviewId) {
    const input = document.getElementById(`vendor-review-response-${reviewId}`);
    if (!input || !input.value.trim()) {
        alert("Enter a reply first.");
        return;
    }
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/reviews/${reviewId}/response`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response: input.value.trim() })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        await loadVendorReviews();
    } catch (error) {
        console.error("Submit vendor review response error:", error);
        alert("Could not connect to server.");
    }
}

// --- Compliance notices (Task #63) --------------------------------------
// Read-only history of admin actions on this vendor's account - warnings,
// suspensions, product restrictions, payout freezes.

const VENDOR_NOTICE_LABEL = {
    warn: "Warning",
    suspend: "Account suspended",
    reinstate: "Account reinstated",
    restrict_product: "Product restricted",
    unrestrict_product: "Product restriction lifted",
    freeze_payout: "Payouts frozen",
    unfreeze_payout: "Payouts unfrozen"
};
const VENDOR_NOTICE_CLASS = {
    warn: "status-pending",
    suspend: "status-cancelled",
    reinstate: "status-paid",
    restrict_product: "status-cancelled",
    unrestrict_product: "status-paid",
    freeze_payout: "status-cancelled",
    unfreeze_payout: "status-paid"
};

async function loadVendorComplianceNotices() {
    const box = document.getElementById("vendor-compliance-notices");
    if (!box) return;

    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/compliance-notices");
        if (rows.error) {
            box.innerHTML = `<p>${vendorEsc(rows.error)}</p>`;
            return;
        }
        if (rows.length === 0) {
            box.innerHTML = `<p class="no-data">No notices on your account.</p>`;
            return;
        }

        box.innerHTML = `
            <table style="width:100%;">
                <thead><tr><th>Date</th><th>Action</th><th>Details</th></tr></thead>
                <tbody>
                    ${rows.map(n => `
                        <tr>
                            <td data-label="Date">${new Date(n.created_at).toLocaleDateString()}</td>
                            <td data-label="Action"><span class="status-badge ${VENDOR_NOTICE_CLASS[n.action_type] || ""}">${VENDOR_NOTICE_LABEL[n.action_type] || n.action_type}</span></td>
                            <td data-label="Details">${vendorEsc(n.reason)}${n.product_name ? ` <span style="color:#888;">(${vendorEsc(n.product_name)})</span>` : ""}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load vendor compliance notices error:", error);
        box.innerHTML = "<p>Could not connect to server.</p>";
    }
}

// --- Init -----------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    if (!getVendorToken()) {
        window.location.href = "../vendor-login.html";
        return;
    }
    setupVendorTabs();
    loadVendorStatus();
    loadVendorDashboardSummary();
    loadVendorCategories();
    loadVendorPromotions();
});
