const API_URL = "";

function getToken() {
    return localStorage.getItem("adminToken");
}

function setToken(token) {
    localStorage.setItem("adminToken", token);
}

function clearToken() {
    localStorage.removeItem("adminToken");
}

function showDashboard() {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");
    loadAllDashboardData();
}

function showLogin(errorMessage) {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("dashboard-screen").classList.add("hidden");
    document.getElementById("login-error").textContent = errorMessage || "";
}

let pendingLoginToken = null;

async function handleLogin() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (!email || !password) {
        document.getElementById("login-error").textContent = "Please enter both email and password.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/admin-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Login failed.";
            return;
        }

        if (data.requiresPasswordReset) {
            pendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            document.getElementById("login-reset-password").classList.remove("hidden");
            document.getElementById("login-reset-password-confirm").classList.remove("hidden");
            document.getElementById("login-reset-btn").classList.remove("hidden");
            document.getElementById("login-error").textContent = "You must set a new password before continuing.";
            return;
        }

        if (data.requires2FA) {
            pendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-2fa-code").classList.remove("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            document.getElementById("login-2fa-btn").classList.remove("hidden");
            document.getElementById("login-error").textContent = "Enter the 6-digit code from your authenticator app.";
            return;
        }

        setToken(data.token);
        showDashboard();

    } catch (error) {
        console.error("Login error:", error);
        document.getElementById("login-error").textContent = "Could not connect to server.";
    }
}

async function submitForcedReset() {
    const newPassword = document.getElementById("login-reset-password").value;
    const confirmPassword = document.getElementById("login-reset-password-confirm").value;

    if (!newPassword || !confirmPassword) {
        document.getElementById("login-error").textContent = "Please fill in both password fields.";
        return;
    }

    if (newPassword.length < 6) {
        document.getElementById("login-error").textContent = "Password must be at least 6 characters.";
        return;
    }

    if (newPassword !== confirmPassword) {
        document.getElementById("login-error").textContent = "Passwords do not match.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/complete-forced-reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken, newPassword })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Could not reset password.";
            return;
        }

        setToken(data.token);
        showDashboard();

    } catch (error) {
        console.error("Complete forced reset error:", error);
        document.getElementById("login-error").textContent = "Could not connect to server.";
    }
}

async function submitLogin2FA() {
    const code = document.getElementById("login-2fa-code").value.trim();

    if (!code) {
        document.getElementById("login-error").textContent = "Please enter the 6-digit code.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/login/2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken, code })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Invalid code.";
            return;
        }

        if (data.user.role !== "admin") {
            document.getElementById("login-error").textContent = "This account does not have admin access.";
            return;
        }

        setToken(data.token);
        showDashboard();

    } catch (error) {
        console.error("2FA login verification error:", error);
        document.getElementById("login-error").textContent = "Could not connect to server.";
    }
}

function handleLogout() {
    clearToken();
    showLogin();
}

async function authorizedFetch(path, options = {}) {
    const token = getToken();

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        cache: "no-store",
        headers: {
            ...(options.headers || {}),
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.status === 401 || response.status === 403) {
        clearToken();
        showLogin("Session expired. Please log in again.");
        throw new Error("Unauthorized");
    }

    return response.json();
}

async function loadAllDashboardData() {
    await loadStats();
    await loadVisitorStats();
    await loadOrders();
    await loadCustomers();
    await loadProducts();
}

async function loadVisitorStats() {
    try {
        const stats = await authorizedFetch("/api/admin/visitor-stats");
        const container = document.getElementById("visitor-analytics-grid");
        if (!container) return;

        container.innerHTML = `
            <div class="stat-card">
                <div class="label">Visitors Today</div>
                <div class="value">${stats.visitorsToday}</div>
            </div>
            <div class="stat-card">
                <div class="label">Visitors This Week</div>
                <div class="value">${stats.visitorsThisWeek}</div>
            </div>
            <div class="stat-card">
                <div class="label">Visitors This Month</div>
                <div class="value">${stats.visitorsThisMonth}</div>
            </div>
            <div class="stat-card">
                <div class="label">Visitors This Year</div>
                <div class="value">${stats.visitorsThisYear}</div>
            </div>
            <div class="stat-card">
                <div class="label">Unique Visitors Today</div>
                <div class="value">${stats.uniqueVisitorsToday}</div>
            </div>
            <div class="stat-card">
                <div class="label">Unique Visitors (All Time)</div>
                <div class="value">${stats.uniqueVisitorsTotal}</div>
            </div>
        `;
    } catch (error) {
        console.error("Load visitor stats error:", error);
    }
}

async function loadStats() {
    try {
        const stats = await authorizedFetch("/api/admin/stats");

        const statsGrid = document.getElementById("stats-grid");
        statsGrid.innerHTML = `
            <div class="stat-card">
                <div class="label">Total Revenue (Paid)</div>
                <div class="value">UGX ${Number(stats.totalRevenue).toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Orders</div>
                <div class="value">${stats.totalOrders}</div>
            </div>
            <div class="stat-card ${stats.pendingOrders > 0 ? "warning" : ""}">
                <div class="label">Pending Orders</div>
                <div class="value">${stats.pendingOrders}</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Registered Customers</div>
                <div class="value">${stats.totalCustomers}</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Deleted Accounts</div>
                <div class="value">${stats.totalDeletedAccounts}</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Guest Customers</div>
                <div class="value">${stats.totalGuestCustomers}</div>
            </div>
            <div class="stat-card ${stats.pendingPayments > 0 ? "warning" : ""}">
                <div class="label">Pending Payments</div>
                <div class="value">${stats.pendingPayments}</div>
            </div>
            <div class="stat-card" id="search-stat-card">
                <div class="label">Searches (7 days)</div>
                <div class="value">...</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Visitors</div>
                <div class="value">${stats.totalVisitors}</div>
            </div>
            <div class="stat-card">
                <div class="label">Paid Orders</div>
                <div class="value">${stats.paidOrders}</div>
            </div>
        `;

        const lowStockList = document.getElementById("low-stock-list");
        if (!stats.lowStockProducts || stats.lowStockProducts.length === 0) {
            lowStockList.innerHTML = `<p class="no-data">No products are low on stock.</p>`;
        } else {
            lowStockList.innerHTML = `
                <table>
                    <thead><tr><th>Product</th><th>Stock Left</th></tr></thead>
                    <tbody>
                        ${stats.lowStockProducts.map(p => `
                            <tr>
                                <td data-label="Product">${p.name}</td>
                                <td data-label="Stock">${p.stock}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        }

    } catch (error) {
        console.error("Load stats error:", error);
    }

    try {
        const searchStats = await authorizedFetch("/api/search/stats");

        const searchStatCard = document.getElementById("search-stat-card");
        if (searchStatCard) {
            searchStatCard.querySelector(".value").textContent = searchStats.searchesLast7Days;
        }

        const topSearchesList = document.getElementById("top-searches-list");
        if (!searchStats.topTerms || searchStats.topTerms.length === 0) {
            topSearchesList.innerHTML = `<p class="no-data">No searches logged yet.</p>`;
        } else {
            topSearchesList.innerHTML = `
                <table>
                    <thead><tr><th>Search Term</th><th>Times Searched</th></tr></thead>
                    <tbody>
                        ${searchStats.topTerms.map(t => `
                            <tr>
                                <td data-label="Term">${t.query}</td>
                                <td data-label="Count">${t.count}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        console.error("Load search stats error:", error);
    }
}

let adminOrders = [];

async function loadOrders() {
    try {
        const orders = await authorizedFetch("/api/admin/orders");
        adminOrders = orders;
        const ordersTable = document.getElementById("orders-table");

        if (!orders || orders.length === 0) {
            ordersTable.innerHTML = `<p class="no-data">No orders yet.</p>`;
            return;
        }

        const statusOptions = ["pending", "paid", "shipped", "delivered", "cancelled"];

        ordersTable.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Order #</th>
                        <th>Customer</th>
                        <th>Total</th>
                        <th>Delivery</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${orders.map(order => `
                        <tr>
                            <td data-label="Order #">#${order.id}</td>
                            <td data-label="Customer">${order.customer_name || order.customer_email || "Guest"}</td>
                            <td data-label="Total">UGX ${Number(order.total).toLocaleString()}</td>
                            <td data-label="Delivery">${order.delivery_method === "pickup" ? "Pickup" : "UGX " + Number(order.delivery_fee || 0).toLocaleString()}</td>
                            <td data-label="Status">
                                <select class="status-select" onchange="updateOrderStatus(${order.id}, this.value)">
                                    ${statusOptions.map(s => `
                                        <option value="${s}" ${s === order.status ? "selected" : ""}>${s}</option>
                                    `).join("")}
                                </select>
                            </td>
                            <td data-label="Date">${new Date(order.created_at).toLocaleDateString()}</td>
                            <td data-label="Actions">
                                <button onclick="viewOrderDetails(${order.id})">View</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error("Load orders error:", error);
    }
}

async function updateOrderStatus(orderId, newStatus) {
    try {
        const token = getToken();

        const response = await fetch(`${API_URL}/api/admin/orders/${orderId}/status`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            const data = await response.json();
            alert(data.error || "Failed to update order status.");
        }
        loadOrders();

    } catch (error) {
        console.error("Update order status error:", error);
        alert("Could not connect to server.");
    }
}

let customerSearchDebounce = null;

async function loadCustomers(search) {
    try {
        const query = search ? `?search=${encodeURIComponent(search)}` : "";
        const customers = await authorizedFetch(`/api/admin/customers${query}`);
        const customersTable = document.getElementById("customers-table");

        if (!customers || customers.length === 0) {
            customersTable.innerHTML = `<p class="no-data">No customers found.</p>`;
            return;
        }

        customersTable.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Joined</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${customers.map(c => `
                        <tr>
                            <td data-label="Name">${c.name}</td>
                            <td data-label="Email">${c.email}</td>
                            <td data-label="Phone">${c.phone || "—"}</td>
                            <td data-label="Role"><span class="status-badge status-${c.role === "admin" ? "delivered" : "paid"}">${c.role}</span></td>
                            <td data-label="Status">${c.deleted_at ? `<span class="status-badge status-cancelled">Deleted</span>` : `<span class="status-badge status-paid">Active</span>`}</td>
                            <td data-label="Joined">${new Date(c.created_at).toLocaleDateString()}</td>
                            <td data-label="Action">${c.deleted_at || c.role === "admin" ? "—" : `<button onclick="deleteCustomerAccount(${c.id}, '${c.name.replace(/'/g, "\\'")}')" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Delete</button>`}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error("Load customers error:", error);
    }
}

function filterCustomers() {
    const value = document.getElementById("customer-search-input").value.trim();
    clearTimeout(customerSearchDebounce);
    customerSearchDebounce = setTimeout(() => {
        loadCustomers(value);
    }, 300);
}

async function deleteCustomerAccount(id, name) {
    if (!confirm(`Delete the account for "${name}"? This cannot be undone from here.`)) {
        return;
    }

    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/customers/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            const data = await response.json();
            alert(data.error || "Failed to delete account.");
            return;
        }

        showToast(`${name}'s account has been deleted.`);

        const searchValue = document.getElementById("customer-search-input").value.trim();
        loadCustomers(searchValue);
        loadStats();

        const staffContainer = document.getElementById("staff-accounts-list");
        if (staffContainer) loadStaffAccounts();

    } catch (error) {
        console.error("Delete customer error:", error);
        alert("Something went wrong while deleting the account.");
    }
}

let allCategories = [];

async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/api/products/categories`);
        allCategories = await response.json();

        const select = document.getElementById("product-category");
        select.innerHTML = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

    } catch (error) {
        console.error("Load categories error:", error);
    }
}

let adminProducts = [];

let currentProductFilter = "all";

async function loadProducts() {
    try {
        await loadCategories();

        const response = await fetch(`${API_URL}/api/products`);
        const products = await response.json();
        adminProducts = products;

        renderProductSummary(products);
        setupProductImageDropzone();
        renderProductsTable();

    } catch (error) {
        console.error("Load products error:", error);
    }
}

function renderProductSummary(products) {
    const container = document.getElementById("product-summary-grid");
    if (!container) return;

    const total = products.length;
    const inStock = products.filter(p => p.stock > 10).length;
    const lowStock = products.filter(p => p.stock > 0 && p.stock <= 10).length;
    const outOfStock = products.filter(p => p.stock <= 0).length;

    container.innerHTML = `
        <div class="stat-card">
            <div class="label">Total Products</div>
            <div class="value">${total}</div>
        </div>
        <div class="stat-card" style="background:#eafaf1;">
            <div class="label">In Stock</div>
            <div class="value">${inStock}</div>
        </div>
        <div class="stat-card" style="background:#fef3e2;">
            <div class="label">Low Stock</div>
            <div class="value">${lowStock}</div>
        </div>
        <div class="stat-card" style="background:#fdeee9;">
            <div class="label">Out of Stock</div>
            <div class="value">${outOfStock}</div>
        </div>
    `;
}

function setProductFilter(filter) {
    currentProductFilter = filter;
    document.querySelectorAll("#product-filter-tabs .filter-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderProductsTable();
}

function renderProductsTable() {
    const productsTable = document.getElementById("products-table");
    const searchInput = document.getElementById("product-search-input");
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

    let filtered = adminProducts.filter(p => {
        if (currentProductFilter === "instock") return p.stock > 10;
        if (currentProductFilter === "lowstock") return p.stock > 0 && p.stock <= 10;
        if (currentProductFilter === "outofstock") return p.stock <= 0;
        return true;
    });

    if (searchTerm) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
    }

    if (filtered.length === 0) {
        productsTable.innerHTML = `<p class="no-data">No products found.</p>`;
        return;
    }

    productsTable.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(p => `
                    <tr>
                        <td data-label=""><img class="product-table-thumb" src="${p.image || ''}" onerror="this.style.visibility='hidden'"></td>
                        <td data-label="Name">${p.name}</td>
                        <td data-label="Category">${p.category || "—"}</td>
                        <td data-label="Price">UGX ${Number(p.price).toLocaleString()}</td>
                        <td data-label="Stock">${p.stock}</td>
                        <td data-label="Actions">
                            <button onclick="editProduct(${p.id})">Edit</button>
                            <button onclick="removeProduct(${p.id})">Delete</button>
                        </td>
                    </tr>
                `).join("")}
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

function openProductForm() {
    document.getElementById("product-form-title").textContent = "Add Product";
    document.getElementById("product-id").value = "";
    document.getElementById("product-name").value = "";
    document.getElementById("product-description").value = "";
    document.getElementById("product-price").value = "";
    document.getElementById("product-stock").value = "";
    document.getElementById("product-image").value = "";
    document.getElementById("product-image-preview").innerHTML = "";
    document.getElementById("product-form-error").textContent = "";
    document.getElementById("variants-section").classList.add("hidden");
    document.getElementById("variants-list").innerHTML = "";
    document.getElementById("product-form-container").classList.remove("hidden");
}

function editProduct(id) {
    const product = adminProducts.find(p => p.id === id);
    if (!product) {
        console.error("Product not found:", id);
        return;
    }
    document.getElementById("product-form-title").textContent = "Edit Product";
    document.getElementById("product-id").value = product.id;
    document.getElementById("product-name").value = product.name;
    document.getElementById("product-category").value = product.category_id;
    document.getElementById("product-description").value = product.description || "";
    document.getElementById("product-price").value = product.price;
    document.getElementById("product-stock").value = product.stock;
    document.getElementById("variants-section").classList.remove("hidden");
    loadVariants(product.id);
    document.getElementById("product-image").value = "";
    document.getElementById("product-image-preview").innerHTML = "";
    document.getElementById("product-form-error").textContent = "";
    document.getElementById("product-form-container").classList.remove("hidden");
}

function closeProductForm() {
    document.getElementById("product-form-container").classList.add("hidden");
}

async function saveProduct() {
    const id = document.getElementById("product-id").value;
    const name = document.getElementById("product-name").value.trim();
    const category_id = document.getElementById("product-category").value;
    const description = document.getElementById("product-description").value.trim();
    const price = document.getElementById("product-price").value;
    const stock = document.getElementById("product-stock").value;
    const files = document.getElementById("product-image").files;

    const errorEl = document.getElementById("product-form-error");

    if (!name || !category_id || !price || !stock) {
        errorEl.textContent = "Please fill in name, category, price, and stock.";
        return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("category_id", category_id);
    formData.append("description", description);
    formData.append("price", price);
    formData.append("stock", stock);

    for (let i = 0; i < files.length; i++) {
        formData.append("images", files[i]);
    }

    try {
        const result = await authorizedFetch(
            id ? `/api/products/${id}` : "/api/products",
            {
                method: id ? "PUT" : "POST",
                body: formData
            }
        );

        if (result.error) {
            errorEl.textContent = result.error;
            return;
        }

        closeProductForm();
        loadProducts();
        loadStats();

    } catch (error) {
        console.error("Save product error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

async function removeProduct(id) {
    if (!confirm("Delete this product? This cannot be undone.")) {
        return;
    }

    try {
        const result = await authorizedFetch(`/api/products/${id}`, { method: "DELETE" });

        if (result.error) {
            alert(result.error);
            return;
        }

        loadProducts();
        loadStats();

    } catch (error) {
        console.error("Delete product error:", error);
        alert("Could not connect to server.");
    }
}

function setupTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.add("hidden"));

            button.classList.add("active");
            document.getElementById(`tab-${button.dataset.tab}`).classList.remove("hidden");

            if (button.dataset.tab === "account") {
                loadAccount2FAStatus();
                loadAccountSessions();
            }

            if (button.dataset.tab === "staff") {
                loadStaffAccounts();
                loadPendingProducts();
                loadDeletionRequests();
                loadTrash();
                loadActivityLog();
                loadStaffSessions();
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    setupTabs();

    if (getToken()) {
        showDashboard();
    } else {
        showLogin();
    }
});

let currentVariants = [];

async function loadVariants(productId) {
    try {
        const response = await fetch(`${API_URL}/api/variants/product/${productId}`);
        currentVariants = await response.json();
        renderVariantsList();
    } catch (error) {
        console.error("Load variants error:", error);
    }
}

function renderVariantsList() {
    const container = document.getElementById("variants-list");

    if (!currentVariants || currentVariants.length === 0) {
        container.innerHTML = `<p class="no-data">No variants yet.</p>`;
        return;
    }

    container.innerHTML = currentVariants.map(v => `
        <div class="variant-row">
            <img src="${v.image_path || ''}" alt="" class="variant-thumb">
            <span>${v.variant_name}</span>
            <span>UGX ${Number(v.price).toLocaleString()}</span>
            <span>Stock: ${v.stock}</span>
            <button type="button" onclick="deleteVariant(${v.id})">Delete</button>
        </div>
    `).join("");
}

async function addVariant() {
    const productId = document.getElementById("product-id").value;
    const variant_name = document.getElementById("variant-name").value.trim();
    const price = document.getElementById("variant-price").value;
    const stock = document.getElementById("variant-stock").value;
    const files = document.getElementById("variant-image").files;
    const errorEl = document.getElementById("variant-form-error");

    if (!productId) {
        errorEl.textContent = "Save the product first before adding variants.";
        return;
    }

    if (!variant_name || !price) {
        errorEl.textContent = "Please enter a variant name and price.";
        return;
    }

    const formData = new FormData();
    formData.append("variant_name", variant_name);
    formData.append("price", price);
    formData.append("stock", stock || 0);

    if (files.length > 0) {
        formData.append("images", files[0]);
    }

    try {
        const result = await authorizedFetch(`/api/variants/product/${productId}`, {
            method: "POST",
            body: formData
        });

        if (result.error) {
            errorEl.textContent = result.error;
            return;
        }

        document.getElementById("variant-name").value = "";
        document.getElementById("variant-price").value = "";
        document.getElementById("variant-stock").value = "";
        document.getElementById("variant-image").value = "";
        errorEl.textContent = "";

        loadVariants(productId);

    } catch (error) {
        console.error("Add variant error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

async function deleteVariant(variantId) {
    if (!confirm("Delete this variant?")) {
        return;
    }

    try {
        const result = await authorizedFetch(`/api/variants/${variantId}`, {
            method: "DELETE"
        });

        if (result.error) {
            console.error(result.error);
            return;
        }

        const productId = document.getElementById("product-id").value;
        loadVariants(productId);

    } catch (error) {
        console.error("Delete variant error:", error);
    }
}

async function viewOrderDetails(orderId) {
    const order = adminOrders.find(o => o.id === orderId);
    if (!order) {
        console.error("Order not found:", orderId);
        return;
    }

    document.getElementById("order-detail-id").textContent = order.id;
    document.getElementById("order-detail-customer").textContent = order.customer_name || order.customer_email || "Guest";
    document.getElementById("order-detail-phone").textContent = order.phone || "—";
    document.getElementById("order-detail-payment").textContent = order.payment_method || "—";
    document.getElementById("order-detail-method").textContent = order.delivery_method === "pickup" ? "Self Pickup" : "Home Delivery";
    document.getElementById("order-detail-address").textContent = order.delivery_address || "—";
    document.getElementById("order-detail-fee").textContent = order.delivery_method === "pickup"
        ? "Free"
        : "UGX " + Number(order.delivery_fee || 0).toLocaleString();
    document.getElementById("order-detail-total").textContent = "UGX " + Number(order.total).toLocaleString();

    const itemsContainer = document.getElementById("order-detail-items");
    itemsContainer.innerHTML = "Loading...";

    try {
        const items = await authorizedFetch(`/api/admin/orders/${orderId}/items`);

        if (!items || items.length === 0) {
            itemsContainer.innerHTML = `<p class="no-data">No items found for this order.</p>`;
        } else {
            itemsContainer.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Qty</th>
                            <th>Price</th>
                            <th>Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(item => `
                            <tr>
                                <td>${item.product_name}</td>
                                <td>${item.quantity}</td>
                                <td>UGX ${Number(item.price).toLocaleString()}</td>
                                <td>UGX ${(Number(item.price) * item.quantity).toLocaleString()}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        }
    } catch (error) {
        console.error("Load order items error:", error);
        itemsContainer.innerHTML = `<p class="no-data">Could not load items.</p>`;
    }

    document.getElementById("order-detail-modal").classList.remove("hidden");
}

function closeOrderDetails() {
    document.getElementById("order-detail-modal").classList.add("hidden");
}

// ===== Account Settings =====

async function submitChangeUsername() {
    const input = document.getElementById("account-username-input");
    const msg = document.getElementById("account-username-msg");
    const username = input.value.trim();

    if (!username) {
        msg.textContent = "Please enter a username.";
        msg.className = "account-msg error";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/username`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify({ username })
        });
        const data = await response.json();

        if (response.ok) {
            msg.textContent = "Username updated successfully.";
            msg.className = "account-msg success";
            input.value = "";
        } else {
            msg.textContent = data.error || "Something went wrong.";
            msg.className = "account-msg error";
        }
    } catch (error) {
        msg.textContent = "Could not connect to server.";
        msg.className = "account-msg error";
    }
}

async function submitChangeEmail() {
    const emailInput = document.getElementById("account-email-input");
    const passwordInput = document.getElementById("account-email-password");
    const msg = document.getElementById("account-email-msg");
    const email = emailInput.value.trim();
    const currentPassword = passwordInput.value;

    if (!email || !currentPassword) {
        msg.textContent = "Please fill in both fields.";
        msg.className = "account-msg error";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/email`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify({ email, currentPassword })
        });
        const data = await response.json();

        if (response.ok) {
            msg.textContent = "Email updated successfully.";
            msg.className = "account-msg success";
            emailInput.value = "";
            passwordInput.value = "";
        } else {
            msg.textContent = data.error || "Something went wrong.";
            msg.className = "account-msg error";
        }
    } catch (error) {
        msg.textContent = "Could not connect to server.";
        msg.className = "account-msg error";
    }
}

async function submitChangePassword() {
    const currentInput = document.getElementById("account-current-password");
    const newInput = document.getElementById("account-new-password");
    const msg = document.getElementById("account-password-msg");
    const currentPassword = currentInput.value;
    const newPassword = newInput.value;

    if (!currentPassword || !newPassword) {
        msg.textContent = "Please fill in both fields.";
        msg.className = "account-msg error";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/password`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await response.json();

        if (response.ok) {
            msg.textContent = "Password updated successfully.";
            msg.className = "account-msg success";
            currentInput.value = "";
            newInput.value = "";
        } else {
            msg.textContent = data.error || "Something went wrong.";
            msg.className = "account-msg error";
        }
    } catch (error) {
        msg.textContent = "Could not connect to server.";
        msg.className = "account-msg error";
    }
}

let twoFactorCurrentlyEnabled = false;

async function loadAccount2FAStatus() {
    const statusEl = document.getElementById("account-2fa-status");
    const toggleBtn = document.getElementById("account-2fa-toggle-btn");

    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            headers: { "Authorization": `Bearer ${getToken()}` }
        });
        const data = await response.json();

        if (response.ok) {
            twoFactorCurrentlyEnabled = !!data.user.two_factor_enabled;
            statusEl.textContent = twoFactorCurrentlyEnabled
                ? "Two-factor authentication is ON."
                : "Two-factor authentication is OFF.";
            toggleBtn.textContent = twoFactorCurrentlyEnabled ? "Disable 2FA" : "Enable 2FA";
        } else {
            statusEl.textContent = "Could not load 2FA status.";
        }
    } catch (error) {
        statusEl.textContent = "Could not connect to server.";
    }
}

async function handle2FAToggle() {
    if (twoFactorCurrentlyEnabled) {
        const currentPassword = prompt("Enter your current password to disable 2FA:");
        if (!currentPassword) return;

        try {
            const response = await fetch(`${API_URL}/api/auth/2fa/disable`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${getToken()}`
                },
                body: JSON.stringify({ currentPassword })
            });
            const data = await response.json();
            const msg = document.getElementById("account-2fa-msg");

            if (response.ok) {
                msg.textContent = "2FA disabled.";
                msg.className = "account-msg success";
                document.getElementById("account-2fa-setup").classList.add("hidden");
                loadAccount2FAStatus();
            } else {
                msg.textContent = data.error || "Something went wrong.";
                msg.className = "account-msg error";
            }
        } catch (error) {
            document.getElementById("account-2fa-msg").textContent = "Could not connect to server.";
        }
    } else {
        try {
            const response = await fetch(`${API_URL}/api/auth/2fa/setup`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${getToken()}` }
            });
            const data = await response.json();

            if (response.ok) {
                document.getElementById("account-2fa-qr").src = data.qrCode;
                document.getElementById("account-2fa-key").textContent = data.manualEntryKey;
                document.getElementById("account-2fa-setup").classList.remove("hidden");
            } else {
                document.getElementById("account-2fa-msg").textContent = data.error || "Something went wrong.";
            }
        } catch (error) {
            document.getElementById("account-2fa-msg").textContent = "Could not connect to server.";
        }
    }
}

async function submitVerify2FA() {
    const codeInput = document.getElementById("account-2fa-code");
    const msg = document.getElementById("account-2fa-msg");
    const token = codeInput.value.trim();

    if (!token) {
        msg.textContent = "Please enter the 6-digit code.";
        msg.className = "account-msg error";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/2fa/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify({ token })
        });
        const data = await response.json();

        if (response.ok) {
            msg.textContent = "Two-factor authentication enabled successfully.";
            msg.className = "account-msg success";
            document.getElementById("account-2fa-setup").classList.add("hidden");
            codeInput.value = "";
            loadAccount2FAStatus();
        } else {
            msg.textContent = data.error || "Invalid code.";
            msg.className = "account-msg error";
        }
    } catch (error) {
        msg.textContent = "Could not connect to server.";
        msg.className = "account-msg error";
    }
}

// ===== Logged-In Devices =====

function formatSessionDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString();
}

function describeDevice(userAgentString) {
    if (!userAgentString) return "Unknown device";
    if (userAgentString.includes("curl")) return "Command line (curl)";
    if (/android/i.test(userAgentString)) return "Android device";
    if (/iphone|ipad/i.test(userAgentString)) return "iOS device";
    if (/windows/i.test(userAgentString)) return "Windows computer";
    if (/mac os/i.test(userAgentString)) return "Mac computer";
    return "Browser session";
}

async function loadAccountSessions() {
    const container = document.getElementById("account-sessions-list");

    try {
        const response = await fetch(`${API_URL}/api/auth/sessions`, {
            headers: { "Authorization": `Bearer ${getToken()}` }
        });
        const data = await response.json();

        if (!response.ok) {
            container.textContent = data.error || "Could not load devices.";
            return;
        }

        if (data.sessions.length === 0) {
            container.textContent = "No active devices found.";
            return;
        }

        container.innerHTML = data.sessions.map(session => `
            <div class="session-row">
                <div class="session-info">
                    <strong>${describeDevice(session.deviceLabel)}</strong>${session.isCurrent ? ' <span class="session-current-tag">This device</span>' : ''}
                    <div class="session-meta">IP: ${session.ipAddress} &middot; Last active: ${formatSessionDate(session.lastUsedAt)}</div>
                </div>
                ${session.isCurrent ? '' : `<button class="session-logout-btn" onclick="revokeSession(${session.id})">Log Out</button>`}
            </div>
        `).join("");

    } catch (error) {
        container.textContent = "Could not connect to server.";
    }
}

async function revokeSession(sessionId) {
    if (!confirm("Log out this device? It will need to sign in again to access the dashboard.")) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/sessions/${sessionId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${getToken()}` }
        });
        const data = await response.json();

        if (response.ok) {
            loadAccountSessions();
        } else {
            alert(data.error || "Could not log out that device.");
        }
    } catch (error) {
        alert("Could not connect to server.");
    }
}


// --- Staff & Approvals tab ---

async function createStaffAccount() {
    const name = document.getElementById("staff-name").value.trim();
    const email = document.getElementById("staff-email").value.trim();
    const password = document.getElementById("staff-password").value;
    const role = document.getElementById("staff-role").value;
    const statusEl = document.getElementById("staff-create-status");

    if (!name || !email || !password) {
        statusEl.textContent = "Please fill in all fields.";
        return;
    }

    statusEl.textContent = "Creating account...";

    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/staff`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ name, email, password, role })
        });

        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Failed to create staff account.";
            return;
        }

        statusEl.textContent = `Staff account created for ${name}.`;
        document.getElementById("staff-name").value = "";
        document.getElementById("staff-email").value = "";
        document.getElementById("staff-password").value = "";
        loadCustomers();

    } catch (error) {
        console.error("Create staff error:", error);
        statusEl.textContent = "Something went wrong.";
    }
}

async function loadPendingProducts() {
    try {
        const products = await authorizedFetch("/api/admin/products/pending");
        const container = document.getElementById("pending-products-list");

        if (!products || products.length === 0) {
            container.innerHTML = `<p class="no-data">No products awaiting approval.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Product</th><th>Submitted By</th><th>Price</th><th>Actions</th></tr></thead>
                <tbody>
                    ${products.map(p => `
                        <tr>
                            <td data-label="Product">${p.name}</td>
                            <td data-label="Submitted By">${p.submitted_by_name || "Unknown"}</td>
                            <td data-label="Price">UGX ${Number(p.price).toLocaleString()}</td>
                            <td data-label="Actions">
                                <button onclick="approvePendingProduct(${p.id})" style="background:#16A34A; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Approve</button>
                                <button onclick="rejectPendingProduct(${p.id})" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Reject</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load pending products error:", error);
    }
}

async function approvePendingProduct(id) {
    try {
        const token = getToken();
        await fetch(`${API_URL}/api/admin/products/${id}/approve`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        loadPendingProducts();
    } catch (error) {
        console.error("Approve product error:", error);
        alert("Something went wrong.");
    }
}

async function rejectPendingProduct(id) {
    if (!confirm("Reject this product submission?")) return;
    try {
        const token = getToken();
        await fetch(`${API_URL}/api/admin/products/${id}/reject`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        loadPendingProducts();
    } catch (error) {
        console.error("Reject product error:", error);
        alert("Something went wrong.");
    }
}

async function loadDeletionRequests() {
    try {
        const requests = await authorizedFetch("/api/admin/deletion-requests");
        const container = document.getElementById("deletion-requests-list");

        if (!requests || requests.length === 0) {
            container.innerHTML = `<p class="no-data">No pending deletion requests.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Product</th><th>Requested By</th><th>Requested</th><th>Actions</th></tr></thead>
                <tbody>
                    ${requests.map(r => `
                        <tr>
                            <td data-label="Product">${r.product_name}</td>
                            <td data-label="Requested By">${r.requested_by_name || "Unknown"}</td>
                            <td data-label="Requested">${new Date(r.requested_at).toLocaleDateString()}</td>
                            <td data-label="Actions">
                                <button onclick="approveDeletion(${r.id})" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Approve Deletion</button>
                                <button onclick="rejectDeletion(${r.id})" style="background:#666; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Keep Product</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load deletion requests error:", error);
    }
}

async function approveDeletion(requestId) {
    if (!confirm("Approve this deletion? The product will move to Trash.")) return;
    try {
        const token = getToken();
        await fetch(`${API_URL}/api/admin/deletion-requests/${requestId}/approve`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        loadDeletionRequests();
        loadTrash();
    } catch (error) {
        console.error("Approve deletion error:", error);
        alert("Something went wrong.");
    }
}

async function rejectDeletion(requestId) {
    try {
        const token = getToken();
        await fetch(`${API_URL}/api/admin/deletion-requests/${requestId}/reject`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        loadDeletionRequests();
    } catch (error) {
        console.error("Reject deletion error:", error);
        alert("Something went wrong.");
    }
}

async function loadTrash() {
    try {
        const items = await authorizedFetch("/api/admin/trash");
        const container = document.getElementById("trash-list");

        if (!items || items.length === 0) {
            container.innerHTML = `<p class="no-data">Trash is empty.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Product</th><th>Deleted</th><th>Actions</th></tr></thead>
                <tbody>
                    ${items.map(p => `
                        <tr>
                            <td data-label="Product">${p.name}</td>
                            <td data-label="Deleted">${new Date(p.deleted_at).toLocaleDateString()}</td>
                            <td data-label="Actions">
                                <button onclick="restoreTrashedProduct(${p.id})" style="background:#16A34A; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Restore</button>
                                <button onclick="permanentlyDeleteTrashedProduct(${p.id})" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Delete Forever</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load trash error:", error);
    }
}

async function restoreTrashedProduct(id) {
    try {
        const token = getToken();
        await fetch(`${API_URL}/api/admin/products/${id}/restore`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        loadTrash();
    } catch (error) {
        console.error("Restore product error:", error);
        alert("Something went wrong.");
    }
}

async function permanentlyDeleteTrashedProduct(id) {
    if (!confirm("Permanently delete this product? This CANNOT be undone.")) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/products/${id}/permanent`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not permanently delete this product.");
            return;
        }
        loadTrash();
    } catch (error) {
        console.error("Permanent delete error:", error);
        alert("Something went wrong.");
    }
}

async function loadActivityLog() {
    try {
        const logs = await authorizedFetch("/api/admin/activity-log");
        const container = document.getElementById("activity-log-list");

        if (!logs || logs.length === 0) {
            container.innerHTML = `<p class="no-data">No activity recorded yet.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>User</th><th>Action</th><th>Details</th><th>When</th></tr></thead>
                <tbody>
                    ${logs.map(log => `
                        <tr>
                            <td data-label="User">${log.user_name || "Unknown"}</td>
                            <td data-label="Action">${log.action.replace(/_/g, " ")}</td>
                            <td data-label="Details">${log.details || "—"}</td>
                            <td data-label="When">${new Date(log.created_at).toLocaleString()}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load activity log error:", error);
    }
}


function closeStaffMenus() {
    const menu = document.getElementById("floating-staff-menu");
    if (menu) {
        menu.classList.add("hidden");
        menu.dataset.openForId = "";
    }
}

function buildStaffMenuItems(s) {
    const safeName = s.name.replace(/'/g, "\\'");
    let menuItems = "";

    if (!s.is_active) {
        menuItems += `<div class="staff-menu-item" onclick="closeStaffMenus(); activateStaff(${s.id}, '${safeName}')">✅ Activate</div>`;
    }
    if (s.is_active && !s.blocked_at) {
        menuItems += `<div class="staff-menu-item" onclick="closeStaffMenus(); blockStaff(${s.id}, '${safeName}')">🚫 Block</div>`;
    }
    menuItems += `<div class="staff-menu-item" onclick="closeStaffMenus(); forceResetStaff(${s.id}, '${safeName}')">🔑 Force Reset</div>`;
    menuItems += `<div class="staff-menu-item" onclick="closeStaffMenus(); logoutAllStaffDevices(${s.id}, '${safeName}')">🚪 Logout All</div>`;
    menuItems += `<div class="staff-menu-item" onclick="closeStaffMenus(); viewStaffLoginHistory(${s.id}, '${safeName}')">📜 Login History</div>`;
    menuItems += `<div class="staff-menu-item" style="color:#DC2626;" onclick="closeStaffMenus(); deleteCustomerAccount(${s.id}, '${safeName}')">🗑 Delete</div>`;

    return menuItems;
}

function toggleStaffMenu(event, id) {
    event.stopPropagation();

    let menu = document.getElementById("floating-staff-menu");
    if (!menu) {
        menu = document.createElement("div");
        menu.id = "floating-staff-menu";
        menu.className = "hidden staff-menu";
        menu.style.cssText = "position:fixed; background:#fff; border:1px solid #ddd; border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,0.18); z-index:9999; min-width:170px; overflow:hidden;";
        document.body.appendChild(menu);
    }

    const wasOpenForThisId = !menu.classList.contains("hidden") && menu.dataset.openForId === String(id);
    closeStaffMenus();

    if (wasOpenForThisId) {
        return;
    }

    const staffMember = (window._staffListCache || []).find(s => s.id === id);
    if (!staffMember) return;

    menu.innerHTML = buildStaffMenuItems(staffMember);
    menu.dataset.openForId = String(id);

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 180;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;

    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.classList.remove("hidden");
}

document.addEventListener("click", (event) => {
    if (!event.target.closest(".staff-menu-btn") && !event.target.closest("#floating-staff-menu")) {
        closeStaffMenus();
    }
});

window.addEventListener("scroll", closeStaffMenus, true);

async function loadStaffAccounts() {
    try {
        const customers = await authorizedFetch("/api/admin/customers");
        const staff = (customers || []).filter(c => c.role === "product_staff" || c.role === "store_manager");
        window._staffListCache = staff;
        const container = document.getElementById("staff-accounts-list");

        if (staff.length === 0) {
            container.innerHTML = `<p class="no-data">No staff accounts yet.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    ${staff.map(s => {
                        let statusBadge;
                        if (s.deleted_at) {
                            statusBadge = `<span class="status-badge status-cancelled">Deleted</span>`;
                        } else if (s.blocked_at) {
                            statusBadge = `<span class="status-badge status-cancelled">Blocked</span>`;
                        } else if (!s.is_active) {
                            statusBadge = `<span class="status-badge status-pending">Inactive</span>`;
                        } else {
                            statusBadge = `<span class="status-badge status-paid">Active</span>`;
                        }

                        const roleLabel = s.role === "product_staff" ? "Product Staff" : "Store Manager";

                        let actions = "";
                        if (!s.deleted_at) {
                            actions = `<button class="staff-menu-btn" onclick="toggleStaffMenu(event, ${s.id})" style="background:#374151; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:16px; line-height:1; cursor:pointer;">⋮</button>`;
                        } else {
                            actions = "—";
                        }

                        return `
                            <tr>
                                <td data-label="Name">${s.name}</td>
                                <td data-label="Email">${s.email}</td>
                                <td data-label="Role">${roleLabel}</td>
                                <td data-label="Status">${statusBadge}</td>
                                <td data-label="Actions">${actions}</td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load staff accounts error:", error);
    }
}

async function activateStaff(id, name) {
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/staff/${id}/activate`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not activate account.");
            return;
        }
        showToast(`${name} has been activated.`);
        loadStaffAccounts();
    } catch (error) {
        console.error("Activate staff error:", error);
        alert("Something went wrong.");
    }
}


function openGenericModal(title, bodyHtml) {
    document.getElementById("generic-modal-title").textContent = title;
    document.getElementById("generic-modal-body").innerHTML = bodyHtml;
    document.getElementById("generic-modal").classList.remove("hidden");
}

function closeGenericModal() {
    document.getElementById("generic-modal").classList.add("hidden");
}

async function forceResetStaff(id, name) {
    if (!confirm(`Require ${name} to set a new password on their next login?`)) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/staff/${id}/force-reset`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not force password reset.");
            return;
        }
        showToast(`${name} will be required to reset their password on next login.`);
    } catch (error) {
        console.error("Force reset error:", error);
        alert("Something went wrong.");
    }
}

async function logoutAllStaffDevices(id, name) {
    if (!confirm(`Log ${name} out of all devices right now?`)) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/staff/${id}/logout-all`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not log out devices.");
            return;
        }
        showToast(`${name} has been logged out of all devices.`);
    } catch (error) {
        console.error("Logout all devices error:", error);
        alert("Something went wrong.");
    }
}

async function viewStaffLoginHistory(id, name) {
    try {
        const data = await authorizedFetch(`/api/admin/staff/${id}/login-history`);
        const history = (data && data.history) || [];

        let bodyHtml;
        if (history.length === 0) {
            bodyHtml = `<p class="no-data">No login attempts recorded yet.</p>`;
        } else {
            bodyHtml = `
                <table>
                    <thead><tr><th>When</th><th>IP Address</th><th>Device</th><th>Result</th></tr></thead>
                    <tbody>
                        ${history.map(h => `
                            <tr>
                                <td data-label="When">${new Date(h.logged_in_at).toLocaleString()}</td>
                                <td data-label="IP Address">${h.ip_address || "Unknown"}</td>
                                <td data-label="Device">${(h.device_label || "Unknown").slice(0, 60)}</td>
                                <td data-label="Result">${h.success ? '<span class="status-badge status-paid">Success</span>' : '<span class="status-badge status-cancelled">Failed</span>'}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        }

        openGenericModal(`Login History — ${name}`, bodyHtml);
    } catch (error) {
        console.error("Load login history error:", error);
        alert("Could not load login history.");
    }
}

function formatDuration(startISO, endISO) {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const diffMs = end - start;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

async function loadStaffSessions() {
    try {
        const sessions = await authorizedFetch("/api/admin/staff-sessions");
        const container = document.getElementById("staff-sessions-list");

        if (!sessions || sessions.length === 0) {
            container.innerHTML = `<p class="no-data">No staff login sessions recorded yet.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Name</th><th>Login Time</th><th>Last Active</th><th>Duration</th><th>Device</th></tr></thead>
                <tbody>
                    ${sessions.map(s => `
                        <tr>
                            <td data-label="Name">${s.name}</td>
                            <td data-label="Login Time">${new Date(s.login_time).toLocaleString()}</td>
                            <td data-label="Last Active">${new Date(s.last_used_at).toLocaleString()}</td>
                            <td data-label="Duration">${formatDuration(s.login_time, s.last_used_at)}</td>
                            <td data-label="Device">${s.device_label || "Unknown"}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load staff sessions error:", error);
    }
}


async function blockStaff(id, name) {
    if (!confirm(`Block ${name}'s account? They will be logged out and unable to log in until you reactivate them.`)) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/staff/${id}/block`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not block account.");
            return;
        }
        showToast(`${name} has been blocked.`);
        loadStaffAccounts();
    } catch (error) {
        console.error("Block staff error:", error);
        alert("Something went wrong.");
    }
}

function showToast(message) {
    let toast = document.getElementById("admin-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "admin-toast";
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
