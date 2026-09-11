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

            const parentGroup = button.closest(".vd-nav-group");
            if (parentGroup) parentGroup.classList.add("vd-nav-open");

            if (button.dataset.tab === "overview") { loadVendorStatus(); loadVendorKyc(); loadVendorPremiumDashboard(); }
            if (button.dataset.tab === "products") loadVendorProducts();
            if (button.dataset.tab === "inventory") loadVendorInventory();
            if (button.dataset.tab === "add-product" && staffCategoriesLoaded === false) loadVendorCategories();
            if (button.dataset.tab === "add-product" && !document.getElementById("product-id").value) {
                const blockHost = document.getElementById("desc-blocks-editor");
                if (blockHost && window.LzBlockEditor) {
                    LzBlockEditor.mount(blockHost, null, { tokenKey: "vendorToken", apiBase: "/api/vendors/products" });
                }
            }
            if (button.dataset.tab === "orders") loadVendorOrders();
            if (button.dataset.tab === "returns") loadVendorReturns();
            if (button.dataset.tab === "refunds") loadVendorReturnsRefunds();
            if (button.dataset.tab === "wallet") loadVendorWallet();
            if (button.dataset.tab === "reviews") loadVendorReviews();
            if (button.dataset.tab === "promotions") loadVendorPromotionsTab();
            if (button.dataset.tab === "account") { loadVendorComplianceNotices(); vdLoadJumia(); }
            if (button.dataset.tab === "reports") loadVendorReports();
            if (button.dataset.tab === "storefront") loadVendorStorefront();
            if (button.dataset.tab === "messages") loadVendorMessages();
        });
    });
}

// Sidebar accordion groups (Products/Orders/Marketing/Analytics/Payments) -
// collapsed by default, matching the reference layout's chevron affordance;
// opens automatically when one of its own tabs becomes active (see the
// click handler above).
function toggleVdNavGroup(key) {
    const group = document.querySelector(`.vd-nav-group[data-group="${key}"]`);
    if (!group) return;
    group.classList.toggle("vd-nav-open");
}

// The bottom vendor profile card's Settings/Profile/Logout/feedback menu -
// same expand-in-place pattern as the sidebar's accordion groups, but not
// itself a .vd-nav-group (it lives below the tab list, not among the tabs).
function toggleVdProfileMenu() {
    const menu = document.getElementById("vd-sidebar-profile-menu");
    const chevron = document.getElementById("vd-sidebar-profile-chevron");
    if (!menu) return;
    menu.classList.toggle("vd-nav-open");
    if (chevron) chevron.classList.toggle("vd-nav-open");
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

        const welcomeHeading = document.getElementById("vd-welcome-heading");
        if (welcomeHeading) welcomeHeading.textContent = v.business_name ? `Welcome back, ${v.business_name}!` : "Welcome back!";
        const avatarName = document.getElementById("vd-avatar-name");
        const avatarInitial = document.getElementById("vd-avatar-initial");
        if (avatarName) avatarName.textContent = v.business_name || "Vendor";
        if (avatarInitial) avatarInitial.textContent = (v.business_name || "V").trim().charAt(0).toUpperCase();

        const banner = document.getElementById("vendor-status-banner");
        const s = vendorStatusLabel(v.status);

        const sidebarProfileName = document.getElementById("vd-sidebar-profile-name");
        const sidebarProfileBadge = document.getElementById("vd-sidebar-profile-badge");
        const sidebarStorefrontLink = document.getElementById("vd-sidebar-view-storefront");
        if (sidebarProfileName) sidebarProfileName.textContent = v.business_name || "Your Store";
        if (sidebarProfileBadge) {
            sidebarProfileBadge.textContent = v.status === "approved" ? "Verified Vendor" : s.text;
            sidebarProfileBadge.style.background = s.bg;
            sidebarProfileBadge.style.color = s.color;
        }
        if (sidebarStorefrontLink) {
            if (v.slug) {
                sidebarStorefrontLink.href = `/store/${encodeURIComponent(v.slug)}`;
            } else {
                sidebarStorefrontLink.style.display = "none";
            }
        }

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

        document.getElementById("vendor-profile-details").innerHTML = `
            <table>
                <tbody>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Shop Name</td><td>${v.business_name || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Account Type</td><td>${v.account_type === "company" ? "Company" : v.account_type === "individual" ? "Individual" : "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Phone</td><td>${v.phone || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Location</td><td>${v.physical_address || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">MoMo Payout Number</td><td>${v.momo_number || "-"}</td></tr>
                    <tr><td style="font-weight:600; padding:6px 12px 6px 0;">Applied</td><td>${v.submitted_at ? new Date(v.submitted_at).toLocaleDateString() : "-"}</td></tr>
                </tbody>
            </table>
        `;

        document.getElementById("vendor-momo-input").value = v.momo_number || "";
    } catch (error) {
        console.error("Load vendor status error:", error);
    }
}

async function saveVendorMomoNumber() {
    const statusEl = document.getElementById("vendor-momo-status");
    const momo_number = document.getElementById("vendor-momo-input").value.trim();

    statusEl.style.color = "#555";
    statusEl.textContent = "Saving...";

    try {
        await vendorAuthorizedFetch("/api/vendors/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ momo_number: momo_number || null })
        });
        statusEl.style.color = "#067647";
        statusEl.textContent = "Saved.";
    } catch (error) {
        console.error("Save vendor momo number error:", error);
        statusEl.style.color = "#DC2626";
        statusEl.textContent = "Could not save. Please try again.";
    }
}

// --- Vendor KYC & Compliance Profile (Ryan, Sept 2026) ----------------------
// Identity/business-registration verification - separate from the plain
// business profile above. See server/utils/vendorKyc.js for the status
// values and server/controllers/vendorKycController.js for the API.

const VENDOR_KYC_BADGE = {
    not_started:     { cls: "status-forfeited",  label: "Not started" },
    submitted:        { cls: "status-new",        label: "Submitted - awaiting review" },
    under_review:     { cls: "status-processing", label: "Under review" },
    action_required:  { cls: "status-pending",    label: "Action required" },
    verified:         { cls: "status-paid",       label: "Verified" },
    rejected:         { cls: "status-cancelled",  label: "Rejected" },
    suspended:        { cls: "status-cancelled",  label: "Suspended" }
};

async function loadVendorKyc() {
    try {
        const k = await vendorAuthorizedFetch("/api/vendors/me/kyc");

        const badge = document.getElementById("vendor-kyc-status-badge");
        const info = VENDOR_KYC_BADGE[k.kyc_status] || VENDOR_KYC_BADGE.not_started;
        badge.className = "status-badge " + info.cls;
        badge.textContent = info.label;

        const noteEl = document.getElementById("vendor-kyc-review-note");
        if (k.review_note && (k.kyc_status === "action_required" || k.kyc_status === "rejected")) {
            noteEl.textContent = (k.kyc_status === "rejected" ? "Rejected: " : "Action needed: ") + k.review_note;
            noteEl.classList.remove("hidden");
        } else {
            noteEl.classList.add("hidden");
        }

        const formEl = document.getElementById("vendor-kyc-form");
        const lockedEl = document.getElementById("vendor-kyc-locked-view");

        if (k.editable) {
            formEl.classList.remove("hidden");
            lockedEl.classList.add("hidden");
            const needsRegNum = k.account_type === "company";
            const needsNatId = k.account_type === "individual";
            document.getElementById("vendor-kyc-regnum-group").classList.toggle("hidden", !needsRegNum);
            document.getElementById("vendor-kyc-natid-group").classList.toggle("hidden", !needsNatId);
            document.getElementById("vendor-kyc-regnum").value = k.registration_number || "";
            document.getElementById("vendor-kyc-natid").value = k.national_id_number || "";
        } else {
            formEl.classList.add("hidden");
            lockedEl.classList.remove("hidden");
            const lockedText = document.getElementById("vendor-kyc-locked-text");
            if (k.kyc_status === "verified") {
                lockedText.textContent = "Your identity/business registration is verified. Contact support if anything needs to change.";
            } else {
                lockedText.textContent = "Your information is with Lizimas Store for review - we'll let you know once it's checked.";
            }
        }
    } catch (error) {
        console.error("Load vendor KYC error:", error);
    }
}

async function submitVendorKyc() {
    const statusEl = document.getElementById("vendor-kyc-status-msg");
    const body = {};

    if (vendorAccountType === "company") {
        const registration_number = document.getElementById("vendor-kyc-regnum").value.trim();
        if (!registration_number) {
            statusEl.textContent = "Please enter your URSB registration number.";
            return;
        }
        body.registration_number = registration_number;
    } else if (vendorAccountType === "individual") {
        const national_id_number = document.getElementById("vendor-kyc-natid").value.trim();
        if (!national_id_number) {
            statusEl.textContent = "Please enter your national ID number.";
            return;
        }
        body.national_id_number = national_id_number;
    }

    statusEl.style.color = "#DC2626";
    statusEl.textContent = "Submitting...";

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/kyc", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (data.error) {
            statusEl.style.color = "#DC2626";
            statusEl.textContent = data.error;
            return;
        }
        statusEl.style.color = "#067647";
        statusEl.textContent = "Submitted for review.";
        loadVendorKyc();
    } catch (error) {
        console.error("Submit vendor KYC error:", error);
        statusEl.style.color = "#DC2626";
        statusEl.textContent = "Could not submit. Please try again.";
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
let vendorProductsSearchTerm = "";

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

// Bulk action flow: confirm -> run -> results breakdown, matching the
// Jumia Vendor Center pattern Ryan referenced (a confirmation step before
// the action runs, then a successful/failed/skipped count with reasons
// and a downloadable error report) rather than a bare browser confirm().
let vendorBulkPendingAction = null;
let vendorLastBulkResults = null;

const VD_BULK_ACTION_VERB = { activate: "activate", deactivate: "deactivate", delete: "delete" };
const VD_BULK_ACTION_WARNING = {
    activate: "Activated products become visible on the storefront immediately (subject to admin approval).",
    deactivate: "Deactivated products are pulled off the storefront but are not deleted - you can reactivate them later.",
    delete: "Deleted products are removed from your active catalogue. Products with existing orders are archived, not permanently erased."
};

function bulkVendorProductAction(action) {
    if (vendorProductsSelected.size === 0) return;
    vendorBulkPendingAction = action;
    const verb = VD_BULK_ACTION_VERB[action];
    const count = vendorProductsSelected.size;
    document.getElementById("vd-bulk-confirm-text").innerHTML =
        `You selected <strong>${count}</strong> product${count === 1 ? "" : "s"}.<br>Action: <strong>${verb.charAt(0).toUpperCase()}${verb.slice(1)}</strong><br><br>${VD_BULK_ACTION_WARNING[action] || ""}`;
    const confirmBtn = document.getElementById("vd-bulk-confirm-btn");
    confirmBtn.textContent = action === "delete" ? "Delete Products" : `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
    confirmBtn.style.background = action === "delete" ? "#DC2626" : "#1a1a2e";
    document.getElementById("vd-bulk-confirm-overlay").hidden = false;
}

function closeVdBulkConfirm() {
    document.getElementById("vd-bulk-confirm-overlay").hidden = true;
    vendorBulkPendingAction = null;
}

async function confirmVdBulkAction() {
    const action = vendorBulkPendingAction;
    if (!action) return;
    const confirmBtn = document.getElementById("vd-bulk-confirm-btn");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Working...";

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/products/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productIds: Array.from(vendorProductsSelected), action })
        });
        closeVdBulkConfirm();
        confirmBtn.disabled = false;

        if (data.error) {
            alert(data.error);
            return;
        }

        vendorLastBulkResults = { action, ...data };
        renderVdBulkResults(data, action);
        vendorProductsSelected.clear();
        updateVendorProductsBulkBar();
        loadVendorProducts();
    } catch (error) {
        console.error("Bulk product action error:", error);
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm";
        alert("Could not connect to server.");
    }
}

function renderVdBulkResults(data, action) {
    const summary = data.summary || {
        total: (data.successful || []).length + (data.failed || []).length + (data.skipped || []).length,
        successCount: (data.successful || []).length,
        failedCount: (data.failed || []).length,
        skippedCount: (data.skipped || []).length
    };

    document.getElementById("vd-bulk-results-summary").innerHTML = `
        <div><div style="font-size:20px; font-weight:700; color:#166534;">${summary.successCount}</div><div style="color:#666;">Successful</div></div>
        <div><div style="font-size:20px; font-weight:700; color:#DC2626;">${summary.failedCount}</div><div style="color:#666;">Failed</div></div>
        <div><div style="font-size:20px; font-weight:700; color:#B45309;">${summary.skippedCount}</div><div style="color:#666;">Skipped</div></div>
        <div><div style="font-size:20px; font-weight:700; color:#1a1a2e;">${summary.total}</div><div style="color:#666;">Total</div></div>
    `;

    const sections = [];
    if ((data.failed || []).length > 0) {
        sections.push(`
            <div style="margin-bottom:14px;">
                <div style="font-weight:700; font-size:12.5px; color:#DC2626; margin-bottom:6px;">Failed</div>
                ${data.failed.map(f => `<div style="font-size:12.5px; padding:5px 0; border-bottom:1px solid #f3f3f3;">${vendorEsc(f.name || `Product #${f.id}`)} - <span style="color:#666;">${vendorEsc(f.reason)}</span></div>`).join("")}
            </div>
        `);
    }
    if ((data.skipped || []).length > 0) {
        sections.push(`
            <div>
                <div style="font-weight:700; font-size:12.5px; color:#B45309; margin-bottom:6px;">Skipped</div>
                ${data.skipped.map(s => `<div style="font-size:12.5px; padding:5px 0; border-bottom:1px solid #f3f3f3;">${vendorEsc(s.name || `Product #${s.id}`)} - <span style="color:#666;">${vendorEsc(s.reason)}</span></div>`).join("")}
            </div>
        `);
    }
    document.getElementById("vd-bulk-results-detail").innerHTML = sections.join("") ||
        `<p style="font-size:13px; color:#666;">All selected products were ${action}d successfully.</p>`;

    const downloadBtn = document.getElementById("vd-bulk-download-report-btn");
    downloadBtn.hidden = (data.failed || []).length === 0 && (data.skipped || []).length === 0;

    document.getElementById("vd-bulk-results-overlay").hidden = false;
}

function closeVdBulkResults() {
    document.getElementById("vd-bulk-results-overlay").hidden = true;
}

function downloadVdBulkErrorReport() {
    if (!vendorLastBulkResults) return;
    const rows = [["Product ID", "Product Name", "Outcome", "Reason"]];
    (vendorLastBulkResults.successful || []).forEach(r => rows.push([r.id, r.name || "", "Successful", ""]));
    (vendorLastBulkResults.failed || []).forEach(r => rows.push([r.id, r.name || "", "Failed", r.reason || ""]));
    (vendorLastBulkResults.skipped || []).forEach(r => rows.push([r.id, r.name || "", "Skipped", r.reason || ""]));

    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-${vendorLastBulkResults.action}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

    let rows = vendorProductsFilter === "all"
        ? vendorProductsCache
        : vendorProductsCache.filter(p => vendorProductFilterKey(p) === vendorProductsFilter);

    if (vendorProductsSearchTerm) {
        rows = rows.filter(p =>
            (p.name || "").toLowerCase().includes(vendorProductsSearchTerm) ||
            (p.sku || "").toLowerCase().includes(vendorProductsSearchTerm)
        );
    }

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
                        <td data-label="Status">${vendorProductStatusBadge(p)}${p.status === "rejected" && p.rejection_reason ? `<div style="font-size:11px; color:#991B1B; margin-top:4px;">${p.rejection_reason}</div>` : ""}</td>
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

// Topbar search box (premium desktop dashboard) - filters the Products tab
// by name/SKU rather than hitting a separate endpoint, since the full
// product list is already fetched for that tab.
function vdSearchProducts() {
    const input = document.getElementById("vd-product-search-input");
    vendorProductsSearchTerm = input ? input.value.trim().toLowerCase() : "";
    const productsBtn = document.querySelector('.tab-btn[data-tab="products"]');
    if (productsBtn) productsBtn.click();
    else renderVendorProductsTable();
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
    const specsList = document.getElementById("specs-list");
    if (specsList) specsList.innerHTML = "";
    const specsPasteBox = document.getElementById("vendor-specs-paste-box");
    if (specsPasteBox) specsPasteBox.value = "";
    hideVendorVariantsPanel();
    const blockHost = document.getElementById("desc-blocks-editor");
    if (blockHost && window.LzBlockEditor) {
        LzBlockEditor.mount(blockHost, null, { tokenKey: "vendorToken", apiBase: "/api/vendors/products" });
    }
}

// --- Specifications (Task: same key-value spec structure staff/admin use,
// so vendor listings render specs consistently with staff-added ones on the
// storefront) - specs are saved via the shared saveProductOptions endpoint
// but ONLY that field: this call omits sizes/colors entirely so it never
// touches the vendor's separate Variants panel, and vice versa (see the
// productController.js comment on saveProductOptions). ------------------

let vendorSpecRowCounter = 0;

function addVendorSpecRow(label, value) {
    const list = document.getElementById("specs-list");
    if (!list) return;
    const rowId = `vendor-spec-row-${vendorSpecRowCounter++}`;
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

function collectVendorSpecRows() {
    const rows = document.querySelectorAll("#specs-list > div");
    const specs = [];
    rows.forEach(row => {
        const label = row.querySelector(".spec-label-input").value.trim();
        const value = row.querySelector(".spec-value-input").value.trim();
        if (label) specs.push({ label, value });
    });
    return specs;
}

// Splits one pasted line into a label/value pair. Excel copy/paste of two
// adjacent columns produces tab-separated text, so that's tried first;
// falls back to 2+ spaces (a plain-text table) or a colon (someone typing
// "Material: Cotton" by hand) so the paste box is forgiving either way.
//
// Last resort: some sources (copying straight out of a rendered spec table,
// rather than an actual spreadsheet) lose the separator entirely - "Os" and
// "iOS" arrive glued together as "OsiOS" with nothing between them. There's
// no way to split that back apart in general (the boundary information is
// gone), so this only recovers it for a curated list of common spec labels:
// if the line starts with one of them, that's treated as the label and
// whatever follows is the value. It never overrides a real tab/space/colon
// match above, so it can't make a well-formed paste worse - it only helps
// the no-separator case, and only for labels on the list.
const VENDOR_KNOWN_SPEC_LABELS = [
    "Model Year", "Model Number", "Model", "Os Version", "Operating System", "Os",
    "Screen Size", "Display Type", "Display", "Refresh Rate", "Resolution",
    "Internal Storage", "Storage Capacity", "Storage", "Memory", "Ram",
    "Camera Resolution", "Camera", "Battery Life", "Battery Capacity", "Battery",
    "Product Type", "Type", "Brand", "Processor", "Chipset", "Graphics",
    "Color", "Colour", "Sim", "Usb", "Wifi", "Wi-Fi", "Ports", "Port",
    "Connectivity", "Network", "Weight", "Net Weight", "Item Weight", "Package Weight",
    "Dimensions", "Size", "Sizes", "Fit", "Material", "Fabric", "Sleeve Length", "Sleeve",
    "Closure", "Pattern", "Style", "Gender", "Age Group", "Origin", "Country Of Origin",
    "Warranty", "Power", "Voltage", "Wattage", "Capacity", "Volume", "Quantity",
    "Flavor", "Flavour", "Ingredients", "Allergen Info", "Care Instructions",
    "Waterproof", "Water Resistance", "Shelf Life", "Expiry Date"
].sort((a, b) => b.length - a.length);

function vendorMatchKnownSpecLabel(line) {
    const lower = line.toLowerCase();
    for (const candidate of VENDOR_KNOWN_SPEC_LABELS) {
        if (lower.startsWith(candidate.toLowerCase())) {
            const value = line.slice(candidate.length).trim();
            if (value) return { label: line.slice(0, candidate.length).trim(), value };
        }
    }
    return null;
}

function vendorParseSpecLine(line) {
    if (line.includes("\t")) {
        const [label, ...rest] = line.split("\t");
        return { label: label.trim(), value: rest.join(" ").trim() };
    }
    const spaceSplit = line.match(/^(.+?)\s{2,}(.+)$/);
    if (spaceSplit) {
        return { label: spaceSplit[1].trim(), value: spaceSplit[2].trim() };
    }
    const colonSplit = line.match(/^([^:]+):\s*(.+)$/);
    if (colonSplit) {
        return { label: colonSplit[1].trim(), value: colonSplit[2].trim() };
    }
    const knownLabelMatch = vendorMatchKnownSpecLabel(line);
    if (knownLabelMatch) return knownLabelMatch;
    return { label: line.trim(), value: "" };
}

function parseAndAddVendorSpecs() {
    const box = document.getElementById("vendor-specs-paste-box");
    if (!box || !box.value.trim()) return;
    const lines = box.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach(line => {
        const { label, value } = vendorParseSpecLine(line);
        if (label) addVendorSpecRow(label, value);
    });
    box.value = "";
}
// --- Direct paste into the spec boxes themselves (Ryan: typing a single
// spec should keep working exactly as before, but pasting a multi-line
// block straight into a Label or Value box - not just via the separate
// "Paste from Excel" staging box above - should fan out across rows,
// spreadsheet-style, adding new rows as needed). Mirrors admin.js's
// adminDistributeSpecPaste - kept as its own copy, same reason as the
// rest of this parser (separate pages, no shared bundle). ---

function vendorDistributeSpecPaste(startRowIndex, startCol, text) {
    const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return;

    function ensureRow(idx) {
        let rows = document.querySelectorAll("#specs-list > div");
        while (rows.length <= idx) {
            addVendorSpecRow();
            rows = document.querySelectorAll("#specs-list > div");
        }
        return rows[idx];
    }

    function setCell(idx, col, val) {
        const row = ensureRow(idx);
        const input = row.querySelector(col === "label" ? ".spec-label-input" : ".spec-value-input");
        if (input) input.value = val;
    }

    // Every line has a tab - a normal two-column Excel copy. One full
    // label+value pair per line, regardless of which box was pasted into.
    if (rawLines.every(l => l.includes("\t"))) {
        rawLines.forEach((line, i) => {
            const [label, ...rest] = line.split("\t");
            setCell(startRowIndex + i, "label", label.trim());
            setCell(startRowIndex + i, "value", rest.join(" ").trim());
        });
        return;
    }

    // Every line independently parses via a colon or 2+ spaces - one pair
    // per line, same rule the "Paste from Excel" box above already uses.
    if (rawLines.every(l => /:|  +/.test(l))) {
        rawLines.forEach((line, i) => {
            const { label, value } = vendorParseSpecLine(line);
            setCell(startRowIndex + i, "label", label);
            setCell(startRowIndex + i, "value", value);
        });
        return;
    }

    // Flat list with no reliable per-line separator - e.g. a spec table
    // copied from a web page where each cell lands on its own line rather
    // than tab-joined with its neighbour. Pair consecutive lines alternately
    // as label/value, starting at whichever column was actually pasted into.
    let row = startRowIndex;
    let col = startCol;
    rawLines.forEach((line) => {
        setCell(row, col, line);
        if (col === "label") {
            col = "value";
        } else {
            col = "label";
            row += 1;
        }
    });
}

function setupVendorSpecsPasteHandler() {
    const list = document.getElementById("specs-list");
    if (!list || list.dataset.pasteHandlerAttached) return;
    list.dataset.pasteHandlerAttached = "1";
    list.addEventListener("paste", (e) => {
        const target = e.target;
        if (!target || !target.classList) return;
        let col = null;
        if (target.classList.contains("spec-label-input")) col = "label";
        else if (target.classList.contains("spec-value-input")) col = "value";
        if (!col) return;

        const text = (e.clipboardData || window.clipboardData).getData("text");
        if (!text) return;
        // A single value with no tab and no newline is a normal single-box
        // paste - let the browser handle it so typing or pasting one spec
        // at a time keeps working exactly as before.
        if (!/\t/.test(text) && !/\r?\n/.test(text.trim())) return;

        e.preventDefault();
        const rows = Array.from(document.querySelectorAll("#specs-list > div"));
        const row = target.closest("#specs-list > div");
        const rowIndex = Math.max(0, rows.indexOf(row));
        vendorDistributeSpecPaste(rowIndex, col, text);
    });
}

document.addEventListener("DOMContentLoaded", setupVendorSpecsPasteHandler);


async function loadVendorProductSpecs(productId) {
    const list = document.getElementById("specs-list");
    if (list) list.innerHTML = "";
    vendorSpecRowCounter = 0;
    try {
        const data = await vendorAuthorizedFetch(`/api/products/${productId}/options`);
        (data.specs || []).forEach(sp => addVendorSpecRow(sp.label, sp.value));
    } catch (error) {
        console.error("Load vendor product specs error:", error);
    }
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
    loadVendorProductSpecs(product.id);
    const blockHost = document.getElementById("desc-blocks-editor");
    if (blockHost && window.LzBlockEditor) {
        LzBlockEditor.mount(blockHost, product.id, { tokenKey: "vendorToken", apiBase: "/api/vendors/products" });
    }
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

        const savedProductId = data.product ? data.product.id : id;
        const specsPayload = collectVendorSpecRows();
        if (savedProductId && specsPayload.length > 0) {
            try {
                await vendorAuthorizedFetch(`/api/vendors/products/${savedProductId}/options`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ specs: specsPayload })
                });
            } catch (optionsError) {
                console.error("Save vendor product specs error:", optionsError);
            }
        }

        // Rich content blocks: on create the editor mounts without an id, so
        // flush against the id the server just returned - same pattern
        // admin.js uses. A failure here must not lose the product save.
        if (savedProductId && window.LzBlockEditor) {
            const blockRes = await LzBlockEditor.save(savedProductId);
            if (!blockRes.ok) {
                statusEl.textContent = "Product saved, but rich content failed: " + blockRes.message;
                loadVendorProducts();
                return;
            }
        }

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


// --- Inventory (premium desktop dashboard) --------------------------------
// Client-side view over the vendor's own product list - no new backend
// endpoint needed, since /api/vendors/products already returns stock and
// active/status for every product.

let vendorInventoryFilter = "low";

function setVendorInventoryFilter(key) {
    vendorInventoryFilter = key;
    document.querySelectorAll("#vendor-inventory-filters .vd-inv-filter-btn").forEach(btn => {
        const active = btn.dataset.invFilter === key;
        btn.classList.toggle("active", active);
        btn.style.background = active ? "#1a1a2e" : "#fff";
        btn.style.color = active ? "#fff" : "#333";
        btn.style.borderColor = active ? "#1a1a2e" : "#ddd";
    });
    renderVendorInventoryList();
}

async function loadVendorInventory() {
    try {
        if (!vendorProductsCache || vendorProductsCache.length === 0) {
            vendorProductsCache = await vendorAuthorizedFetch("/api/vendors/products");
        }
        renderVendorInventoryList();
    } catch (error) {
        console.error("Load vendor inventory error:", error);
    }
}

function renderVendorInventoryList() {
    const totalEl = document.getElementById("vd-inv-total");
    const inStockEl = document.getElementById("vd-inv-in-stock");
    const lowStockEl = document.getElementById("vd-inv-low-stock");
    const outStockEl = document.getElementById("vd-inv-out-stock");
    const listEl = document.getElementById("vendor-inventory-list");
    if (!listEl) return;

    const products = vendorProductsCache || [];
    const lowStock = products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 5);
    const outOfStock = products.filter(p => Number(p.stock) <= 0);
    const inStock = products.filter(p => Number(p.stock) > 5);

    if (totalEl) totalEl.textContent = products.length;
    if (inStockEl) inStockEl.textContent = inStock.length;
    if (lowStockEl) lowStockEl.textContent = lowStock.length;
    if (outStockEl) outStockEl.textContent = outOfStock.length;

    const rows = vendorInventoryFilter === "all" ? products : [...outOfStock, ...lowStock];

    if (rows.length === 0) {
        listEl.innerHTML = vendorInventoryFilter === "all"
            ? `<p class="no-data">You haven't listed any products yet.</p>`
            : `<p class="no-data">Nothing low or out of stock right now.</p>`;
        return;
    }

    listEl.innerHTML = `
        <table>
            <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Status</th></tr></thead>
            <tbody>
                ${rows.map(p => {
                    const stock = Number(p.stock);
                    const stockColor = stock <= 0 ? "#DC2626" : stock <= 5 ? "#B45309" : "#166534";
                    const stockLabel = stock <= 0 ? "Out of stock" : stock <= 5 ? "Low stock" : "In stock";
                    return `
                        <tr>
                            <td data-label="Product">${vendorEsc(p.name)}</td>
                            <td data-label="SKU">${p.sku ? vendorEsc(p.sku) : "—"}</td>
                            <td data-label="Stock"><span style="font-weight:700; color:${stockColor};">${p.stock}</span></td>
                            <td data-label="Status"><span style="color:${stockColor};">${stockLabel}</span></td>
                        </tr>`;
                }).join("")}
            </tbody>
        </table>
    `;
}


// --- Premium Dashboard Home (Sales Overview / Recent Orders / Top Products /
// Quick Actions / Notifications) -------------------------------------------
// Reuses the same data already fetched for the Reports tab (/api/vendors/reports),
// Orders tab (/api/vendors/orders) and the notification panel
// (/api/vendors/notifications) rather than adding new endpoints.

let vendorDashboardChart = null;

function renderVendorDashboardChart(dailySales) {
    const canvas = document.getElementById("vd-sales-overview-chart");
    if (!canvas || typeof Chart === "undefined") return;
    const labels = dailySales.map(d => d.day);
    const datasets = [
        { label: "Sales (UGX)", data: dailySales.map(d => d.sales), borderColor: "#1a1a2e", backgroundColor: "rgba(26,26,46,0.08)", tension: 0.3, fill: true, yAxisID: "y" },
        { label: "Orders", data: dailySales.map(d => d.orders), borderColor: "#f4b400", backgroundColor: "rgba(244,180,0,0.12)", tension: 0.3, fill: true, yAxisID: "y1" }
    ];
    if (vendorDashboardChart) {
        vendorDashboardChart.data.labels = labels;
        vendorDashboardChart.data.datasets = datasets;
        vendorDashboardChart.update();
        return;
    }
    vendorDashboardChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            scales: {
                y: { beginAtZero: true, position: "left" },
                y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } }
            }
        }
    });
}

async function loadVendorDashboardStats() {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/dashboard-summary");
        if (data.error) return;
        const ordersToday = document.getElementById("vd-stat-orders-today");
        const pendingHandover = document.getElementById("vd-stat-pending-handover");
        const totalProducts = document.getElementById("vd-stat-total-products");
        if (ordersToday) ordersToday.textContent = data.orders.today;
        if (pendingHandover) pendingHandover.textContent = data.orders.pendingHandover;
        if (totalProducts) totalProducts.textContent = data.products.total;

        const sidebarOrdersBadge = document.getElementById("vd-sidebar-orders-badge");
        if (sidebarOrdersBadge) {
            const needsAttention = (data.orders.pendingHandover || 0) + (data.orders.awaitingDelivery || 0);
            if (needsAttention > 0) {
                sidebarOrdersBadge.textContent = needsAttention > 99 ? "99+" : String(needsAttention);
                sidebarOrdersBadge.hidden = false;
            } else {
                sidebarOrdersBadge.hidden = true;
            }
        }
    } catch (error) {
        console.error("Load vendor dashboard stats error:", error);
    }
}

// Store Rating stat card - a real average across the vendor's own product
// reviews (same /api/vendors/reviews rows the Reviews tab lists), not a
// stand-in metric. Shown as a number, a row of filled/empty stars, and the
// review count, matching the reference screenshot.
async function loadVendorDashboardRating() {
    const valueEl = document.getElementById("vd-stat-store-rating");
    const starsEl = document.getElementById("vd-stat-rating-stars");
    if (!valueEl && !starsEl) return;
    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/reviews");
        if (!Array.isArray(rows) || rows.length === 0) {
            if (valueEl) valueEl.textContent = "-";
            if (starsEl) starsEl.textContent = "No reviews yet";
            return;
        }
        const total = rows.reduce((sum, r) => sum + Number(r.rating || 0), 0);
        const average = total / rows.length;
        if (valueEl) valueEl.textContent = average.toFixed(1);
        if (starsEl) {
            const filled = Math.round(average);
            const stars = "\u2605".repeat(Math.max(0, Math.min(5, filled))) + "\u2606".repeat(Math.max(0, 5 - filled));
            starsEl.textContent = `${stars} (${rows.length} review${rows.length === 1 ? "" : "s"})`;
        }
    } catch (error) {
        console.error("Load vendor dashboard rating error:", error);
    }
}

async function loadVendorDashboardOrdersAndProducts() {
    const ordersBox = document.getElementById("vd-recent-orders-list");
    const topProductsBox = document.getElementById("vd-top-products-list");

    try {
        const orders = await vendorAuthorizedFetch("/api/vendors/orders");
        if (ordersBox && Array.isArray(orders)) {
            const recent = [...orders]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);
            ordersBox.innerHTML = recent.length === 0
                ? `<p class="no-data">No orders yet.</p>`
                : `<table>
                    <thead><tr><th>Product</th><th>Qty</th><th>Status</th></tr></thead>
                    <tbody>
                        ${recent.map(o => `
                            <tr>
                                <td data-label="Product">${vendorEsc(o.product_name)}</td>
                                <td data-label="Qty">${o.quantity}</td>
                                <td data-label="Status"><span class="status-badge ${VENDOR_STAGE_BADGE_CLASS[o.stage] || "status-pending"}">${vendorEsc(o.stageLabel)}</span></td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>`;
        }
    } catch (error) {
        console.error("Load recent orders error:", error);
    }

    try {
        const reportsData = await vendorAuthorizedFetch("/api/vendors/reports");
        if (reportsData.error) return;
        renderVendorDashboardChart(reportsData.dailySales);
        if (topProductsBox) {
            topProductsBox.innerHTML = reportsData.topProducts.length === 0
                ? `<p class="no-data">No sales in the last 30 days.</p>`
                : reportsData.topProducts.slice(0, 5).map(p => `
                    <div class="vd-notif-row" style="justify-content:space-between;">
                        <span>${vendorEsc(p.name)}</span>
                        <span style="color:#6b7280;">${p.unitsSold} sold &middot; ${vendorFmtUgx(p.revenue)}</span>
                    </div>
                `).join("");
        }
    } catch (error) {
        console.error("Load dashboard reports error:", error);
    }
}

async function loadVendorDashboardNotifPreview() {
    const box = document.getElementById("vd-dashboard-notif-list");
    if (!box) return;
    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/notifications");
        if (rows.error) {
            box.innerHTML = `<p class="no-data">${vendorEsc(rows.error)}</p>`;
            return;
        }
        if (rows.length === 0) {
            box.innerHTML = `<p class="no-data">No notifications yet.</p>`;
            return;
        }
        box.innerHTML = rows.slice(0, 4).map(n => `
            <div class="vd-notif-row" style="cursor:pointer; ${n.read_at ? "opacity:0.55;" : ""}" onclick="openVendorNotification(${n.id}, '${n.link_tab || ""}')">
                <div>
                    <div style="font-weight:600;">${vendorEsc(n.title)}</div>
                    <div style="color:#6b7280;">${vendorEsc(n.message)}</div>
                </div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load dashboard notif preview error:", error);
        box.innerHTML = `<p class="no-data">Could not connect to server.</p>`;
    }
}

function loadVendorPremiumDashboard() {
    loadVendorDashboardStats();
    loadVendorDashboardRating();
    loadVendorDashboardOrdersAndProducts();
    loadVendorDashboardNotifPreview();
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

// --- Promotions (Task #64) ------------------------------------------------
// Propose a time-boxed sale price on one of the vendor's own products.
// Lizimas reviews every promotion before it affects anything a customer
// sees or pays.

const VENDOR_PROMO_STATUS_LABEL = {
    pending: "Awaiting review",
    rejected: "Rejected",
    scheduled: "Scheduled",
    active: "Live",
    expired: "Ended"
};
const VENDOR_PROMO_STATUS_CLASS = {
    pending: "status-pending",
    rejected: "status-cancelled",
    scheduled: "status-processing",
    active: "status-paid",
    expired: "status-forfeited"
};

async function loadVendorPromotionsTab() {
    await Promise.all([populateVendorPromoProductSelect(), loadVendorPromotionsList()]);
}

async function populateVendorPromoProductSelect() {
    const select = document.getElementById("vendor-promo-product");
    if (!select) return;
    try {
        const products = await vendorAuthorizedFetch("/api/vendors/products");
        if (products.error) return;
        const eligible = products.filter(p => p.status === "approved" && !p.admin_restricted);
        select.innerHTML = eligible.length === 0
            ? `<option value="">No eligible products</option>`
            : eligible.map(p => `<option value="${p.id}" data-price="${p.price}">${vendorEsc(p.name)} (UGX ${Number(p.price).toLocaleString()})</option>`).join("");
    } catch (error) {
        console.error("Load vendor promo product select error:", error);
    }
}

async function submitVendorPromotion() {
    const productId = document.getElementById("vendor-promo-product").value;
    const salePrice = Number(document.getElementById("vendor-promo-price").value);
    const startsAt = document.getElementById("vendor-promo-starts").value;
    const endsAt = document.getElementById("vendor-promo-ends").value;
    const statusEl = document.getElementById("vendor-promo-status");

    if (!productId) {
        statusEl.textContent = "Choose a product first.";
        return;
    }
    if (!salePrice || salePrice <= 0) {
        statusEl.textContent = "Enter a sale price.";
        return;
    }
    if (!startsAt || !endsAt) {
        statusEl.textContent = "Choose a start and end time.";
        return;
    }

    statusEl.textContent = "Submitting...";
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/promotions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                product_id: Number(productId),
                proposed_sale_price: salePrice,
                starts_at: new Date(startsAt).toISOString(),
                ends_at: new Date(endsAt).toISOString()
            })
        });
        if (data.error) {
            statusEl.textContent = data.error;
            return;
        }
        statusEl.textContent = "Submitted for review.";
        document.getElementById("vendor-promo-price").value = "";
        document.getElementById("vendor-promo-starts").value = "";
        document.getElementById("vendor-promo-ends").value = "";
        await loadVendorPromotionsList();
    } catch (error) {
        console.error("Submit vendor promotion error:", error);
        statusEl.textContent = "Could not connect to server.";
    }
}

async function loadVendorPromotionsList() {
    const box = document.getElementById("vendor-promotions-list");
    if (!box) return;

    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/promotions");
        if (rows.error) {
            box.innerHTML = `<p>${vendorEsc(rows.error)}</p>`;
            return;
        }
        if (rows.length === 0) {
            box.innerHTML = `<p class="no-data">No promotions proposed yet.</p>`;
            return;
        }

        box.innerHTML = `
            <table style="width:100%;">
                <thead><tr><th>Product</th><th>Price</th><th>Window</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td data-label="Product">${vendorEsc(r.product_name)}</td>
                            <td data-label="Price"><s style="color:#888;">${vendorFmtUgx(r.original_price)}</s> ${vendorFmtUgx(r.proposed_sale_price)}</td>
                            <td data-label="Window">${new Date(r.starts_at).toLocaleDateString()} - ${new Date(r.ends_at).toLocaleDateString()}</td>
                            <td data-label="Status">
                                <span class="status-badge ${VENDOR_PROMO_STATUS_CLASS[r.resolutionStatus] || ""}">${VENDOR_PROMO_STATUS_LABEL[r.resolutionStatus] || r.resolutionStatus}</span>
                                ${r.homepage_featured ? `<span class="status-badge status-paid" style="margin-left:4px;">Featured</span>` : ""}
                            </td>
                            <td data-label="Notes">${r.rejection_reason ? vendorEsc(r.rejection_reason) : "-"}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error("Load vendor promotions list error:", error);
        box.innerHTML = "<p>Could not connect to server.</p>";
    }
}

// --- Notifications (Task #65) --------------------------------------------
// A small bell in the sidebar header, polled on load and whenever the
// panel is opened. Clicking a notification jumps to its linked tab and
// marks it read.

let vendorNotifPanelOpen = false;

async function refreshVendorNotifBadge() {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/notifications/unread-count");
        const badge = document.getElementById("vendor-notif-badge");
        if (!badge) return;
        if (data.unread > 0) {
            badge.textContent = data.unread > 99 ? "99+" : String(data.unread);
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    } catch (error) {
        console.error("Refresh vendor notif badge error:", error);
    }
}

function toggleVendorNotifPanel() {
    const panel = document.getElementById("vendor-notif-panel");
    if (!panel) return;
    vendorNotifPanelOpen = !vendorNotifPanelOpen;
    panel.hidden = !vendorNotifPanelOpen;
    if (vendorNotifPanelOpen) loadVendorNotifList();
}

async function loadVendorNotifList() {
    const box = document.getElementById("vendor-notif-list");
    if (!box) return;
    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/notifications");
        if (rows.error) {
            box.innerHTML = `<p>${vendorEsc(rows.error)}</p>`;
            return;
        }
        if (rows.length === 0) {
            box.innerHTML = `<p style="color:#888;">No notifications yet.</p>`;
            return;
        }
        box.innerHTML = rows.map(n => `
            <div onclick="openVendorNotification(${n.id}, '${n.link_tab || ""}')" style="padding:8px 6px; border-bottom:1px solid #eee; cursor:pointer; ${n.read_at ? "opacity:0.55;" : ""}">
                <div style="font-weight:600;">${vendorEsc(n.title)}</div>
                <div style="color:#555; margin-top:2px;">${vendorEsc(n.message)}</div>
                <div style="color:#999; font-size:11px; margin-top:2px;">${new Date(n.created_at).toLocaleString()}</div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load vendor notif list error:", error);
        box.innerHTML = "<p>Could not connect to server.</p>";
    }
}

async function openVendorNotification(id, linkTab) {
    try {
        await vendorAuthorizedFetch(`/api/vendors/notifications/${id}/read`, { method: "PATCH" });
        refreshVendorNotifBadge();
        loadVendorNotifList();
    } catch (error) {
        console.error("Mark vendor notification read error:", error);
    }
    if (linkTab) {
        const button = document.querySelector(`.tab-btn[data-tab="${linkTab}"]`);
        if (button) button.click();
    }
    toggleVendorNotifPanel();
}

async function markAllVendorNotifsRead() {
    try {
        await vendorAuthorizedFetch("/api/vendors/notifications/read-all", { method: "PATCH" });
        refreshVendorNotifBadge();
        loadVendorNotifList();
    } catch (error) {
        console.error("Mark all vendor notifications read error:", error);
    }
}

// --- Reports (Task #65) ---------------------------------------------------

let vendorReportsChart = null;

async function loadVendorReports() {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/reports");
        if (data.error) return;

        renderVendorReportsChart(data.dailySales);

        const topBox = document.getElementById("vendor-reports-top-products");
        topBox.innerHTML = data.topProducts.length === 0
            ? `<p class="no-data">No sales in the last 30 days.</p>`
            : `<table style="width:100%;">
                <thead><tr><th>Product</th><th>Units Sold</th><th>Revenue</th></tr></thead>
                <tbody>
                    ${data.topProducts.map(p => `
                        <tr>
                            <td data-label="Product">${vendorEsc(p.name)}</td>
                            <td data-label="Units Sold">${p.unitsSold}</td>
                            <td data-label="Revenue">${vendorFmtUgx(p.revenue)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>`;

        const statusBox = document.getElementById("vendor-reports-order-status");
        statusBox.innerHTML = data.orderStatusBreakdown.length === 0
            ? `<p class="no-data">No orders in the last 30 days.</p>`
            : data.orderStatusBreakdown.map(s => `<span class="status-badge status-${vendorEsc(s.status)}" style="margin-right:6px;">${vendorEsc(s.status)}: ${s.count}</span>`).join("");

        const payoutsBox = document.getElementById("vendor-reports-payouts");
        payoutsBox.innerHTML = data.payoutSummary.length === 0
            ? `<p class="no-data">No payout requests in the last 30 days.</p>`
            : data.payoutSummary.map(p => `<div>${p.status}: ${p.count} (${vendorFmtUgx(p.total)})</div>`).join("");
    } catch (error) {
        console.error("Load vendor reports error:", error);
    }
}

function renderVendorReportsChart(dailySales) {
    const canvas = document.getElementById("vendor-reports-chart");
    if (!canvas || typeof Chart === "undefined") return;
    const labels = dailySales.map(d => d.day);
    const datasets = [
        { label: "Sales (UGX)", data: dailySales.map(d => d.sales), borderColor: "#1a1a2e", backgroundColor: "rgba(26,26,46,0.08)", tension: 0.3, fill: true, yAxisID: "y" },
        { label: "Orders", data: dailySales.map(d => d.orders), borderColor: "#C9A227", backgroundColor: "rgba(201,162,39,0.12)", tension: 0.3, fill: true, yAxisID: "y1" }
    ];
    if (vendorReportsChart) {
        vendorReportsChart.data.labels = labels;
        vendorReportsChart.data.datasets = datasets;
        vendorReportsChart.update();
        return;
    }
    vendorReportsChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            scales: {
                y: { beginAtZero: true, position: "left" },
                y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } }
            }
        }
    });
}

// --- Storefront branding (Tasks #68/#74/#75) ------------------------------
// About text and delivery/payment method, shown on the vendor's own public
// store page (client/store.html). No logo/banner here - Ryan asked for
// those removed from the storefront (Sept 2026); a plain JSON PATCH is
// enough now that there's nothing to upload.

async function loadVendorStorefront() {
    try {
        const v = await vendorAuthorizedFetch("/api/vendors/me");
        if (v.error) return;

        const aboutEl = document.getElementById("vendor-storefront-about");
        aboutEl.value = v.about || "";
        document.getElementById("vendor-storefront-about-count").textContent = aboutEl.value.length;

        const codRadio = document.getElementById("vendor-delivery-method-cod");
        const prepayRadio = document.getElementById("vendor-delivery-method-prepay");
        codRadio.checked = v.delivery_method === "cash_on_delivery";
        prepayRadio.checked = v.delivery_method === "payment_first";

        const viewLink = document.getElementById("vendor-storefront-view-link");
        if (v.slug) {
            viewLink.href = `/store/${encodeURIComponent(v.slug)}`;
        }

        document.getElementById("vendor-storefront-status").textContent = "";
    } catch (error) {
        console.error("Load vendor storefront error:", error);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const aboutEl = document.getElementById("vendor-storefront-about");
    if (aboutEl) {
        aboutEl.addEventListener("input", () => {
            document.getElementById("vendor-storefront-about-count").textContent = aboutEl.value.length;
        });
    }

    const saveBtn = document.getElementById("vendor-storefront-save-btn");
    if (saveBtn) {
        saveBtn.addEventListener("click", saveVendorStorefront);
    }
});

async function saveVendorStorefront() {
    const statusEl = document.getElementById("vendor-storefront-status");
    const saveBtn = document.getElementById("vendor-storefront-save-btn");
    const about = document.getElementById("vendor-storefront-about").value;
    const codRadio = document.getElementById("vendor-delivery-method-cod");
    const prepayRadio = document.getElementById("vendor-delivery-method-prepay");
    const deliveryMethod = codRadio.checked ? "cash_on_delivery" : (prepayRadio.checked ? "payment_first" : "");

    saveBtn.disabled = true;
    saveBtn.style.opacity = "0.6";
    statusEl.style.color = "";
    statusEl.textContent = "Saving...";

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/storefront", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ about, delivery_method: deliveryMethod })
        });
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";

        if (data.error) {
            statusEl.style.color = "#DC2626";
            statusEl.textContent = data.error;
            return;
        }

        statusEl.style.color = "#16A34A";
        statusEl.textContent = "Saved.";
        loadVendorStorefront();
    } catch (error) {
        console.error("Save vendor storefront error:", error);
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
        statusEl.style.color = "#DC2626";
        statusEl.textContent = "Could not connect to server.";
    }
}

// --- Vendor-to-Admin Messaging (Task #71) ---------------------------------
// A minimal ticket/thread view: a list of the vendor's own threads plus a
// "New Message" form, and a detail view (conversation + reply box) shown
// in place of the list when a thread is opened.

let vendorMessagesCache = [];
let vendorOpenMessageThreadId = null;

function vendorMessageStatusBadge(status) {
    return status === "resolved"
        ? `<span class="status-badge status-paid">Resolved</span>`
        : `<span class="status-badge status-pending">Open</span>`;
}

async function loadVendorMessages() {
    const box = document.getElementById("vendor-messages-list");
    if (!box) return;
    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/messages");
        if (rows.error) {
            box.innerHTML = `<p>${rows.error}</p>`;
            return;
        }
        vendorMessagesCache = rows;
        if (rows.length === 0) {
            box.innerHTML = `<p class="no-data">You haven't sent any messages yet.</p>`;
            return;
        }
        box.innerHTML = `
            <table style="width:100%;">
                <thead><tr><th>Subject</th><th>Status</th><th>Replies</th><th>Last Update</th></tr></thead>
                <tbody>
                    ${rows.map(m => `
                        <tr onclick="openVendorMessageThread(${m.id})" style="cursor:pointer;">
                            <td data-label="Subject">${m.subject}</td>
                            <td data-label="Status">${vendorMessageStatusBadge(m.status)}</td>
                            <td data-label="Replies">${m.reply_count}</td>
                            <td data-label="Last Update">${new Date(m.updated_at).toLocaleString()}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>`;
    } catch (error) {
        console.error("Load vendor messages error:", error);
        box.innerHTML = "<p>Could not connect to server.</p>";
    }
}

async function openVendorMessageThread(id) {
    vendorOpenMessageThreadId = id;
    document.getElementById("vendor-messages-list-view").hidden = true;
    document.getElementById("vendor-messages-thread-view").hidden = false;
    await loadVendorMessageThread();
}

function closeVendorMessageThread() {
    vendorOpenMessageThreadId = null;
    document.getElementById("vendor-messages-thread-view").hidden = true;
    document.getElementById("vendor-messages-list-view").hidden = false;
    loadVendorMessages();
}

async function loadVendorMessageThread() {
    if (!vendorOpenMessageThreadId) return;
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/messages/${vendorOpenMessageThreadId}`);
        if (data.error) return;
        document.getElementById("vendor-message-thread-subject").textContent = data.thread.subject;
        document.getElementById("vendor-message-thread-status").innerHTML =
            `${vendorMessageStatusBadge(data.thread.status)} &middot; opened ${new Date(data.thread.created_at).toLocaleDateString()}`;
        const repliesBox = document.getElementById("vendor-message-thread-replies");
        repliesBox.innerHTML = data.replies.map(r => `
            <div style="padding:8px 10px; border-radius:8px; margin-bottom:8px; max-width:85%; ${r.sender_role === "admin" ? "background:#EEF2FF; margin-right:auto;" : "background:#F3F4F6; margin-left:auto;"}">
                <div style="font-size:11px; font-weight:600; color:#555; margin-bottom:2px;">${r.sender_role === "admin" ? "Lizimas Store" : "You"}</div>
                <div>${r.body}</div>
                <div style="font-size:10px; color:#999; margin-top:2px;">${new Date(r.created_at).toLocaleString()}</div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Load vendor message thread error:", error);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const sendBtn = document.getElementById("vendor-message-send-btn");
    if (sendBtn) {
        sendBtn.addEventListener("click", async () => {
            const subjectEl = document.getElementById("vendor-message-subject");
            const bodyEl = document.getElementById("vendor-message-body");
            const statusEl = document.getElementById("vendor-message-send-status");
            const subject = subjectEl.value.trim();
            const body = bodyEl.value.trim();
            if (!subject || !body) {
                statusEl.style.color = "#DC2626";
                statusEl.textContent = "Subject and message are both required.";
                return;
            }
            sendBtn.disabled = true;
            sendBtn.style.opacity = "0.6";
            statusEl.style.color = "";
            statusEl.textContent = "Sending...";
            try {
                const data = await vendorAuthorizedFetch("/api/vendors/messages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subject, body })
                });
                sendBtn.disabled = false;
                sendBtn.style.opacity = "1";
                if (data.error) {
                    statusEl.style.color = "#DC2626";
                    statusEl.textContent = data.error;
                    return;
                }
                subjectEl.value = "";
                bodyEl.value = "";
                statusEl.style.color = "#16A34A";
                statusEl.textContent = "Sent.";
                loadVendorMessages();
            } catch (error) {
                console.error("Send vendor message error:", error);
                sendBtn.disabled = false;
                sendBtn.style.opacity = "1";
                statusEl.style.color = "#DC2626";
                statusEl.textContent = "Could not connect to server.";
            }
        });
    }

    const replyBtn = document.getElementById("vendor-message-reply-btn");
    if (replyBtn) {
        replyBtn.addEventListener("click", async () => {
            const bodyEl = document.getElementById("vendor-message-reply-body");
            const statusEl = document.getElementById("vendor-message-reply-status");
            const body = bodyEl.value.trim();
            if (!body || !vendorOpenMessageThreadId) return;
            replyBtn.disabled = true;
            replyBtn.style.opacity = "0.6";
            statusEl.style.color = "";
            statusEl.textContent = "Sending...";
            try {
                const data = await vendorAuthorizedFetch(`/api/vendors/messages/${vendorOpenMessageThreadId}/replies`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ body })
                });
                replyBtn.disabled = false;
                replyBtn.style.opacity = "1";
                if (data.error) {
                    statusEl.style.color = "#DC2626";
                    statusEl.textContent = data.error;
                    return;
                }
                bodyEl.value = "";
                statusEl.textContent = "";
                loadVendorMessageThread();
            } catch (error) {
                console.error("Send vendor message reply error:", error);
                replyBtn.disabled = false;
                replyBtn.style.opacity = "1";
                statusEl.style.color = "#DC2626";
                statusEl.textContent = "Could not connect to server.";
            }
        });
    }
});

// --- Profile photo (shared account-level upload, wired up via photo-crop.js) ---
// The Account tab's photo circle (#profile-photo-img/#profile-photo-placeholder)
// is updated directly by photo-crop.js's own upload/remove logic. This just
// keeps the sidebar's small avatar in sync with it, on load and after a change.

function setVdSidebarProfileIcon(photoUrl) {
    const icon = document.getElementById("vd-sidebar-profile-icon");
    if (!icon) return;
    if (photoUrl) {
        icon.innerHTML = `<img src="${vendorEsc(photoUrl)}" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:8px;">`;
    } else {
        icon.innerHTML = "&#127978;";
    }
}

async function loadVendorProfilePhoto() {
    try {
        const data = await vendorAuthorizedFetch("/api/auth/profile");
        const photoUrl = data.user && data.user.profile_photo_url;
        setVdSidebarProfileIcon(photoUrl);
        const img = document.getElementById("profile-photo-img");
        const placeholder = document.getElementById("profile-photo-placeholder");
        if (img && placeholder) {
            if (photoUrl) {
                img.src = photoUrl;
                img.classList.remove("hidden");
                placeholder.classList.add("hidden");
            } else {
                img.classList.add("hidden");
                placeholder.classList.remove("hidden");
            }
        }
    } catch (error) {
        console.error("Load vendor profile photo error:", error);
    }
}

window.addEventListener("profilePhotoChanged", (e) => {
    setVdSidebarProfileIcon(e.detail && e.detail.url);
});


// --- Jumia (desktop Applications panel, tab-account) -----------------
// Mirrors the vm*Jumia* functions in vendor-mobile.js, targeting the
// vd-jumia-* elements in the desktop Account tab instead of the mobile
// Settings > Applications screen. Shares the same import state
// (vmJumiaRemoteProductsCache, vmJumiaImportSelected, VM_JUMIA_STATUS_LABEL,
// declared in vendor-mobile.js) since both scripts run in the same page
// and the backend connection is a single source of truth either way. The
// Applications list itself (many rows per vendor since migration 084) is
// desktop-only state - vdJumiaApplications/vdJumiaSetupAppId below.

let vdJumiaApplications = [];
let vdJumiaSetupAppId = null;

async function vdLoadJumia() {
    try {
        const apps = await vendorAuthorizedFetch("/api/vendors/me/jumia/applications");
        if (apps.error) { console.error("vdLoadJumia error:", apps.error); return; }
        vdJumiaApplications = Array.isArray(apps) ? apps : [];
        vdRenderJumiaApplicationsTable();

        const activeApp = vdJumiaApplications.find(a => a.is_active);
        const syncPanel = document.getElementById("vd-jumia-sync-panel");
        if (activeApp && activeApp.connected) {
            syncPanel.hidden = false;
            vdLoadJumiaLinks();
        } else {
            syncPanel.hidden = true;
            document.getElementById("vd-jumia-import-panel").hidden = true;
            document.getElementById("vd-jumia-export-panel").hidden = true;
        }
    } catch (error) {
        console.error("vdLoadJumia error:", error);
    }
}

// Picked up once on page load (see setupVendorTabs' DOMContentLoaded
// hook) - the query string Jumia's OAuth redirect lands the vendor back
// on after jumiaOAuthCallback finishes (see jumiaController.js).
let vdJumiaOAuthReturnHandled = false;

// Called from both vendor-dashboard.js's and vendor-mobile.js's own
// DOMContentLoaded handlers (only one shell is visually shown per
// viewport, decided by CSS, so both scripts navigate their own screen to
// Applications) - guarded so the alert only fires once even though both
// call it.
function vdCheckJumiaOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("jumia_oauth");
    if (!result) return;
    if (vdJumiaOAuthReturnHandled) return;
    vdJumiaOAuthReturnHandled = true;
    if (result === "success") {
        alert("Connected to Jumia.");
    } else if (result === "error") {
        alert("Could not connect to Jumia: " + (params.get("message") || "Please try again."));
    }
    params.delete("jumia_oauth");
    params.delete("message");
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
}

const VD_JUMIA_TYPE_LABEL = { self_authorization: "Self Authorization", web_application: "Web Application" };
const VD_JUMIA_STATUS_PILL = {
    connected: ["Connected", "#16A34A"],
    error: ["Error", "#DC2626"],
    token_expired: ["Reconnect", "#B45309"],
    disconnected: ["Not connected", "#888"]
};

function vdRenderJumiaApplicationsTable() {
    const host = document.getElementById("vd-jumia-applications-table");
    if (!host) return;
    if (vdJumiaApplications.length === 0) {
        host.innerHTML = '<p style="font-size:13px; color:#888; padding:8px 0;">No Applications yet. Create one to connect Lizimas to your Jumia Vendor Center account.</p>';
        return;
    }
    const rows = vdJumiaApplications.map(app => {
        const [statusLabel, statusColor] = VD_JUMIA_STATUS_PILL[app.connection_status] || [app.connection_status, "#888"];
        const created = app.created_at ? new Date(app.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
        const activeCell = app.is_active
            ? '<span style="font-size:11.5px; font-weight:700; color:#16A34A;">&bull; ACTIVE</span>'
            : (app.connected
                ? `<button type="button" onclick="vdMakeJumiaAppActive(${app.id})" style="font-size:11.5px; padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">Make Active</button>`
                : '<span style="font-size:11.5px; color:#bbb;">&mdash;</span>');
        return `<tr>
            <td data-label="Name" style="font-weight:600; color:var(--vd-navy);">${vendorEsc(app.name)}</td>
            <td data-label="Type" style="font-size:12.5px; color:#666;">${VD_JUMIA_TYPE_LABEL[app.app_type] || app.app_type}</td>
            <td data-label="Client ID" style="font-family:monospace; font-size:12px; color:#666;">${app.client_id ? vendorEsc(app.client_id) : "&mdash;"}</td>
            <td data-label="Status" title="${app.last_error ? vendorEsc(app.last_error) : ""}" style="font-size:12.5px; font-weight:600; color:${statusColor};">${statusLabel}${app.jumia_shop_name ? `<div style="font-size:11px; font-weight:400; color:#999;">${vendorEsc(app.jumia_shop_name)}</div>` : ""}</td>
            <td data-label="Active">${activeCell}</td>
            <td data-label="Created At" style="font-size:12.5px; color:#888;">${created}</td>
            <td data-label="Actions">
                <div style="display:flex; gap:6px;">
                    <button type="button" title="${app.connected ? "Reconnect" : "Connect"}" onclick="vdShowJumiaAppSetup(${app.id})" style="background:none; border:1px solid #ccc; border-radius:6px; width:32px; height:32px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </button>
                    ${app.is_active ? `<button type="button" title="Test Connection" onclick="vdTestJumiaApp(${app.id})" style="background:none; border:1px solid #ccc; border-radius:6px; width:32px; height:32px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>` : ""}
                    <button type="button" title="Delete" onclick="vdDeleteJumiaApp(${app.id})" style="background:none; border:1px solid #ccc; border-radius:6px; width:32px; height:32px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join("");
    host.innerHTML = `<table class="lz-mini-table" style="width:100%; border-collapse:collapse;">
        <thead><tr><th>Name</th><th>Type</th><th>Client ID</th><th>Status</th><th>Active</th><th>Created At</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function vdShowCreateJumiaApplication() {
    vdHideJumiaAppSetup();
    const createViewEl = document.getElementById("vd-jumia-create-application-view");
    createViewEl.hidden = false;
    createViewEl.style.display = "flex";
    document.getElementById("vd-jumia-new-app-name").value = "";
    document.getElementById("vd-jumia-new-app-error").textContent = "";
    const selfRadio = document.querySelector('input[name="vd-jumia-new-app-type"][value="self_authorization"]');
    if (selfRadio) selfRadio.checked = true;
}

function vdHideCreateJumiaApplication() {
    const createViewEl = document.getElementById("vd-jumia-create-application-view");
    createViewEl.hidden = true;
    createViewEl.style.display = "none";
}

async function vdCreateJumiaApplication() {
    const name = document.getElementById("vd-jumia-new-app-name").value.trim();
    const typeInput = document.querySelector('input[name="vd-jumia-new-app-type"]:checked');
    const errorEl = document.getElementById("vd-jumia-new-app-error");
    if (!name) { errorEl.textContent = "Enter an Application Name."; return; }
    try {
        const created = await vendorAuthorizedFetch("/api/vendors/me/jumia/applications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, app_type: typeInput ? typeInput.value : "self_authorization" })
        });
        if (created.error) { errorEl.textContent = created.error; return; }
        vdHideCreateJumiaApplication();
        await vdLoadJumia();
        vdShowJumiaAppSetup(created.id);
    } catch (error) {
        console.error("vdCreateJumiaApplication error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

function vdHideJumiaAppSetup() {
    const setupViewEl = document.getElementById("vd-jumia-app-setup-view");
    setupViewEl.hidden = true;
    setupViewEl.style.display = "none";
}

function vdShowJumiaAppSetup(applicationId) {
    vdHideCreateJumiaApplication();
    const app = vdJumiaApplications.find(a => Number(a.id) === Number(applicationId));
    if (!app) return;
    vdJumiaSetupAppId = applicationId;
    const setupViewEl = document.getElementById("vd-jumia-app-setup-view");
    setupViewEl.hidden = false;
    setupViewEl.style.display = "flex";
    document.getElementById("vd-jumia-app-setup-title").textContent = `${app.connected ? "Reconnect" : "Connect"} "${app.name}"`;
    document.getElementById("vd-jumia-app-setup-error").textContent = "";

    const isWeb = app.app_type === "web_application";
    document.getElementById("vd-jumia-app-setup-self").style.display = isWeb ? "none" : "flex";
    document.getElementById("vd-jumia-app-setup-web").style.display = isWeb ? "flex" : "none";

    if (isWeb) {
        document.getElementById("vd-jumia-app-redirect-uri").value = app.redirect_uri || "";
        document.getElementById("vd-jumia-app-web-client-id").value = app.client_id || "";
        document.getElementById("vd-jumia-app-web-client-secret").value = "";
    } else {
        document.getElementById("vd-jumia-app-client-id").value = app.client_id || "";
        document.getElementById("vd-jumia-app-refresh-token").value = "";
    }
}

async function vdConnectJumiaApp() {
    if (!vdJumiaSetupAppId) return;
    const clientId = document.getElementById("vd-jumia-app-client-id").value.trim();
    const refreshToken = document.getElementById("vd-jumia-app-refresh-token").value.trim();
    const errorEl = document.getElementById("vd-jumia-app-setup-error");
    if (!clientId || !refreshToken) { errorEl.textContent = "Enter both the Client ID and Refresh Token."; return; }
    const btn = document.getElementById("vd-jumia-app-connect-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
    try {
        const result = await vendorAuthorizedFetch(`/api/vendors/me/jumia/applications/${vdJumiaSetupAppId}/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: clientId, refresh_token: refreshToken })
        });
        if (result.error) { errorEl.textContent = result.error; return; }
        vdHideJumiaAppSetup();
        vdLoadJumia();
    } catch (error) {
        console.error("vdConnectJumiaApp error:", error);
        errorEl.textContent = "Could not connect. Please try again.";
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Connect"; }
    }
}

function vdCopyJumiaRedirectUri() {
    const input = document.getElementById("vd-jumia-app-redirect-uri");
    if (!input) return;
    input.select();
    try {
        navigator.clipboard.writeText(input.value);
    } catch (error) {
        document.execCommand("copy");
    }
}

async function vdSignInWithJumia() {
    if (!vdJumiaSetupAppId) return;
    const clientId = document.getElementById("vd-jumia-app-web-client-id").value.trim();
    const clientSecret = document.getElementById("vd-jumia-app-web-client-secret").value.trim();
    const errorEl = document.getElementById("vd-jumia-app-setup-error");
    if (!clientId) { errorEl.textContent = "Enter the Client ID first."; return; }
    const btn = document.getElementById("vd-jumia-app-signin-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Redirecting..."; }
    try {
        const saved = await vendorAuthorizedFetch(`/api/vendors/me/jumia/applications/${vdJumiaSetupAppId}/credentials`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret || undefined })
        });
        if (saved.error) { errorEl.textContent = saved.error; return; }
        const auth = await vendorAuthorizedFetch(`/api/vendors/me/jumia/applications/${vdJumiaSetupAppId}/authorize`);
        if (auth.error) { errorEl.textContent = auth.error; return; }
        window.location.href = auth.authorize_url;
    } catch (error) {
        console.error("vdSignInWithJumia error:", error);
        errorEl.textContent = "Could not start Jumia sign-in.";
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Save & Sign in with Jumia"; }
    }
}

async function vdMakeJumiaAppActive(applicationId) {
    try {
        const result = await vendorAuthorizedFetch(`/api/vendors/me/jumia/applications/${applicationId}/activate`, { method: "POST" });
        if (result.error) { alert(result.error); return; }
        vdLoadJumia();
    } catch (error) {
        console.error("vdMakeJumiaAppActive error:", error);
        alert("Could not activate this Application.");
    }
}

async function vdTestJumiaApp(applicationId) {
    try {
        const result = await vendorAuthorizedFetch(`/api/vendors/me/jumia/applications/${applicationId}/test`, { method: "POST" });
        if (result.error) { alert(result.error); vdLoadJumia(); return; }
        alert("Connection is working.");
        vdLoadJumia();
    } catch (error) {
        console.error("vdTestJumiaApp error:", error);
        alert("Could not verify the connection.");
    }
}

async function vdDeleteJumiaApp(applicationId) {
    const app = vdJumiaApplications.find(a => Number(a.id) === Number(applicationId));
    if (!confirm(`Delete "${app ? app.name : "this Application"}"? This cannot be undone.`)) return;
    try {
        const result = await vendorAuthorizedFetch(`/api/vendors/me/jumia/applications/${applicationId}`, { method: "DELETE" });
        if (result.error) { alert(result.error); return; }
        vdLoadJumia();
    } catch (error) {
        console.error("vdDeleteJumiaApp error:", error);
        alert("Could not delete this Application.");
    }
}

async function vdLoadJumiaLinks() {
    const list = document.getElementById("vd-jumia-links-list");
    if (!list) return;
    try {
        const links = await vendorAuthorizedFetch("/api/vendors/me/jumia/links");
        if (links.error) return;
        vdRenderJumiaLinks(links);
    } catch (error) {
        console.error("vdLoadJumiaLinks error:", error);
    }
}

function vdRenderJumiaLinks(links) {
    const list = document.getElementById("vd-jumia-links-list");
    if (!links || links.length === 0) {
        list.innerHTML = '<div style="font-size:12.5px; color:#888; padding:8px 0;">No products linked yet.</div>';
        return;
    }
    list.innerHTML = links.map(link => {
        const status = link.locally_changed_since_sync ? "out_of_sync" : link.sync_status;
        const [label, color] = VM_JUMIA_STATUS_LABEL[status] || [status, "#888"];
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eee;">
            <div>
                <div style="font-size:13px; font-weight:600; color:var(--vd-navy);">${vendorEsc(link.product_name || link.jumia_seller_sku)}</div>
                <div style="font-size:11.5px; color:#999;">${link.sync_direction === "pull" ? "From Jumia" : "To Jumia"}${link.last_error ? " &bull; " + vendorEsc(link.last_error) : ""}</div>
            </div>
            <span style="font-size:12px; font-weight:600; color:${color};">${label}</span>
        </div>`;
    }).join("");
}

function vdShowJumiaImport() {
    document.getElementById("vd-jumia-import-panel").hidden = false;
    vdLoadJumiaImport();
}

function vdHideJumiaImport() {
    document.getElementById("vd-jumia-import-panel").hidden = true;
}

async function vdLoadJumiaImport() {
    const list = document.getElementById("vd-jumia-import-list");
    list.innerHTML = '<div style="font-size:12.5px; color:#888;">Loading...</div>';
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/remote-products");
        if (result.error) {
            list.innerHTML = `<div style="font-size:12.5px; color:#DC2626;">${vendorEsc(result.error)}</div>`;
            return;
        }
        vmJumiaRemoteProductsCache = new Map((result.items || []).map(item => [item.seller_sku, item]));
        vdRenderJumiaImportList(result.items || []);
    } catch (error) {
        console.error("vdLoadJumiaImport error:", error);
        list.innerHTML = '<div style="font-size:12.5px; color:#DC2626;">Could not load your Jumia products.</div>';
    }
}

function vdRenderJumiaImportList(items) {
    const list = document.getElementById("vd-jumia-import-list");
    vmJumiaImportSelected = new Set();
    if (!items || items.length === 0) {
        list.innerHTML = '<div style="font-size:12.5px; color:#888; padding:8px 0;">No Jumia products found.</div>';
        return;
    }
    list.innerHTML = items.map(item => {
        const disabled = item.already_linked;
        return `<label style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #eee; ${disabled ? "opacity:.5;" : ""}">
            <input type="checkbox" ${disabled ? "disabled" : ""} onchange="vdToggleJumiaImportSelect('${vendorEsc(item.seller_sku)}', this.checked)">
            <div style="flex:1;">
                <div style="font-size:13px; font-weight:600; color:var(--vd-navy);">${vendorEsc(item.name || item.seller_sku)}</div>
                <div style="font-size:11.5px; color:#999;">${disabled ? "Already imported" : (item.seller_sku || "")}</div>
            </div>
        </label>`;
    }).join("");
}

function vdToggleJumiaImportSelect(sellerSku, checked) {
    if (checked) vmJumiaImportSelected.add(sellerSku);
    else vmJumiaImportSelected.delete(sellerSku);
    const help = document.getElementById("vd-jumia-import-help");
    if (help) help.textContent = vmJumiaImportSelected.size > 0 ? `${vmJumiaImportSelected.size} selected` : "";
}

async function vdImportSelectedJumiaProducts() {
    if (vmJumiaImportSelected.size === 0) { alert("Select at least one product first."); return; }
    const items = Array.from(vmJumiaImportSelected).map(sku => vmJumiaRemoteProductsCache.get(sku)).filter(Boolean);
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items })
        });
        if (result.error) { alert(result.error); return; }
        const createdCount = (result.created || []).length;
        const skippedCount = (result.skipped || []).length;
        alert(`${createdCount} product(s) imported.` + (skippedCount > 0 ? ` ${skippedCount} skipped.` : ""));
        vdHideJumiaImport();
        vdLoadJumia();
    } catch (error) {
        console.error("vdImportSelectedJumiaProducts error:", error);
        alert("Could not import products.");
    }
}

// --- Export to Jumia (Task #96: a direct way to push products from
// inside the Applications > Product Sync panel itself, rather than only
// via the Manage Products tab's bulk-select bar) ---

let vdJumiaExportCandidates = [];
let vdJumiaExportSelected = new Set();

function vdShowJumiaExport() {
    document.getElementById("vd-jumia-export-panel").hidden = false;
    vdLoadJumiaExport();
}

function vdHideJumiaExport() {
    document.getElementById("vd-jumia-export-panel").hidden = true;
}

async function vdLoadJumiaExport() {
    const list = document.getElementById("vd-jumia-export-list");
    list.innerHTML = '<div style="font-size:12.5px; color:#888;">Loading...</div>';
    try {
        const [products, links] = await Promise.all([
            vendorAuthorizedFetch("/api/vendors/products"),
            vendorAuthorizedFetch("/api/vendors/me/jumia/links")
        ]);
        if (products.error) {
            list.innerHTML = `<div style="font-size:12.5px; color:#DC2626;">${vendorEsc(products.error)}</div>`;
            return;
        }
        const linkedIds = new Set((Array.isArray(links) ? links : []).map(l => Number(l.product_id)));
        vdJumiaExportCandidates = (Array.isArray(products) ? products : []).filter(p => p.status === "approved" && !p.admin_restricted);
        vdRenderJumiaExportList(vdJumiaExportCandidates, linkedIds);
    } catch (error) {
        console.error("vdLoadJumiaExport error:", error);
        list.innerHTML = '<div style="font-size:12.5px; color:#DC2626;">Could not load your products.</div>';
    }
}

function vdRenderJumiaExportList(products, linkedIds) {
    const list = document.getElementById("vd-jumia-export-list");
    vdJumiaExportSelected = new Set();
    if (!products || products.length === 0) {
        list.innerHTML = '<div style="font-size:12.5px; color:#888; padding:8px 0;">No approved products to export yet.</div>';
        return;
    }
    list.innerHTML = products.map(p => {
        const linked = linkedIds.has(Number(p.id));
        return `<label style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #eee;">
            <input type="checkbox" onchange="vdToggleJumiaExportSelect(${p.id}, this.checked)">
            <div style="flex:1;">
                <div style="font-size:13px; font-weight:600; color:var(--vd-navy);">${vendorEsc(p.name)}</div>
                <div style="font-size:11.5px; color:#999;">${linked ? "Already linked - pushing again re-syncs it" : (p.sku || `LZM-${p.id}`)}</div>
            </div>
        </label>`;
    }).join("");
}

function vdToggleJumiaExportSelect(productId, checked) {
    if (checked) vdJumiaExportSelected.add(productId);
    else vdJumiaExportSelected.delete(productId);
    const help = document.getElementById("vd-jumia-export-help");
    if (help) help.textContent = vdJumiaExportSelected.size > 0 ? `${vdJumiaExportSelected.size} selected` : "";
}

async function vdExportSelectedToJumia() {
    if (vdJumiaExportSelected.size === 0) { alert("Select at least one product first."); return; }
    const ids = Array.from(vdJumiaExportSelected);
    if (!confirm(`Push ${ids.length} product(s) to Jumia?`)) return;
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/products/push-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productIds: ids })
        });
        if (result.error) { alert(result.error); return; }
        const successCount = (result.successful || []).length;
        const failedCount = (result.failed || []).length;
        let message = `${successCount} product(s) pushed to Jumia.`;
        if (failedCount > 0) {
            message += `\n${failedCount} failed:\n` + result.failed.map(f => `- ${f.reason}`).join("\n");
        }
        alert(message);
        vdHideJumiaExport();
        vdLoadJumia();
    } catch (error) {
        console.error("vdExportSelectedToJumia error:", error);
        alert("Could not push products to Jumia.");
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
    loadVendorKyc();
    loadVendorDashboardSummary();
    loadVendorPremiumDashboard();
    loadVendorCategories();
    loadVendorPromotions();
    loadVendorProfilePhoto();
    refreshVendorNotifBadge();

    // Jumia's OAuth redirect (see jumiaController.js's jumiaOAuthCallback)
    // lands the vendor back on this same dashboard URL with a jumia_oauth
    // query param - jump straight to Applications so the result is visible
    // without them having to go find it.
    if (new URLSearchParams(window.location.search).has("jumia_oauth")) {
        const accountTabBtn = document.querySelector('.tab-btn[data-tab="account"]');
        if (accountTabBtn) accountTabBtn.click();
        vdCheckJumiaOAuthReturn();
    }
});
