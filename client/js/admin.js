const API_URL = "http://localhost:5000";

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

async function handleLogin() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (!email || !password) {
        document.getElementById("login-error").textContent = "Please enter both email and password.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Login failed.";
            return;
        }

        if (data.user.role !== "admin") {
            document.getElementById("login-error").textContent = "This account does not have admin access.";
            return;
        }

        setToken(data.token);
        showDashboard();

    } catch (error) {
        console.error("Login error:", error);
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
    await loadOrders();
    await loadCustomers();
    await loadProducts();
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
                <div class="label">Total Customers</div>
                <div class="value">${stats.totalCustomers}</div>
            </div>
            <div class="stat-card ${stats.pendingPayments > 0 ? "warning" : ""}">
                <div class="label">Pending Payments</div>
                <div class="value">${stats.pendingPayments}</div>
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
            loadOrders();
        }

    } catch (error) {
        console.error("Update order status error:", error);
        alert("Could not connect to server.");
    }
}

async function loadCustomers() {
    try {
        const customers = await authorizedFetch("/api/admin/customers");
        const customersTable = document.getElementById("customers-table");

        if (!customers || customers.length === 0) {
            customersTable.innerHTML = `<p class="no-data">No customers yet.</p>`;
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
                        <th>Joined</th>
                    </tr>
                </thead>
                <tbody>
                    ${customers.map(c => `
                        <tr>
                            <td data-label="Name">${c.name}</td>
                            <td data-label="Email">${c.email}</td>
                            <td data-label="Phone">${c.phone || "—"}</td>
                            <td data-label="Role"><span class="status-badge status-${c.role === "admin" ? "delivered" : "paid"}">${c.role}</span></td>
                            <td data-label="Joined">${new Date(c.created_at).toLocaleDateString()}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;

    } catch (error) {
        console.error("Load customers error:", error);
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

async function loadProducts() {
    try {
        await loadCategories();

        const response = await fetch(`${API_URL}/api/products`);
        const products = await response.json();
        adminProducts = products;

        const productsTable = document.getElementById("products-table");

        if (!products || products.length === 0) {
            productsTable.innerHTML = `<p class="no-data">No products yet.</p>`;
            return;
        }

        productsTable.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Price</th>
                        <th>Stock</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map(p => `
                        <tr>
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

    } catch (error) {
        console.error("Load products error:", error);
    }
}

function openProductForm() {
    document.getElementById("product-form-title").textContent = "Add Product";
    document.getElementById("product-id").value = "";
    document.getElementById("product-name").value = "";
    document.getElementById("product-description").value = "";
    document.getElementById("product-price").value = "";
    document.getElementById("product-stock").value = "";
    document.getElementById("product-image").value = "";
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
