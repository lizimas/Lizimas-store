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
            if (button.dataset.tab === "handovers") loadVendorHandovers();
            if (button.dataset.tab === "returns") loadVendorReturns();
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

function vendorProductStatusBadge(status) {
    if (status === "pending") return `<span class="status-badge status-pending">Pending Approval</span>`;
    if (status === "rejected") return `<span class="status-badge status-cancelled">Rejected</span>`;
    return `<span class="status-badge status-paid">Approved</span>`;
}

let vendorProductsCache = [];

async function loadVendorProducts() {
    try {
        const products = await vendorAuthorizedFetch("/api/vendors/products");
        vendorProductsCache = products;
        const container = document.getElementById("vendor-products-list");

        if (!products || products.length === 0) {
            container.innerHTML = `<p class="no-data">You haven't listed any products yet.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    ${products.map(p => `
                        <tr>
                            <td data-label="Product">${p.name}</td>
                            <td data-label="Price">UGX ${Number(p.price).toLocaleString()}</td>
                            <td data-label="Stock">${p.stock}</td>
                            <td data-label="Status">${vendorProductStatusBadge(p.status)}</td>
                            <td data-label="Actions">
                                <button onclick="editVendorProduct(${p.id})" style="background:#1a1a2e; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer; margin-right:6px;">Edit</button>
                                <button onclick="deleteVendorProduct(${p.id})" style="background:#DC2626; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Delete</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load vendor products error:", error);
    }
}

function resetVendorProductForm() {
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
    document.getElementById("product-images").value = "";
    document.getElementById("product-authenticity-confirm").checked = false;
    document.getElementById("product-submit-btn").textContent = "Submit for Approval";
    document.getElementById("product-form-status").textContent = "";
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
    document.getElementById("product-description").value = product.description || "";
    document.getElementById("product-price").value = product.price || "";
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
    const category_id = document.getElementById("product-category").value;
    const description = document.getElementById("product-description").value.trim();
    const price = document.getElementById("product-price").value;
    const stock = document.getElementById("product-stock").value;
    const packageSize = document.getElementById("product-package-size").value;
    const warrantyMonths = document.getElementById("product-warranty-months").value.trim();
    const brand = document.getElementById("product-brand").value.trim();
    const gtin = document.getElementById("product-gtin").value.trim();
    const mpn = document.getElementById("product-mpn").value.trim();
    const imageFiles = document.getElementById("product-images").files;
    const statusEl = document.getElementById("product-form-status");
    const submitBtn = document.getElementById("product-submit-btn");

    if (!name || !price || !stock) {
        statusEl.textContent = "Name, price, and stock are required.";
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

// --- Handovers ------------------------------------------------------------

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

async function loadVendorHandovers() {
    try {
        await loadVendorDropoffPointsIfNeeded();
        const orders = await vendorAuthorizedFetch("/api/vendors/orders");
        const relevant = orders.filter(o =>
            ["pending_handover", "handed_over", "rejected"].includes(o.handover_status)
        );
        const container = document.getElementById("vendor-handovers-list");

        if (relevant.length === 0) {
            container.innerHTML = `<p class="no-data">Nothing awaiting handover right now.</p>`;
            return;
        }

        container.innerHTML = `
            <table>
                <thead><tr><th>Product</th><th>Qty</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                    ${relevant.map(o => {
                        if (o.handover_status === "handed_over") {
                            return `
                                <tr>
                                    <td data-label="Product">${o.product_name}</td>
                                    <td data-label="Qty">${o.quantity}</td>
                                    <td data-label="Status"><span class="status-badge status-pending">Awaiting inspection at ${o.dropoff_point_name || "drop-off point"}</span></td>
                                    <td data-label="Action">-</td>
                                </tr>`;
                        }
                        const rejectedNote = o.handover_status === "rejected"
                            ? `<div style="font-size:12px; color:#991B1B; margin-top:4px;">Rejected: ${o.rejection_reason || "no reason given"} - re-prepare and re-submit.</div>`
                            : "";
                        return `
                            <tr>
                                <td data-label="Product">${o.product_name}${rejectedNote}</td>
                                <td data-label="Qty">${o.quantity}</td>
                                <td data-label="Status"><span class="status-badge status-cancelled">${o.handover_status === "rejected" ? "Rejected" : "Needs handover"}</span></td>
                                <td data-label="Action">
                                    <select id="dropoff-select-${o.order_item_id}" style="padding:6px; border:1px solid #ccc; border-radius:6px; margin-right:6px;">
                                        <option value="">Choose drop-off point</option>
                                        ${dropoffPointOptions()}
                                    </select>
                                    <button onclick="markVendorHandedOver(${o.order_item_id})" style="background:#16A34A; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;">Mark Handed Over</button>
                                </td>
                            </tr>`;
                    }).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load handovers error:", error);
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
        loadVendorHandovers();
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

// --- Init -----------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    if (!getVendorToken()) {
        window.location.href = "../vendor-login.html";
        return;
    }
    setupVendorTabs();
    loadVendorStatus();
    loadVendorCategories();
});
