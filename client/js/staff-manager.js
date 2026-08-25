let staffCategories = [];

// Rebuilds the product form's category dropdown, grouped parent > child.
// Call with a category id to preselect it when editing.
function renderCategorySelect(selectedId) {
    const select = document.getElementById("product-category");
    if (!select || !staffCategories) return;
    select.innerHTML = buildGroupedCategoryOptions(staffCategories, selectedId);
}

const API_URL = "";

function getStaffToken() {
    return localStorage.getItem("staffToken");
}

function clearStaffToken() {
    localStorage.removeItem("staffToken");
}

function staffLogout() {
    clearStaffToken();
    window.location.href = "../staff-login.html";
}

async function staffAuthorizedFetch(path, options = {}) {
    const token = getStaffToken();

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        cache: "no-store",
        headers: {
            ...(options.headers || {}),
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.status === 401 || response.status === 403) {
        clearStaffToken();
        window.location.href = "../staff-login.html";
        throw new Error("Unauthorized");
    }

    return response.json();
}

function showToast(message) {
    let toast = document.getElementById("staff-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "staff-toast";
        toast.style.cssText = "position:fixed; top:20px; right:20px; background:#1a1a2e; color:#fff; padding:12px 20px; border-radius:8px; font-size:14px; z-index:9999; box-shadow:0 4px 12px rgba(0,0,0,0.2); transition:opacity 0.3s;";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    toast.style.display = "block";

    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => { toast.style.display = "none"; }, 300);
    }, 2500);
}

async function init() {
    if (!getStaffToken()) {
        window.location.href = "../staff-login.html";
        return;
    }

    try {
        const me = await staffAuthorizedFetch("/api/auth/me");
        if (!me.user || me.user.role !== "store_manager") {
            clearStaffToken();
            window.location.href = "../staff-login.html";
            return;
        }
        document.getElementById("staff-name-display").textContent = me.user.name;
    } catch (error) {
        return;
    }

    await loadCategories();
    await loadSizeCatalog();
    await loadColorCatalog();
    await loadMyProducts();
}

let pdPickedFiles = [];
let pdLocalPreviews = [];
let pdSpecRowCounter = 0;

function addSpecRow(label, value) {
    const list = document.getElementById("specs-list");
    const rowId = `spec-row-${pdSpecRowCounter++}`;
    const row = document.createElement("div");
    row.id = rowId;
    row.style.cssText = "display:flex; gap:6px;";
    row.innerHTML = `
        <input type="text" class="spec-label-input" placeholder="Label (e.g. Material)" value="${label || ''}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <input type="text" class="spec-value-input" placeholder="Value (e.g. Polyester)" value="${value || ''}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <button type="button" onclick="document.getElementById('${rowId}').remove()" style="padding:8px 12px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">&times;</button>
    `;
    list.appendChild(row);
}

function collectSpecRows() {
    const rows = document.querySelectorAll("#specs-list > div");
    const specs = [];
    rows.forEach(row => {
        const label = row.querySelector(".spec-label-input").value.trim();
        const value = row.querySelector(".spec-value-input").value.trim();
        if (label) specs.push({ label, value });
    });
    return specs;
}
let pdSelectedSizes = [];
let pdSelectedColors = {};

async function loadSizeCatalog() {
    try {
        const response = await fetch(`${API_URL}/api/products/catalog/sizes`);
        const sizes = await response.json();
        const container = document.getElementById("size-checkbox-list");
        container.innerHTML = sizes.map(s => `
            <label style="display:flex; align-items:center; gap:4px; font-size:13px; border:1px solid #ccc; border-radius:16px; padding:4px 10px; cursor:pointer;">
                <input type="checkbox" value="${s.name}" onchange="toggleSizeSelection(this)"> ${s.name}
            </label>
        `).join("");
    } catch (error) {
        console.error("Load size catalog error:", error);
    }
}

function toggleSizeSelection(checkbox) {
    if (checkbox.checked) {
        pdSelectedSizes.push(checkbox.value);
    } else {
        pdSelectedSizes = pdSelectedSizes.filter(s => s !== checkbox.value);
    }
}

async function loadColorCatalog() {
    try {
        const response = await fetch(`${API_URL}/api/products/catalog/colors`);
        const colors = await response.json();
        const container = document.getElementById("color-checkbox-list");
        container.innerHTML = colors.map(c => `
            <div>
                <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
                    <input type="checkbox" value="${c.name}" onchange="toggleColorSelection(this)"> ${c.name}
                </label>
                <div class="pd-color-thumb-picker" data-color-name="${c.name}" style="display:none; flex-wrap:wrap; gap:6px; margin-top:6px;"></div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load color catalog error:", error);
    }
}

function toggleColorSelection(checkbox) {
    const picker = checkbox.closest("div").querySelector(".pd-color-thumb-picker");
    if (checkbox.checked) {
        pdSelectedColors[checkbox.value] = [];
        picker.style.display = "flex";
        renderThumbOptions(picker);
    } else {
        delete pdSelectedColors[checkbox.value];
        picker.style.display = "none";
    }
}

function renderThumbOptions(picker) {
    const colorName = picker.dataset.colorName;
    if (pdLocalPreviews.length === 0) {
        picker.innerHTML = `<span style="font-size:12px; color:#999;">Upload photos first</span>`;
        return;
    }
    picker.innerHTML = pdLocalPreviews.map((url, i) => `
        <img src="${url}" data-index="${i}" onclick="selectColorThumb(this, '${colorName}')" style="width:48px; height:48px; object-fit:cover; border-radius:6px; border:2px solid #ccc; cursor:pointer;">
    `).join("");
}

function selectColorThumb(imgEl, colorName) {
    const index = Number(imgEl.dataset.index);
    if (!Array.isArray(pdSelectedColors[colorName])) pdSelectedColors[colorName] = [];

    const alreadySelected = pdSelectedColors[colorName].includes(index);
    if (alreadySelected) {
        pdSelectedColors[colorName] = pdSelectedColors[colorName].filter(i => i !== index);
        imgEl.style.borderColor = "#ccc";
    } else {
        pdSelectedColors[colorName].push(index);
        imgEl.style.borderColor = "#ff6a00";
    }
}

async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/api/products/categories`);
        staffCategories = await response.json();
        renderCategorySelect();
    } catch (error) {
        console.error("Load categories error:", error);
    }
}

function statusBadge(status, deletionRequestStatus) {
    if (deletionRequestStatus === "pending") {
        return `<span class="status-badge status-pending">Deletion Requested</span>`;
    }
    if (status === "pending") return `<span class="status-badge status-pending">Pending Approval</span>`;
    if (status === "rejected") return `<span class="status-badge status-cancelled">Rejected</span>`;
    return `<span class="status-badge status-paid">Live</span>`;
}

let myProducts = [];
let currentManagerFilter = "all";

async function loadMyProducts() {
    try {
        const products = await staffAuthorizedFetch("/api/products/mine");
        myProducts = products || [];

        renderManagerSummary(myProducts);
        setupProductImageDropzone();
        renderMyProductsTable();

    } catch (error) {
        console.error("Load my products error:", error);
    }
}

function renderManagerSummary(products) {
    const container = document.getElementById("product-summary-grid");
    if (!container) return;

    const total = products.length;
    const live = products.filter(p => p.status === "approved").length;
    const pending = products.filter(p => p.status === "pending" || p.deletion_request_status === "pending").length;

    container.innerHTML = `
        <div class="stat-card">
            <div class="label">Total Products</div>
            <div class="value">${total}</div>
        </div>
        <div class="stat-card" style="background:#eafaf1;">
            <div class="label">Live</div>
            <div class="value">${live}</div>
        </div>
        <div class="stat-card" style="background:#fef3e2;">
            <div class="label">Pending</div>
            <div class="value">${pending}</div>
        </div>
    `;
}

function setManagerFilter(filter) {
    currentManagerFilter = filter;
    document.querySelectorAll("#product-filter-tabs .filter-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderMyProductsTable();
}

function renderMyProductsTable() {
    const container = document.getElementById("my-products-list");
    const searchInput = document.getElementById("product-search-input");
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

    let filtered = myProducts.filter(p => {
        if (currentManagerFilter === "live") return p.status === "approved";
        if (currentManagerFilter === "pending") return p.status === "pending" || p.deletion_request_status === "pending";
        return true;
    });

    if (searchTerm) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
    }

    if (filtered.length === 0) {
        container.innerHTML = `<p class="no-data">No products found.</p>`;
        return;
    }

    container.innerHTML = `
        <table>
            <thead><tr><th></th><th>Name</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
                ${filtered.map(p => {
                    const deletionPending = p.deletion_request_status === "pending";
                    const safeName = p.name.replace(/'/g, "\\'");
                    return `
                    <tr>
                        <td data-label=""><img class="product-table-thumb" src="${p.image || ''}" onerror="this.style.visibility='hidden'"></td>
                        <td data-label="Name">${p.name}</td>
                        <td data-label="Price">UGX ${Number(p.price).toLocaleString()}</td>
                        <td data-label="Stock">${p.stock}</td>
                        <td data-label="Status">${statusBadge(p.status, p.deletion_request_status)}</td>
                        <td data-label="Actions">
                            ${p.is_own === false
                                ? `<span style="font-size:12px; color:#999;">View only \u2014 owned by ${p.owner_name || "another user"}</span>`
                                : `
                            <button onclick='loadProductIntoForm(${JSON.stringify(p)})' style="background:#2563EB; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Edit</button>
                            ${deletionPending
                                ? `<span style="font-size:12px; color:#999;">Awaiting admin review</span>`
                                : `<button onclick="requestDeletion(${p.id}, '${safeName}')" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Request Deletion</button>`
                            }
                            `}
                        </td>
                    </tr>
                `;
                }).join("")}
            </tbody>
        </table>
    `;
}

function setupProductImageDropzone() {
    const dropzone = document.getElementById("product-image-dropzone");
    const fileInput = document.getElementById("product-image");
    if (!dropzone || !fileInput || dropzone.dataset.wired) return;

    dropzone.dataset.wired = "true";

    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            renderImagePreviews(fileInput.files);
        }
    });

    fileInput.addEventListener("change", () => {
        renderImagePreviews(fileInput.files);
    });
}

async function renderImagePreviews(fileList) {
    const preview = document.getElementById("product-image-preview");
    if (!preview) return;
    preview.innerHTML = "";

    const files = Array.from(fileList);
    const btn = document.getElementById("product-submit-btn");
    if (btn) btn.disabled = true;
    pdPickedFiles = [];
    const failed = [];

    const status = document.createElement("div");
    status.style.cssText = "font-size:12px; color:#666; width:100%;";
    preview.appendChild(status);

    for (let i = 0; i < files.length; i++) {
        status.textContent = "Preparing photo " + (i + 1) + " of " + files.length + "...";
        if (typeof preparePickedFile !== "function") { pdPickedFiles.push(files[i]); continue; }
        const r = await preparePickedFile(files[i]);
        if (r.ok) pdPickedFiles.push(r.file); else failed.push(r.name + " (" + r.reason + ")");
    }

    if (btn) btn.disabled = false;
    preview.innerHTML = "";

    if (failed.length) {
        const warn = document.createElement("div");
        warn.style.cssText = "color:#c0392b; font-size:12px; width:100%; margin-bottom:6px;";
        warn.textContent = failed.length + " photo(s) could not be read and were skipped: "
            + failed.join(", ") + ". Re-select them, or pick from Files rather than a cloud gallery.";
        preview.appendChild(warn);
    }

    pdLocalPreviews = pdPickedFiles.map(f => URL.createObjectURL(f));
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => renderThumbOptions(picker));

    pdLocalPreviews.forEach(url => {
        const img = document.createElement("img");
        img.src = url;
        preview.appendChild(img);
    });
}

function loadProductIntoForm(product) {
    document.getElementById("product-id").value = product.id;
    document.getElementById("product-name").value = product.name;
    renderCategorySelect(product.category_id);
    document.getElementById("product-description").value = product.description || "";
    document.getElementById("product-price").value = product.price;
    document.getElementById("product-stock").value = product.stock;
    document.getElementById("product-package-size").value = product.package_size || "Small";
    document.getElementById("product-warranty-months").value = product.warranty_months || "";
    document.getElementById("product-brand").value = product.brand || "";
    document.getElementById("product-gtin").value = product.gtin || "";
    document.getElementById("product-mpn").value = product.mpn || "";
    document.getElementById("product-image-preview").innerHTML = "";
    document.getElementById("product-form-title").textContent = `Edit Product: ${product.name}`;
    document.getElementById("product-submit-btn").textContent = "Update Product";
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetProductForm() {
    document.getElementById("product-id").value = "";
    document.getElementById("product-name").value = "";
    document.getElementById("product-description").value = "";
    document.getElementById("product-price").value = "";
    document.getElementById("product-stock").value = "";
    document.getElementById("product-package-size").value = "Small";
    document.getElementById("product-warranty-months").value = "";
    document.getElementById("product-brand").value = "";
    document.getElementById("product-gtin").value = "";
    document.getElementById("product-mpn").value = "";
    document.getElementById("product-image").value = "";
    pdPickedFiles = [];
    document.getElementById("product-image-preview").innerHTML = "";
    document.getElementById("specs-list").innerHTML = "";
    document.getElementById("product-form-title").textContent = "Add Product";
    document.getElementById("product-submit-btn").textContent = "Publish Product";
    document.getElementById("product-form-status").textContent = "";

    pdLocalPreviews = [];
    pdSelectedSizes = [];
    pdSelectedColors = {};
    document.querySelectorAll("#size-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll("#color-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => { picker.style.display = "none"; picker.value = ""; });
}

async function submitProductForm() {
    const id = document.getElementById("product-id").value;
    const name = document.getElementById("product-name").value.trim();
    const category_id = document.getElementById("product-category").value;
    const description = document.getElementById("product-description").value.trim();
    const price = document.getElementById("product-price").value;
    const stock = document.getElementById("product-stock").value;
    const packageSize = document.getElementById("product-package-size").value;
    const warrantyMonths = document.getElementById("product-warranty-months").value.trim();
    const brand = document.getElementById("product-brand").value.trim();
    const gtin = document.getElementById("product-gtin").value.trim();
    const mpn = document.getElementById("product-mpn").value.trim();
    const imageFiles = pdPickedFiles;
    const statusEl = document.getElementById("product-form-status");
    const submitBtn = document.getElementById("product-submit-btn");

    if (!name || !price || !stock) {
        statusEl.textContent = "Name, price, and stock are required.";
        return;
    }

    const confirmMessage = id
        ? "Publish these changes now? They will go live immediately."
        : "Publish this product now? It will go live immediately.";

    if (!confirm(confirmMessage)) {
        return;
    }

    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.6";

    const formData = new FormData();
    formData.append("name", name);
    formData.append("category_id", category_id);
    formData.append("description", description);
    formData.append("price", price);
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
        const token = getStaffToken();
        const url = id ? `${API_URL}/api/products/${id}` : `${API_URL}/api/products`;
        const method = id ? "PUT" : "POST";

        const response = await fetch(url, {
            method,
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Something went wrong.";
            return;
        }

        const savedProductId = data.product ? data.product.id : id;
        const returnedImages = data.images || [];

        const colorsPayload = Object.keys(pdSelectedColors)
            .filter(name => Array.isArray(pdSelectedColors[name]) && pdSelectedColors[name].length > 0)
            .map(name => ({
                name,
                image_paths: pdSelectedColors[name].map(idx => returnedImages[idx]).filter(Boolean)
            }));

        const specsPayload = collectSpecRows();

        if (savedProductId && (pdSelectedSizes.length > 0 || colorsPayload.length > 0 || specsPayload.length > 0)) {
            try {
                await fetch(`${API_URL}/api/products/${savedProductId}/options`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${getStaffToken()}`
                    },
                    body: JSON.stringify({ sizes: pdSelectedSizes, colors: colorsPayload, specs: specsPayload })
                });
            } catch (optionsError) {
                console.error("Save options error:", optionsError);
            }
        }

        showToast(data.message || "Saved successfully.");
        resetProductForm();
        await loadMyProducts();

    } catch (error) {
        console.error("Submit product error:", error);
        statusEl.textContent = "Could not connect to server.";
    } finally {
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
    }
}

async function requestDeletion(id, name) {
    if (!confirm(`Request deletion of "${name}"? An admin will need to approve this.`)) return;

    try {
        const token = getStaffToken();
        const response = await fetch(`${API_URL}/api/products/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || "Could not submit deletion request.");
            return;
        }

        showToast(data.message || "Deletion request submitted.");
        await loadMyProducts();

    } catch (error) {
        console.error("Request deletion error:", error);
        alert("Something went wrong.");
    }
}

init();


// --- Swipeable profile panel ---

let profileData = null;

async function openProfilePanel() {
    document.getElementById("profile-panel-overlay").classList.add("open");
    document.getElementById("profile-panel").classList.add("open");
    await loadProfileIntoPanel();
}

function closeProfilePanel() {
    document.getElementById("profile-panel-overlay").classList.remove("open");
    document.getElementById("profile-panel").classList.remove("open");
}

const ROLE_LABELS = { product_staff: "Product Staff", store_manager: "Store Manager", admin: "Administrator" };

async function loadProfileIntoPanel() {
    try {
        const result = await staffAuthorizedFetch("/api/auth/profile");
        profileData = result.user;

        document.getElementById("profile-first-name").value = profileData.first_name || "";
        document.getElementById("profile-last-name").value = profileData.last_name || "";
        document.getElementById("profile-display-name").value = profileData.display_name || "";
        document.getElementById("profile-phone").value = profileData.phone || "";
        document.getElementById("profile-gender").value = profileData.gender || "";
        document.getElementById("profile-dob").value = profileData.date_of_birth ? String(profileData.date_of_birth).split("T")[0] : "";
        document.getElementById("profile-country").value = profileData.country || "";
        document.getElementById("profile-city").value = profileData.city || "";

        document.getElementById("profile-photo-name").textContent = profileData.display_name || profileData.name;
        document.getElementById("profile-photo-role").textContent = ROLE_LABELS[profileData.role] || profileData.role;

        const photoImg = document.getElementById("profile-photo-img");
        const placeholder = document.getElementById("profile-photo-placeholder");

        if (profileData.profile_photo_url) {
            photoImg.src = profileData.profile_photo_url;
            photoImg.classList.remove("hidden");
            placeholder.classList.add("hidden");
        } else {
            photoImg.classList.add("hidden");
            placeholder.classList.remove("hidden");
        }

    } catch (error) {
        console.error("Load profile error:", error);
    }
}

async function saveProfileInfo() {
    const statusEl = document.getElementById("profile-save-status");
    statusEl.textContent = "Saving...";

    const payload = {
        first_name: document.getElementById("profile-first-name").value.trim(),
        last_name: document.getElementById("profile-last-name").value.trim(),
        display_name: document.getElementById("profile-display-name").value.trim(),
        phone: document.getElementById("profile-phone").value.trim(),
        gender: document.getElementById("profile-gender").value,
        date_of_birth: document.getElementById("profile-dob").value || null,
        country: document.getElementById("profile-country").value.trim(),
        city: document.getElementById("profile-city").value.trim()
    };

    try {
        const token = getStaffToken();
        const response = await fetch(`${API_URL}/api/auth/profile`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Could not save changes.";
            return;
        }

        statusEl.textContent = "Saved!";
        document.getElementById("profile-photo-name").textContent = payload.display_name || payload.first_name || (profileData ? profileData.name : "");

    } catch (error) {
        console.error("Save profile error:", error);
        statusEl.textContent = "Something went wrong.";
    }
}

let panelDragStartX = null;
let panelCurrentX = 0;

function setupProfilePanelSwipe() {
    const panel = document.getElementById("profile-panel");
    if (!panel || panel.dataset.swipeWired) return;
    panel.dataset.swipeWired = "true";

    panel.addEventListener("touchstart", (e) => {
        panelDragStartX = e.touches[0].clientX;
        panel.classList.add("dragging");
    });

    panel.addEventListener("touchmove", (e) => {
        if (panelDragStartX === null) return;
        const deltaX = e.touches[0].clientX - panelDragStartX;
        if (deltaX < 0) {
            panelCurrentX = deltaX;
            panel.style.transform = `translateX(${deltaX}px)`;
        }
    });

    panel.addEventListener("touchend", () => {
        panel.classList.remove("dragging");
        if (panelCurrentX < -100) {
            closeProfilePanel();
        }
        panel.style.transform = "";
        panelDragStartX = null;
        panelCurrentX = 0;
    });
}

document.addEventListener("DOMContentLoaded", setupProfilePanelSwipe);

// --- Searchable country field ---

const COUNTRY_LIST = [
    "Uganda","Kenya","Tanzania","Rwanda","Burundi","South Sudan","Democratic Republic of the Congo",
    "Ethiopia","Somalia","Sudan","Nigeria","Ghana","South Africa","Egypt","Morocco","Algeria","Tunisia",
    "Zambia","Zimbabwe","Malawi","Mozambique","Botswana","Namibia","Angola","Cameroon","Senegal",
    "Ivory Coast","Mali","Niger","Chad","Libya","United States","United Kingdom","Canada","Australia",
    "Germany","France","Italy","Spain","Portugal","Netherlands","Belgium","Switzerland","Sweden",
    "Norway","Denmark","Finland","Ireland","Poland","Austria","Greece","Turkey","Russia","China",
    "Japan","South Korea","India","Pakistan","Bangladesh","Indonesia","Malaysia","Singapore",
    "Philippines","Thailand","Vietnam","United Arab Emirates","Saudi Arabia","Qatar","Israel",
    "Brazil","Mexico","Argentina","Chile","Colombia","Peru","New Zealand"
];

function filterCountryResults() {
    const input = document.getElementById("profile-country");
    const query = input.value.trim().toLowerCase();
    const dropdown = document.getElementById("country-results-dropdown");

    const matches = query
        ? COUNTRY_LIST.filter(c => c.toLowerCase().includes(query))
        : COUNTRY_LIST;

    if (matches.length === 0) {
        dropdown.innerHTML = "<div class='district-result-empty'>No matching country</div>";
        dropdown.style.display = "block";
        return;
    }

    dropdown.innerHTML = matches.map(c =>
        `<div class="district-result-item" onclick="selectCountry('${c.replace(/'/g, "\\'")}')">${c}</div>`
    ).join("");
    dropdown.style.display = "block";
}

function selectCountry(name) {
    document.getElementById("profile-country").value = name;
    document.getElementById("country-results-dropdown").style.display = "none";
}

document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("country-results-dropdown");
    const input = document.getElementById("profile-country");
    if (dropdown && input && e.target !== input && !dropdown.contains(e.target)) {
        dropdown.style.display = "none";
    }
});
