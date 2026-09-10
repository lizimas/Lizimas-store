// Vendor mobile app shell (client/vendor/dashboard.html), shown below the
// ~768px breakpoint (see client/css/vendor-mobile.css). Matches Jumia's
// real seller-center IA: a persistent Home/Orders/Manage Products/Menu
// bottom nav, with Menu as the hub for Settings and everything else.
//
// Deliberately reuses the SAME globals/functions vendor-dashboard.js
// already defines for the desktop tabs wherever the underlying data and
// business rules are identical (vendorAuthorizedFetch, vendorOrdersCache,
// vendorProductsCache, advanceVendorOrderStage, bulkVendorProductAction,
// etc.) rather than re-deriving order/product stage logic a second time -
// this file only adds NEW rendering (cards instead of tables) and the
// net-new Shop Activation / Holiday Mode screens. Loaded after
// vendor-dashboard.js (see dashboard.html), so all of those already exist
// by the time this file runs.

const VM_ICON = {
    check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
};

// --- Navigation ------------------------------------------------------------

const VM_NAV_SCREENS = ["home", "orders", "products", "menu"]; // bottom-nav-level screens
let vmNavStack = ["menu"]; // back-target for a sub-screen reached from Menu

function vmShowScreen(name, opts) {
    opts = opts || {};
    document.querySelectorAll(".vm-screen").forEach(el => el.classList.remove("active"));
    const target = document.getElementById(`vm-screen-${name}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".vm-nav-item").forEach(el => el.classList.remove("active"));
    const navKey = VM_NAV_SCREENS.includes(name) ? name : "menu";
    const navBtn = document.querySelector(`.vm-nav-item[data-vm-nav="${navKey}"]`);
    if (navBtn) navBtn.classList.add("active");

    if (!opts.isBack && !VM_NAV_SCREENS.includes(name)) {
        vmNavStack.push(name);
    } else if (VM_NAV_SCREENS.includes(name)) {
        vmNavStack = [name];
    }

    if (name === "home") vmLoadHome();
    if (name === "orders") vmLoadOrders();
    if (name === "products") vmLoadProducts();
    if (name === "menu") vmLoadMenu();
    if (name === "settings") vmLoadSettings();
    if (name === "holiday-mode") vmLoadHolidayMode();
    if (name === "add-product") vmLoadAddProduct();
    if (name === "promotions") vmLoadPromotions();
    if (name === "wallet") vmLoadWallet();
    if (name === "profile") vmLoadProfile();
}

function vmGoBack() {
    vmNavStack.pop();
    const prev = vmNavStack[vmNavStack.length - 1] || "menu";
    vmShowScreen(prev, { isBack: true });
}

function vmSetupNav() {
    document.querySelectorAll(".vm-nav-item").forEach(btn => {
        btn.addEventListener("click", () => vmShowScreen(btn.dataset.vmNav));
    });
    document.querySelectorAll("[data-vm-back]").forEach(btn => {
        btn.addEventListener("click", vmGoBack);
    });
}

function vmFmtUgx(n) {
    return "UGX " + Number(n || 0).toLocaleString();
}

// --- Home (two states: application status vs. KPI dashboard) --------------
//
// The "not yet approved" state shows the vendor's REAL application status
// (vendors.status/rejection_reason via GET /vendors/me) rather than a
// fabricated multi-step progress tracker - Lizimas has no per-section
// (shop info/business info/shipping/payment) completion tracking in the
// database today, so a step-by-step checklist here would just be
// decoration with no real data behind it. Once vendors.status is
// 'approved', Home switches to the real KPI summary from
// GET /vendors/dashboard-summary (the same endpoint the desktop Overview
// tab uses via loadVendorDashboardSummary()).

async function vmLoadHome() {
    const el = document.getElementById("vm-home-body");
    el.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        const v = await vendorAuthorizedFetch("/api/vendors/me");
        if (v.error) { el.innerHTML = `<div class="vm-loading-state">${v.error}</div>`; return; }

        if (v.status !== "approved") {
            el.innerHTML = vmRenderHomeStatus(v);
            return;
        }

        const data = await vendorAuthorizedFetch("/api/vendors/dashboard-summary");
        if (data.error) { el.innerHTML = `<div class="vm-loading-state">${data.error}</div>`; return; }
        el.innerHTML = vmRenderHomeKpi(v, data);
    } catch (error) {
        console.error("vmLoadHome error:", error);
        el.innerHTML = '<div class="vm-loading-state">Could not load your dashboard.</div>';
    }
}

function vmStatusCopy(status) {
    if (status === "pending") return { bg: "var(--vm-amber-bg)", color: "var(--vm-amber-text)", text: "Pending Review" };
    if (status === "rejected") return { bg: "#fce8e6", color: "#c5221f", text: "Rejected" };
    if (status === "suspended") return { bg: "#fce8e6", color: "#c5221f", text: "Suspended" };
    return { bg: "var(--vm-green-bg)", color: "var(--vm-green-text)", text: "Approved" };
}

function vmRenderHomeStatus(v) {
    const s = vmStatusCopy(v.status);
    let extra = "";
    if (v.status === "pending") {
        extra = '<div style="font-size:12.5px; color:#555; line-height:1.5; margin-top:10px;">Your application is awaiting review. You can still add products from a larger screen, but they won\'t go live until your account is approved.</div>';
    } else if (v.status === "rejected") {
        extra = `<div style="font-size:12.5px; color:#555; line-height:1.5; margin-top:10px;">${v.rejection_reason ? "Reason: " + v.rejection_reason : "Contact support for details."}</div>`;
    }
    const statusCard = `<div class="vm-card">
        <div style="display:inline-block; padding:6px 14px; border-radius:999px; background:${s.bg}; color:${s.color}; font-weight:700; font-size:13px;">${s.text}</div>
        ${extra}
    </div>`;
    const profileRows = [
        ["Shop Name", v.business_name || "-"],
        ["Account Type", v.account_type === "company" ? "Company" : v.account_type === "individual" ? "Individual" : "-"],
        ["Phone", v.phone || "-"],
        ["Location", v.physical_address || "-"]
    ].map(([label, value]) => `<div style="display:flex; align-items:center; justify-content:space-between; padding:9px 0; border-bottom:1px solid #f0f1f4;"><span style="font-size:12.5px; color:#888;">${label}</span><span style="font-size:13px; font-weight:600; color:var(--vm-navy); text-align:right;">${value}</span></div>`).join("");
    const profileCard = `<div class="vm-card"><div class="vm-card-title">Your Application</div><div class="vm-card-subtitle">Once approved, Home becomes your live orders and earnings summary.</div>${profileRows}</div>`;
    return `<div class="vm-header"><div class="vm-header-brand"><span class="vm-header-brand-badge">L</span><span class="vm-header-eyebrow">Welcome back,</span></div><div class="vm-header-title">${v.business_name || "Lizimas Store"}</div></div>` + statusCard + profileCard;
}

function vmStatTile(label, value, color) {
    return `<div class="vm-stat-tile"><div class="vm-stat-value"${color ? ` style="color:${color};"` : ""}>${value}</div><div class="vm-stat-label">${label}</div></div>`;
}

function vmRenderHomeKpi(v, data) {
    const o = data.orders, e = data.earnings, p = data.products;
    const header = `<div class="vm-header"><div class="vm-header-brand"><span class="vm-header-brand-badge">L</span><span class="vm-header-eyebrow">Welcome back,</span></div><div class="vm-header-title">${v.business_name || "Lizimas Store"}</div></div>`;
    const stats = `<div style="margin:-4px 14px 14px;">
        <div class="vm-stat-row">${vmStatTile("Today's Orders", o.today)}${vmStatTile("Pending Handover", o.pendingHandover, o.pendingHandover > 0 ? "var(--vm-amber-text)" : null)}</div>
        <div class="vm-stat-row">${vmStatTile("Awaiting Delivery", o.awaitingDelivery)}${vmStatTile("Completed", o.completed, "var(--vm-green-text)")}</div>
        <div class="vm-stat-row">${vmStatTile("Cancelled", o.cancelled, o.cancelled > 0 ? "var(--vm-red)" : null)}${vmStatTile("Active Returns", o.activeReturns, o.activeReturns > 0 ? "var(--vm-amber-text)" : null)}</div>
    </div>`;
    // Currency amounts only, never a rate or percentage - sellers must
    // never see the commission % (Ryan, Sept 2026) - see
    // loadVendorDashboardSummary() in vendor-dashboard.js for the desktop
    // equivalent of this same rule.
    const earnings = `<div class="vm-card">
        <div class="vm-card-title">Earnings</div><div class="vm-card-subtitle">Delivered orders</div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #f0f1f4;"><span style="font-size:13px; color:#555;">Sale</span><span style="font-size:13.5px; font-weight:600; color:var(--vm-navy);">${vmFmtUgx(e.sale)}</span></div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #f0f1f4;"><span style="font-size:13px; color:#555;">Marketplace charges</span><span style="font-size:13.5px; font-weight:600; color:var(--vm-red);">&minus; ${vmFmtUgx(e.charges)}</span></div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0 2px;"><span style="font-size:13.5px; font-weight:700; color:var(--vm-navy);">Net payable</span><span style="font-size:16px; font-weight:700; color:var(--vm-green-text);">${vmFmtUgx(e.net)}</span></div>
    </div>`;
    const products = `<div class="vm-card">
        <div class="vm-card-title">Products</div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:2px 0;"><span style="font-size:13px; color:#555;">Active products</span><span style="font-size:15px; font-weight:700; color:var(--vm-navy);">${p.total}</span></div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0 2px; margin-top:6px; border-top:1px solid #f0f1f4;"><span style="font-size:13px; color:#555;">Low stock</span><span style="font-size:15px; font-weight:700; color:var(--vm-amber-text);">${p.lowStock}</span></div>
    </div>`;
    const score = `<div class="vm-card"><div style="display:flex; align-items:center; justify-content:space-between;"><div><div style="font-size:13px; font-weight:600; color:var(--vm-navy); margin-bottom:2px;">Seller score</div><div style="font-size:11.5px; color:#888;">Shown on your storefront and product pages</div></div><span style="font-size:20px; font-weight:700; color:var(--vm-green-text);">${data.sellerScore != null ? data.sellerScore : "-"}</span></div></div>`;
    return header + stats + earnings + products + score;
}

// --- Orders -----------------------------------------------------------------
// Reuses vendorOrdersCache/VENDOR_STAGE_FILTERS/VENDOR_STAGE_BADGE_CLASS/
// VENDOR_NEXT_STAGE/VENDOR_NEXT_STAGE_BUTTON_LABEL/advanceVendorOrderStage/
// markVendorHandedOver/dropoffPointOptions from vendor-dashboard.js - same
// data, same stage rules, just card markup instead of a table.

let vmOrdersFilter = "all";

async function vmLoadOrders() {
    const listEl = document.getElementById("vm-orders-list");
    listEl.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        await loadVendorOrders(); // populates the shared vendorOrdersCache global
        vmRenderOrdersPills();
        vmRenderOrdersList();
    } catch (error) {
        console.error("vmLoadOrders error:", error);
        listEl.innerHTML = '<div class="vm-loading-state">Could not load orders.</div>';
    }
}

function vmSetOrdersFilter(key) {
    vmOrdersFilter = key;
    vmRenderOrdersPills();
    vmRenderOrdersList();
}

function vmRenderOrdersPills() {
    const el = document.getElementById("vm-orders-pills");
    el.innerHTML = VENDOR_STAGE_FILTERS.map(([key, label]) => {
        const count = key === "all" ? vendorOrdersCache.length : vendorOrdersCache.filter(o => o.stage === key).length;
        const active = vmOrdersFilter === key;
        return `<div class="vm-pill${active ? " active" : ""}" onclick="vmSetOrdersFilter('${key}')">${label}${count ? ` (${count})` : ""}</div>`;
    }).join("");
}

function vmOrderCard(o) {
    const badgeClass = VENDOR_STAGE_BADGE_CLASS[o.stage] || "status-pending";
    const rejectedNote = o.stage === "rejected"
        ? `<div style="font-size:11px; color:#991B1B; margin-top:6px;">Rejected: ${o.rejection_reason || "no reason given"} - re-prepare and re-submit.</div>`
        : "";

    let actions = "";
    if (o.stage in VENDOR_NEXT_STAGE) {
        const next = VENDOR_NEXT_STAGE[o.stage];
        actions = `<div class="vm-order-actions"><button class="vm-order-action-btn" style="background:var(--vm-navy); color:#fff; border-color:var(--vm-navy);" onclick="advanceVendorOrderStage(${o.order_item_id}, '${next}')">${VENDOR_NEXT_STAGE_BUTTON_LABEL[next]}</button></div>`;
    } else if (o.stage === "ready_for_handover") {
        actions = `<div style="margin-top:10px;">
            <select id="vm-dropoff-select-${o.order_item_id}" style="width:100%; padding:8px; border:1px solid var(--vm-border); border-radius:8px; font-size:12.5px; margin-bottom:8px;">
                <option value="">Choose drop-off point</option>
                ${dropoffPointOptions()}
            </select>
            <button class="vm-order-action-btn" style="width:100%; background:var(--vm-green-text); color:#fff; border-color:var(--vm-green-text);" onclick="markVendorHandedOver(${o.order_item_id})">Mark Handed Over</button>
        </div>`;
    }

    return `<div class="vm-order-card">
        <div class="vm-order-card-top">
            <span class="vm-order-no">Order #${o.order_id}</span>
            <span class="status-badge ${badgeClass}">${o.stageLabel}</span>
        </div>
        <div class="vm-order-product">${o.product_name}</div>
        <div class="vm-order-meta">Qty ${o.quantity} &middot; ${new Date(o.created_at).toLocaleDateString()}</div>
        <div class="vm-order-bottom">
            <span>${vmFmtUgx(Number(o.price) * Number(o.quantity))}</span>
            ${o.dropoff_point_name ? `<span>${o.dropoff_point_name}</span>` : ""}
        </div>
        ${rejectedNote}
        ${actions}
    </div>`;
}

function vmRenderOrdersList() {
    const el = document.getElementById("vm-orders-list");
    const rows = vmOrdersFilter === "all" ? vendorOrdersCache : vendorOrdersCache.filter(o => o.stage === vmOrdersFilter);
    if (!rows || rows.length === 0) {
        el.innerHTML = '<div class="vm-empty-state">No orders in this view.</div>';
        return;
    }
    el.innerHTML = rows.map(vmOrderCard).join("");
}

// --- Manage Products ----------------------------------------------------
// Reuses vendorProductsCache/VENDOR_PRODUCT_FILTERS/vendorProductFilterKey/
// vendorProductStatusBadge/vendorProductsSelected/toggleVendorProductSelect/
// bulkVendorProductAction from vendor-dashboard.js - the filter set here
// (all/active/pending/rejected/out_of_stock/inactive) matches what the
// desktop Manage Products tab actually has today, not the fuller Jumia-
// style list (Restricted/Pending Deletion) from the earlier design canvas
// - Lizimas doesn't expose those as vendor-facing filters yet.

let vmProductsFilter = "all";

async function vmLoadProducts() {
    const listEl = document.getElementById("vm-products-list");
    listEl.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        await loadVendorProducts(); // populates the shared vendorProductsCache global
        vmRenderProductsPills();
        vmRenderProductsList();
        vmUpdateBulkBar();
    } catch (error) {
        console.error("vmLoadProducts error:", error);
        listEl.innerHTML = '<div class="vm-loading-state">Could not load products.</div>';
    }
}

function vmSetProductsFilter(key) {
    vmProductsFilter = key;
    vmRenderProductsPills();
    vmRenderProductsList();
}

function vmRenderProductsPills() {
    const el = document.getElementById("vm-products-pills");
    el.innerHTML = VENDOR_PRODUCT_FILTERS.map(([key, label]) => {
        const count = key === "all" ? vendorProductsCache.length : vendorProductsCache.filter(p => vendorProductFilterKey(p) === key).length;
        const active = vmProductsFilter === key;
        return `<div class="vm-pm-group-pill${active ? " active" : ""}" onclick="vmSetProductsFilter('${key}')">${label}${count ? ` (${count})` : ""}</div>`;
    }).join("");
}

function vmProductCard(p) {
    const checked = vendorProductsSelected.has(Number(p.id));
    return `<div class="vm-order-card" style="display:flex; gap:10px;">
        <button class="vm-checkbox${checked ? " checked" : ""}" onclick="vmToggleProduct(${p.id})">${checked ? VM_ICON.check : ""}</button>
        <div style="flex:1; min-width:0;">
            <div class="vm-order-card-top"><span style="font-size:13px; font-weight:600; color:var(--vm-navy);">${p.name}</span>${vendorProductStatusBadge(p)}</div>
            <div class="vm-order-meta">Stock ${p.stock != null ? p.stock : "-"}</div>
            <div class="vm-order-bottom"><span class="vm-order-amount">${vmFmtUgx(p.price)}</span></div>
        </div>
    </div>`;
}

function vmToggleProduct(id) {
    const checked = !vendorProductsSelected.has(Number(id));
    toggleVendorProductSelect(id, checked); // shared with desktop selection
    vmRenderProductsList();
    vmUpdateBulkBar();
}

function vmRenderProductsList() {
    const el = document.getElementById("vm-products-list");
    const rows = vmProductsFilter === "all" ? vendorProductsCache : vendorProductsCache.filter(p => vendorProductFilterKey(p) === vmProductsFilter);
    if (!rows || rows.length === 0) {
        el.innerHTML = '<div class="vm-empty-state">No records found!</div>';
        return;
    }
    el.innerHTML = rows.map(vmProductCard).join("");
}

function vmUpdateBulkBar() {
    const label = document.getElementById("vm-bulk-label");
    if (label) label.textContent = vendorProductsSelected.size > 0 ? `${vendorProductsSelected.size} selected` : "Select items to apply bulk actions";
}

async function vmBulkAction(action) {
    if (vendorProductsSelected.size === 0) { alert("Select at least one product first."); return; }
    await bulkVendorProductAction(action); // confirms, calls the API, and refreshes vendorProductsCache
    vmRenderProductsPills();
    vmRenderProductsList();
    vmUpdateBulkBar();
}

function vmExportProductsCsv() {
    const rows = vmProductsFilter === "all" ? vendorProductsCache : vendorProductsCache.filter(p => vendorProductFilterKey(p) === vmProductsFilter);
    if (!rows || rows.length === 0) { alert("Nothing to export in this view."); return; }
    const header = ["Product Name", "Status", "Stock", "Price (UGX)"];
    const lines = [header.join(",")].concat(rows.map(p => [
        `"${(p.name || "").replace(/"/g, '""')}"`,
        vendorProductFilterKey(p),
        p.stock != null ? p.stock : "",
        p.price != null ? p.price : ""
    ].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lizimas-products.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Menu ------------------------------------------------------------------

async function vmLoadMenu() {
    const el = document.getElementById("vm-menu-account");
    try {
        const v = await vendorAuthorizedFetch("/api/vendors/me");
        el.innerHTML = `
            <span style="width:44px; height:44px; border-radius:50%; background:var(--vm-navy); color:var(--vm-gold); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:17px; flex-shrink:0;">${(v.business_name || "L").charAt(0).toUpperCase()}</span>
            <div style="flex:1; min-width:0;">
                <div style="font-size:14.5px; font-weight:700; color:var(--vm-navy); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${v.business_name || "Lizimas Store"}</div>
                <div style="font-size:12px; color:#888;">${vmStatusCopy(v.status).text}</div>
            </div>`;
    } catch (error) {
        console.error("vmLoadMenu error:", error);
    }
}

// --- Settings, Shop Activation & Holiday Mode -------------------------------

let vmShopStatusCache = { shopActive: true, holidayMode: { active: false } };

async function vmLoadSettings() {
    try {
        const s = await vendorAuthorizedFetch("/api/vendors/me/shop-status");
        if (s.error) return;
        vmShopStatusCache = s;

        const toggle = document.getElementById("vm-shop-active-toggle");
        toggle.classList.toggle("checked", !!s.shopActive);
        toggle.innerHTML = s.shopActive ? VM_ICON.check : "";
        document.getElementById("vm-shop-active-sub").textContent = s.shopActive ? "Your shop is visible to customers" : "Your shop is hidden from customers";

        const holidaySub = document.getElementById("vm-holiday-sub");
        holidaySub.textContent = s.holidayMode.active ? `On until ${s.holidayMode.endDate}` : "Off";
    } catch (error) {
        console.error("vmLoadSettings error:", error);
    }
}

async function vmToggleShopActive() {
    const turningOff = vmShopStatusCache.shopActive;
    const msg = turningOff
        ? "Turn your shop off? All of your products will be hidden from customers immediately."
        : "Turn your shop back on? Your products will become visible to customers again.";
    if (!confirm(msg)) return;
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/shop-active", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !vmShopStatusCache.shopActive })
        });
        if (result.error) { alert(result.error); return; }
        vmShopStatusCache.shopActive = result.shopActive;
        vmLoadSettings();
    } catch (error) {
        console.error("vmToggleShopActive error:", error);
        alert("Could not update shop status.");
    }
}

async function vmLoadHolidayMode() {
    try {
        const s = await vendorAuthorizedFetch("/api/vendors/me/shop-status");
        if (s.error) return;
        vmShopStatusCache = s;
        const active = s.holidayMode.active;
        document.getElementById("vm-holiday-form").hidden = active;
        document.getElementById("vm-holiday-active-view").hidden = !active;
        if (active) {
            document.getElementById("vm-holiday-active-dates").textContent = `${s.holidayMode.startDate} to ${s.holidayMode.endDate}`;
        } else {
            document.getElementById("vm-holiday-start").value = "";
            document.getElementById("vm-holiday-end").value = "";
            vmUpdateHolidaySaveState();
        }
    } catch (error) {
        console.error("vmLoadHolidayMode error:", error);
    }
}

function vmUpdateHolidaySaveState() {
    const start = document.getElementById("vm-holiday-start").value;
    const end = document.getElementById("vm-holiday-end").value;
    const btn = document.getElementById("vm-holiday-save-btn");
    const help = document.getElementById("vm-holiday-help");
    const valid = start && end && end >= start;
    btn.disabled = !valid;
    help.textContent = valid ? "" : (start && end && end < start ? "End date must be after start date." : "Choose a start and end date to turn on Holiday Mode.");
}

async function vmSaveHolidayMode() {
    const startDate = document.getElementById("vm-holiday-start").value;
    const endDate = document.getElementById("vm-holiday-end").value;
    const help = document.getElementById("vm-holiday-help");
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/holiday-mode", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: true, startDate, endDate })
        });
        if (result.error) { help.textContent = result.error; help.style.color = "var(--vm-red)"; return; }
        vmLoadHolidayMode();
    } catch (error) {
        console.error("vmSaveHolidayMode error:", error);
        help.textContent = "Could not save. Please try again.";
    }
}

async function vmTurnOffHolidayMode() {
    if (!confirm("Turn off Holiday Mode? Your products will become visible again right away.")) return;
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/holiday-mode", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: false })
        });
        if (result.error) { alert(result.error); return; }
        vmLoadHolidayMode();
    } catch (error) {
        console.error("vmTurnOffHolidayMode error:", error);
        alert("Could not update Holiday Mode.");
    }
}

// --- Add Product (quick-add: core fields only) ---------------------------
// A focused subset of the desktop Add Product form (name/category/
// description/payout/stock/package size/photos/authenticity) - brand,
// warranty, GTIN, MPN and variants stay desktop-only for now, added from
// there once the product exists. Posts to the SAME /api/vendors/products
// endpoint submitVendorProductForm() uses, just via its own vm- prefixed
// fields rather than sharing DOM ids with the desktop form (two elements
// sharing one id would break whichever form runs second).

let vmPricingPreviewTimer = null;

async function vmLoadAddProduct() {
    if (!staffCategoriesLoaded) {
        try {
            const response = await fetch(`${API_URL}/api/products/categories`);
            staffCategories = await response.json();
            staffCategoriesLoaded = true;
        } catch (error) {
            console.error("vmLoadAddProduct categories error:", error);
        }
    }
    const select = document.getElementById("vm-product-category");
    if (select && staffCategories) select.innerHTML = buildGroupedCategoryOptions(staffCategories);
    document.getElementById("vm-product-form-status").textContent = "";
}

function vmSchedulePricingPreview() {
    clearTimeout(vmPricingPreviewTimer);
    vmPricingPreviewTimer = setTimeout(vmUpdatePricingPreview, 400);
}

function vmHidePricingPreview() {
    document.getElementById("vm-pricing-preview").style.display = "none";
    document.getElementById("vm-pricing-preview-error").style.display = "none";
}

async function vmUpdatePricingPreview() {
    const payoutRaw = document.getElementById("vm-product-payout").value;
    const categoryId = document.getElementById("vm-product-category").value;
    const previewEl = document.getElementById("vm-pricing-preview");
    const errorEl = document.getElementById("vm-pricing-preview-error");

    const payout = Number(payoutRaw);
    if (!payoutRaw || !(payout > 0)) { vmHidePricingPreview(); return; }

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
        errorEl.style.display = "none";
        previewEl.style.display = "block";
        document.getElementById("vm-preview-customer-price").textContent = Number(result.customer_price).toLocaleString();
        document.getElementById("vm-preview-payout").textContent = Number(result.vendor_payout).toLocaleString();
    } catch (error) {
        console.error("vmUpdatePricingPreview error:", error);
    }
}

async function vmSubmitProduct() {
    const name = document.getElementById("vm-product-name").value.trim();
    const category_id = document.getElementById("vm-product-category").value;
    const description = document.getElementById("vm-product-description").value.trim();
    const desiredPayout = document.getElementById("vm-product-payout").value;
    const stock = document.getElementById("vm-product-stock").value;
    const packageSize = document.getElementById("vm-product-package-size").value;
    const imageFiles = document.getElementById("vm-product-images").files;
    const statusEl = document.getElementById("vm-product-form-status");
    const submitBtn = document.getElementById("vm-product-submit-btn");

    if (!name || !desiredPayout || !stock) {
        statusEl.textContent = "Name, payout, and stock are required.";
        return;
    }
    if (!document.getElementById("vm-product-authenticity-confirm").checked) {
        statusEl.textContent = "Please confirm the authenticity statement to continue.";
        return;
    }

    submitBtn.disabled = true;
    submitBtn.style.opacity = "0.6";
    statusEl.textContent = "Saving...";

    const formData = new FormData();
    formData.append("name", name);
    formData.append("category_id", category_id);
    formData.append("description", description);
    formData.append("desired_payout", desiredPayout);
    formData.append("stock", stock);
    formData.append("package_size", packageSize);
    for (const file of imageFiles) formData.append("images", file);

    try {
        const token = getVendorToken();
        const response = await fetch(`${API_URL}/api/vendors/products`, {
            method: "POST",
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

        // Reset the quick-add form for next time.
        ["vm-product-name", "vm-product-description", "vm-product-payout", "vm-product-stock"].forEach(id => document.getElementById(id).value = "");
        document.getElementById("vm-product-images").value = "";
        document.getElementById("vm-product-authenticity-confirm").checked = false;
        vmHidePricingPreview();

        vmShowScreen("products");
    } catch (error) {
        console.error("vmSubmitProduct error:", error);
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
        statusEl.textContent = "Could not connect to server.";
    }
}

// --- Promotions ------------------------------------------------------------
// Reuses VENDOR_PROMO_STATUS_CLASS/VENDOR_PROMO_STATUS_LABEL and vendorEsc
// from vendor-dashboard.js; posts to the same /api/vendors/promotions
// endpoint submitVendorPromotion() uses, via its own vm- ids.

async function vmLoadPromotions() {
    await Promise.all([vmPopulatePromoProductSelect(), vmLoadPromotionsList()]);
}

async function vmPopulatePromoProductSelect() {
    const select = document.getElementById("vm-promo-product");
    try {
        const products = await vendorAuthorizedFetch("/api/vendors/products");
        if (products.error) return;
        const eligible = products.filter(p => p.status === "approved" && !p.admin_restricted);
        select.innerHTML = eligible.length === 0
            ? '<option value="">No eligible products</option>'
            : eligible.map(p => `<option value="${p.id}">${vendorEsc(p.name)} (${vmFmtUgx(p.price)})</option>`).join("");
    } catch (error) {
        console.error("vmPopulatePromoProductSelect error:", error);
    }
}

async function vmSubmitPromotion() {
    const productId = document.getElementById("vm-promo-product").value;
    const salePrice = Number(document.getElementById("vm-promo-price").value);
    const startsAt = document.getElementById("vm-promo-starts").value;
    const endsAt = document.getElementById("vm-promo-ends").value;
    const statusEl = document.getElementById("vm-promo-status");

    if (!productId) { statusEl.textContent = "Choose a product first."; return; }
    if (!salePrice || salePrice <= 0) { statusEl.textContent = "Enter a sale price."; return; }
    if (!startsAt || !endsAt) { statusEl.textContent = "Choose a start and end time."; return; }

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
        if (data.error) { statusEl.textContent = data.error; return; }
        statusEl.textContent = "Submitted for review.";
        document.getElementById("vm-promo-price").value = "";
        document.getElementById("vm-promo-starts").value = "";
        document.getElementById("vm-promo-ends").value = "";
        await vmLoadPromotionsList();
    } catch (error) {
        console.error("vmSubmitPromotion error:", error);
        statusEl.textContent = "Could not connect to server.";
    }
}

function vmPromotionCard(r) {
    return `<div class="vm-order-card">
        <div class="vm-order-card-top">
            <span class="vm-order-no">${vendorEsc(r.product_name)}</span>
            <span class="status-badge ${VENDOR_PROMO_STATUS_CLASS[r.resolutionStatus] || ""}">${VENDOR_PROMO_STATUS_LABEL[r.resolutionStatus] || r.resolutionStatus}</span>
        </div>
        <div class="vm-order-bottom" style="margin-bottom:4px;">
            <span style="text-decoration:line-through; color:#888;">${vmFmtUgx(r.original_price)}</span>
            <span class="vm-order-amount">${vmFmtUgx(r.proposed_sale_price)}</span>
        </div>
        <div class="vm-order-meta">${new Date(r.starts_at).toLocaleDateString()} &ndash; ${new Date(r.ends_at).toLocaleDateString()}</div>
        ${r.homepage_featured ? '<span class="status-badge status-paid" style="margin-top:6px; display:inline-block;">Featured</span>' : ""}
        ${r.rejection_reason ? `<div style="font-size:11px; color:#991B1B; margin-top:6px;">${vendorEsc(r.rejection_reason)}</div>` : ""}
    </div>`;
}

async function vmLoadPromotionsList() {
    const box = document.getElementById("vm-promotions-list");
    box.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        const rows = await vendorAuthorizedFetch("/api/vendors/promotions");
        if (rows.error) { box.innerHTML = `<div class="vm-loading-state">${vendorEsc(rows.error)}</div>`; return; }
        if (rows.length === 0) { box.innerHTML = '<div class="vm-empty-state">No promotions proposed yet.</div>'; return; }
        box.innerHTML = rows.map(vmPromotionCard).join("");
    } catch (error) {
        console.error("vmLoadPromotionsList error:", error);
        box.innerHTML = '<div class="vm-loading-state">Could not load promotions.</div>';
    }
}

// --- Account Statements (Wallet) --------------------------------------------
// Reuses VENDOR_PAYOUT_STATUS_CLASS/LABEL and vendorEsc from
// vendor-dashboard.js; same /api/vendors/wallet and
// /api/vendors/wallet/payout-requests endpoints requestVendorPayout() uses.

let vmWalletEligible = false;

async function vmLoadWallet() {
    const el = document.getElementById("vm-wallet-body");
    el.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/wallet");
        if (data.error) { el.innerHTML = `<div class="vm-loading-state">${vendorEsc(data.error)}</div>`; return; }
        vmWalletEligible = !!data.eligibility.allowed;
        el.innerHTML = vmRenderWallet(data);
    } catch (error) {
        console.error("vmLoadWallet error:", error);
        el.innerHTML = '<div class="vm-loading-state">Could not load your wallet.</div>';
    }
}

function vmRenderWallet(data) {
    const b = data.balance;
    const summary = `<div class="vm-card">
        <div class="vm-stat-row">${vmStatTile("Available Balance", vmFmtUgx(b.available), "var(--vm-green-text)")}${vmStatTile("Pending", vmFmtUgx(b.pending), "var(--vm-amber-text)")}</div>
        <div class="vm-stat-row">${vmStatTile("Requested", vmFmtUgx(b.requestedTotal))}${vmStatTile("Paid Out to Date", vmFmtUgx(b.paidOutTotal))}</div>
        <div style="font-size:12px; color:#666; margin:12px 0 14px; line-height:1.5;">
            MoMo number on file: ${data.momoNumber ? vendorEsc(data.momoNumber) : '<span style="color:var(--vm-red);">none - add one in Profile first</span>'}<br>
            Minimum payout: ${vmFmtUgx(data.minPayout)}
        </div>
        <button class="vm-btn-primary" id="vm-request-payout-btn" onclick="vmRequestPayout()" ${data.eligibility.allowed ? "" : "disabled"}>Request Payout</button>
        ${!data.eligibility.allowed ? `<div class="vm-btn-help">${vendorEsc(data.eligibility.reason)}</div>` : ""}
    </div>`;

    const historyRows = data.payouts.length === 0
        ? '<div class="vm-empty-state">No payout requests yet.</div>'
        : data.payouts.map(p => `<div class="vm-order-card">
            <div class="vm-order-card-top"><span class="vm-order-no">${new Date(p.requestedAt).toLocaleDateString()}</span><span class="status-badge ${VENDOR_PAYOUT_STATUS_CLASS[p.status] || ""}">${VENDOR_PAYOUT_STATUS_LABEL[p.status] || p.status}</span></div>
            <div class="vm-order-bottom"><span class="vm-order-amount">${vmFmtUgx(p.amount)}</span><span>${vendorEsc(p.momoNumber || "-")}</span></div>
            ${p.reference ? `<div class="vm-order-meta">Ref: ${vendorEsc(p.reference)}</div>` : ""}
        </div>`).join("");
    const history = `<div class="vm-card-title" style="margin:0 14px 8px;">Payout History</div>` + historyRows;

    const adjustRows = data.adjustments.length === 0
        ? '<div class="vm-empty-state">No balance adjustments.</div>'
        : data.adjustments.map(a => `<div class="vm-order-card">
            <div class="vm-order-card-top"><span class="vm-order-no">${new Date(a.createdAt).toLocaleDateString()}</span><span class="vm-order-amount" style="color:${a.amount >= 0 ? "var(--vm-green-text)" : "var(--vm-red)"};">${a.amount >= 0 ? "+" : ""}${vmFmtUgx(a.amount)}</span></div>
            <div class="vm-order-meta">${vendorEsc(a.reason)}</div>
        </div>`).join("");
    const adjustments = `<div class="vm-card-title" style="margin:18px 14px 8px;">Balance Adjustments</div>` + adjustRows;

    return summary + history + adjustments;
}

async function vmRequestPayout() {
    if (!confirm("Request a payout of your full available balance via MoMo?")) return;
    const btn = document.getElementById("vm-request-payout-btn");
    if (btn) btn.disabled = true;
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/wallet/payout-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        if (data.error) { alert(data.error); if (btn) btn.disabled = false; return; }
        alert("Payout requested. Lizimas will review it and send your MoMo transfer.");
        await vmLoadWallet();
    } catch (error) {
        console.error("vmRequestPayout error:", error);
        alert("Could not connect to server.");
        if (btn) btn.disabled = false;
    }
}

// --- Profile ----------------------------------------------------------------
// Merges what the desktop splits across two tabs (Overview's profile
// details + Account's notices/logout) into one mobile screen, plus the
// editable MoMo number saveVendorMomoNumber() already exposes on desktop.
// Reuses VENDOR_NOTICE_CLASS/LABEL and vendorEsc.

async function vmLoadProfile() {
    const el = document.getElementById("vm-profile-body");
    el.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        const [v, notices] = await Promise.all([
            vendorAuthorizedFetch("/api/vendors/me"),
            vendorAuthorizedFetch("/api/vendors/compliance-notices")
        ]);
        if (v.error) { el.innerHTML = `<div class="vm-loading-state">${vendorEsc(v.error)}</div>`; return; }
        el.innerHTML = vmRenderProfile(v, Array.isArray(notices) ? notices : []);
        const momoInput = document.getElementById("vm-momo-input");
        if (momoInput) momoInput.value = v.momo_number || "";
    } catch (error) {
        console.error("vmLoadProfile error:", error);
        el.innerHTML = '<div class="vm-loading-state">Could not load your profile.</div>';
    }
}

function vmNoticeCard(n) {
    return `<div class="vm-order-card">
        <div class="vm-order-card-top"><span class="vm-order-no">${new Date(n.created_at).toLocaleDateString()}</span><span class="status-badge ${VENDOR_NOTICE_CLASS[n.action_type] || ""}">${VENDOR_NOTICE_LABEL[n.action_type] || n.action_type}</span></div>
        <div class="vm-order-meta">${vendorEsc(n.reason)}${n.product_name ? ` (${vendorEsc(n.product_name)})` : ""}</div>
    </div>`;
}

function vmRenderProfile(v, notices) {
    const s = vmStatusCopy(v.status);
    const statusCard = `<div class="vm-card"><div style="display:inline-block; padding:6px 14px; border-radius:999px; background:${s.bg}; color:${s.color}; font-weight:700; font-size:13px;">${s.text}</div></div>`;

    const rows = [
        ["Shop Name", v.business_name || "-"],
        ["Account Type", v.account_type === "company" ? "Company" : v.account_type === "individual" ? "Individual" : "-"],
        ["Phone", v.phone || "-"],
        ["Location", v.physical_address || "-"],
        ["Applied", v.submitted_at ? new Date(v.submitted_at).toLocaleDateString() : "-"]
    ].map(([label, value]) => `<div style="display:flex; align-items:center; justify-content:space-between; padding:9px 0; border-bottom:1px solid #f0f1f4;"><span style="font-size:12.5px; color:#888;">${label}</span><span style="font-size:13px; font-weight:600; color:var(--vm-navy); text-align:right;">${vendorEsc(value)}</span></div>`).join("");
    const detailsCard = `<div class="vm-card"><div class="vm-card-title">Your Details</div>${rows}</div>`;

    const momoCard = `<div class="vm-card">
        <div class="vm-card-title">MoMo Payout Number</div>
        <div class="vm-card-subtitle">Where your payouts are sent</div>
        <input type="text" id="vm-momo-input" class="vm-field-input" placeholder="e.g. 07XXXXXXXX" style="margin-bottom:10px;">
        <button class="vm-btn-primary" onclick="vmSaveMomoNumber()">Save</button>
        <div class="vm-btn-help" id="vm-momo-status"></div>
    </div>`;

    const noticesCard = `<div class="vm-card"><div class="vm-card-title">Notices</div>${notices.length === 0 ? '<div style="font-size:12.5px; color:#888;">No notices on your account.</div>' : notices.map(vmNoticeCard).join("")}</div>`;

    const logoutRow = `<div class="vm-card" style="padding:4px 16px;"><button class="vm-list-row vm-danger" onclick="vendorLogout()">
        <span class="vm-list-row-label">Logout</span>
    </button></div>`;

    return statusCard + detailsCard + momoCard + noticesCard + logoutRow;
}

async function vmSaveMomoNumber() {
    const statusEl = document.getElementById("vm-momo-status");
    const momo_number = document.getElementById("vm-momo-input").value.trim();
    statusEl.style.color = "#555";
    statusEl.textContent = "Saving...";
    try {
        await vendorAuthorizedFetch("/api/vendors/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ momo_number: momo_number || null })
        });
        statusEl.style.color = "var(--vm-green-text)";
        statusEl.textContent = "Saved.";
    } catch (error) {
        console.error("vmSaveMomoNumber error:", error);
        statusEl.style.color = "var(--vm-red)";
        statusEl.textContent = "Could not save. Please try again.";
    }
}

// --- Init --------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector(".vendor-mobile-shell")) return;
    vmSetupNav();
    const startEl = document.getElementById("vm-holiday-start");
    const endEl = document.getElementById("vm-holiday-end");
    if (startEl) startEl.addEventListener("change", vmUpdateHolidaySaveState);
    if (endEl) endEl.addEventListener("change", vmUpdateHolidaySaveState);
    vmShowScreen("home");
});
