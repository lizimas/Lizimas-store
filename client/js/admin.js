// ============================================
// DEVICE APPROVAL (phase 4c)
// ============================================
let pendingLoginToken = null;

function lzShowDeviceWait(data, onApproved) {
    pendingLoginToken = data.pendingToken;

    ["login-email", "login-password", "login-btn"].forEach(id => {
        var el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    var err = document.getElementById("login-error");
    var deadline = new Date(data.expiresAt).getTime();
    var stopped = false;

    function say(text) { if (err) err.textContent = text; }

    say("We have emailed you to confirm this sign-in. Please check your email.");

    var timer = setTimeout(function () {
        if (stopped) return;
        if (Date.now() > deadline) {
            say("Login request expired. Please try again.");
        }
    }, 1000);
}

// ============================================
// AUTHORIZED FETCH
// ============================================
function getToken() {
    return localStorage.getItem('adminToken');
}

async function authorizedFetch(url, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (response.status === 401) {
        window.location.href = '/login.html';
        return;
    }
    
    return response.json();
}

// ============================================
// LOAD DASHBOARD DATA
// ============================================
async function loadAllDashboardData() {
    await loadStats();
    await loadVisitorStats();
    await loadOrders();
    await loadCustomers();
    await loadProducts();
}

// ============================================
// LOAD STATS - with click handlers
// ============================================
async function loadStats() {
    try {
        const stats = await authorizedFetch("/api/admin/stats");

        const statsGrid = document.getElementById("stats-grid");
        if (!statsGrid) return;

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
        `;

        // ✅ CLICK HANDLERS FOR STAT CARDS
        const cards = statsGrid.querySelectorAll('.stat-card');
        const routes = [
            '/admin/orders',                    // Total Revenue
            '/admin/orders',                    // Total Orders
            '/admin/orders?status=pending',     // Pending Orders
            '/admin/customers',                 // Total Registered Customers
            '/admin/users?deleted=true',        // Total Deleted Accounts
            '/admin/users?role=guest',          // Total Guest Customers
            '/admin/payments?status=pending'    // Pending Payments
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
                window.location.href = url;
            });
        });

    } catch (error) {
        console.error("Failed to load stats:", error);
        const statsGrid = document.getElementById("stats-grid");
        if (statsGrid) {
            statsGrid.innerHTML = `<p>Error loading stats</p>`;
        }
    }
}

// ============================================
// LOAD VISITOR STATS - with click handlers
// ============================================
async function loadVisitorStats() {
    try {
        const stats = await authorizedFetch("/api/admin/visitor-stats");
        const container = document.getElementById("visitor-analytics-grid");
        if (!container) return;

        container.innerHTML = `
            <div class="stat-card">
                <div class="label">Visitors Today</div>
                <div class="value">${stats.visitorsToday || 0}</div>
            </div>
            <div class="stat-card">
                <div class="label">Visitors This Week</div>
                <div class="value">${stats.visitorsThisWeek || 0}</div>
            </div>
            <div class="stat-card">
                <div class="label">Total Visitors</div>
                <div class="value">${stats.totalVisitors || 0}</div>
            </div>
        `;

        // ✅ CLICK HANDLERS FOR VISITOR STATS
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

    } catch (error) {
        console.error("Failed to load visitor stats:", error);
        const container = document.getElementById("visitor-analytics-grid");
        if (container) {
            container.innerHTML = `<p>Error loading visitor stats</p>`;
        }
    }
}

// ============================================
// LOAD ORDERS
// ============================================
async function loadOrders() {
    try {
        const orders = await authorizedFetch("/api/admin/orders");
        const container = document.getElementById("orders-list");
        if (!container) return;
        
        if (orders && orders.length > 0) {
            container.innerHTML = orders.slice(0, 5).map(order => `
                <div class="order-item">
                    <span>#${order.id}</span>
                    <span>${order.customer_name || 'Guest'}</span>
                    <span>UGX ${Number(order.total).toLocaleString()}</span>
                    <span class="status-${order.status}">${order.status}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p>No recent orders</p>';
        }
    } catch (error) {
        console.error("Failed to load orders:", error);
    }
}

// ============================================
// LOAD CUSTOMERS
// ============================================
async function loadCustomers() {
    try {
        const customers = await authorizedFetch("/api/admin/customers");
        const container = document.getElementById("customers-list");
        if (!container) return;
        
        if (customers && customers.length > 0) {
            container.innerHTML = customers.slice(0, 5).map(customer => `
                <div class="customer-item">
                    <span>${customer.name || 'Guest'}</span>
                    <span>${customer.email}</span>
                    <span>${customer.orders_count || 0} orders</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p>No customers yet</p>';
        }
    } catch (error) {
        console.error("Failed to load customers:", error);
    }
}

// ============================================
// LOAD PRODUCTS
// ============================================
async function loadProducts() {
    try {
        const products = await authorizedFetch("/api/products");
        const container = document.getElementById("products-list");
        if (!container) return;
        
        if (products && products.length > 0) {
            container.innerHTML = products.slice(0, 5).map(product => `
                <div class="product-item">
                    <span>${product.name}</span>
                    <span>UGX ${Number(product.price).toLocaleString()}</span>
                    <span>Stock: ${product.stock || 0}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p>No products</p>';
        }
    } catch (error) {
        console.error("Failed to load products:", error);
    }
}

// ============================================
// INITIALIZE ON PAGE LOAD
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    loadAllDashboardData();
});

// ============================================
// LOGOUT FUNCTION
// ============================================
function logout() {
    localStorage.removeItem('adminToken');
    window.location.href = '/login.html';
}

console.log('Admin dashboard loaded successfully!');
