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

const VM_NAV_SCREENS = ["home", "products", "orders", "account"]; // bottom-nav-level screens
let vmNavStack = ["account"]; // back-target for a sub-screen reached from Account

// Which bottom-nav tab should stay highlighted while a nested (non-nav)
// screen is open, keyed by where that screen is actually reached from -
// add-product from the Manage Products FAB, everything else from Account.
const VM_NAV_FALLBACK = {
    "add-product": "products",
    "promotions": "account",
    "wallet": "account",
    "settings": "account",
    "holiday-mode": "account",
    "commissions-fees": "account",
    "jumia": "account",
    "jumia-import": "account"
};

function vmShowScreen(name, opts) {
    opts = opts || {};
    document.querySelectorAll(".vm-screen").forEach(el => el.classList.remove("active"));
    const target = document.getElementById(`vm-screen-${name}`);
    if (target) target.classList.add("active");

    document.querySelectorAll(".vm-nav-item").forEach(el => el.classList.remove("active"));
    const navKey = VM_NAV_SCREENS.includes(name) ? name : (VM_NAV_FALLBACK[name] || "account");
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
    if (name === "account") vmLoadProfile();
    if (name === "settings") vmLoadSettings();
    if (name === "holiday-mode") vmLoadHolidayMode();
    if (name === "jumia") vmLoadJumia();
    if (name === "jumia-import") vmLoadJumiaImport();
    if (name === "add-product") vmLoadAddProduct();
    if (name === "promotions") vmLoadPromotions();
    if (name === "wallet") vmLoadWallet();
}

function vmGoBack() {
    vmNavStack.pop();
    const prev = vmNavStack[vmNavStack.length - 1] || "account";
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
// --- Applications: Jumia product linking -----------------------------------
// Settings > Applications (Ryan, Sept 2026 - "link products from Lizimas
// directly to Jumia, and vendors already on Jumia can link products from
// Jumia to Lizimas"). A vendor pastes the Client ID/Secret from an
// Application they create on Jumia's own Vendor Center (Settings >
// Applications there); Lizimas exchanges those for an access token
// (server/services/jumiaClient.js) and stores everything encrypted -
// nothing here ever sees a plaintext secret again after the initial paste.
// See jumiaClient.js's header for what part of the Jumia side of this is
// still unverified against a real Jumia Application.

let vmJumiaConnectionCache = { connected: false };
let vmJumiaRemoteProductsCache = new Map(); // seller_sku -> remote product object, for the import screen
let vmJumiaImportSelected = new Set();

async function vmLoadJumia() {
    const sub = document.getElementById("vm-jumia-status-sub");
    try {
        const status = await vendorAuthorizedFetch("/api/vendors/me/jumia/connection");
        if (status.error) { console.error("vmLoadJumia error:", status.error); return; }
        vmJumiaConnectionCache = status;

        const disconnectedView = document.getElementById("vm-jumia-disconnected-view");
        const connectedView = document.getElementById("vm-jumia-connected-view");
        const connectActions = document.getElementById("vm-jumia-connect-actions");
        const syncCard = document.getElementById("vm-jumia-sync-card");
        vmCancelUpdateJumiaSecret();

        if (status.connected) {
            disconnectedView.hidden = true;
            connectedView.hidden = false;
            connectActions.hidden = true;
            syncCard.hidden = false;
            document.getElementById("vm-jumia-shop-name").textContent = status.jumia_shop_name || "";
            document.getElementById("vm-jumia-client-id-display").textContent = status.client_id || "";
            if (sub) sub.textContent = "Connected";
            vmLoadJumiaLinks();
        } else {
            disconnectedView.hidden = false;
            connectedView.hidden = true;
            connectActions.hidden = false;
            syncCard.hidden = true;
            if (sub) sub.textContent = status.connection_status === "error" ? "Connection error" : "Not connected";
            const help = document.getElementById("vm-jumia-help");
            if (status.last_error && help) { help.textContent = status.last_error; help.style.color = "var(--vm-red)"; }
        }
    } catch (error) {
        console.error("vmLoadJumia error:", error);
    }
}

// Rotating the secret (padlock icon on the connected row) - Client ID
// stays the same, only a new Secret is submitted. Mirrors Jumia's own
// Applications table, where the secret is never shown in the list and a
// dedicated icon is how you deal with it - on our side that means
// re-entering a new one rather than revealing the stored one, since the
// vendor's secret is encrypted at rest and this app never sends it back
// to the browser once saved.
function vmShowUpdateJumiaSecret() {
    document.getElementById("vm-jumia-update-secret-view").hidden = false;
    document.getElementById("vm-jumia-update-secret-actions").hidden = false;
    const input = document.getElementById("vm-jumia-new-secret");
    input.value = "";
    input.focus();
}

function vmCancelUpdateJumiaSecret() {
    const view = document.getElementById("vm-jumia-update-secret-view");
    const actions = document.getElementById("vm-jumia-update-secret-actions");
    if (view) view.hidden = true;
    if (actions) actions.hidden = true;
    const input = document.getElementById("vm-jumia-new-secret");
    if (input) input.value = "";
}

async function vmSaveUpdatedJumiaSecret() {
    const newSecret = document.getElementById("vm-jumia-new-secret").value.trim();
    if (!newSecret) { alert("Enter the new Client Secret first."); return; }
    if (!vmJumiaConnectionCache.client_id) { alert("Missing Client ID - reconnect from scratch instead."); return; }
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/connection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: vmJumiaConnectionCache.client_id, client_secret: newSecret })
        });
        if (result.error) { alert(result.error); return; }
        vmLoadJumia();
    } catch (error) {
        console.error("vmSaveUpdatedJumiaSecret error:", error);
        alert("Could not update the secret. Please try again.");
    }
}

async function vmConnectJumia() {
    const clientId = document.getElementById("vm-jumia-client-id").value.trim();
    const clientSecret = document.getElementById("vm-jumia-client-secret").value.trim();
    const help = document.getElementById("vm-jumia-help");
    if (!clientId || !clientSecret) {
        if (help) { help.textContent = "Enter both the Client ID and Client Secret."; help.style.color = "var(--vm-red)"; }
        return;
    }
    const btn = document.getElementById("vm-jumia-connect-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Connecting..."; }
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/connection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
        });
        if (result.error) {
            if (help) { help.textContent = result.error; help.style.color = "var(--vm-red)"; }
            return;
        }
        document.getElementById("vm-jumia-client-secret").value = "";
        vmLoadJumia();
    } catch (error) {
        console.error("vmConnectJumia error:", error);
        if (help) { help.textContent = "Could not connect. Please try again."; help.style.color = "var(--vm-red)"; }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Connect to Jumia"; }
    }
}

async function vmDisconnectJumia() {
    if (!confirm("Disconnect this Jumia account? Product syncing will stop until you reconnect.")) return;
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/connection", { method: "DELETE" });
        if (result.error) { alert(result.error); return; }
        vmLoadJumia();
    } catch (error) {
        console.error("vmDisconnectJumia error:", error);
        alert("Could not disconnect.");
    }
}

async function vmTestJumiaConnection() {
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/connection/test", { method: "POST" });
        if (result.error) { alert(result.error); vmLoadJumia(); return; }
        alert("Connection is working.");
        vmLoadJumia();
    } catch (error) {
        console.error("vmTestJumiaConnection error:", error);
        alert("Could not verify the connection.");
    }
}

async function vmLoadJumiaLinks() {
    const list = document.getElementById("vm-jumia-links-list");
    if (!list) return;
    try {
        const links = await vendorAuthorizedFetch("/api/vendors/me/jumia/links");
        if (links.error) return;
        vmRenderJumiaLinks(links);
    } catch (error) {
        console.error("vmLoadJumiaLinks error:", error);
    }
}

const VM_JUMIA_STATUS_LABEL = {
    pending: ["Pending", "#888"],
    synced: ["Synced", "var(--vm-green-text)"],
    failed: ["Failed", "#DC2626"],
    out_of_sync: ["Changed since last sync", "#B45309"]
};

function vmRenderJumiaLinks(links) {
    const list = document.getElementById("vm-jumia-links-list");
    if (!links || links.length === 0) {
        list.innerHTML = '<div style="font-size:12.5px; color:#888; padding:8px 0;">No products linked yet.</div>';
        return;
    }
    list.innerHTML = links.map(link => {
        const status = link.locally_changed_since_sync ? "out_of_sync" : link.sync_status;
        const [label, color] = VM_JUMIA_STATUS_LABEL[status] || [status, "#888"];
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eee;">
            <div>
                <div style="font-size:13px; font-weight:600; color:var(--vm-navy);">${vendorEsc(link.product_name || link.jumia_seller_sku)}</div>
                <div style="font-size:11.5px; color:#999;">${link.sync_direction === "pull" ? "From Jumia" : "To Jumia"}${link.last_error ? " &bull; " + vendorEsc(link.last_error) : ""}</div>
            </div>
            <span style="font-size:12px; font-weight:600; color:${color};">${label}</span>
        </div>`;
    }).join("");
}

async function vmPushSelectedToJumia() {
    if (vendorProductsSelected.size === 0) { alert("Select at least one product first."); return; }
    if (!vmJumiaConnectionCache.connected) { alert("Connect to Jumia first (Menu > Settings > Applications)."); return; }
    const ids = Array.from(vendorProductsSelected);
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
    } catch (error) {
        console.error("vmPushSelectedToJumia error:", error);
        alert("Could not push products to Jumia.");
    }
}

// --- Import from Jumia ---

async function vmLoadJumiaImport() {
    const list = document.getElementById("vm-jumia-import-list");
    list.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/jumia/remote-products");
        if (result.error) {
            list.innerHTML = `<div style="font-size:12.5px; color:#DC2626;">${vendorEsc(result.error)}</div>`;
            return;
        }
        vmJumiaRemoteProductsCache = new Map((result.items || []).map(item => [item.seller_sku, item]));
        vmRenderJumiaImportList(result.items || []);
    } catch (error) {
        console.error("vmLoadJumiaImport error:", error);
        list.innerHTML = '<div style="font-size:12.5px; color:#DC2626;">Could not load your Jumia products.</div>';
    }
}

function vmRenderJumiaImportList(items) {
    const list = document.getElementById("vm-jumia-import-list");
    vmJumiaImportSelected = new Set();
    if (!items || items.length === 0) {
        list.innerHTML = '<div style="font-size:12.5px; color:#888; padding:8px 0;">No Jumia products found.</div>';
        document.getElementById("vm-jumia-import-actions").hidden = true;
        return;
    }
    list.innerHTML = items.map(item => {
        const disabled = item.already_linked;
        return `<label style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #eee; ${disabled ? "opacity:.5;" : ""}">
            <input type="checkbox" ${disabled ? "disabled" : ""} onchange="vmToggleJumiaImportSelect('${vendorEsc(item.seller_sku)}', this.checked)">
            <div style="flex:1;">
                <div style="font-size:13px; font-weight:600; color:var(--vm-navy);">${vendorEsc(item.name || item.seller_sku)}</div>
                <div style="font-size:11.5px; color:#999;">${disabled ? "Already imported" : (item.seller_sku || "")}</div>
            </div>
        </label>`;
    }).join("");
    document.getElementById("vm-jumia-import-actions").hidden = false;
}

function vmToggleJumiaImportSelect(sellerSku, checked) {
    if (checked) vmJumiaImportSelected.add(sellerSku);
    else vmJumiaImportSelected.delete(sellerSku);
    const help = document.getElementById("vm-jumia-import-help");
    if (help) help.textContent = vmJumiaImportSelected.size > 0 ? `${vmJumiaImportSelected.size} selected` : "";
}

async function vmImportSelectedJumiaProducts() {
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
        vmShowScreen("jumia", { isBack: true });
    } catch (error) {
        console.error("vmImportSelectedJumiaProducts error:", error);
        alert("Could not import products.");
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
    const specsList = document.getElementById("vm-specs-list");
    if (specsList) specsList.innerHTML = "";
    const specsPasteBox = document.getElementById("vm-specs-paste-box");
    if (specsPasteBox) specsPasteBox.value = "";
    vmSpecRowCounter = 0;
}

// Same key/value structure as desktop's Specifications section (and
// staff/admin's) - kept as its own vm-prefixed id/function pair since this
// screen shares the page with the desktop admin-shell's own #specs-list.
let vmSpecRowCounter = 0;

function vmAddSpecRow(label, value) {
    const list = document.getElementById("vm-specs-list");
    if (!list) return;
    const rowId = `vm-spec-row-${vmSpecRowCounter++}`;
    const row = document.createElement("div");
    row.id = rowId;
    row.style.cssText = "display:flex; gap:6px;";
    row.innerHTML = `
        <input type="text" class="vm-field-input vm-spec-label-input" placeholder="Label (e.g. Material)" value="${label || ''}" style="flex:1;">
        <input type="text" class="vm-field-input vm-spec-value-input" placeholder="Value (e.g. Polyester)" value="${value || ''}" style="flex:1;">
        <button type="button" onclick="document.getElementById('${rowId}').remove()" style="padding:0 12px; border-radius:8px; border:1px solid #dfe1e8; background:#fff; cursor:pointer;">&times;</button>
    `;
    list.appendChild(row);
}

function vmCollectSpecRows() {
    const rows = document.querySelectorAll("#vm-specs-list > div");
    const specs = [];
    rows.forEach(row => {
        const label = row.querySelector(".vm-spec-label-input").value.trim();
        const value = row.querySelector(".vm-spec-value-input").value.trim();
        if (label) specs.push({ label, value });
    });
    return specs;
}

// Same paste-from-Excel parsing as the desktop Add Product form
// (client/js/vendor-dashboard.js's vendorParseSpecLine) - tab-separated
// first (how Excel copies two adjacent columns), then 2+ spaces or a
// colon as forgiving fallbacks. Last resort - a curated list of common spec
// labels for sources that lose the separator entirely (e.g. copying out of
// a rendered spec table gives "OsiOS" with nothing between "Os" and "iOS").
// Mirrors vendorMatchKnownSpecLabel/VENDOR_KNOWN_SPEC_LABELS in
// vendor-dashboard.js - kept duplicated since desktop and mobile are
// separate files, same as the rest of this parser.
const VM_KNOWN_SPEC_LABELS = [
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

function vmMatchKnownSpecLabel(line) {
    const lower = line.toLowerCase();
    for (const candidate of VM_KNOWN_SPEC_LABELS) {
        if (lower.startsWith(candidate.toLowerCase())) {
            const value = line.slice(candidate.length).trim();
            if (value) return { label: line.slice(0, candidate.length).trim(), value };
        }
    }
    return null;
}

function vmParseSpecLine(line) {
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
    const knownLabelMatch = vmMatchKnownSpecLabel(line);
    if (knownLabelMatch) return knownLabelMatch;
    return { label: line.trim(), value: "" };
}

function vmParseAndAddSpecs() {
    const box = document.getElementById("vm-specs-paste-box");
    if (!box || !box.value.trim()) return;
    const lines = box.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach(line => {
        const { label, value } = vmParseSpecLine(line);
        if (label) vmAddSpecRow(label, value);
    });
    box.value = "";
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

        const specsPayload = vmCollectSpecRows();
        if (data.product && data.product.id && specsPayload.length > 0) {
            try {
                await vendorAuthorizedFetch(`/api/vendors/products/${data.product.id}/options`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ specs: specsPayload })
                });
            } catch (optionsError) {
                console.error("vmSubmitProduct specs error:", optionsError);
            }
        }

        // Reset the quick-add form for next time.
        ["vm-product-name", "vm-product-description", "vm-product-payout", "vm-product-stock"].forEach(id => document.getElementById(id).value = "");
        document.getElementById("vm-product-images").value = "";
        document.getElementById("vm-product-authenticity-confirm").checked = false;
        document.getElementById("vm-specs-list").innerHTML = "";
        const vmSpecsPasteBoxAfterSubmit = document.getElementById("vm-specs-paste-box");
        if (vmSpecsPasteBoxAfterSubmit) vmSpecsPasteBoxAfterSubmit.value = "";
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

    const moreCard = `<div class="vm-card" style="padding:4px 16px;">
        <button class="vm-list-row" onclick="vmShowScreen('promotions')">
            <span class="vm-list-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 13v-2Z"/><path d="M11.6 16.8 13 21h-3l-1.4-4.8"/></svg></span>
            <span class="vm-list-row-label">Promotions</span>
            <span class="vm-list-row-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>
        </button>
        <button class="vm-list-row" onclick="vmShowScreen('wallet')">
            <span class="vm-list-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg></span>
            <span class="vm-list-row-label">Account Statements</span>
            <span class="vm-list-row-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>
        </button>
        <button class="vm-list-row" onclick="vmShowScreen('settings')">
            <span class="vm-list-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg></span>
            <span class="vm-list-row-label">Settings</span>
            <span class="vm-list-row-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>
        </button>
        <div class="vm-list-row vm-muted" style="cursor:default;">
            <span class="vm-list-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg></span>
            <span class="vm-list-row-label">Stock Recommendation</span>
            <span class="vm-badge-soon">Coming soon</span>
        </div>
        <div class="vm-list-row vm-muted" style="cursor:default;">
            <span class="vm-list-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 8a4 4 0 0 1 0 8"/><path d="M19 5a8 8 0 0 1 0 14"/></svg></span>
            <span class="vm-list-row-label">Advertise your Products</span>
            <span class="vm-badge-soon">Coming soon</span>
        </div>
        <button class="vm-list-row" onclick="alert('Give us your feedback needs a bigger screen for now \u2014 switch to desktop.')">
            <span class="vm-list-row-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg></span>
            <span class="vm-list-row-label">Give us your feedback!</span>
            <span class="vm-list-row-chevron"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></span>
        </button>
    </div>
    <div class="vm-note vm-note-amber">"Stock Recommendation" and "Advertise your Products" mirror Jumia's marketplace tools and aren't built in Lizimas yet.</div>`;

    const logoutRow = `<div class="vm-card" style="padding:4px 16px; margin-top:14px;"><button class="vm-list-row vm-danger" onclick="vendorLogout()">
        <span class="vm-list-row-label">Logout</span>
    </button></div>`;

    return statusCard + detailsCard + momoCard + moreCard + noticesCard + logoutRow;
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
