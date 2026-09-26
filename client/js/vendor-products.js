// Product Management - vendor desktop + mobile (Ryan, Sept 2026).
//
// Desktop follows Vendor Center's Product Management page: breadcrumb,
// Manage Columns / Add Product / Import-Export, grouped STATUS pills, search
// by product name + Countries, bulk bar (Activate + More Actions), table
// Name / Seller SKU / Price / Sale Price / Subsidy Price / Quantity /
// Visible / Active / Actions.
// Mobile follows the mobile Orders layout: STATUS pills with counts,
// COUNTRY chip, search by product name + search by Seller SKU, select-all
// + "Product actions" + go button, list, pager + items per page, floating
// Export + filter buttons.
//
// Loaded AFTER vendor-dashboard.js and vendor-mobile.js - it owns
// loadVendorProducts / renderVendorProductsTable / updateVendorProductsBulkBar
// / setVendorProductsFilter / toggleAllVendorProductsSelect (desktop) and
// vmLoadProducts (mobile). It reuses vendorProductsCache, vendorProductsSelected,
// toggleVendorProductSelect, bulkVendorProductAction(+Single),
// editVendorProduct, vendorQualityScoreBadge and vendorEsc from
// vendor-dashboard.js.
//
// What each status means (also in the vendor guide):
//   Pending QC      status pending and the listing has image + category + price
//   Not Ready To QC status pending but one of those is missing
//   Approved/Rejected  QC outcome (products.status)
//   Active/Inactive the vendor's own on/off switch (products.is_active)
//   Deleted         soft-deleted (products.deleted_at)
//   Live            approved + active + not restricted + quantity > 0 -
//                   customers can see and buy it
//   Unauthorized    restricted by Lizimas Store (products.admin_restricted)
//   Pending Deletion a deletion request waiting for review

let vpAllProducts = [];
const VP_FILTER_DEFAULTS = { currency: "local", preset: "", from: "", to: "", visibility: "all", stock: "all" };
const vpState = { filter: "all", name: "", sku: "", page: 1, perPage: 50, mAction: "", ...VP_FILTER_DEFAULTS };
let vpUsdRate = null; // UGX per USD, fetched when the vendor picks USD

const VP_FILTER_GROUPS = [
    [["all", "All"]],
    [["pending_qc", "Pending QC"], ["not_ready", "Not Ready To QC"], ["approved", "Approved"], ["rejected", "Rejected"]],
    [["active", "Active"], ["inactive", "Inactive"], ["deleted", "Deleted"]],
    [["live", "Live"], ["not_live", "Not Live"]],
    [["unauthorized", "Unauthorized"]],
    [["pending_deletion", "Pending Deletion"]]
];

const VP_TESTS = {
    all: (f) => !f.deleted,
    pending_qc: (f) => !f.deleted && f.pending && !f.notReady,
    not_ready: (f) => !f.deleted && f.notReady,
    approved: (f) => !f.deleted && f.approved,
    rejected: (f) => !f.deleted && f.rejected,
    active: (f) => !f.deleted && f.active,
    inactive: (f) => !f.deleted && !f.active,
    deleted: (f) => f.deleted,
    live: (f) => f.live,
    not_live: (f) => !f.deleted && !f.live,
    unauthorized: (f) => !f.deleted && f.unauthorized,
    pending_deletion: (f) => !f.deleted && f.pendingDeletion
};

// Table columns in display order. `fixed` columns always show (Name,
// Seller SKU, Visible, Active, Actions -); the rest are picked
// in Manage Columns > Table Filters (list order = that panel's order).
const VP_COLUMNS = [
    { key: "deletion", label: "Deletion", on: false },
    { key: "lizimas_sku", label: "Lizimas Store SKU", on: false },
    { key: "sku", label: "Seller SKU", on: true, fixed: true },
    { key: "price", label: "Price", on: true },
    { key: "sale", label: "Sale Price", on: true },
    { key: "promo", label: "Promo Price", on: false },
    { key: "subsidy", label: "Subsidy Price", on: true },
    { key: "qty", label: "Quantity", on: true, help: "Units you have in stock. At 0 the product can't be Live." },
    { key: "created", label: "Creation Date", on: false },
    { key: "quality", label: "Quality Score", on: false },
    { key: "visible", label: "Visible", on: true, fixed: true },
    { key: "active", label: "Active", on: true, fixed: true }
];
const VP_PICKER_ORDER = ["deletion", "lizimas_sku", "price", "sale", "promo", "subsidy", "qty", "created", "quality"];

const VP_ICON = {
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
    power: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>',
    dots: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
    help: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    caret: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
    first: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/><polyline points="17 6 11 12 17 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',
    last: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v14"/><polyline points="7 6 13 12 7 18"/></svg>',
    funnel: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/></svg>'
};

const vpEsc = (v) => (typeof vendorEsc === "function" ? vendorEsc(v == null ? "" : v)
    : String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
// Table cells show the number only; the column header carries the currency.
function vpNum(v) {
    if (v == null || v === "") return "&mdash;";
    if (vpState.currency === "usd" && vpUsdRate) return (Number(v) / vpUsdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Number(v).toLocaleString();
}
const vpCur = () => (vpState.currency === "usd" && vpUsdRate ? "USD" : "UGX");

function vpMoney(v) {
    if (v == null || v === "") return "&mdash;";
    if (vpState.currency === "usd" && vpUsdRate) return `USD ${(Number(v) / vpUsdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `UGX ${Number(v).toLocaleString()}`;
}

// --- Classification ---------------------------------------------------------

function vpFlags(p) {
    const deleted = !!p.deleted_at;
    const missing = [];
    if (!p.image) missing.push("a main image");
    if (!p.category_id) missing.push("a category");
    if (!(Number(p.price) > 0)) missing.push("a price");
    const pending = p.status === "pending";
    const notReady = pending && missing.length > 0;
    const approved = p.status === "approved";
    const rejected = p.status === "rejected";
    const active = p.is_active !== false;
    const unauthorized = !!p.admin_restricted;
    const inStock = Number(p.stock) > 0;
    const live = !deleted && approved && active && !unauthorized && inStock;
    const pendingDeletion = p.deletion_request_status === "pending";
    let reason = "";
    if (!live) {
        if (deleted) reason = "Deleted";
        else if (notReady) reason = `Not ready for QC - add ${missing.join(", ")}`;
        else if (pending) reason = "Waiting for quality check (QC)";
        else if (rejected) reason = `Rejected in QC${p.rejection_reason ? ": " + p.rejection_reason : ""}`;
        else if (unauthorized) reason = "Restricted by Lizimas Store - contact support";
        else if (!active) reason = "Inactive - switch it on in the Active column";
        else if (!inStock) reason = "Quantity is 0 - add stock";
    }
    let qc = "Approved";
    if (notReady) qc = "Not Ready To QC";
    else if (pending) qc = "Pending QC";
    else if (rejected) qc = "Rejected";
    return { deleted, pending, notReady, approved, rejected, active, unauthorized, inStock, live, pendingDeletion, reason, qc };
}

function vpCount(key) {
    return vpAllProducts.filter((p) => VP_TESTS[key](vpFlags(p))).length;
}

function vpRows() {
    const test = VP_TESTS[vpState.filter] || VP_TESTS.all;
    const name = vpState.name.trim().toLowerCase();
    const sku = vpState.sku.trim().toLowerCase();
    return vpAllProducts.filter((p) => {
        if (!test(vpFlags(p))) return false;
        if (name && !String(p.name || "").toLowerCase().includes(name)) return false;
        if (sku && !String(p.sku || "").toLowerCase().includes(sku) && !String(p.lizimas_sku || "").toLowerCase().includes(sku)) return false;
        if (vpState.from || vpState.to) {
            const d = vpLocalDate(p.created_at);
            if (!d) return false;
            if (vpState.from && d < vpState.from) return false;
            if (vpState.to && d > vpState.to) return false;
        }
        if (vpState.visibility !== "all") {
            const live = vpFlags(p).live;
            if ((vpState.visibility === "live") !== live) return false;
        }
        if (vpState.stock === "in" && !(Number(p.stock) > 0)) return false;
        if (vpState.stock === "out" && Number(p.stock) > 0) return false;
        return true;
    });
}

function vpPageRows(rows) {
    const pages = Math.max(1, Math.ceil(rows.length / vpState.perPage));
    if (vpState.page > pages) vpState.page = pages;
    if (vpState.page < 1) vpState.page = 1;
    const start = (vpState.page - 1) * vpState.perPage;
    return { pageRows: rows.slice(start, start + vpState.perPage), start, pages };
}

// --- Loading ----------------------------------------------------------------

async function loadVendorProducts() {
    try {
        const products = await vendorAuthorizedFetch("/api/vendors/products?include_deleted=1");
        if (!Array.isArray(products)) { console.error("Load vendor products error:", products && products.error); return; }
        vpAllProducts = products;
        // Everything else in the dashboard (edit form, specs, ads, promotions)
        // expects only live catalogue rows here.
        vendorProductsCache = products.filter((p) => !p.deleted_at);
        vendorProductsSelected.clear();
        vpRenderAll();
    } catch (error) {
        console.error("Load vendor products error:", error);
    }
}

async function vmLoadProducts() {
    const list = document.getElementById("vpm-list");
    if (list) list.innerHTML = '<div class="vpm-empty">Loading...</div>';
    await loadVendorProducts();
    if (typeof vmLoadProductTierStatus === "function") vmLoadProductTierStatus();
}

function vpRenderAll() {
    renderVendorProductFilters();
    renderVendorProductsTable();
    updateVendorProductsBulkBar();
    vpRenderMobile();
}

// --- Shared actions ---------------------------------------------------------

function setVendorProductsFilter(key) {
    vpState.filter = VP_TESTS[key] ? key : "all";
    vpState.page = 1;
    vendorProductsSelected.clear();
    vpRenderAll();
}

function vpSetSearch(field, value) {
    vpState[field] = value || "";
    vpState.page = 1;
    renderVendorProductsTable();
    vpRenderMobileList();
}

function vpGoPage(page) {
    vpState.page = page;
    renderVendorProductsTable();
    vpRenderMobileList();
}

function vpSetPerPage(n) {
    vpState.perPage = Number(n) || 50;
    vpState.page = 1;
    renderVendorProductsTable();
    vpRenderMobileList();
}

function vpToggleSelect(id, on) {
    const checked = on === undefined ? !vendorProductsSelected.has(Number(id)) : on;
    toggleVendorProductSelect(id, checked);
    renderVendorProductsTable();
    vpRenderMobileList();
}

function toggleAllVendorProductsSelect(checked) {
    const { pageRows } = vpPageRows(vpRows());
    pageRows.filter((p) => !p.deleted_at).forEach((p) => (checked ? vendorProductsSelected.add(Number(p.id)) : vendorProductsSelected.delete(Number(p.id))));
    updateVendorProductsBulkBar();
    renderVendorProductsTable();
    vpRenderMobileList();
}

function vpToggleActive(id, on) {
    bulkVendorProductActionSingle(id, on ? "activate" : "deactivate");
}

function vpBulk(action) {
    vpCloseMenus();
    if (vendorProductsSelected.size === 0) return;
    bulkVendorProductAction(action);
}

function vpExportCsv() {
    vpCloseMenus();
    const rows = vpRows();
    if (!rows.length) { alert("Nothing to export in this view."); return; }
    const head = ["Name", "Seller SKU", "Lizimas Store SKU", "Price (UGX)", "Sale Price (UGX)", "Promo Price (UGX)", "Subsidy Price (UGX)", "Quantity", "Visible", "Active", "QC Status"];
    const cell = (v) => {
        let s = String(v == null ? "" : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // no spreadsheet formula injection
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head].concat(rows.map((p) => {
        const f = vpFlags(p);
        return [p.name, p.sku || "", p.lizimas_sku || "", p.price, p.sale_price || "", p.promo_price || "", p.subsidy_price || "", p.stock,
            f.live ? "Live" : "Not Live", f.deleted ? "Deleted" : (f.active ? "Active" : "Inactive"), f.qc];
    }));
    const blob = new Blob([lines.map((l) => l.map(cell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lizimas-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function vpImport() {
    vpCloseMenus();
    const panel = document.getElementById("vd-product-import-panel");
    if (panel && panel.hidden) vdToggleProductImportPanel();
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function vpAddProduct() {
    const btn = document.querySelector('.tab-btn[data-tab="add-product"]');
    if (btn) btn.click();
}

// --- Menus ------------------------------------------------------------------

function vpCloseMenus() {
    document.querySelectorAll(".vp-menu").forEach((m) => { m.hidden = true; });
    document.querySelectorAll(".vp-row-menu").forEach((m) => m.remove());
}

function vpToggleMenu(id, ev) {
    if (ev) ev.stopPropagation();
    const m = document.getElementById(id);
    if (!m) return;
    const open = m.hidden;
    vpCloseMenus();
    m.hidden = !open;
}

function vpOpenRowMenu(id, ev) {
    ev.stopPropagation();
    vpCloseMenus();
    const p = vpAllProducts.find((x) => Number(x.id) === Number(id));
    if (!p) return;
    const f = vpFlags(p);
    const canToggle = f.approved && !f.unauthorized;
    const items = [];
    const onPhone = window.matchMedia("(max-width: 768px)").matches;
    if (!f.deleted) items.push(`<button type="button" onclick="vpCloseMenus(); ${onPhone ? "vmEditProduct" : "editVendorProduct"}(${Number(id)})">Edit</button>`);
    if (canToggle) items.push(`<button type="button" onclick="vpCloseMenus(); vpToggleActive(${Number(id)}, ${!f.active})">${f.active ? "Deactivate" : "Activate"}</button>`);
    items.push(`<button type="button" class="vp-danger" onclick="vpCloseMenus(); vpDeleteOne(${Number(id)})">Delete</button>`);
    const menu = document.createElement("div");
    menu.className = "vp-row-menu";
    menu.innerHTML = items.join("");
    document.body.appendChild(menu);
    const r = ev.currentTarget.getBoundingClientRect();
    const w = 160;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    const below = r.bottom + 4;
    menu.style.top = `${below + menu.offsetHeight > window.innerHeight ? Math.max(8, r.top - menu.offsetHeight - 4) : below}px`;
}

function vpDeleteOne(id) {
    vendorProductsSelected.clear();
    vendorProductsSelected.add(Number(id));
    bulkVendorProductAction("delete");
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".vp-menu, .vp-row-menu, [data-vp-menu]")) vpCloseMenus();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { vpCloseMenus(); vpCloseFilterSheet(); vpCloseColumnsPanel(); } });

// --- Desktop ----------------------------------------------------------------

// Columns: the vendor's saved default (Table Filters > New Default) is used
// on load; Apply filters changes this session only; Reset Filters goes back
// to the saved default (or the built-in one when none is saved).
function vpBuiltinColumns() {
    const on = {};
    VP_COLUMNS.forEach((c) => { on[c.key] = c.on; });
    return on;
}

function vpSavedDefaultColumns() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("lz-vp-columns") || "null"); } catch (e) { saved = null; }
    const on = vpBuiltinColumns();
    if (saved && typeof saved === "object") VP_COLUMNS.forEach((c) => { if (!c.fixed && typeof saved[c.key] === "boolean") on[c.key] = saved[c.key]; });
    return on;
}

let vpColumns = null;
let vpColumnsDraft = null;

function vpColumnsOn() {
    if (!vpColumns) vpColumns = vpSavedDefaultColumns();
    return vpColumns;
}

function vpOpenColumnsPanel(ev) {
    if (ev) ev.stopPropagation();
    vpCloseMenus();
    vpCloseColumnsPanel();
    vpColumnsDraft = { ...vpColumnsOn() };
    const overlay = document.createElement("div");
    overlay.className = "vp-drawer-overlay";
    overlay.id = "vp-columns-drawer";
    overlay.innerHTML = `<aside class="vp-drawer" role="dialog" aria-modal="true" aria-labelledby="vp-drawer-title">
        <div class="vp-drawer-head"><button type="button" class="vp-drawer-back" aria-label="Close" onclick="vpCloseColumnsPanel()"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="11 6 5 12 11 18"/></svg></button><h2 class="vp-drawer-title" id="vp-drawer-title">Table Filters</h2></div>
        <div class="vp-drawer-body">
            <div class="vp-drawer-sub">Customize your table</div>
            <div class="vp-drawer-hint">Adjust your table choosing to add or remove your columns</div>
            <div class="vp-drawer-list" id="vp-drawer-list"></div>
            <div class="vp-drawer-status" id="vp-drawer-status" role="status"></div>
        </div>
        <div class="vp-drawer-foot">
            <div class="vp-drawer-btns">
                <button type="button" class="vp-btn vp-btn-outline vp-drawer-default" onclick="vpSaveColumnsDefault()"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> New Default</button>
                <button type="button" class="vp-btn vp-btn-gold vp-drawer-apply" onclick="vpApplyColumns()">Apply filters</button>
            </div>
            <button type="button" class="vp-drawer-reset" onclick="vpResetColumns()">Reset Filters</button>
        </div>
    </aside>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) vpCloseColumnsPanel(); });
    document.body.appendChild(overlay);
    vpRenderColumnsList();
    const first = overlay.querySelector("input");
    if (first) first.focus();
}

function vpRenderColumnsList() {
    const list = document.getElementById("vp-drawer-list");
    if (!list) return;
    list.innerHTML = VP_PICKER_ORDER.map((key) => {
        const c = VP_COLUMNS.find((x) => x.key === key);
        const on = !!vpColumnsDraft[key];
        return `<label class="vp-drawer-item${on ? " vp-drawer-item-on" : ""}"><input type="checkbox"${on ? " checked" : ""} onchange="vpColumnsDraft['${key}'] = this.checked; this.parentElement.classList.toggle('vp-drawer-item-on', this.checked)"><span class="vp-drawer-box"></span>${c.label}</label>`;
    }).join("");
}

function vpCloseColumnsPanel() {
    const d = document.getElementById("vp-columns-drawer");
    if (d) d.remove();
}

function vpApplyColumns() {
    vpColumns = { ...vpColumnsDraft };
    vpCloseColumnsPanel();
    renderVendorProductsTable();
}

function vpSaveColumnsDefault() {
    const save = {};
    VP_PICKER_ORDER.forEach((k) => { save[k] = !!vpColumnsDraft[k]; });
    try { localStorage.setItem("lz-vp-columns", JSON.stringify(save)); } catch (e) { /* per-viewer convenience only */ }
    const st = document.getElementById("vp-drawer-status");
    if (st) st.textContent = "Saved as your default columns.";
}

function vpResetColumns() {
    vpColumnsDraft = vpSavedDefaultColumns();
    vpRenderColumnsList();
    const st = document.getElementById("vp-drawer-status");
    if (st) st.textContent = "";
}

function renderVendorProductFilters() {
    const host = document.getElementById("vendor-products-filters");
    if (host) {
        host.innerHTML = `<span class="vp-status-label">Status:</span>` + VP_FILTER_GROUPS.map((group) => {
            const pills = group.map(([key, label]) => {
                const n = vpCount(key);
                return `<button type="button" class="vp-pill${vpState.filter === key ? " vp-pill-active" : ""}" onclick="setVendorProductsFilter('${key}')">${label}${n ? ` <span class="vp-pill-n">${n}</span>` : ""}</button>`;
            }).join("");
            return group.length === 1 && group[0][0] === "all" ? pills : `<span class="vp-pill-group">${pills}</span>`;
        }).join("");
    }
}

function updateVendorProductsBulkBar() {
    const n = vendorProductsSelected.size;
    const label = document.getElementById("vendor-products-selected-count");
    if (label) label.textContent = n ? `${n} item${n === 1 ? "" : "s"} selected` : "Select items to apply bulk actions";
    ["vp-bulk-activate", "vp-bulk-more"].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = n === 0; });
    vpRefreshMobileGo();
}

function vpPagerHtml(total, start, count, mobile) {
    const pages = Math.max(1, Math.ceil(total / vpState.perPage));
    const p = vpState.page;
    const btn = (icon, page, label, off) => `<button type="button" class="vp-pg-btn" aria-label="${label}" ${off ? "disabled" : ""} onclick="vpGoPage(${page})">${icon}</button>`;
    const range = total ? `${start + 1}&ndash;${start + count} of ${total}` : "0 of 0";
    const per = `<label class="vp-per">Items per page: <select onchange="vpSetPerPage(this.value)">${[20, 50, 100, 200].map((n) => `<option${n === vpState.perPage ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
    const nav = `<span class="vp-range">${range}</span>${btn(VP_ICON.first, 1, "First page", p <= 1)}${btn(VP_ICON.prev, p - 1, "Previous page", p <= 1)}${btn(VP_ICON.right, p + 1, "Next page", p >= pages)}${btn(VP_ICON.last, pages, "Last page", p >= pages)}`;
    return mobile ? `<div class="vp-pager-nav">${nav}</div><div class="vp-pager-per">${per}</div>` : `${per}<div class="vp-pager-nav">${nav}</div>`;
}

function vpVisibleCell(f, withReason) {
    if (!f.live && withReason) return `<span class="vp-notlive"><span class="vp-dot"></span>Not Live</span><div class="vp-reason">${vpEsc(f.reason)}</div>`;
    return f.live
        ? `<span class="vp-live"><span class="vp-dot"></span>Live</span>`
        : `<span class="vp-notlive" tabindex="0" title="${vpEsc(f.reason)}" aria-label="Not Live: ${vpEsc(f.reason)}"><span class="vp-dot"></span>Not Live <span class="vp-help">${VP_ICON.help}</span></span>`;
}

function vpActiveSwitch(p, f) {
    if (f.deleted) return `<span class="vp-muted">Deleted</span>`;
    const can = f.approved && !f.unauthorized;
    const why = can ? (f.active ? "Switch off" : "Switch on") : (f.unauthorized ? "Restricted by Lizimas Store" : "You can switch it on after QC approval");
    return `<label class="vp-switch" title="${why}"><input type="checkbox" aria-label="Active"${f.active ? " checked" : ""}${can ? "" : " disabled"} onchange="vpToggleActive(${Number(p.id)}, this.checked)"><span></span></label>`;
}

function renderVendorProductsTable() {
    const container = document.getElementById("vendor-products-list");
    const pager = document.getElementById("vp-pager");
    if (!container) return;
    const on = vpColumnsOn();
    const cols = VP_COLUMNS.filter((c) => on[c.key]);
    const rows = vpRows();
    const { pageRows, start } = vpPageRows(rows);
    const selectable = pageRows.filter((p) => !p.deleted_at);
    const allSel = selectable.length > 0 && selectable.every((p) => vendorProductsSelected.has(Number(p.id)));
    const numeric = new Set(["price", "sale", "promo", "subsidy", "qty"]);

    const head = `<tr><th class="vp-col-check"><input type="checkbox" aria-label="Select all on this page"${allSel ? " checked" : ""}${selectable.length ? "" : " disabled"} onchange="toggleAllVendorProductsSelect(this.checked)"></th><th class="vp-col-name">Name</th>${cols.map((c) =>
        `<th class="${numeric.has(c.key) ? "vp-num" : ""}">${c.label}${numeric.has(c.key) && c.key !== "qty" ? ` <span class="vp-cur">(${vpCur()})</span>` : ""}${c.help ? ` <span class="vp-help" title="${vpEsc(c.help)}">${VP_ICON.help}</span>` : ""}</th>`).join("")}<th class="vp-col-actions">Actions</th></tr>`;

    const cell = (p, f, key) => {
        switch (key) {
            case "sku": return p.sku ? vpEsc(p.sku) : "&mdash;";
            case "lizimas_sku": return p.lizimas_sku ? vpEsc(p.lizimas_sku) : "&mdash;";
            case "price": return vpNum(p.price);
            case "sale": return vpNum(p.sale_price);
            case "promo": return vpNum(p.promo_price);
            case "subsidy": return vpNum(p.subsidy_price);
            case "deletion": return f.pendingDeletion ? '<span class="vp-qc vp-qc-warn">Pending Deletion</span>' : "&mdash;";
            case "created": return p.created_at ? vpLocalDate(p.created_at) : "&mdash;";
            case "qty": return `${Number(p.stock) || 0}`;
            case "quality": return typeof vendorQualityScoreBadge === "function" ? vendorQualityScoreBadge(p) : "";
            case "visible": return vpVisibleCell(f);
            case "active": return vpActiveSwitch(p, f);
            default: return "";
        }
    };

    const body = pageRows.map((p) => {
        const f = vpFlags(p);
        const qcCls = { "Pending QC": "vp-qc-wait", "Not Ready To QC": "vp-qc-warn", Rejected: "vp-qc-bad", Approved: "vp-qc-ok" }[f.qc];
        const nameHtml = f.deleted
            ? `<span class="vp-name vp-name-deleted">${vpEsc(p.name)}</span>`
            : `<button type="button" class="vp-name" onclick="editVendorProduct(${Number(p.id)})">${vpEsc(p.name)}</button>`;
        return `<tr class="${f.deleted ? "vp-row-deleted" : ""}">
            <td class="vp-col-check"><input type="checkbox" aria-label="Select ${vpEsc(p.name)}"${vendorProductsSelected.has(Number(p.id)) ? " checked" : ""}${f.deleted ? " disabled" : ""} onchange="vpToggleSelect(${Number(p.id)}, this.checked)"></td>
            <td class="vp-col-name">${nameHtml}<div class="vp-sub"><span class="vp-qc ${qcCls}">${f.qc}</span>${f.pendingDeletion ? '<span class="vp-qc vp-qc-warn">Pending Deletion</span>' : ""}${f.unauthorized ? '<span class="vp-qc vp-qc-bad">Unauthorized</span>' : ""}</div></td>
            ${cols.map((c) => `<td class="${numeric.has(c.key) ? "vp-num" : ""}${c.key === "visible" ? " vp-col-visible" : ""}">${cell(p, f, c.key)}</td>`).join("")}
            <td class="vp-col-actions">${f.deleted ? "" : `<button type="button" class="vp-link" onclick="editVendorProduct(${Number(p.id)})">Edit</button><button type="button" class="vp-kebab" data-vp-menu aria-label="More actions" onclick="vpOpenRowMenu(${Number(p.id)}, event)">${VP_ICON.dots}</button>`}</td>
        </tr>`;
    }).join("");

    container.innerHTML = `<div class="vp-table-scroll"><table class="vp-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols.length + 3}" class="vp-empty">No records found !</td></tr>`}</tbody></table></div>`;
    if (pager) pager.innerHTML = rows.length ? vpPagerHtml(rows.length, start, pageRows.length, false) : "";
}

// --- Mobile -----------------------------------------------------------------

function vpRenderMobile() {
    const pills = document.getElementById("vpm-pills");
    if (!pills) return;
    pills.innerHTML = VP_FILTER_GROUPS.flat().map(([key, label]) => {
        const active = vpState.filter === key;
        return `<button type="button" class="vpm-pill${active ? " vpm-pill-active" : ""}" onclick="setVendorProductsFilter('${key}')">${active ? VP_ICON.check : ""}${label} (${vpCount(key)})</button>`;
    }).join("");
    const activePill = pills.querySelector(".vpm-pill-active");
    if (activePill && activePill.scrollIntoView && pills.scrollWidth > pills.clientWidth) {
        pills.scrollLeft = Math.max(0, activePill.offsetLeft - 16);
    }
    vpRenderChips();
    vpRenderMobileList();
}

function vpMobileCard(p) {
    const f = vpFlags(p);
    const sel = vendorProductsSelected.has(Number(p.id));
    const price = p.sale_price
        ? `<span class="vpm-price">${vpMoney(p.sale_price)}</span> <s class="vpm-old">${vpMoney(p.price)}</s>`
        : `<span class="vpm-price">${vpMoney(p.price)}</span>`;
    return `<div class="vpm-card${f.deleted ? " vpm-card-deleted" : ""}">
        <button type="button" class="vpm-check${sel ? " vpm-checked" : ""}" aria-label="Select ${vpEsc(p.name)}" ${f.deleted ? "disabled" : ""} onclick="vpToggleSelect(${Number(p.id)})">${sel ? VP_ICON.check : ""}</button>
        <div class="vpm-card-body">
            <div class="vpm-card-top"><div class="vpm-name">${vpEsc(p.name)}</div>${f.deleted ? "" : `<button type="button" class="vp-kebab" data-vp-menu aria-label="More actions" onclick="vpOpenRowMenu(${Number(p.id)}, event)">${VP_ICON.dots}</button>`}</div>
            <div class="vpm-sku">Seller SKU: ${p.sku ? vpEsc(p.sku) : "&mdash;"}</div>
            <div class="vpm-sku">Lizimas SKU: ${p.lizimas_sku ? vpEsc(p.lizimas_sku) : "&mdash;"}</div>
            <div class="vpm-prices">${price}${p.subsidy_price ? ` <span class="vpm-subsidy">Subsidy ${vpMoney(p.subsidy_price)}</span>` : ""}</div>
            <div class="vpm-meta"><span>Qty ${Number(p.stock) || 0}</span><span class="vp-qc ${{ "Pending QC": "vp-qc-wait", "Not Ready To QC": "vp-qc-warn", Rejected: "vp-qc-bad", Approved: "vp-qc-ok" }[f.qc]}">${f.qc}</span>${f.pendingDeletion ? '<span class="vp-qc vp-qc-warn">Pending Deletion</span>' : ""}</div>
            <div class="vpm-foot"><div>${vpVisibleCell(f, true)}</div><div class="vpm-active">${f.deleted ? '<span class="vp-muted">Deleted</span>' : `<span>Active</span>${vpActiveSwitch(p, f)}`}</div></div>
        </div>
    </div>`;
}

function vpRenderMobileList() {
    const list = document.getElementById("vpm-list");
    if (!list) return;
    const rows = vpRows();
    const { pageRows, start } = vpPageRows(rows);
    list.innerHTML = pageRows.length ? pageRows.map(vpMobileCard).join("") : '<div class="vpm-empty">No products to display!</div>';
    const pager = document.getElementById("vpm-pager");
    if (pager) pager.innerHTML = vpPagerHtml(rows.length, start, pageRows.length, true);
    const all = document.getElementById("vpm-check-all");
    if (all) {
        const selectable = pageRows.filter((p) => !p.deleted_at);
        const on = selectable.length > 0 && selectable.every((p) => vendorProductsSelected.has(Number(p.id)));
        all.classList.toggle("vpm-checked", on);
        all.innerHTML = on ? VP_ICON.check : "";
        all.disabled = selectable.length === 0;
    }
    vpRefreshMobileGo();
}

function vpMobileToggleAll() {
    const all = document.getElementById("vpm-check-all");
    toggleAllVendorProductsSelect(!(all && all.classList.contains("vpm-checked")));
}

function vpRefreshMobileGo() {
    const go = document.getElementById("vpm-go");
    if (go) go.disabled = !(vpState.mAction && vendorProductsSelected.size > 0);
}

function vpMobileSetAction(v) {
    vpState.mAction = v;
    vpRefreshMobileGo();
}

function vpMobileGo() {
    if (!vpState.mAction || vendorProductsSelected.size === 0) return;
    bulkVendorProductAction(vpState.mAction);
}

// --- Mobile Filters page (mobile "Filters" layout) ---------------------

function vpLocalDate(v) {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const VP_DATE_PRESETS = [
    ["yesterday", "Yesterday"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"],
    ["90", "Last 90 days"], ["6m", "Last 6 months"], ["year", "This year"]
];

function vpPresetRange(key) {
    const today = new Date();
    const day = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return vpLocalDate(d); };
    const t = vpLocalDate(today);
    switch (key) {
        case "yesterday": return [day(-1), day(-1)];
        case "today": return [t, t];
        case "7": return [day(-6), t];
        case "30": return [day(-29), t];
        case "90": return [day(-89), t];
        case "6m": { const d = new Date(today); d.setMonth(d.getMonth() - 6); return [vpLocalDate(d), t]; }
        case "year": return [`${today.getFullYear()}-01-01`, t];
        default: return ["", ""];
    }
}

let vpDraft = null;

function vpOpenFilterSheet() {
    vpCloseFilterSheet();
    vpDraft = { filter: vpState.filter, currency: vpState.currency, preset: vpState.preset, from: vpState.from, to: vpState.to, visibility: vpState.visibility, stock: vpState.stock };
    const page = document.createElement("div");
    page.className = "vpm-filters-page";
    page.id = "vpm-filter-sheet";
    page.setAttribute("role", "dialog");
    page.setAttribute("aria-modal", "true");
    page.setAttribute("aria-label", "Filters");
    const nav = document.querySelector(".vm-bottom-nav");
    (nav && nav.parentElement ? nav.parentElement : document.body).appendChild(page);
    vpRenderFilterPage();
}

function vpRenderFilterPage() {
    const page = document.getElementById("vpm-filter-sheet");
    if (!page || !vpDraft) return;
    const d = vpDraft;
    const radio = (val, label) => `<label class="vpf-radio"><input type="radio" name="vpf-currency" value="${val}"${d.currency === val ? " checked" : ""} onchange="vpDraft.currency='${val}'"><span></span>${label}</label>`;
    const select = (id, label, value, opts) => `<div class="vpf-field"><div class="vpf-label">${label}</div><div class="vpf-select-wrap"><select id="${id}" class="vpf-select" onchange="vpDraftSet('${id}', this.value)">${opts.map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${l}</option>`).join("")}</select>${VP_ICON.chevDown}</div></div>`;
    page.innerHTML = `
        <div class="vpf-head">
            <button type="button" class="vpf-back" aria-label="Back" onclick="vpCloseFilterSheet()"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="11 6 5 12 11 18"/></svg></button>
            <span class="vpf-title">Filters</span>
            <button type="button" class="vpf-reset" onclick="vpResetDraft()">Reset Filters</button>
        </div>
        <div class="vpf-body">
            <div class="vpf-caps">Currency</div>
            <div class="vpf-radios">${radio("usd", "USD")}${radio("local", "Local")}</div>
            <div class="vpf-rule"></div>
            <div class="vpf-section">Country</div>
            <div class="vpf-outlined"><span class="vpf-outlined-label">Countries *</span><select class="vpf-country" aria-label="Countries"><option>Uganda</option></select>${VP_ICON.caret}</div>
            <div class="vpf-section">Product Creation Date</div>
            <div class="vpf-chips">${VP_DATE_PRESETS.map(([k, l]) => `<button type="button" class="vpf-chip${d.preset === k ? " vpf-chip-on" : ""}" onclick="vpDraftPreset('${k}')">${d.preset === k ? VP_ICON.check : ""}${l}</button>`).join("")}</div>
            <div class="vpf-label vpf-label-gap">Custom Range:</div>
            <div class="vpf-range">
                <input type="date" id="vpf-from" aria-label="From date" value="${d.from}" onchange="vpDraftDate('from', this.value)">
                <span>&ndash;</span>
                <input type="date" id="vpf-to" aria-label="To date" value="${d.to}" onchange="vpDraftDate('to', this.value)">
            </div>
            ${select("vpf-status", "Status", d.filter, VP_FILTER_GROUPS.flat())}
            ${select("vpf-visible", "Visible", d.visibility, [["all", "All"], ["live", "Live"], ["not_live", "Not Live"]])}
            ${select("vpf-stock", "Quantity", d.stock, [["all", "All"], ["in", "In stock"], ["out", "Out of stock (0)"]])}
            <div class="vpf-rule"></div>
            <div class="vpf-error" id="vpf-error" hidden></div>
        </div>
        <div class="vpf-apply-wrap"><button type="button" class="vpf-apply" onclick="vpApplyFilters()">Apply Filters</button></div>`;
}

function vpDraftSet(id, value) {
    if (id === "vpf-status") vpDraft.filter = value;
    if (id === "vpf-visible") vpDraft.visibility = value;
    if (id === "vpf-stock") vpDraft.stock = value;
}

function vpDraftPreset(key) {
    if (vpDraft.preset === key) { vpDraft.preset = ""; vpDraft.from = ""; vpDraft.to = ""; }
    else { vpDraft.preset = key; [vpDraft.from, vpDraft.to] = vpPresetRange(key); }
    vpRenderFilterPage();
}

function vpDraftDate(which, value) {
    vpDraft[which] = value || "";
    vpDraft.preset = "";
    vpRenderFilterPage();
}

function vpResetDraft() {
    vpDraft = { filter: "all", ...VP_FILTER_DEFAULTS };
    vpRenderFilterPage();
}

async function vpApplyFilters() {
    const err = document.getElementById("vpf-error");
    if (vpDraft.from && vpDraft.to && vpDraft.from > vpDraft.to) {
        if (err) { err.textContent = "The start date must be on or before the end date."; err.hidden = false; }
        return;
    }
    if (vpDraft.currency === "usd" && !vpUsdRate) {
        try {
            const r = await vendorAuthorizedFetch("/api/vendors/fx-rate");
            if (r && Number(r.rate) > 0) vpUsdRate = Number(r.rate);
        } catch (e) { /* handled below */ }
        if (!vpUsdRate) {
            if (err) { err.textContent = "USD prices aren't available right now - showing local currency."; err.hidden = false; }
            vpDraft.currency = "local";
            vpRenderFilterPage();
            return;
        }
    }
    Object.assign(vpState, { currency: vpDraft.currency, preset: vpDraft.preset, from: vpDraft.from, to: vpDraft.to, visibility: vpDraft.visibility, stock: vpDraft.stock });
    vpCloseFilterSheet();
    setVendorProductsFilter(vpDraft.filter);
    vpRenderChips();
}

function vpRenderChips() {
    const host = document.getElementById("vpm-applied");
    if (!host) return;
    const date = vpState.from || vpState.to ? `<span class="vpm-label">Date</span><button type="button" class="vpm-chip" onclick="vpOpenFilterSheet()">${vpState.from || "&hellip;"} / ${vpState.to || "&hellip;"}</button>` : "";
    const cur = vpState.currency === "usd" ? `<span class="vpm-label">Currency</span><button type="button" class="vpm-chip" onclick="vpOpenFilterSheet()">USD</button>` : "";
    host.innerHTML = `<span class="vpm-label">Country</span><button type="button" class="vpm-chip" onclick="vpOpenFilterSheet()">Uganda</button>${date}${cur}`;
}

function vpCloseFilterSheet() {
    const s = document.getElementById("vpm-filter-sheet");
    if (s) s.remove();
}

// The bulk confirm/results dialogs live inside the desktop Products tab;
// lift them to <body> so they also show from the mobile shell.
document.addEventListener("DOMContentLoaded", () => {
    ["vd-bulk-confirm-overlay", "vd-bulk-results-overlay"].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.parentElement !== document.body) document.body.appendChild(el);
    });
});
