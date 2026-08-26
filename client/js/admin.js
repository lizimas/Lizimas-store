// Device approval (phase 4c): the sign-in is on hold until the account owner
// decides from the emailed link. Poll until they do, then fall through to the
// authenticator prompt — approval alone never completes a login.
function lzShowDeviceWait(data, onApproved) {
    pendingLoginToken = data.pendingToken;

    ["login-email", "login-password", "login-btn"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    var err = document.getElementById("login-error");
    var deadline = new Date(data.expiresAt).getTime();
    var stopped = false;

    function say(text) { if (err) err.textContent = text; }

    say("We have emailed you to confirm this sign-in. Approve it from that email — this page will continue on its own.");

    var timer = setInterval(function () {
        if (stopped) return;

        if (Date.now() > deadline) {
            clearInterval(timer);
            say("This sign-in request expired. Please log in again.");
            setTimeout(function () { location.reload(); }, 4000);
            return;
        }

        fetch("/api/auth/device-request/" + encodeURIComponent(data.ref) + "/status")
            .then(function (r) { return r.json(); })
            .then(function (s) {
                if (stopped) return;

                if (s.status === "approved") {
                    stopped = true;
                    clearInterval(timer);
                    onApproved();
                } else if (s.status === "denied") {
                    stopped = true;
                    clearInterval(timer);
                    say("This sign-in was refused. The account has been locked.");
                } else if (s.status === "expired") {
                    stopped = true;
                    clearInterval(timer);
                    say("This sign-in request expired. Please log in again.");
                    setTimeout(function () { location.reload(); }, 4000);
                }
            })
            .catch(function () { /* transient - the next tick retries */ });
    }, 3000);
}

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

        if (data.requiresDeviceApproval) {
            // Re-run the login now the device is trusted. The server decides what
            // comes next - 2FA enrolment for a new account, or a code prompt for an
            // existing one - rather than this callback assuming either.
            lzShowDeviceWait(data, function () {
                pendingLoginToken = data.pendingToken;
                document.getElementById("login-email").classList.add("hidden");
                document.getElementById("login-password").classList.add("hidden");
                document.getElementById("login-btn").classList.add("hidden");

                if (data.requires2FASetup) {
                    document.getElementById("login-error").textContent =
                        "Approved. Set up your authenticator app to finish.";
                    startStaff2FASetup();
                    return;
                }

                document.getElementById("login-2fa-code").classList.remove("hidden");
                document.getElementById("login-2fa-btn").classList.remove("hidden");
                document.getElementById("login-error").textContent =
                    "Approved. Enter the 6-digit code from your authenticator app.";
            });
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
            document.getElementById("login-2fa-email-btn").classList.remove("hidden");
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

let emailCodeCooldown = null;

async function requestEmailLoginCode() {
    const btn = document.getElementById("login-2fa-email-btn");
    const errorEl = document.getElementById("login-error");

    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        const response = await fetch(`${API_URL}/api/auth/login/2fa/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || "Could not send the code.";
            btn.disabled = false;
            btn.textContent = "Email me a code instead";
            return;
        }

        errorEl.textContent = "A code has been sent to your email. It expires in 10 minutes.";
        startEmailCodeCooldown(60);

    } catch (error) {
        console.error("Request email login code error:", error);
        errorEl.textContent = "Could not connect to server.";
        btn.disabled = false;
        btn.textContent = "Email me a code instead";
    }
}

function startEmailCodeCooldown(seconds) {
    const btn = document.getElementById("login-2fa-email-btn");
    let remaining = seconds;

    if (emailCodeCooldown) clearInterval(emailCodeCooldown);

    btn.disabled = true;
    btn.textContent = `Resend in ${remaining}s`;

    emailCodeCooldown = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(emailCodeCooldown);
            emailCodeCooldown = null;
            btn.disabled = false;
            btn.textContent = "Email me a code instead";
        } else {
            btn.textContent = `Resend in ${remaining}s`;
        }
    }, 1000);
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

    const text = await response.text();
    try { return JSON.parse(text); } catch (e) { throw new Error(`HTTP ${response.status}: ${text.slice(0,200)}`); }
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
        renderOrdersTable();
    } catch (error) {
        console.error("Load orders error:", error);
    }
}

function renderOrdersTable() {
    const ordersTable = document.getElementById("orders-table");
    if (!ordersTable) return;

    if (!adminOrders || adminOrders.length === 0) {
        ordersTable.innerHTML = `<p class="no-data">No orders yet.</p>`;
        return;
    }

    const searchInput = document.getElementById("order-search-input");
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

    let orders = adminOrders;
    if (searchTerm) {
        orders = adminOrders.filter(order => {
            const customer = (order.customer_name || order.customer_email || "guest").toLowerCase();
            return String(order.id).includes(searchTerm)
                || customer.includes(searchTerm)
                || (order.status || "").toLowerCase().includes(searchTerm);
        });
    }

    if (orders.length === 0) {
        ordersTable.innerHTML = `<p class="no-data">No orders found.</p>`;
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
                        <th>#</th>
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
                    ${customers.map((c, i) => `
                        <tr>
                            <td data-label="#">${i + 1}</td>
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

let pdLocalPreviews = [];
let pdAllImages = [];
let pdPickedFiles = [];
let pdSaveInFlight = false;
let pdSelectedSizes = [];
let pdSelectedColors = {};
let pdSpecRowCounter = 0;

function addSpecRow(label, value) {
    const list = document.getElementById("specs-list");
    const rowId = `spec-row-${pdSpecRowCounter++}`;
    const row = document.createElement("div");
    row.id = rowId;
    row.style.cssText = "display:flex; gap:6px;";
    row.innerHTML = `
        <input type="text" class="spec-label-input" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Label (e.g. Material)" value="${label || ''}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
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
    if (!Array.isArray(pdAllImages) || pdAllImages.length === 0) {
        picker.innerHTML = `<span style="font-size:12px; color:#999;">Upload photos first</span>`;
        return;
    }
    picker.innerHTML = pdAllImages.map(img => `
        <span style="position:relative; display:inline-block; margin:2px;">
            <img src="${img.url}" data-key="${img.key}" onclick="selectColorThumb(this, '${picker.dataset.colorName}')" style="width:48px; height:48px; object-fit:cover; border-radius:6px; border:2px solid #ccc; cursor:pointer; display:block;">
            <span class="pd-pos-badge" data-key="${img.key}" style="position:absolute; top:-4px; right:-4px; min-width:16px; height:16px; line-height:16px; text-align:center; border-radius:8px; background:#ff6a00; color:#fff; font-size:11px; font-weight:700; display:none;"></span>
        </span>
    `).join("");
    refreshColorThumbBadges(picker, picker.dataset.colorName);
}

function refreshColorThumbBadges(picker, colorName) {
    const order = Array.isArray(pdSelectedColors[colorName]) ? pdSelectedColors[colorName] : [];
    picker.querySelectorAll("img[data-key]").forEach(img => {
        const key = img.dataset.key;
        const pos = order.indexOf(key);
        const badge = picker.querySelector('.pd-pos-badge[data-key="' + key + '"]');
        if (pos === -1) {
            img.style.borderColor = "#ccc";
            if (badge) badge.style.display = "none";
        } else {
            img.style.borderColor = "#ff6a00";
            if (badge) { badge.textContent = pos + 1; badge.style.display = "block"; }
        }
    });
}

function selectColorThumb(imgEl, colorName) {
    const key = imgEl.dataset.key;
    if (!Array.isArray(pdSelectedColors[colorName])) pdSelectedColors[colorName] = [];

    if (pdSelectedColors[colorName].includes(key)) {
        pdSelectedColors[colorName] = pdSelectedColors[colorName].filter(k => k !== key);
    } else {
        pdSelectedColors[colorName].push(key);
    }

    const picker = imgEl.closest("[data-color-name]");
    if (picker) refreshColorThumbBadges(picker, colorName);
}

async function loadProductOptionsIntoForm(productId) {
    try {
        const [optRes, imgRes] = await Promise.all([
            fetch(`${API_URL}/api/products/${productId}/options`),
            fetch(`${API_URL}/api/products/${productId}/images`)
        ]);
        const opts = await optRes.json();
        const images = await imgRes.json();

        pdAllImages = images.map(im => ({ key: "id:" + im.id, url: im.image_path }));
        renderPhotoOrderList();

        pdSelectedColors = {};
        (opts.colors || []).forEach(c => { pdSelectedColors[c.name] = []; });
        images.forEach(im => {
            if (!im.color_name) return;
            if (!Array.isArray(pdSelectedColors[im.color_name])) pdSelectedColors[im.color_name] = [];
            pdSelectedColors[im.color_name].push("id:" + im.id);
        });

        document.querySelectorAll("#color-checkbox-list input[type=checkbox]").forEach(cb => {
            const on = Object.prototype.hasOwnProperty.call(pdSelectedColors, cb.value);
            cb.checked = on;
            const picker = cb.closest("div").querySelector(".pd-color-thumb-picker");
            if (picker) {
                picker.style.display = on ? "flex" : "none";
                if (on) renderThumbOptions(picker);
            }
        });

        pdSelectedSizes = (opts.sizes || []).map(s => s.name);
        document.querySelectorAll("#size-checkbox-list input[type=checkbox]").forEach(cb => {
            cb.checked = pdSelectedSizes.includes(cb.value);
        });

        const specsList = document.getElementById("specs-list");
        if (specsList) {
            specsList.innerHTML = "";
            (opts.specs || []).forEach(sp => addSpecRow(sp.label, sp.value));
        }
    } catch (error) {
        console.error("Load product options error:", error);
    }
}

async function loadCategories() {
    try {
        const response = await fetch(`${API_URL}/api/products/categories`);
        allCategories = await response.json();

        renderCategorySelect();

    } catch (error) {
        console.error("Load categories error:", error);
    }
}

// Rebuilds the product form's category dropdown, grouped parent > children.
// Call with a category id to preselect it when editing.
function renderCategorySelect(selectedId) {
    const select = document.getElementById("product-category");
    if (!select || !allCategories) return;
    select.innerHTML = buildGroupedCategoryOptions(allCategories, selectedId);
}

let adminProducts = [];

let currentProductFilter = "all";

async function loadProducts() {
    try {
        await loadCategories();
        await loadSizeCatalog();
        await loadColorCatalog();

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
                        <td data-label="Name">${p.name} <span style="color:#999; font-size:0.85em; white-space:nowrap;">#${p.id}</span></td>
                        <td data-label="Category">${p.category || "—"}</td>
                        <td data-label="Price">UGX ${Number(p.price).toLocaleString()}</td>
                        <td data-label="Stock">${p.stock}</td>
                        <td data-label="Actions">
                            <button onclick="editProduct(${p.id})">Edit</button>
                            <button onclick="openManageStock(${p.id})" data-pname="${String(p.name || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}">Stock</button>
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

async function renderImagePreviews(fileList) {
    const preview = document.getElementById("product-image-preview");
    if (!preview) return;
    preview.innerHTML = "";
    pdPickedFiles = [];

    const saveBtn = document.getElementById("product-save-btn");
    const files = Array.from(fileList);
    if (files.length === 0) {
        pdLocalPreviews = [];
        pdAllImages = pdAllImages.filter(im => im.key.startsWith("id:"));
        document.querySelectorAll(".pd-color-thumb-picker").forEach(p => renderThumbOptions(p));
        return;
    }

    // Block Save while reads are in flight, or a partial set can be uploaded.
    if (saveBtn) saveBtn.disabled = true;
    const status = document.createElement("div");
    status.style.cssText = "font-size:12px; color:#666; width:100%;";
    status.textContent = "Preparing " + files.length + " photo(s)...";
    preview.appendChild(status);

    const failures = [];
    for (let i = 0; i < files.length; i++) {
        status.textContent = "Preparing photo " + (i + 1) + " of " + files.length + "...";
        const res = await preparePickedFile(files[i]);
        if (res.ok) pdPickedFiles.push(res.file);
        else failures.push(res);
    }

    if (saveBtn) saveBtn.disabled = false;
    preview.innerHTML = "";

    if (failures.length > 0) {
        const warn = document.createElement("div");
        warn.style.cssText = "color:#c0392b; font-size:12px; width:100%; margin-bottom:6px;";
        warn.textContent = failures.length + " photo(s) could not be read and were skipped: "
            + failures.map(f => f.name + " (" + f.reason + ")").join(", ")
            + ". Re-select them, or pick from Files rather than a cloud gallery.";
        preview.appendChild(warn);
    }

    pdLocalPreviews = pdPickedFiles.map(f => URL.createObjectURL(f));
    pdAllImages = pdAllImages.filter(im => im.key.startsWith("id:"))
        .concat(pdPickedFiles.map((f, i) => ({ key: "new:" + i, url: pdLocalPreviews[i] })));
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => renderThumbOptions(picker));

    renderPhotoOrderList();
}

function openProductForm() {
    document.getElementById("product-form-title").textContent = "Add Product";
    document.getElementById("product-id").value = "";
    const newBlockHost = document.getElementById("desc-blocks-editor");
    if (newBlockHost && window.LzBlockEditor) {
        LzBlockEditor.mount(newBlockHost, null, { tokenKey: "adminToken" });
    }
    document.getElementById("product-name").value = "";
    document.getElementById("product-description").value = "";
    document.getElementById("product-price").value = "";
    document.getElementById("product-stock").value = "";
    document.getElementById("product-package-size").value = "Small";
    document.getElementById("product-image").value = "";
    pdPickedFiles = [];
    document.getElementById("product-image-preview").innerHTML = "";
    document.getElementById("product-form-error").textContent = "";
    document.getElementById("variants-section").classList.add("hidden");
    document.getElementById("variants-list").innerHTML = "";
    document.getElementById("specs-list").innerHTML = "";
    pdLocalPreviews = [];
    pdAllImages = [];
    const _po = document.getElementById("pd-photo-order"); if (_po) _po.remove();
    pdSelectedSizes = [];
    pdSelectedColors = {};
    document.querySelectorAll("#size-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll("#color-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => { picker.style.display = "none"; picker.innerHTML = ""; });
    renderCategorySelect();
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
    // Rebuild rather than assign: a product still on a parent category has no
    // matching option, and a plain assignment would silently leave this blank.
    renderCategorySelect(product.category_id);
    document.getElementById("product-description").value = product.description || "";
    document.getElementById("product-price").value = product.price;
    document.getElementById("product-stock").value = product.stock;
    document.getElementById("product-package-size").value = product.package_size || "Small";
    document.getElementById("product-warranty-months").value = product.warranty_months || "";
    document.getElementById("product-brand").value = product.brand || "";
    document.getElementById("product-gtin").value = product.gtin || "";
    document.getElementById("product-mpn").value = product.mpn || "";
    document.getElementById("variants-section").classList.remove("hidden");
    loadVariants(product.id);
    loadProductOptionsIntoForm(product.id);
    LzBlockEditor.mount(document.getElementById("desc-blocks-editor"), product.id, { tokenKey: "adminToken" });
    document.getElementById("product-image").value = "";
    pdPickedFiles = [];
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
    const packageSize = document.getElementById("product-package-size").value;
    const warrantyMonths = document.getElementById("product-warranty-months").value.trim();
    const brand = document.getElementById("product-brand").value.trim();
    const gtin = document.getElementById("product-gtin").value.trim();
    const mpn = document.getElementById("product-mpn").value.trim();
    const files = pdPickedFiles;

    const errorEl = document.getElementById("product-form-error");

    if (!name || !category_id || !price || !stock) {
        errorEl.textContent = "Please fill in name, category, price, and stock.";
        return;
    }

    if (pdSaveInFlight) return;
    pdSaveInFlight = true;
    const saveBtn = document.getElementById("product-save-btn");
    const saveBtnLabel = saveBtn ? saveBtn.textContent : null;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving..."; }

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

        // The server's error handler replies with { message }, validation
        // paths reply with { error }: accept either, or a create that came
        // back without a product row.
        if (result.error || result.message && !result.product && !id) {
            errorEl.textContent = result.error || result.message;
            return;
        }

        const savedProductId = result.product ? result.product.id : id;
        if (!savedProductId) {
            errorEl.textContent = "Save failed: the server did not return a product.";
            return;
        }
        const returnedImages = result.images || [];
        const returnedRecords = result.image_records || [];

        const colorsPayload = Object.keys(pdSelectedColors)
            .map(name => ({
                name,
                image_paths: pdSelectedColors[name].map(k => k.startsWith("new:") ? returnedImages[Number(k.slice(4))] : (pdAllImages.find(im => im.key === k) || {}).url).filter(Boolean),
                image_ids: pdSelectedColors[name].map(k => k.startsWith("new:")
                    ? ((returnedRecords[Number(k.slice(4))] || {}).id)
                    : Number(k.slice(3))).filter(v => Number.isInteger(v))
            }));

        const specsPayload = collectSpecRows();

        if (savedProductId && (pdSelectedSizes.length > 0 || colorsPayload.length > 0 || specsPayload.length > 0)) {
            try {
                await authorizedFetch(`/api/products/${savedProductId}/options`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sizes: pdSelectedSizes, colors: colorsPayload, specs: specsPayload })
                });
            } catch (optionsError) {
                console.error("Save options error:", optionsError);
            }
        }

        // Description blocks: on create the editor mounts without an id, so
        // flush against the id the server just returned. A failure here must
        // not lose the product save.
        if (savedProductId && window.LzBlockEditor) {
            const blockRes = await LzBlockEditor.save(savedProductId);
            if (!blockRes.ok) {
                errorEl.textContent = "Product saved, but description blocks failed: " + blockRes.message;
                loadProducts();
                return;
            }
        }

        closeProductForm();
        loadProducts();
        loadStats();

    } catch (error) {
        console.error("Save product error:", error);
        errorEl.textContent = "Could not connect to server.";
    } finally {
        pdSaveInFlight = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            if (saveBtnLabel !== null) saveBtn.textContent = saveBtnLabel;
        }
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

// ---------------------------------------------------------------------------
// Security tab
// ---------------------------------------------------------------------------
let securityRecent = [];

const SECURITY_REASON_LABELS = {
    unknown_device: "Unrecognised device",
    security_locked: "Locked",
    wrong_password: "Wrong password",
    wrong_portal: "Wrong portal",
    unknown_email: "No such account",
    blocked: "Blocked account",
    inactive: "Inactive account",
    bad_2fa: "Failed 2FA",
    rate_limited: "Rate limited"
};

function securityBucket(row) {
    // Portal panels show only attempts that actually recorded a portal. Guessing
    // from users.role put an account's whole history under a panel it may never
    // have touched, which made the counts read as activity that never happened.
    if (row.surface === "admin" || row.surface === "staff" || row.surface === "customer") {
        return row.surface;
    }
    return "other";
}

function securityEscape(value) {
    const div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
}

function securityTime(value) {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function securityGroupKey(row) {
    return `${row.email}|${row.surface}`;
}

function renderSecurityGroups(containerId, rows) {
    const box = document.getElementById(containerId);
    if (!box) return;

    if (!rows.length) {
        box.innerHTML = '<p style="color:#666; font-size:14px;">No attempts in this period.</p>';
        return;
    }

    let html = '<div class="table-wrapper"><table style="width:100%; border-collapse:collapse; font-size:14px;">';
    html += '<thead><tr style="text-align:left; border-bottom:2px solid #eee;">' +
        '<th style="padding:8px;">Account</th>' +
        '<th style="padding:8px;">Attempts</th>' +
        '<th style="padding:8px;">Failed</th>' +
        '<th style="padding:8px;">Reasons</th>' +
        '<th style="padding:8px;">IPs</th>' +
        '<th style="padding:8px;">Last attempt</th>' +
        '<th style="padding:8px;"></th></tr></thead><tbody>';

    rows.forEach(row => {
        const failed = row.failures > 0;
        const key = securityGroupKey(row);
        const reasons = (row.reasons || [])
            .map(x => SECURITY_REASON_LABELS[x] || x)
            .join(", ");

        html += `<tr style="border-bottom:1px solid #f0f0f0; ${failed ? "background:#fff5f5;" : ""}">` +
            `<td style="padding:8px; ${failed ? "color:#b00020; font-weight:600;" : ""}">${securityEscape(row.email)}` +
            (row.role ? `<div style="font-size:12px; color:#888; font-weight:400;">${securityEscape(row.role)}</div>` : "") +
            `</td>` +
            `<td style="padding:8px;">${row.attempts}</td>` +
            `<td style="padding:8px; ${failed ? "color:#b00020; font-weight:700;" : "color:#888;"}">${row.failures}</td>` +
            `<td style="padding:8px; color:#555;">${securityEscape(reasons)}</td>` +
            `<td style="padding:8px;">${row.ip_count}</td>` +
            `<td style="padding:8px; color:#555;">${securityTime(row.last_attempt)}</td>` +
            `<td style="padding:8px;"><button onclick="toggleSecurityDetail('${containerId}', '${encodeURIComponent(key)}')" style="background:none; border:1px solid #ccc; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px;">Details</button></td>` +
            `</tr>`;

        html += `<tr class="security-detail hidden" data-key="${encodeURIComponent(key)}"><td colspan="7" style="padding:0 8px 12px 8px;"></td></tr>`;
    });

    html += "</tbody></table></div>";
    box.innerHTML = html;
}

function toggleSecurityDetail(containerId, encodedKey) {
    const box = document.getElementById(containerId);
    if (!box) return;

    const row = box.querySelector(`.security-detail[data-key="${encodedKey}"]`);
    if (!row) return;

    if (!row.classList.contains("hidden")) {
        row.classList.add("hidden");
        return;
    }

    const key = decodeURIComponent(encodedKey);
    const entries = securityRecent.filter(r => `${r.email}|${r.surface}` === key);
    const cell = row.querySelector("td");

    if (!entries.length) {
        cell.innerHTML = '<p style="color:#666; font-size:13px;">No individual attempts retained for this group.</p>';
    } else {
        let inner = '<table style="width:100%; border-collapse:collapse; font-size:13px; background:#fafafa;">';
        inner += '<thead><tr style="text-align:left; color:#666;">' +
            '<th style="padding:6px;">Time</th>' +
            '<th style="padding:6px;">Result</th>' +
            '<th style="padding:6px;">IP</th>' +
            '<th style="padding:6px;">Device</th></tr></thead><tbody>';

        entries.forEach(e => {
            const label = e.success
                ? '<span style="color:#0a7a3d;">Success</span>'
                : `<span style="color:#b00020;">${securityEscape(SECURITY_REASON_LABELS[e.failure_reason] || e.failure_reason || "Failed")}</span>`;
            inner += `<tr style="border-top:1px solid #eee;">` +
                `<td style="padding:6px;">${securityTime(e.logged_in_at)}</td>` +
                `<td style="padding:6px;">${label}</td>` +
                `<td style="padding:6px;">${securityEscape(e.ip_address)}</td>` +
                `<td style="padding:6px; color:#777;">${securityEscape((e.device_label || "").slice(0, 60))}</td>` +
                `</tr>`;
        });

        inner += "</tbody></table>";
        cell.innerHTML = inner;
    }

    row.classList.remove("hidden");
}

function renderSecurityLocked(rows) {
    const panel = document.getElementById("security-locked-panel");
    const box = document.getElementById("security-locked");
    if (!panel || !box) return;

    if (!rows.length) {
        panel.classList.add("hidden");
        box.innerHTML = "";
        return;
    }

    let html = '<div class="table-wrapper"><table style="width:100%; border-collapse:collapse; font-size:14px;">';
    html += '<thead><tr style="text-align:left; border-bottom:2px solid #eee;">' +
        '<th style="padding:8px;">Account</th>' +
        '<th style="padding:8px;">Locked</th>' +
        '<th style="padding:8px;">Reason</th>' +
        '<th style="padding:8px;"></th></tr></thead><tbody>';

    rows.forEach(row => {
        html += `<tr style="border-bottom:1px solid #f0f0f0; background:#fff5f5;">` +
            `<td style="padding:8px; color:#b00020; font-weight:600;">${securityEscape(row.email)}` +
            `<div style="font-size:12px; color:#888; font-weight:400;">${securityEscape(row.role)}</div></td>` +
            `<td style="padding:8px; color:#555;">${securityTime(row.security_locked_at)}</td>` +
            `<td style="padding:8px; color:#555;">${securityEscape(SECURITY_REASON_LABELS[row.security_locked_reason] || row.security_locked_reason || "")}</td>` +
            `<td style="padding:8px;"><button onclick="unlockSecurityAccount(${row.id}, '${securityEscape(row.email)}')" style="background:#1a1a2e; color:#fff; border:none; border-radius:6px; padding:6px 12px; cursor:pointer; font-size:13px;">Unlock</button></td>` +
            `</tr>`;
    });

    html += "</tbody></table></div>";
    box.innerHTML = html;
    panel.classList.remove("hidden");
}

async function unlockSecurityAccount(id, email) {
    if (!confirm(`Unlock ${email}? One sign-in within the next 15 minutes will register that device as trusted.`)) {
        return;
    }

    const base = (typeof API_URL !== "undefined" && API_URL) ? API_URL : "";
    const token = localStorage.getItem("adminToken");

    try {
        const res = await fetch(`${base}/api/admin/security/unlock/${id}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Could not unlock the account.");
            return;
        }

        alert(data.message);
        loadSecurityLogins();
    } catch (err) {
        console.error("unlockSecurityAccount error:", err);
        alert("Could not connect to server.");
    }
}

async function loadSecurityLogins() {
    const status = document.getElementById("security-status");
    const windowSel = document.getElementById("security-window");
    const period = windowSel ? windowSel.value : "7d";

    if (status) status.textContent = "Loading...";

    // Same-origin, so an empty base is safe if API_URL is not in scope here.
    const base = (typeof API_URL !== "undefined" && API_URL) ? API_URL : "";
    const token = localStorage.getItem("adminToken");

    try {
        const res = await fetch(`${base}/api/admin/security/logins?window=${encodeURIComponent(period)}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!res.ok) {
            if (status) status.textContent = `Could not load (HTTP ${res.status}).`;
            return;
        }

        const data = await res.json();
        securityRecent = data.recent || [];
        renderSecurityLocked(data.locked || []);

        const buckets = { admin: [], staff: [], customer: [], other: [] };
        (data.groups || []).forEach(row => buckets[securityBucket(row)].push(row));

        renderSecurityGroups("security-admin", buckets.admin);
        renderSecurityGroups("security-staff", buckets.staff);
        renderSecurityGroups("security-customer", buckets.customer);

        const otherPanel = document.getElementById("security-other-panel");
        if (otherPanel) {
            if (buckets.other.length) {
                otherPanel.classList.remove("hidden");
                renderSecurityGroups("security-other", buckets.other);
            } else {
                otherPanel.classList.add("hidden");
            }
        }

        const totalFailures = (data.groups || []).reduce((sum, r) => sum + r.failures, 0);
        if (status) {
            status.textContent = `${(data.groups || []).length} accounts, ${totalFailures} failed attempts.`;
        }
    } catch (err) {
        console.error("loadSecurityLogins error:", err);
        if (status) status.textContent = "Could not connect to server.";
    }
}

const REPORT_TYPE_LABELS = {
    blocked: "Cannot sign in / blocked",
    compromised: "Suspected compromise",
    no_email: "Not receiving emails",
    other: "Other"
};

function escapeReportText(v) {
    return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function loadAccountReports() {
    const box = document.getElementById("security-reports");
    if (!box) return;
    const sel = document.getElementById("reports-status");
    const status = sel ? sel.value : "new";

    box.textContent = "Loading...";
    const base = (typeof API_URL !== "undefined" && API_URL) ? API_URL : "";
    const token = localStorage.getItem("adminToken");

    try {
        const res = await fetch(`${base}/api/admin/security/reports?status=${encodeURIComponent(status)}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) {
            box.textContent = `Could not load (HTTP ${res.status}).`;
            return;
        }
        const data = await res.json();
        renderAccountReports(data.reports || []);
    } catch (err) {
        console.error("loadAccountReports error:", err);
        box.textContent = "Could not connect to server.";
    }
}

function renderAccountReports(rows) {
    const box = document.getElementById("security-reports");
    if (!box) return;

    if (!rows.length) {
        box.innerHTML = '<p style="color:#666; font-size:14px;">No reports in this view.</p>';
        return;
    }

    box.innerHTML = rows.map(r => {
        const when = new Date(r.created_at).toLocaleString();
        const type = REPORT_TYPE_LABELS[r.report_type] || escapeReportText(r.report_type);
        const acct = r.user_id
            ? `<span style="color:#0a6b2d;">matches account: ${escapeReportText(r.account_name || "-")} (${escapeReportText(r.account_role || "-")})</span>`
            : '<span style="color:#666;">no matching account</span>';
        const locked = r.account_locked
            ? ` &middot; <strong style="color:#b00020;">locked</strong>` : "";
        const msg = r.message
            ? `<p style="margin:8px 0 0; white-space:pre-wrap;">${escapeReportText(r.message)}</p>` : "";
        const note = r.admin_note
            ? `<p style="margin:6px 0 0; font-size:13px; color:#555;">Note: ${escapeReportText(r.admin_note)}</p>` : "";

        const unlockBtn = (r.user_id && r.account_locked)
            ? `<button onclick="unlockSecurityAccount(${r.user_id})" style="background:#b00020; color:#fff; border:none; border-radius:6px; padding:6px 12px; cursor:pointer;">Unlock account</button>` : "";
        const reviewBtn = r.status !== "reviewed"
            ? `<button onclick="setReportStatus(${r.id}, 'reviewed')" style="background:#1a1a2e; color:#fff; border:none; border-radius:6px; padding:6px 12px; cursor:pointer;">Mark reviewed</button>` : "";
        const resolveBtn = r.status !== "resolved"
            ? `<button onclick="setReportStatus(${r.id}, 'resolved')" style="background:#0a6b2d; color:#fff; border:none; border-radius:6px; padding:6px 12px; cursor:pointer;">Resolve</button>` : "";

        return `<div style="border:1px solid #e4e6ee; border-radius:10px; padding:14px; margin-bottom:12px;">
            <div style="font-size:13px; color:#666;">#${r.id} &middot; ${when} &middot; status: ${escapeReportText(r.status)}</div>
            <div style="margin-top:4px; font-weight:600;">${type}</div>
            <div style="margin-top:2px;">${escapeReportText(r.email)} &middot; ${acct}${locked}</div>
            ${msg}${note}
            <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">${unlockBtn}${reviewBtn}${resolveBtn}</div>
        </div>`;
    }).join("");
}

async function setReportStatus(id, status) {
    const base = (typeof API_URL !== "undefined" && API_URL) ? API_URL : "";
    const token = localStorage.getItem("adminToken");
    try {
        const res = await fetch(`${base}/api/admin/security/reports/${id}`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ status: status })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || "Could not update the report.");
            return;
        }
        loadAccountReports();
    } catch (err) {
        console.error("setReportStatus error:", err);
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

            if (button.dataset.tab === "promotions") {
                loadAdminPromos();
            }

            if (button.dataset.tab === "categories") {
                loadAdminCategories();
            }

            if (button.dataset.tab === "security") {
                loadSecurityLogins();
                loadAccountReports();
            }

            if (button.dataset.tab === "account") {
                loadAccount2FAStatus();
                loadAccountSessions();
            }

            if (button.dataset.tab === "support") {
                loadSupportOverview();
                loadSupportQueue();
                startSupportPolling();
            } else {
                stopSupportPolling();
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
    setupCategoryImagePicker();
    setupPromoImagePicker();

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

let editingVariantId = null;

function startVariantEdit(variantId) {
    editingVariantId = variantId;
    renderVariantsList();
}

function cancelVariantEdit() {
    editingVariantId = null;
    renderVariantsList();
}

// updateVariant sets name, price and stock unconditionally, so all three are
// sent every time even when only one changed. Image is left alone.
async function saveVariantEdit(variantId) {
    const nameEl = document.getElementById("ev-name-" + variantId);
    const priceEl = document.getElementById("ev-price-" + variantId);
    const stockEl = document.getElementById("ev-stock-" + variantId);
    if (!nameEl || !priceEl || !stockEl) return;

    const variant_name = nameEl.value.replace(/\s+/g, " ").trim();
    const price = Number(priceEl.value);
    const stock = Number(stockEl.value);

    if (!variant_name) { alert("Variant name cannot be empty."); return; }
    if (!Number.isFinite(price) || price < 0) { alert("Enter a valid price."); return; }
    if (!Number.isInteger(stock) || stock < 0) { alert("Stock must be a whole number of 0 or more."); return; }

    const form = new FormData();
    form.append("variant_name", variant_name);
    form.append("price", price);
    form.append("stock", stock);

    try {
        const result = await authorizedFetch("/api/variants/" + variantId, {
            method: "PUT",
            body: form
        });
        if (result && result.error) { alert("Failed: " + result.error); return; }
        editingVariantId = null;
        loadVariants(document.getElementById("product-id").value);
    } catch (error) {
        alert("Failed: " + error.message);
    }
}

function renderVariantsList() {
    const container = document.getElementById("variants-list");

    if (!currentVariants || currentVariants.length === 0) {
        container.innerHTML = `<p class="no-data">No variants yet.</p>`;
        return;
    }

    container.innerHTML = currentVariants.map(v => {
        if (Number(v.id) === Number(editingVariantId)) {
            return `
        <div class="variant-row">
            <input type="text" id="ev-name-${v.id}" value="${String(v.variant_name).replace(/"/g, '&quot;')}" style="flex:1;min-width:120px;padding:6px;">
            <input type="number" id="ev-price-${v.id}" value="${v.price}" style="width:100px;padding:6px;">
            <input type="number" id="ev-stock-${v.id}" value="${v.stock}" style="width:80px;padding:6px;">
            <button type="button" onclick="saveVariantEdit(${v.id})">Save</button>
            <button type="button" onclick="cancelVariantEdit()">Cancel</button>
        </div>`;
        }
        return `
        <div class="variant-row">
            <img src="${v.image_path || ''}" alt="" class="variant-thumb">
            <span>${v.variant_name}</span>
            <span>UGX ${Number(v.price).toLocaleString()}</span>
            <span>Stock: ${v.stock}</span>
            <button type="button" onclick="startVariantEdit(${v.id})">Edit</button>
            <button type="button" onclick="deleteVariant(${v.id})">Delete</button>
        </div>`;
    }).join("");

    const err = document.getElementById("variant-edit-error");
    if (err) err.remove();
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

    const receiptLink = document.getElementById("order-detail-receipt");
    if (receiptLink) {
        receiptLink.classList.add("hidden");
        authorizedFetch(`/api/admin/orders/${orderId}/receipt-link`)
            .then(function (r) {
                if (r && r.url) {
                    receiptLink.href = r.url;
                    receiptLink.classList.remove("hidden");
                }
            })
            .catch(function (e) { console.warn("Receipt link unavailable:", e); });
    }

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
    const role = document.getElementById("staff-role").value;
    const statusEl = document.getElementById("staff-create-status");

    if (!name || !email) {
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
            body: JSON.stringify({ name, email, role })
        });

        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Failed to create staff account.";
            return;
        }

        statusEl.textContent = data.message || `Staff account created for ${name}.`;
        document.getElementById("staff-name").value = "";
        document.getElementById("staff-email").value = "";
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
    menuItems += `<div class="staff-menu-item" onclick="closeStaffMenus(); resetStaff2FA(${s.id}, '${safeName}')">🛡️ Reset 2FA</div>`;
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
        const staff = (customers || []).filter(c => c.role === "product_staff" || c.role === "store_manager" || c.role === "customer_support");
        window._staffListCache = staff;
        const container = document.getElementById("staff-accounts-list");

        if (staff.length === 0) {
            container.innerHTML = `<p class="no-data">No staff accounts yet.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    ${staff.map((s, i) => {
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

                        const roleLabel = s.role === "product_staff" ? "Product Staff"
                            : s.role === "customer_support" ? "Customer Support"
                            : "Store Manager";

                        let actions = "";
                        if (!s.deleted_at) {
                            actions = `<button class="staff-menu-btn" onclick="toggleStaffMenu(event, ${s.id})" style="background:#374151; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:16px; line-height:1; cursor:pointer;">⋮</button>`;
                        } else {
                            actions = "—";
                        }

                        return `
                            <tr>
                                <td data-label="#">${i + 1}</td>
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


// ---- Manage Stock panel: variant matrix generation, stock entry, mode toggle ----

let msProductId = null;
let msProductName = "";
let msVariants = [];
let msFlagEnabled = false;

async function openManageStock(productId, productName) {
    msProductId = productId;
    if (productName === undefined && window.event && window.event.target) {
        const btnName = window.event.target.getAttribute("data-pname");
        if (btnName) productName = btnName;
    }
    if (productName !== undefined) msProductName = productName;
    productName = msProductName;
    openGenericModal(`Manage Stock \u2014 ${productName}`, `<p class="no-data">Loading\u2026</p>`);

    try {
        const [optsRes, prodRes] = await Promise.all([
            fetch(`${API_URL}/api/products/${productId}/options`),
            fetch(`${API_URL}/api/products/${productId}`)
        ]);

        const opts = await optsRes.json();
        let flag = false;
        if (prodRes.ok) {
            const prod = await prodRes.json();
            flag = prod.variant_stock_enabled === true;
        }

        msVariants = Array.isArray(opts.variants) ? opts.variants : [];
        msFlagEnabled = flag;
        renderManageStock(opts.colors || [], opts.sizes || []);

    } catch (err) {
        console.error("Manage stock load error:", err);
        document.getElementById("generic-modal-body").innerHTML =
            `<p class="no-data">Could not load stock data.</p>`;
    }
}

function renderManageStock(colors, sizes) {
    const body = document.getElementById("generic-modal-body");
    const colorName = {};
    colors.forEach(c => { colorName[c.id] = c.name; });
    const sizeName = {};
    sizes.forEach(z => { sizeName[z.id] = z.name; });

    const mode = msFlagEnabled
        ? `<span style="color:#0a7d32; font-weight:600;">Variant stock active</span>`
        : `<span style="color:#8a6d00; font-weight:600;">Simple stock (product level)</span>`;

    if (msVariants.length === 0) {
        const canGenerate = colors.length > 0 && sizes.length > 0;
        body.innerHTML = `
            <p style="margin:0 0 12px;">Mode: ${mode}</p>
            <p style="margin:0 0 12px;">No variants yet. Generating creates one row per
            colour and size combination at zero stock \u2014 ${colors.length} \u00d7 ${sizes.length}
            = <strong>${colors.length * sizes.length}</strong> rows.</p>
            ${canGenerate
                ? `<button onclick="generateVariants()">Generate Variants</button>`
                : `<p class="no-data">Add at least one colour and one size first.</p>`}
        `;
        return;
    }

    const inStock = msVariants.filter(v => Number(v.stock) > 0).length;

    const rows = msVariants.map(v => `
        <tr>
            <td>${pdEsc(colorName[v.color_id] || "\u2014")}</td>
            <td>${pdEsc(sizeName[v.size_id] || "\u2014")}</td>
            <td>
                <input type="number" min="0" step="1"
                       data-variant-id="${v.id}"
                       value="${Number(v.stock) || 0}"
                       class="ms-stock-input"
                       style="width:80px;">
            </td>
        </tr>
    `).join("");

    body.innerHTML = `
        <p style="margin:0 0 12px;">Mode: ${mode}</p>
        <table style="width:100%; margin-bottom:12px;">
            <thead><tr><th>Colour</th><th>Size</th><th>Stock</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p style="margin:0 0 12px; font-size:0.9em; color:#666;">
            ${msVariants.length} variants, ${inStock} with stock.
        </p>
        <button onclick="saveVariantStock()">Save Stock</button>
        <button onclick="generateVariants()" style="margin-left:8px;">Re-generate Missing</button>
        <button onclick="toggleVariantStockMode()" style="margin-left:8px;">
            ${msFlagEnabled ? "Revert to Simple Stock" : "Enable Variant Stock"}
        </button>
    `;
}

function pdEsc(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function generateVariants() {
    try {
        const data = await authorizedFetch(`/api/products/${msProductId}/variants/generate`, {
            method: "POST"
        });
        alert(`${data.created} created, ${data.skipped} already existed.`);
        await openManageStock(msProductId);
    } catch (err) {
        alert(err.message || "Could not generate variants.");
    }
}

async function saveVariantStock() {
    const updates = Array.from(document.querySelectorAll(".ms-stock-input")).map(el => ({
        variant_id: Number(el.dataset.variantId),
        stock: Number(el.value)
    }));

    if (updates.some(u => !Number.isInteger(u.stock) || u.stock < 0)) {
        alert("Stock values must be whole numbers of zero or more.");
        return;
    }

    try {
        const data = await authorizedFetch(`/api/products/${msProductId}/variants/stock`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates })
        });
        alert(`Saved. ${data.in_stock} of ${data.total} variants have stock (${data.total_stock} units).`);
        await openManageStock(msProductId);
    } catch (err) {
        alert(err.message || "Could not save stock.");
    }
}

async function toggleVariantStockMode() {
    const target = !msFlagEnabled;
    if (target && !confirm("Enable variant stock? The storefront will use per-variant quantities instead of the product stock figure.")) return;
    if (!target && !confirm("Revert to simple stock? The storefront will use the product-level stock figure.")) return;

    try {
        const data = await authorizedFetch(`/api/products/${msProductId}/variant-stock`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: target })
        });
        alert(data.message);
        await openManageStock(msProductId);
    } catch (err) {
        alert(err.message || "Could not change stock mode.");
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
    if (!confirm(`Email ${name} a password reset link and require a new password before their next login?`)) return;
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
        // A failed email leaves the account flagged but the person with no way
        // back in, so it needs an alert rather than a toast that scrolls past.
        if (data.emailSent === false) {
            alert(data.message || `${name} is flagged for reset, but the email could not be sent.`);
            return;
        }
        showToast(data.message || `${name} will be required to reset their password on next login.`);
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

async function resetStaff2FA(id, name) {
    if (!confirm(`Reset two-factor authentication for ${name}? They will be logged out and must set it up again at next login.`)) return;
    try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/admin/staff/${id}/reset-2fa`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Could not reset 2FA.");
            return;
        }
        showToast(`2FA reset for ${name}. They will re-enrol at next login.`);
    } catch (error) {
        console.error("Reset 2FA error:", error);
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

async function loadProfileIntoPanel() {
    try {
        const result = await authorizedFetch("/api/auth/profile");
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
        document.getElementById("profile-photo-role").textContent = profileData.role === "admin" ? "Administrator" : profileData.role;

        const photoImg = document.getElementById("profile-photo-img");
        const placeholder = document.getElementById("profile-photo-placeholder");
        const sidebarAvatar = document.getElementById("sidebar-profile-avatar");

        if (profileData.profile_photo_url) {
            photoImg.src = profileData.profile_photo_url;
            photoImg.classList.remove("hidden");
            placeholder.classList.add("hidden");
            if (sidebarAvatar) sidebarAvatar.innerHTML = `<img src="${profileData.profile_photo_url}">`;
        } else {
            photoImg.classList.add("hidden");
            placeholder.classList.remove("hidden");
            if (sidebarAvatar) sidebarAvatar.textContent = (profileData.name || "?").charAt(0).toUpperCase();
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
        const token = getToken();
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


// --- Searchable country field for profile panel ---

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

// ---- Stored photo order (edit mode only; new picks have no id yet) ----
function pdIsNew(key) { return key.startsWith("new:"); }

function pdRebuildAllImages() {
    const stored = pdAllImages.filter(im => im.key.startsWith("id:"));
    pdAllImages = stored.concat(
        pdPickedFiles.map((f, i) => ({ key: "new:" + i, url: pdLocalPreviews[i] }))
    );
}

// Removing an unsaved photo shifts every later new: index, so colour
// assignments have to move with it or they silently point at the wrong file.
function pdRemapColorsAfterRemoval(removedIndex) {
    Object.keys(pdSelectedColors).forEach(name => {
        if (!Array.isArray(pdSelectedColors[name])) return;
        pdSelectedColors[name] = pdSelectedColors[name]
            .filter(k => k !== "new:" + removedIndex)
            .map(k => {
                if (!pdIsNew(k)) return k;
                const n = Number(k.slice(4));
                return n > removedIndex ? "new:" + (n - 1) : k;
            });
    });
}

function pdSwapColorKeys(i, j) {
    const ki = "new:" + i, kj = "new:" + j;
    Object.keys(pdSelectedColors).forEach(name => {
        if (!Array.isArray(pdSelectedColors[name])) return;
        pdSelectedColors[name] = pdSelectedColors[name].map(k =>
            k === ki ? kj : (k === kj ? ki : k)
        );
    });
}

function renderPhotoOrderList() {
    const preview = document.getElementById("product-image-preview");
    if (!preview) return;
    let block = document.getElementById("pd-photo-order");
    const all = pdAllImages;
    if (all.length === 0) { if (block) block.remove(); return; }
    if (!block) {
        block = document.createElement("div");
        block.id = "pd-photo-order";
        block.style.cssText = "width:100%; margin-bottom:10px;";
        preview.parentNode.insertBefore(block, preview);
    }

    const storedCount = all.filter(im => im.key.startsWith("id:")).length;

    block.innerHTML =
        '<div style="font-size:12px;font-weight:700;color:#444;margin-bottom:8px;">Photos</div>' +
        all.map((im, i) => {
            const isNew = pdIsNew(im.key);
            const prev = all[i - 1];
            const next = all[i + 1];
            const canUp = prev && pdIsNew(prev.key) === isNew;
            const canDown = next && pdIsNew(next.key) === isNew;
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
                '<span style="min-width:16px;font-size:12px;color:#666;">' + (i + 1) + '</span>' +
                '<div style="position:relative;flex:0 0 auto;">' +
                    '<img src="' + im.url + '" style="width:46px;height:46px;object-fit:cover;border-radius:4px;display:block;">' +
                    '<button type="button" onclick="removePhoto(\'' + im.key + '\')" title="Remove photo" ' +
                        'style="position:absolute;top:-7px;right:-7px;width:21px;height:21px;padding:0;line-height:19px;text-align:center;' +
                        'background:#fff;color:#c0392b;border:1px solid #e0b4ae;border-radius:50%;font-size:12px;cursor:pointer;">&#10005;</button>' +
                '</div>' +
                '<button type="button" onclick="movePhotoOrder(' + i + ',-1)" ' + (canUp ? '' : 'disabled') + ' style="padding:6px 12px;">&uarr;</button>' +
                '<button type="button" onclick="movePhotoOrder(' + i + ',1)" ' + (canDown ? '' : 'disabled') + ' style="padding:6px 12px;">&darr;</button>' +
                (isNew ? '<span style="font-size:10px;font-weight:700;color:#ff6a00;letter-spacing:.5px;">NEW</span>' : '') +
            '</div>';
        }).join("") +
        (storedCount > 1
            ? '<button type="button" onclick="savePhotoOrder()" style="margin-top:4px;padding:6px 14px;background:#ff6a00;color:#fff;border:none;border-radius:4px;">Save order</button>'
            : '') +
        '<span id="pd-photo-order-status" style="margin-left:8px;font-size:12px;color:#666;"></span>';
}

function removePhoto(key) {
    if (key.startsWith("id:")) return deleteStoredPhoto(key);
    return removeNewPhoto(key);
}

// Unsaved upload: nothing has reached the server, so this is purely local.
function removeNewPhoto(key) {
    const i = Number(key.slice(4));
    if (!Number.isInteger(i) || i < 0 || i >= pdPickedFiles.length) return;
    try { URL.revokeObjectURL(pdLocalPreviews[i]); } catch (e) {}
    pdPickedFiles.splice(i, 1);
    pdLocalPreviews.splice(i, 1);
    pdRemapColorsAfterRemoval(i);
    pdRebuildAllImages();
    renderPhotoOrderList();
    document.querySelectorAll(".pd-color-thumb-picker").forEach(pk => renderThumbOptions(pk));
}

let pdDeleteInFlight = false;

async function deleteStoredPhoto(key) {
    if (pdDeleteInFlight) return;
    const imageId = key.split(":")[1];
    if (!imageId) return;
    if (!confirm("Remove this photo from the product?")) return;

    pdDeleteInFlight = true;
    document.querySelectorAll("#pd-photo-order button").forEach(b => b.disabled = true);
    const status = document.getElementById("pd-photo-order-status");
    if (status) status.textContent = "Removing...";
    try {
        // authorizedFetch returns parsed JSON and throws on error.
        const data = await authorizedFetch("/api/products/images/" + imageId, { method: "DELETE" });
        if (data && data.error) {
            if (status) status.textContent = "Failed: " + data.error;
            return;
        }
        pdAllImages = pdAllImages.filter(im => im.key !== key);
        Object.keys(pdSelectedColors).forEach(name => {
            if (Array.isArray(pdSelectedColors[name])) {
                pdSelectedColors[name] = pdSelectedColors[name].filter(k => k !== key);
            }
        });
        renderPhotoOrderList();
        document.querySelectorAll(".pd-color-thumb-picker").forEach(pk => renderThumbOptions(pk));
        const s2 = document.getElementById("pd-photo-order-status");
        if (s2) s2.textContent = "Removed";
    } catch (e) {
        if (status) status.textContent = "Failed: " + e.message;
    } finally {
        pdDeleteInFlight = false;
        renderPhotoOrderList();
    }
}

function movePhotoOrder(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= pdAllImages.length) return;
    const a = pdAllImages[index];
    const b = pdAllImages[target];
    // Saved and unsaved photos do not interleave: unsaved always sort last.
    if (pdIsNew(a.key) !== pdIsNew(b.key)) return;

    if (pdIsNew(a.key)) {
        const i = Number(a.key.slice(4));
        const j = Number(b.key.slice(4));
        const tf = pdPickedFiles[i]; pdPickedFiles[i] = pdPickedFiles[j]; pdPickedFiles[j] = tf;
        const tp = pdLocalPreviews[i]; pdLocalPreviews[i] = pdLocalPreviews[j]; pdLocalPreviews[j] = tp;
        pdSwapColorKeys(i, j);
        pdRebuildAllImages();
    } else {
        pdAllImages[index] = b;
        pdAllImages[target] = a;
    }

    renderPhotoOrderList();
    document.querySelectorAll(".pd-color-thumb-picker").forEach(p => renderThumbOptions(p));
}

async function savePhotoOrder() {
    const productId = document.getElementById("product-id").value;
    const status = document.getElementById("pd-photo-order-status");
    if (!productId) { if (status) status.textContent = "Save the product first."; return; }
    const imageIds = pdAllImages
        .filter(im => im.key.startsWith("id:"))
        .map(im => Number(im.key.slice(3)));
    if (status) status.textContent = "Saving...";
    try {
        const res = await authorizedFetch("/api/products/" + productId + "/images/order", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: imageIds })
        });
        if (status) status.textContent = (res && res.success) ? "Order saved." : ("Failed: " + ((res && res.error) || "Unexpected response."));
    } catch (e) {
        if (status) status.textContent = "Failed: " + e.message;
    }
}

// ---------- Category management (admin only) ----------

let adminCategories = [];
let categoryPickedFile = null;

async function loadAdminCategories() {
    try {
        adminCategories = await authorizedFetch("/api/categories/manage");
        renderCategoriesTable();
    } catch (error) {
        console.error("Load categories error:", error);
    }
}

function renderCategoriesTable() {
    const tbody = document.getElementById("categories-table-body");
    if (!tbody) return;

    const categorySearchInput = document.getElementById("category-search-input");
    const categorySearchTerm = categorySearchInput ? categorySearchInput.value.trim().toLowerCase() : "";

    let keepCategoryIds = null;
    if (categorySearchTerm) {
        const matchedCategories = adminCategories.filter(c => c.name.toLowerCase().includes(categorySearchTerm));
        keepCategoryIds = new Set();
        const addAncestors = (cat) => {
            let current = cat;
            while (current && current.parent_id) {
                keepCategoryIds.add(current.parent_id);
                current = adminCategories.find(x => x.id === current.parent_id);
            }
        };
        const addDescendants = (id) => {
            adminCategories.filter(c => c.parent_id === id).forEach(child => {
                keepCategoryIds.add(child.id);
                addDescendants(child.id);
            });
        };
        matchedCategories.forEach(m => {
            keepCategoryIds.add(m.id);
            addAncestors(m);
            addDescendants(m.id);
        });
    }

    // Render as a tree: each parent in display order, followed by its children.
    const parents = adminCategories
        .filter(c => !c.parent_id && (!keepCategoryIds || keepCategoryIds.has(c.id)))
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

    const byOrder = (a, b) => (a.display_order || 0) - (b.display_order || 0);
    const kidsOf = id => adminCategories
        .filter(c => c.parent_id === id && (!keepCategoryIds || keepCategoryIds.has(c.id)))
        .sort(byOrder);

    const ordered = [];
    for (const top of parents) {
        ordered.push({ ...top, depth: 1 });
        for (const second of kidsOf(top.id)) {
            ordered.push({ ...second, depth: 2 });
            for (const third of kidsOf(second.id)) {
                ordered.push({ ...third, depth: 3 });
            }
        }
    }

    tbody.innerHTML = ordered.map(c => {
        const thumb = c.image_url
            ? `<img src="${c.image_url}" alt="${c.name}" class="category-thumb">`
            : `<div class="category-thumb category-thumb-empty">—</div>`;
        const status = c.is_active
            ? `<span class="badge badge-active">Active</span>`
            : `<span class="badge badge-hidden">Hidden</span>`;
        const toggle = c.is_active
            ? `<button onclick="setCategoryActive(${c.id}, false)">Hide</button>`
            : `<button onclick="setCategoryActive(${c.id}, true)">Restore</button>`;

        return `<tr>
            <td data-label="Image">${thumb}</td>
            <td data-label="Name">${c.depth === 1
                ? `<strong>${c.name}</strong>`
                : `<span class="category-child-name" style="padding-left:${(c.depth - 1) * 22}px">${c.name}</span>`}</td>
            <td data-label="Products">${c.product_count}</td>
            <td data-label="Order">${c.display_order}</td>
            <td data-label="Status">${status}</td>
            <td data-label="Actions">
                <button onclick="editCategory(${c.id})">Edit</button>
                ${toggle}
            </td>
        </tr>`;
    }).join("");
}

function renderCategoryParentSelect(selectedParentId) {
    const select = document.getElementById("category-parent");
    if (!select) return;

    const byOrder = (a, b) => (a.display_order || 0) - (b.display_order || 0);
    const childrenOf = id => adminCategories.filter(c => c.parent_id === id).sort(byOrder);

    // Offer levels 1 and 2 as possible parents. Level 3 holds products, not
    // categories, so it is never offered.
    const options = [];
    for (const top of adminCategories.filter(c => !c.parent_id).sort(byOrder)) {
        options.push({ id: top.id, label: top.name });
        for (const second of childrenOf(top.id)) {
            options.push({ id: second.id, label: `\u00A0\u00A0\u00A0${top.name} \u203A ${second.name}` });
        }
    }

    const selected = selectedParentId != null ? String(selectedParentId) : "";
    select.innerHTML = `<option value="">Top level (a main category)</option>`
        + options.map(o => {
            const isSel = String(o.id) === selected ? " selected" : "";
            return `<option value="${o.id}"${isSel}>Under ${o.label}</option>`;
        }).join("");
}

function openCategoryForm() {
    document.getElementById("category-form-title").textContent = "Add Category";
    renderCategoryParentSelect();
    document.getElementById("category-id").value = "";
    document.getElementById("category-name").value = "";
    document.getElementById("category-description").value = "";
    document.getElementById("category-order").value = "";
    document.getElementById("category-image-preview").innerHTML = "";
    document.getElementById("category-form-error").textContent = "";
    categoryPickedFile = null;
    document.getElementById("category-form-container").classList.remove("hidden");
}

function editCategory(id) {
    const c = adminCategories.find(x => x.id === id);
    if (!c) return;

    document.getElementById("category-form-title").textContent = "Edit Category";
    document.getElementById("category-id").value = c.id;
    document.getElementById("category-name").value = c.name;
    document.getElementById("category-description").value = c.description || "";
    document.getElementById("category-order").value = c.display_order;
    renderCategoryParentSelect(c.parent_id);
    document.getElementById("category-form-error").textContent = "";
    categoryPickedFile = null;

    document.getElementById("category-image-preview").innerHTML = c.image_url
        ? `<img src="${c.image_url}" class="drag-drop-preview">`
        : "";

    document.getElementById("category-form-container").classList.remove("hidden");
}

function closeCategoryForm() {
    document.getElementById("category-form-container").classList.add("hidden");
    categoryPickedFile = null;
}

function setupCategoryImagePicker() {
    const zone = document.getElementById("category-image-dropzone");
    const input = document.getElementById("category-image");
    if (!zone || !input) return;

    zone.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        const preview = document.getElementById("category-image-preview");
        const errorEl = document.getElementById("category-form-error");
        errorEl.textContent = "";
        preview.innerHTML = "Preparing image…";

        const result = await preparePickedFile(file);

        if (!result.ok) {
            categoryPickedFile = null;
            preview.innerHTML = "";
            errorEl.textContent = `Could not read ${result.name} (${result.reason}). Re-select it, or pick from Files rather than a cloud gallery.`;
            return;
        }

        categoryPickedFile = result.file;
        const url = URL.createObjectURL(result.file);
        preview.innerHTML = `<img src="${url}" class="drag-drop-preview" style="max-width:160px; border-radius:8px;">`;
    });
}

async function saveCategory() {
    const errorEl = document.getElementById("category-form-error");
    errorEl.textContent = "";

    const id = document.getElementById("category-id").value;
    const name = document.getElementById("category-name").value.trim();
    const description = document.getElementById("category-description").value.trim();
    const order = document.getElementById("category-order").value;

    if (!name) {
        errorEl.textContent = "Category name is required.";
        return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("description", description);
    formData.append("display_order", order || 0);
    formData.append("parent_id", document.getElementById("category-parent").value || "");
    if (categoryPickedFile) formData.append("image", categoryPickedFile);

    try {
        await authorizedFetch(
            id ? `/api/categories/${id}` : "/api/categories",
            { method: id ? "PUT" : "POST", body: formData }
        );

        closeCategoryForm();
        await loadAdminCategories();
    } catch (error) {
        console.error("Save category error:", error);
        errorEl.textContent = error.message || "Save failed. Check your connection and try again.";
    }
}

async function setCategoryActive(id, isActive) {
    const c = adminCategories.find(x => x.id === id);
    if (!isActive && c && !confirm(`Hide "${c.name}" from the storefront? Its ${c.product_count} product(s) stay linked and it can be restored later.`)) {
        return;
    }

    try {
        await authorizedFetch(`/api/categories/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: isActive })
        });
        await loadAdminCategories();
    } catch (error) {
        console.error("Set category status error:", error);
        alert("Could not update category status.");
    }
}

// ---------- Homepage promotions (admin only) ----------

let adminPromos = [];
let promoPickedFile = null;

async function loadAdminPromos() {
    try {
        adminPromos = await authorizedFetch("/api/promotions/manage");
        renderPromosTable();
    } catch (error) {
        console.error("Load promotions error:", error);
    }
}

// "all", "1", "2" or "3". Kept as a string so it matches the tile dataset.
let promoSlotFilter = "all";

function setPromoSlotFilter(slot) {
    promoSlotFilter = String(slot);
    renderPromosTable();
}

const PROMO_LAYOUT_NAMES = {
    image: "Image banner",
    text: "Text banner",
    strip_text: "Announcement",
    strip_link: "Strip tile"
};

function renderPromoSlotTiles() {
    const wrap = document.getElementById("promo-slot-tiles");
    if (!wrap) return;

    wrap.querySelectorAll(".promo-slot-tile").forEach(tile => {
        const slot = tile.dataset.slot;
        const count = slot === "all"
            ? adminPromos.length
            : adminPromos.filter(p => String(p.slot) === slot).length;

        const badge = tile.querySelector(".pst-count");
        if (badge) badge.textContent = count;
        tile.classList.toggle("selected", slot === promoSlotFilter);
        tile.classList.toggle("empty", count === 0 && slot !== "all");
    });
}

function renderPromosTable() {
    const tbody = document.getElementById("promotions-table-body");
    if (!tbody) return;

    renderPromoSlotTiles();

    const rows = promoSlotFilter === "all"
        ? adminPromos
        : adminPromos.filter(p => String(p.slot) === promoSlotFilter);

    if (rows.length === 0) {
        const message = adminPromos.length === 0
            ? "No promotions yet. The homepage is showing random product images."
            : `Nothing in slot ${promoSlotFilter} yet.`;
        tbody.innerHTML = `<tr><td colspan="6" style="padding:18px; color:#6b7280">
            ${message}</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(p => {
        const status = p.is_active
            ? `<span class="badge badge-active">Live</span>`
            : `<span class="badge badge-hidden">Hidden</span>`;
        const toggle = p.is_active
            ? `<button onclick="setPromoActive(${p.id}, false)">Hide</button>`
            : `<button onclick="setPromoActive(${p.id}, true)">Show</button>`;

        return `<tr>
            <td data-label="Image">${p.image_url
                ? `<img src="${p.image_url}" class="promo-thumb" alt="">`
                : `<span class="promo-thumb-none">${PROMO_LAYOUT_NAMES[p.layout] || "No image"}</span>`}</td>
            <td data-label="Title">${p.title || p.headline
                || "<em style='color:#9ca3af'>Untitled</em>"}</td>
            <td data-label="Slot">${p.slot}</td>
            <td data-label="Order">${p.display_order}</td>
            <td data-label="Status">${status}</td>
            <td data-label="Actions">
                <button onclick="editPromo(${p.id})">Edit</button>
                ${toggle}
                <button onclick="deletePromo(${p.id})">Delete</button>
            </td>
        </tr>`;
    }).join("");
}

function openPromoForm() {
    document.getElementById("promo-form-title").textContent = "Add Promotion";
    document.getElementById("promo-id").value = "";
    document.getElementById("promo-title").value = "";
    document.getElementById("promo-slot").value = "1";
    document.getElementById("promo-link").value = "";
    document.getElementById("promo-order").value = "";
    document.getElementById("promo-layout").value = "image";
    document.getElementById("promo-headline").value = "";
    document.getElementById("promo-subtext").value = "";
    document.getElementById("promo-cta").value = "";
    document.getElementById("promo-bg").value = "";
    document.getElementById("promo-text-color").value = "";
    renderPromoPreview();
    togglePromoLayout();
    document.getElementById("promo-image-preview").innerHTML = "";
    document.getElementById("promo-form-error").textContent = "";
    promoPickedFile = null;
    document.getElementById("promo-form-container").classList.remove("hidden");
}

function editPromo(id) {
    const p = adminPromos.find(x => x.id === id);
    if (!p) return;

    document.getElementById("promo-form-title").textContent = "Edit Promotion";
    document.getElementById("promo-id").value = p.id;
    document.getElementById("promo-title").value = p.title || "";
    document.getElementById("promo-slot").value = String(p.slot);
    document.getElementById("promo-link").value = p.link_url || "";
    document.getElementById("promo-order").value = p.display_order;
    document.getElementById("promo-layout").value = p.layout || "image";
    document.getElementById("promo-headline").value = p.headline || "";
    document.getElementById("promo-subtext").value = p.subtext || "";
    document.getElementById("promo-cta").value = p.cta_label || "";
    document.getElementById("promo-bg").value = p.bg_color || "";
    document.getElementById("promo-text-color").value = p.text_color || "";
    renderPromoPreview();
    togglePromoLayout();
    document.getElementById("promo-form-error").textContent = "";
    promoPickedFile = null;

    document.getElementById("promo-image-preview").innerHTML =
        `<img src="${p.image_url}" class="drag-drop-preview" style="max-width:220px; border-radius:8px;">`;

    document.getElementById("promo-form-container").classList.remove("hidden");
}

function closePromoForm() {
    document.getElementById("promo-form-container").classList.add("hidden");
    promoPickedFile = null;
}

// Each layout says what it needs rather than the form guessing from a single
// boolean. Adding a fifth layout later means one entry here, not another branch.
const PROMO_LAYOUT_RULES = {
    image: {
        copy: false,
        imageHeading: "Image",
        linkHint: "Link, e.g. /product/68"
    },
    text: {
        copy: true,
        imageHeading: "Image (optional cutout)",
        linkHint: "Link, e.g. /product/68"
    },
    strip_text: {
        copy: true,
        imageHeading: "Image (not used on announcements)",
        linkHint: "Not used \u2014 announcements are not tappable"
    },
    strip_link: {
        copy: false,
        imageHeading: "Icon (120\u00d7120)",
        linkHint: "Required \u2014 https://... or a page such as /faq.html"
    }
};

// Background colour swatches. The field stays a text input so a brand hex can
// still be pasted; the swatches just fill it in.
function setPromoBg(value) {
    const field = document.getElementById("promo-bg");
    if (!field) return;
    field.value = value;
    markPromoSwatch();
}

function setPromoText(value) {
    const field = document.getElementById("promo-text-color");
    if (!field) return;
    field.value = value;
    markPromoSwatch();
    renderPromoPreview();
}

function markPromoSwatch() {
    markSwatchRow("promo-bg", "promo-bg-swatches");
    markSwatchRow("promo-text-color", "promo-text-swatches");
}

function markSwatchRow(fieldId, rowId) {
    const field = document.getElementById(fieldId);
    const row = document.getElementById(rowId);
    if (!field || !row) return;

    const current = field.value.trim().toLowerCase();
    row.querySelectorAll(".promo-swatch").forEach(btn => {
        const mine = (btn.dataset.color || "").toLowerCase();
        btn.classList.toggle("selected", mine === current && current !== "");
    });

    const clear = row.querySelector(".promo-swatch.clear");
    if (clear) clear.classList.toggle("selected", current === "");
}

// Relative luminance per WCAG. Used to pick readable text when no colour has
// been set, so the swatch grid cannot produce an unreadable combination.
function promoLuminance(hex) {
    const raw = String(hex || "").trim().replace("#", "");
    const full = raw.length === 3
        ? raw.split("").map(c => c + c).join("")
        : raw;
    if (full.length < 6) return 1;

    const channel = value => {
        const c = parseInt(value, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * channel(full.slice(0, 2))
        + 0.7152 * channel(full.slice(2, 4))
        + 0.0722 * channel(full.slice(4, 6));
}

function promoAutoText(bg) {
    return promoLuminance(bg) > 0.45 ? "#c0392b" : "#fff5f5";
}

function renderPromoPreview() {
    const box = document.getElementById("promo-preview");
    if (!box) return;

    const bgField = document.getElementById("promo-bg").value.trim();
    const textField = document.getElementById("promo-text-color").value.trim();
    const isHex = value => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);

    const bg = isHex(bgField) ? bgField : "#fbeaea";
    const auto = promoAutoText(bg);
    const text = isHex(textField) ? textField : auto;

    box.style.background = bg;
    box.style.color = text;

    const head = document.getElementById("promo-preview-head");
    const sub = document.getElementById("promo-preview-sub");
    head.textContent = document.getElementById("promo-headline").value.trim()
        || "Your headline";
    sub.textContent = document.getElementById("promo-subtext").value.trim();

    // Contrast ratio, so a hand-typed brand colour gets a warning rather than
    // silently shipping something unreadable.
    const note = document.getElementById("promo-preview-note");
    const lighter = Math.max(promoLuminance(bg), promoLuminance(text));
    const darker = Math.min(promoLuminance(bg), promoLuminance(text));
    const ratio = (lighter + 0.05) / (darker + 0.05);

    if (!isHex(textField)) {
        note.textContent = `Automatic (${auto})`;
        note.className = "promo-preview-note";
    } else if (ratio < 4.5) {
        note.textContent = `Low contrast (${ratio.toFixed(1)}:1) - hard to read`;
        note.className = "promo-preview-note warn";
    } else {
        note.textContent = `Contrast ${ratio.toFixed(1)}:1`;
        note.className = "promo-preview-note";
    }

    markPromoSwatch();
}

function togglePromoLayout() {
    const layout = document.getElementById("promo-layout").value;
    const rules = PROMO_LAYOUT_RULES[layout] || PROMO_LAYOUT_RULES.image;

    document.getElementById("promo-copy-section").classList.toggle("hidden", !rules.copy);
    document.getElementById("promo-image-heading").textContent = rules.imageHeading;

    const link = document.getElementById("promo-link");
    if (link) {
        link.placeholder = rules.linkHint;
        link.disabled = layout === "strip_text";
        if (link.disabled) link.value = "";
    }

    // Picking a strip layout from either banner slot is almost always a
    // mis-set slot, so move it rather than letting the save fail.
    const slot = document.getElementById("promo-slot");
    if (slot) {
        const isStrip = layout === "strip_text" || layout === "strip_link";
        if (isStrip && slot.value !== "3") slot.value = "3";
        if (!isStrip && slot.value === "3") slot.value = "1";
    }
}

function setupPromoImagePicker() {
    const zone = document.getElementById("promo-image-dropzone");
    const input = document.getElementById("promo-image");
    if (!zone || !input) return;

    zone.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        const preview = document.getElementById("promo-image-preview");
        const errorEl = document.getElementById("promo-form-error");
        errorEl.textContent = "";
        preview.innerHTML = "Preparing image…";

        const result = await preparePickedFile(file);
        if (!result.ok) {
            promoPickedFile = null;
            preview.innerHTML = "";
            errorEl.textContent = `Could not read ${result.name} (${result.reason}). Re-select it, or pick from Files rather than a cloud gallery.`;
            return;
        }

        promoPickedFile = result.file;
        preview.innerHTML = `<img src="${URL.createObjectURL(result.file)}" class="drag-drop-preview" style="max-width:220px; border-radius:8px;">`;
    });
}

async function savePromo() {
    const errorEl = document.getElementById("promo-form-error");
    errorEl.textContent = "";

    const id = document.getElementById("promo-id").value;
    const layout = document.getElementById("promo-layout").value;
    const headline = document.getElementById("promo-headline").value.trim();

    const link = document.getElementById("promo-link").value.trim();

    if (layout === "image" && !id && !promoPickedFile) {
        errorEl.textContent = "An image is required.";
        return;
    }
    if ((layout === "text" || layout === "strip_text") && !headline) {
        errorEl.textContent = "This layout needs a headline.";
        return;
    }
    if (layout === "strip_link" && !link) {
        errorEl.textContent = "A strip tile needs a link.";
        return;
    }
    if (layout === "strip_link" && !document.getElementById("promo-title").value.trim()
        && !id && !promoPickedFile) {
        errorEl.textContent = "A strip tile needs a label or an icon.";
        return;
    }
    // Same allowlist the server enforces, shown here so a bad paste is caught
    // before the upload rather than after it.
    if (link && !/^(?:https:\/\/|mailto:|tel:|\/(?!\/))/i.test(link)) {
        errorEl.textContent = "Link must be https://, a path starting with /, or mailto:/tel:.";
        return;
    }

    const formData = new FormData();
    formData.append("title", document.getElementById("promo-title").value.trim());
    formData.append("slot", document.getElementById("promo-slot").value);
    formData.append("link_url", document.getElementById("promo-link").value.trim());
    formData.append("display_order", document.getElementById("promo-order").value || 0);
    formData.append("layout", layout);
    formData.append("headline", headline);
    formData.append("subtext", document.getElementById("promo-subtext").value.trim());
    formData.append("cta_label", document.getElementById("promo-cta").value.trim());
    formData.append("bg_color", document.getElementById("promo-bg").value.trim() || "#ffffff");
    formData.append("text_color", document.getElementById("promo-text-color").value.trim());
    if (promoPickedFile) formData.append("image", promoPickedFile);

    try {
        await authorizedFetch(id ? `/api/promotions/${id}` : "/api/promotions",
            { method: id ? "PUT" : "POST", body: formData });
        closePromoForm();
        await loadAdminPromos();
    } catch (error) {
        console.error("Save promotion error:", error);
        errorEl.textContent = error.message || "Save failed.";
    }
}

async function setPromoActive(id, isActive) {
    try {
        await authorizedFetch(`/api/promotions/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: isActive })
        });
        await loadAdminPromos();
    } catch (error) {
        console.error("Set promotion status error:", error);
        alert("Could not update status.");
    }
}

async function deletePromo(id) {
    if (!confirm("Delete this promotion permanently?")) return;
    try {
        await authorizedFetch(`/api/promotions/${id}`, { method: "DELETE" });
        await loadAdminPromos();
    } catch (error) {
        console.error("Delete promotion error:", error);
        alert("Could not delete.");
    }
}


let supportPollTimer = null;

let supportAgents = [];

function waitLabel(iso) {
    if (!iso) return "";
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return mins + "m";
    const h = Math.floor(mins / 60);
    return h + "h " + (mins % 60) + "m";
}

function queueAnchor(c) {
    if (c.status === "waiting") return c.escalated_at || c.created_at;
    return c.assigned_at || c.created_at;
}

async function loadSupportQueue() {
    const box = document.getElementById("support-queue-list");
    try {
        const [convRes, agentRes] = await Promise.all([
            fetch(`${API_URL}/api/chat/conversations?status=active`, {
                headers: { "Authorization": `Bearer ${getToken()}` }
            }),
            fetch(`${API_URL}/api/chat/availability`, {
                headers: { "Authorization": `Bearer ${getToken()}` }
            })
        ]);

        const convs = await convRes.json();
        const agentData = await agentRes.json();
        supportAgents = (agentData && agentData.agents) || [];

        if (!convRes.ok) {
            box.innerHTML = `<p class="no-data">Could not load the queue.</p>`;
            return;
        }

        const queue = (convs || []).filter(c =>
            c.status === "waiting" || (c.status === "open" && !c.first_response_at)
        );

        queue.sort((a, b) => new Date(queueAnchor(a)) - new Date(queueAnchor(b)));

        if (queue.length === 0) {
            box.innerHTML = `<p class="no-data">Nothing waiting. All chats have had a reply.</p>`;
            return;
        }

        let rows = "";
        queue.forEach(c => {
            const wait = waitLabel(queueAnchor(c));
            const tag = c.status === "waiting"
                ? `<span class="q-tag q-waiting">WAITING</span>`
                : `<span class="q-tag q-noreply">NO REPLY</span>`;
            const who = c.assigned_staff_name || "Unassigned";

            let options = `<option value="">Assign to...</option>`;
            supportAgents.forEach(a => {
                const sel = a.staff_id === c.assigned_staff_id ? " selected" : "";
                const dot = a.is_online ? "\u25CF " : "\u25CB ";
                options += `<option value="${a.staff_id}"${sel}>${dot}${a.staff_name || ("Agent " + a.staff_id)} (${a.active_chats})</option>`;
            });

            rows += `
                <tr>
                    <td class="q-open" onclick="openMonitor(${c.id})">${c.display_name || "Guest"}<br><small>${c.display_phone || ""}</small></td>
                    <td>${tag}</td>
                    <td><strong>${wait}</strong></td>
                    <td>${who}</td>
                    <td><select onchange="assignConversation(${c.id}, this.value)">${options}</select></td>
                </tr>`;
        });

        box.innerHTML = `
            <table class="admin-table">
                <thead><tr><th>Customer</th><th>Status</th><th>Waiting</th><th>Agent</th><th>Assign</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

    } catch (error) {
        console.error("Support queue error:", error);
        box.innerHTML = `<p class="no-data">Could not connect to server.</p>`;
    }
}

async function assignConversation(id, staffId) {
    if (!staffId) return;
    try {
        const response = await fetch(`${API_URL}/api/chat/conversations/${id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify({ assigned_staff_id: Number(staffId), status: "open" })
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.message || "Could not assign.");
            return;
        }
        showToast("Conversation assigned.");
        loadSupportQueue();
        loadSupportOverview();
    } catch (error) {
        console.error("Assign error:", error);
        alert("Something went wrong.");
    }
}

async function loadSupportOverview() {
    const msg = document.getElementById("support-overview-msg");
    try {
        const response = await fetch(`${API_URL}/api/chat/overview`, {
            headers: { "Authorization": `Bearer ${getToken()}` }
        });
        const data = await response.json();

        if (!response.ok) {
            msg.textContent = data.error || "Could not load overview.";
            return;
        }

        const o = data.overview || {};
        document.getElementById("ov-waiting").textContent = o.customers_waiting ?? 0;
        document.getElementById("ov-active").textContent = o.active_agent_chats ?? 0;
        document.getElementById("ov-unassigned").textContent = o.unassigned_open ?? 0;
        document.getElementById("ov-online").textContent = o.agents_online ?? 0;
        document.getElementById("ov-nofirst").textContent = o.awaiting_first_reply ?? 0;
        document.getElementById("ov-today").textContent = o.chats_today ?? 0;
        document.getElementById("ov-resolved").textContent = o.resolved_today ?? 0;
        msg.textContent = "";
    } catch (error) {
        console.error("Support overview error:", error);
        msg.textContent = "Could not connect to server.";
    }
}

function startSupportPolling() {
    stopSupportPolling();
    supportPollTimer = setInterval(() => {
        loadSupportOverview();
        loadSupportQueue();
        loadMonitor();
    }, 15000);
}

function stopSupportPolling() {
    if (supportPollTimer) {
        clearInterval(supportPollTimer);
        supportPollTimer = null;
    }
}

let monitorConvId = null;

const EVENT_LABELS = {
    faq_answer_shown: "FAQ answer shown",
    escalated: "Escalated to an agent",
    assigned: "Assigned",
    reassigned: "Reassigned",
    first_response: "First reply sent",
    resolved: "Marked resolved",
    closed: "Closed",
    reopened: "Reopened"
};

function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function openMonitor(id) {
    monitorConvId = id;
    document.getElementById("support-monitor-panel").style.display = "";
    document.getElementById("monitor-thread").innerHTML = "Loading...";
    await loadMonitor();
}

function closeMonitor() {
    monitorConvId = null;
    document.getElementById("support-monitor-panel").style.display = "none";
}

async function loadMonitor() {
    if (!monitorConvId) return;
    try {
        const response = await fetch(`${API_URL}/api/chat/conversations/${monitorConvId}?peek=true`, {
            headers: { "Authorization": `Bearer ${getToken()}` }
        });
        const data = await response.json();
        if (!response.ok) {
            document.getElementById("monitor-thread").innerHTML =
                `<p class="no-data">${data.message || "Could not load."}</p>`;
            return;
        }

        const c = data.conversation || {};
        document.getElementById("monitor-title").textContent =
            (c.display_name || "Guest") + " - #" + c.id;

        let meta = `<span class="m-pill">${c.status}</span>`;
        if (c.display_phone) meta += `<span class="m-pill">${c.display_phone}</span>`;
        if (c.guest_email) meta += `<span class="m-pill">${c.guest_email}</span>`;
        if (c.escalation_reason) meta += `<span class="m-pill">${c.escalation_reason}</span>`;
        if (c.order_id) meta += `<span class="m-pill">Order #${c.order_id}</span>`;
        document.getElementById("monitor-meta").innerHTML = meta;

        const events = data.events || [];
        document.getElementById("monitor-timeline").innerHTML = events.length
            ? events.map(e => `<div class="m-event">
                   <span class="m-event-dot"></span>
                   <span class="m-event-label">${EVENT_LABELS[e.event_type] || e.event_type}</span>
                   ${e.actor_name ? `<span class="m-event-who">${e.actor_name}</span>` : ""}
                   <span class="m-event-time">${fmtTime(e.created_at)}</span>
               </div>`).join("")
            : `<p class="no-data">No events recorded.</p>`;

        const actions = document.getElementById("monitor-actions");
        if (c.status === "closed") {
            actions.innerHTML = `<button class="m-btn" onclick="setConvStatus(${c.id}, 'open')">Reopen</button>`;
        } else {
            actions.innerHTML =
                `<button class="m-btn m-btn-primary" onclick="setConvStatus(${c.id}, 'closed', true)">Close as resolved</button>
                 <button class="m-btn" onclick="setConvStatus(${c.id}, 'closed', false)">Close unresolved</button>`;
        }

        const msgs = data.messages || [];
        document.getElementById("monitor-thread").innerHTML = msgs.length
            ? msgs.map(m => `<div class="m-msg m-${m.sender_type}">
                   <div class="m-msg-body">${(m.body || "").replace(/</g, "&lt;")}</div>
                   <div class="m-msg-time">${fmtTime(m.created_at)}</div>
               </div>`).join("")
            : `<p class="no-data">No messages yet.</p>`;

    } catch (error) {
        console.error("Monitor error:", error);
        document.getElementById("monitor-thread").innerHTML =
            `<p class="no-data">Could not connect to server.</p>`;
    }
}


async function setConvStatus(id, status, resolved) {
    const label = status === "closed"
        ? (resolved ? "Close this conversation as resolved?" : "Close this conversation as unresolved?")
        : "Reopen this conversation?";
    if (!confirm(label)) return;

    const body = { status };
    if (status === "closed") body.resolved = !!resolved;

    try {
        const response = await fetch(`${API_URL}/api/chat/conversations/${id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.message || "Could not update.");
            return;
        }
        showToast(status === "closed" ? "Conversation closed." : "Conversation reopened.");
        loadMonitor();
        loadSupportQueue();
        loadSupportOverview();
    } catch (error) {
        console.error("Status change error:", error);
        alert("Something went wrong.");
    }
}


async function sendMonitorReply() {
    if (!monitorConvId) return;
    const input = document.getElementById("monitor-input");
    const body = input.value.trim();
    if (!body) return;

    try {
        const response = await fetch(`${API_URL}/api/chat/conversations/${monitorConvId}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getToken()}`
            },
            body: JSON.stringify({ body })
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.message || "Could not send.");
            return;
        }
        input.value = "";
        loadMonitor();
        loadSupportQueue();
        loadSupportOverview();
    } catch (error) {
        console.error("Monitor reply error:", error);
        alert("Something went wrong.");
    }
}


// ============================================
// DASHBOARD CLICK HANDLERS
// ============================================
function setupDashboardClicks() {
    console.log('Setting up dashboard click handlers...');
    
    const statsGrid = document.getElementById('stats-grid');
    if (!statsGrid) {
        console.log('Stats grid not found');
        return;
    }
    
    const cards = statsGrid.querySelectorAll('.stat-card');
    console.log('Found', cards.length, 'stat cards');
    
    const routes = [
        '/admin/orders',
        '/admin/orders',
        '/admin/orders?status=pending',
        '/admin/customers',
        '/admin/users?deleted=true',
        '/admin/users?role=guest',
        '/admin/payments?status=pending'
    ];
    
    cards.forEach((card, index) => {
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.2s ease';
        
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
            this.style.boxShadow = '0 8px 25px rgba(0,0,0,0.12)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        });
        
        card.addEventListener('click', function() {
            const url = routes[index] || '/admin';
            console.log('Navigating to:', url);
            window.location.href = url;
        });
    });
}

function setupVisitorClicks() {
    const container = document.getElementById('visitor-analytics-grid');
    if (!container) return;
    
    const cards = container.querySelectorAll('.stat-card');
    cards.forEach(card => {
        card.style.cursor = 'pointer';
        card.style.transition = 'all 0.2s ease';
        
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
            this.style.boxShadow = '0 8px 25px rgba(0,0,0,0.12)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        });
        
        card.addEventListener('click', function() {
            window.location.href = '/admin/analytics';
        });
    });
}

// Run after page loads
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(setupDashboardClicks, 1500);
    setTimeout(setupVisitorClicks, 1800);
});
