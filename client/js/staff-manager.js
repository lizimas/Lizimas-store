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
    await loadMyProducts();
}

async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/api/products/categories`);
        const categories = await response.json();
        const select = document.getElementById("product-category");
        select.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
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
                            <button onclick='loadProductIntoForm(${JSON.stringify(p)})' style="background:#2563EB; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Edit</button>
                            ${deletionPending
                                ? `<span style="font-size:12px; color:#999;">Awaiting admin review</span>`
                                : `<button onclick="requestDeletion(${p.id}, '${safeName}')" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Request Deletion</button>`
                            }
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

function renderImagePreviews(fileList) {
    const preview = document.getElementById("product-image-preview");
    if (!preview) return;
    preview.innerHTML = "";

    Array.from(fileList).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement("img");
            img.src = e.target.result;
            preview.appendChild(img);
        };
        reader.readAsDataURL(file);
    });
}

function loadProductIntoForm(product) {
    document.getElementById("product-id").value = product.id;
    document.getElementById("product-name").value = product.name;
    document.getElementById("product-category").value = product.category_id || "";
    document.getElementById("product-description").value = product.description || "";
    document.getElementById("product-price").value = product.price;
    document.getElementById("product-stock").value = product.stock;
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
    document.getElementById("product-image").value = "";
    document.getElementById("product-image-preview").innerHTML = "";
    document.getElementById("product-form-title").textContent = "Add Product";
    document.getElementById("product-submit-btn").textContent = "Publish Product";
    document.getElementById("product-form-status").textContent = "";
}

async function submitProductForm() {
    const id = document.getElementById("product-id").value;
    const name = document.getElementById("product-name").value.trim();
    const category_id = document.getElementById("product-category").value;
    const description = document.getElementById("product-description").value.trim();
    const price = document.getElementById("product-price").value;
    const stock = document.getElementById("product-stock").value;
    const imageFiles = document.getElementById("product-image").files;
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
