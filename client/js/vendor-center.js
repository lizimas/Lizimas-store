// Vendor Center screens rebuilt to match Jumia Vendor Center (Ryan, Sept
// 2026), shared by BOTH vendor dashboard shells (desktop sidebar/tabs and
// the mobile app shell - client/vendor/dashboard.html). Loaded after
// vendor-dashboard.js, vendor-mobile.js and vendor-shop-setup.js and reuses
// their globals (vendorAuthorizedFetch, vendorEsc, getVendorToken, API_URL,
// vmShowScreen, vdStaffCache, vdStaffAvailableRoles, vdRoleLabel,
// vmJumiaApplications/vdJumiaApplications, vm/vdShowJumiaAppSetup, ...).
//
//   1. Shared UI: bottom-sheet / dialog, toast, kebab popup menu
//   2. Stock Recommendation   (GET /api/vendors/me/stock-overview)
//   3. Promotions Management  (overview + Lizimas campaigns + join)
//   4. Applications           (cards + Create Application dialog)
//   5. Users                  (cards, kebab menu, Assign Permissions)
//
// Everything here is Lizimas-branded (navy #1a1a2e / gold #f4b400), in the
// Jumia layout.

(function () {
"use strict";

const esc = (s) => vendorEsc(s == null ? "" : s);
const api = (path, opts) => vendorAuthorizedFetch(path, opts);
const isMobileShell = () => window.matchMedia("(max-width: 768px)").matches;
const fmtUgx = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString();
const fmtNum = (n) => (Number(n) || 0).toLocaleString();

function fmtDateTime(v) {
    if (!v) return "-";
    const d = new Date(v);
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${date} <span class="vc-sep">|</span> ${time}`;
}

const ICON = {
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    err: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    doc: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-1 7V3.5L18.5 9H13ZM8 13h8v2H8v-2Zm0 4h8v2H8v-2Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    first: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/><path d="m18 6-6 6 6 6"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    last: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v14"/><path d="m6 6 6 6-6 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.7V19h-2v-1.3A2 2 0 0 1 12 14Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z"/><path fill="#fff" d="M12 4.2v8.3H6V6.3l6-2.1Zm0 8.3h6c-.5 3.7-3 6.9-6 7.9v-7.9Z"/></svg>',
    kebab: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    userPlus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4ZM6 10V7H4v3H1v2h3v3h2v-3h3v-2H6Z"/></svg>',
    userOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/><path d="M3 3l18 18"/></svg>',
    userMinus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4ZM1 10h8v2H1v-2Z"/></svg>'
};

// ===========================================================================
// 1. Shared UI
// ===========================================================================

// Bottom sheet on phones, centred dialog on desktop - one component, the
// CSS decides (see .vc-sheet in vendor-mobile.css). Returns { el, close }.
function openSheet({ title, body, footer, wide, onClose }) {
    closeSheet();
    const overlay = document.createElement("div");
    overlay.className = "vc-overlay";
    overlay.innerHTML = `<div class="vc-sheet${wide ? " vc-sheet-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="vc-sheet-head"><h2 class="vc-sheet-title">${esc(title)}</h2></div>
        <div class="vc-sheet-body">${body}</div>
        ${footer ? `<div class="vc-sheet-foot">${footer}</div>` : ""}
    </div>`;
    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        document.body.classList.remove("vc-noscroll");
        if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    document.body.classList.add("vc-noscroll");
    overlay._close = close;
    return { el: overlay.querySelector(".vc-sheet"), close };
}

function closeSheet() {
    const o = document.querySelector(".vc-overlay");
    if (o && o._close) o._close();
}

function toast(message, kind) {
    document.querySelectorAll(".vc-toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = `vc-toast vc-toast-${kind === "ok" ? "ok" : "error"}`;
    t.setAttribute("role", kind === "ok" ? "status" : "alert");
    t.innerHTML = `<span class="vc-toast-icon">${kind === "ok" ? ICON.ok : ICON.err}</span><span class="vc-toast-msg"></span><button type="button" class="vc-toast-x" aria-label="Dismiss">${ICON.close}</button>`;
    t.querySelector(".vc-toast-msg").textContent = message;
    t.querySelector(".vc-toast-x").onclick = () => t.remove();
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
}

// Small floating menu anchored to a button (the kebab "floating table").
function openMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "vc-menu";
    menu.setAttribute("role", "menu");
    items.forEach((it) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "vc-menu-item" + (it.danger ? " vc-menu-danger" : "");
        b.disabled = Boolean(it.disabled);
        b.setAttribute("role", "menuitem");
        b.innerHTML = `<span class="vc-menu-icon">${it.icon || ""}</span><span></span>`;
        b.lastChild.textContent = it.label;
        b.onclick = () => { closeMenu(); it.onClick(); };
        menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    let left = r.right - mw + window.scrollX;
    left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - mw - 8));
    menu.style.left = left + "px";
    menu.style.top = (r.bottom + 6 + window.scrollY) + "px";
    setTimeout(() => document.addEventListener("click", closeMenuOnOutside), 0);
}
function closeMenuOnOutside(e) { if (!e.target.closest(".vc-menu")) closeMenu(); }
function closeMenu() {
    document.querySelectorAll(".vc-menu").forEach((m) => m.remove());
    document.removeEventListener("click", closeMenuOnOutside);
}

function switchHtml({ checked, onchange, label, disabled }) {
    return `<label class="vc-switch"><input type="checkbox"${checked ? " checked" : ""}${disabled ? " disabled" : ""} onchange="${onchange}" aria-label="${esc(label || "")}"><span class="vc-switch-track"></span></label>`;
}

function pagerHtml({ total, page, limit, onPage, onLimit }) {
    const pages = Math.max(1, Math.ceil(total / limit));
    const from = total === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(total, page * limit);
    const btn = (icon, p, disabled, label) => `<button type="button" class="vc-pager-btn" aria-label="${label}"${disabled ? " disabled" : ""} onclick="${onPage}(${p})">${icon}</button>`;
    return `<div class="vc-pager">
        <label class="vc-pager-size">Items per page:
            <select onchange="${onLimit}(this.value)">${[10, 25, 50].map((n) => `<option value="${n}"${n === limit ? " selected" : ""}>${n}</option>`).join("")}</select>
        </label>
        <span class="vc-pager-range">${from} &ndash; ${to} of ${total}</span>
        <span class="vc-pager-nav">
            ${btn(ICON.first, 1, page <= 1, "First page")}${btn(ICON.prev, page - 1, page <= 1, "Previous page")}
            ${btn(ICON.next, page + 1, page >= pages, "Next page")}${btn(ICON.last, pages, page >= pages, "Last page")}
        </span>
    </div>`;
}

// ===========================================================================
// 2. Stock Recommendation
// ===========================================================================

const STOCK_FILTERS = [
    { key: "all", label: "All" },
    { key: "ok", label: "OK" },
    { key: "out_of_stock", label: "Out of stock" },
    { key: "low_stock", label: "Low stock" },
    { key: "sales_issue", label: "Sales issues" }
];
const STOCK_STATUS_BADGE = {
    ok: ["vc-badge-green", "OK"],
    out_of_stock: ["vc-badge-red", "Out of stock"],
    low_stock: ["vc-badge-amber", "Low stock"],
    sales_issue: ["vc-badge-grey", "Sales issue"]
};

const stock = { hostId: null, data: null, filter: "all", field: "sku", q: "", selected: new Set() };

async function loadStock(hostId) {
    stock.hostId = hostId;
    const host = document.getElementById(hostId);
    if (!host) return;
    if (!stock.data) host.innerHTML = '<div class="vm-loading-state">Loading...</div>';
    try {
        const data = await api("/api/vendors/me/stock-overview");
        if (data.error) { host.innerHTML = `<p class="vc-empty">${esc(data.error)}</p>`; return; }
        stock.data = data;
        stock.selected = new Set([...stock.selected].filter((id) => data.items.some((i) => i.id === id)));
        renderStock();
    } catch (error) {
        console.error("loadStock error:", error);
        host.innerHTML = '<p class="vc-empty">Could not load stock recommendations.</p>';
    }
}

function stockRows() {
    const q = stock.q.trim().toLowerCase();
    return stock.data.items.filter((i) => {
        if (stock.filter !== "all" && i.status !== stock.filter) return false;
        if (!q) return true;
        const hay = stock.field === "lizimas" ? (i.lizimasSku || "") : (i.sku || "");
        return String(hay).toLowerCase().includes(q);
    });
}

function renderStock() {
    const host = document.getElementById(stock.hostId);
    if (!host || !stock.data) return;
    const s = stock.data.summary;
    const c = stock.data.counts;
    const tile = (title, value, sub) => `<div class="vc-tile"><div class="vc-tile-title">${title}</div><div class="vc-tile-value">${fmtNum(value)}</div><div class="vc-tile-sub">${sub}</div></div>`;
    host.innerHTML = `
        <div class="vc-tiles">
            ${tile("Potential Missed Business", s.potentialMissed, "Potential lost items sold over the next 30 days on out-of-stock SKUs")}
            ${tile("Total SKUs", s.totalSkus, "Number of product SKUs")}
            ${tile("In Transit", s.inTransit, "Items on consignment orders (CO) that are still open")}
            ${tile("Available Stock", s.available, "Current sellable stock - yours plus stock at Lizimas hubs")}
            ${tile("Suggested Replenish Quantity", s.suggestedQty, 'Target stock <span class="vc-info" title="About 30 days of cover at your last-30-day sales rate">&#9432;</span> &minus; Available stock &minus; In transit')}
        </div>
        <div class="vc-toolbar">
            <select class="vc-input vc-field-select" aria-label="Search by" onchange="vcStockField(this.value)">
                <option value="sku"${stock.field === "sku" ? " selected" : ""}>Seller SKU</option>
                <option value="lizimas"${stock.field === "lizimas" ? " selected" : ""}>Lizimas Store SKU</option>
            </select>
            <label class="vc-search"><input type="search" placeholder="Search..." value="${esc(stock.q)}" oninput="vcStockSearch(this.value)" aria-label="Search products"><span>${ICON.search}</span></label>
            <button type="button" class="vc-btn vc-btn-outline" onclick="vcStockExport()">${ICON.download} Export</button>
            <button type="button" class="vc-btn vc-btn-gold" onclick="vcStockBulkCreate()">${ICON.plus} Bulk Creation</button>
        </div>
        <div class="vc-pillbar">
            <span class="vc-pill-label">Status</span>
            ${STOCK_FILTERS.map((f) => `<button type="button" class="vc-pill${stock.filter === f.key ? " vc-pill-active" : ""}" onclick="vcStockFilter('${f.key}')">${stock.filter === f.key ? ICON.check : ""}${f.label} (${c[f.key] || 0})</button>`).join("")}
            <button type="button" class="vc-btn vc-btn-grey vc-push-right" id="vc-stock-generate" onclick="vcStockGenerateCo()" ${stock.selected.size ? "" : "disabled"}>${ICON.doc} Generate CO${stock.selected.size ? ` (${stock.selected.size})` : ""}</button>
        </div>
        <div class="vc-table-wrap" id="vc-stock-table"></div>`;
    renderStockTable();
}

function renderStockTable() {
    const wrap = document.getElementById("vc-stock-table");
    if (!wrap) return;
    const rows = stockRows();
    if (!rows.length) {
        wrap.innerHTML = `<p class="vc-empty">${stock.data.items.length ? "No products match this filter." : "You have no products yet."}</p>`;
        return;
    }
    const allChecked = rows.every((r) => stock.selected.has(r.id));
    wrap.innerHTML = `<table class="vc-table">
        <thead><tr>
            <th class="vc-col-check"><input type="checkbox" aria-label="Select all"${allChecked ? " checked" : ""} onchange="vcStockSelectAll(this.checked)"></th>
            <th>Product</th><th>Status</th><th class="vc-num">Available</th><th class="vc-num">In Transit</th>
            <th class="vc-num">Sold (30d)</th><th class="vc-num">Days of Cover</th><th class="vc-num">Target Stock</th><th class="vc-num">Suggested Qty</th>
        </tr></thead>
        <tbody>${rows.map((r) => {
            const [cls, label] = STOCK_STATUS_BADGE[r.status] || ["vc-badge-grey", r.status];
            return `<tr>
                <td class="vc-col-check"><input type="checkbox" aria-label="Select ${esc(r.name)}"${stock.selected.has(r.id) ? " checked" : ""} onchange="vcStockSelect(${Number(r.id)}, this.checked)"></td>
                <td><div class="vc-prod-name">${esc(r.name)}</div><div class="vc-prod-sku">Seller SKU: ${r.sku ? esc(r.sku) : "&mdash;"}</div><div class="vc-prod-sku">Lizimas SKU: ${r.lizimasSku ? esc(r.lizimasSku) : "&mdash;"}${r.fulfillmentType === "lizimas_fulfilled" ? " &middot; Fulfilled by Lizimas" : ""}</div></td>
                <td><span class="vc-badge ${cls}">${label}</span></td>
                <td class="vc-num">${fmtNum(r.available)}</td>
                <td class="vc-num">${fmtNum(r.inTransit)}</td>
                <td class="vc-num">${fmtNum(r.unitsSoldWindow)}</td>
                <td class="vc-num">${r.daysOfCover == null ? "&mdash;" : fmtNum(r.daysOfCover)}</td>
                <td class="vc-num">${fmtNum(r.targetStock)}</td>
                <td class="vc-num"><strong>${fmtNum(r.suggestedQty)}</strong></td>
            </tr>`;
        }).join("")}</tbody>
    </table>`;
}

function refreshGenerateButton() {
    const b = document.getElementById("vc-stock-generate");
    if (!b) return;
    b.disabled = stock.selected.size === 0;
    b.innerHTML = `${ICON.doc} Generate CO${stock.selected.size ? ` (${stock.selected.size})` : ""}`;
}

window.vcStockField = (v) => { stock.field = v; renderStockTable(); };
window.vcStockSearch = (v) => { stock.q = v; renderStockTable(); };
window.vcStockFilter = (k) => { stock.filter = k; renderStock(); };
window.vcStockSelect = (id, on) => { if (on) stock.selected.add(id); else stock.selected.delete(id); refreshGenerateButton(); renderStockTable(); };
window.vcStockSelectAll = (on) => { stockRows().forEach((r) => (on ? stock.selected.add(r.id) : stock.selected.delete(r.id))); refreshGenerateButton(); renderStockTable(); };

window.vcStockExport = () => {
    const rows = stockRows();
    const head = ["Product", "Seller SKU", "Lizimas Store SKU", "Status", "Available", "In Transit", "Sold (30d)", "Days of Cover", "Target Stock", "Suggested Qty"];
    const csvCell = (v) => {
        let s = String(v == null ? "" : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // no spreadsheet formula injection
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head, ...rows.map((r) => [r.name, r.sku || "", r.lizimasSku || "", (STOCK_STATUS_BADGE[r.status] || [0, r.status])[1], r.available, r.inTransit, r.unitsSoldWindow, r.daysOfCover == null ? "" : r.daysOfCover, r.targetStock, r.suggestedQty])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-recommendation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Bulk Creation = a consignment order for every SKU with a suggested
// replenish quantity; Generate CO = one for the ticked rows.
window.vcStockBulkCreate = () => {
    const items = stock.data.items.filter((i) => i.suggestedQty > 0 && i.status !== "sales_issue");
    if (!items.length) { toast("Nothing needs replenishing right now based on your recent sales.", "ok"); return; }
    openCoSheet(items);
};
window.vcStockGenerateCo = () => {
    const items = stock.data.items.filter((i) => stock.selected.has(i.id));
    if (items.length) openCoSheet(items);
};

async function openCoSheet(items) {
    const { el } = openSheet({
        title: "Generate Consignment Order",
        wide: true,
        body: `<p class="vc-muted">Ship these items to a Lizimas hub. Quantities start at the suggested replenish quantity - change any of them.</p>
            <div class="vc-field"><label class="vc-label" for="vc-co-hub">Ship to hub</label><select id="vc-co-hub" class="vc-input"><option value="">Loading hubs...</option></select></div>
            <div class="vc-co-lines">${items.map((i) => `<div class="vc-co-line" data-id="${Number(i.id)}">
                <div><div class="vc-prod-name">${esc(i.name)}</div><div class="vc-prod-sku">${i.sku ? esc(i.sku) : "No SKU"} &middot; Suggested ${fmtNum(i.suggestedQty)}</div></div>
                <input type="number" min="0" class="vc-input vc-co-qty" value="${Math.max(i.suggestedQty, 1)}" aria-label="Quantity for ${esc(i.name)}">
            </div>`).join("")}</div>
            <div class="vc-field"><label class="vc-label" for="vc-co-notes">Notes (optional)</label><textarea id="vc-co-notes" class="vc-input" rows="2"></textarea></div>`,
        footer: `<button type="button" class="vc-btn vc-btn-outline" onclick="vcCloseSheet()">Close</button><button type="button" class="vc-btn vc-btn-gold" id="vc-co-submit" onclick="vcSubmitCo()">Submit Request</button>`
    });
    try {
        const points = await api("/api/vendors/dropoff-points");
        const hubs = (Array.isArray(points) ? points : []).filter((p) => p.is_hub);
        const sel = el.querySelector("#vc-co-hub");
        sel.innerHTML = hubs.length
            ? hubs.map((h) => `<option value="${Number(h.id)}">${esc(h.name)} - ${esc(h.address)}</option>`).join("")
            : '<option value="">No central hub available right now</option>';
    } catch (e) {
        console.error("hubs error:", e);
    }
}

window.vcSubmitCo = async () => {
    const hub = document.getElementById("vc-co-hub").value;
    if (!hub) { toast("Choose a hub to ship to."); return; }
    const lines = [...document.querySelectorAll(".vc-co-line")].map((row) => ({
        product_id: Number(row.dataset.id),
        quantity: Number(row.querySelector(".vc-co-qty").value)
    })).filter((l) => l.quantity > 0);
    if (!lines.length) { toast("Set a quantity for at least one product."); return; }
    const btn = document.getElementById("vc-co-submit");
    btn.disabled = true;
    try {
        const result = await api("/api/vendors/me/consignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dropoff_point_id: Number(hub), vendor_notes: document.getElementById("vc-co-notes").value.trim() || null, items: lines })
        });
        if (result.error) { toast(result.error); btn.disabled = false; return; }
        closeSheet();
        stock.selected.clear();
        toast("Consignment order requested. Track it under Fulfillment by Lizimas.", "ok");
        loadStock(stock.hostId);
    } catch (e) {
        console.error("vcSubmitCo error:", e);
        toast("Could not submit this request. Please try again.");
        btn.disabled = false;
    }
};

// ===========================================================================
// 3. Promotions Management
// ===========================================================================

const CAMPAIGN_PILLS = [
    ["all", "All"], ["open", "Open"], ["joined", "Joined"], ["idle", "Idle"],
    ["ongoing", "Ongoing"], ["cancelled", "Cancelled"], ["expired", "Expired"]
];
const CAMPAIGN_STATUS_LABEL = { open: "Open", idle: "Idle", ongoing: "Ongoing", cancelled: "Cancelled", expired: "Expired" };

const promo = { days: 7, overviewHost: null, listHost: null, listMode: "cards", status: "open", q: "", page: 1, limit: 25, qTimer: null, highlightsOpen: false };

function bandText(c) {
    const f = (v) => (v == null ? "N/A" : `${Number(v)}%`);
    return `<div>Min Discount: ${f(c.min_discount_pct)}</div><div>Max Discount: ${f(c.max_discount_pct)}</div>`;
}

async function loadPromoOverview(hostId) {
    promo.overviewHost = hostId;
    const host = document.getElementById(hostId);
    if (!host) return;
    host.classList.add("vc-refetching");
    try {
        const data = await api(`/api/vendors/me/promotions/overview?days=${promo.days}`);
        host.classList.remove("vc-refetching");
        if (data.error) { host.innerHTML = `<p class="vc-empty">${esc(data.error)}</p>`; return; }
        renderPromoOverview(host, data);
    } catch (e) {
        host.classList.remove("vc-refetching");
        console.error("loadPromoOverview error:", e);
        host.innerHTML = '<p class="vc-empty">Could not load promotions.</p>';
    }
}

function renderPromoOverview(host, data) {
    const viewAll = isMobileShell() ? "vmShowScreen('promo-campaigns')" : "vcScrollToCampaigns()";
    const campaigns = data.open_campaigns.length
        ? `<div class="vc-camp-mini-list">${data.open_campaigns.map((c) => `<button type="button" class="vc-camp-mini" onclick="vcOpenCampaign(${Number(c.id)})">
                <span class="vc-camp-mini-name">${esc(c.name)}</span>
                <span class="vc-camp-mini-meta">Register by ${fmtDateTime(c.registration_ends_at)}</span>
                <span class="vc-camp-mini-meta">${c.min_discount_pct != null ? `${Number(c.min_discount_pct)}%` : "Any"} &ndash; ${c.max_discount_pct != null ? `${Number(c.max_discount_pct)}%` : "any"} off${c.joined_count ? ` &middot; ${c.joined_count} joined` : ""}</span>
            </button>`).join("")}</div>`
        : '<p class="vc-promo-none">There are no open promotions</p>';

    const highlights = data.highlight_products;
    const shown = promo.highlightsOpen ? highlights : highlights.slice(0, 3);
    const highlightHtml = highlights.length
        ? shown.map((h) => `<div class="vc-hl-row">
                <div class="vc-hl-main"><div class="vc-prod-name">${esc(h.name)}</div>
                <div class="vc-prod-sku">${h.campaign_name ? esc(h.campaign_name) + " &middot; " : ""}ends ${new Date(h.ends_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div></div>
                <div class="vc-hl-price"><div class="vc-hl-sale">${fmtUgx(h.sale_price)}</div><div class="vc-hl-was"><s>${fmtUgx(h.original_price)}</s> <span class="vc-badge vc-badge-gold">-${h.discount_pct}%</span></div></div>
                <div class="vc-hl-sold">${fmtNum(h.units_sold)} sold</div>
            </div>`).join("")
        : '<p class="vc-empty vc-empty-tight">No products are on promotion right now.</p>';

    const chips = `<div class="vc-chips" role="group" aria-label="Period">${[7, 30, 90].map((d) => `<button type="button" class="vc-chip${promo.days === d ? " vc-chip-active" : ""}" aria-pressed="${promo.days === d}" onclick="vcPromoDays(${d})">${d} Days</button>`).join("")}</div>`;
    const country = '<select class="vc-input vc-country" aria-label="Country"><option>Uganda</option></select>';
    const chartCard = `<div class="vc-chart-card">
                <div class="vc-chart-caption">Total sales from promotions</div>
                <div class="vc-chart-hero">${fmtUgx(data.revenue.revenue)}</div>
                <div class="vc-chart-sub">${fmtNum(data.revenue.units)} items &middot; ${fmtNum(data.revenue.orders)} orders &middot; last ${data.days} days</div>
                ${chartHtml(data.revenue.series)}
            </div>`;
    const campaignsBlock = `${campaigns}
            <div class="vc-center"><button type="button" class="vc-viewall" onclick="${viewAll}">View All <span class="vc-round-gold">${ICON.chevDown}</span></button></div>`;
    const highlightsBlock = `<div class="vc-card-plain">${highlightHtml}</div>
            ${highlights.length > 3 ? `<div class="vc-center"><button type="button" class="vc-link-gold" onclick="vcToggleHighlights()">${promo.highlightsOpen ? "collapse" : `expand (${highlights.length - 3} more)`}</button></div>` : ""}`;

    if (!isMobileShell()) {
        // Desktop: Jumia "Promotions > Management" layout - campaigns on the
        // left, revenue + highlight products on the right.
        host.innerHTML = `
        <div class="vc-crumb"><span class="vc-crumb-muted">Promotions</span> <span class="vc-crumb-sep">&gt;</span> <span class="vc-crumb-on">Management</span></div>
        <h2 class="vc-page-title vc-pm-title">Promotions Management</h2>
        <div class="vc-pm-grid">
            <section class="vc-pm-left">
                <h3 class="vc-pm-h">Lizimas Campaigns</h3>
                ${campaignsBlock}
            </section>
            <section class="vc-pm-right">
                <div class="vc-pm-rev-head">
                    <h3 class="vc-pm-h">Revenue from promotions and top contributors</h3>
                    <div class="vc-pm-rev-tools">${country}${chips}</div>
                </div>
                <div class="vc-pm-chart">${chartCard}</div>
                <h3 class="vc-pm-h vc-pm-h-gap">Highlight products</h3>
                <div class="vc-card-plain">${highlightHtml}</div>
                <div class="vc-center"><button type="button" class="vc-link-gold" onclick="vdOpenPromoMonitoring()">expand</button></div>
            </section>
        </div>`;
        bindChart(host);
        return;
    }

    host.innerHTML = `
        <h2 class="vc-page-title">Promotions Management</h2>
        <section class="vc-section">
            <h3 class="vc-h3">Lizimas Campaigns</h3>
            ${campaignsBlock}
        </section>
        <section class="vc-section">
            <h3 class="vc-h3">Revenue from promotions</h3>
            <div class="vc-filter-row">
                ${country}
                ${chips}
            </div>
            ${chartCard}
        </section>
        <section class="vc-section">
            <h3 class="vc-h3">Highlight products</h3>
            ${highlightsBlock}
        </section>
        <div class="vc-center" style="margin-top:6px;"><button type="button" class="vc-btn vc-btn-outline" onclick="vmShowScreen('promotions-propose')">Propose your own promotion</button></div>`;
    bindChart(host);
}

// Single-series daily bar chart (SVG). Marks in a darker gold (#b07d00,
// passes the lightness/chroma/contrast checks against white) so bars stay
// legible; hover/focus shows the day's value, the hero number above gives
// the total, and every bar is keyboard-focusable.
function chartHtml(series) {
    const W = 600, H = 160, padL = 44, padB = 22, padT = 8, padR = 6;
    const max = Math.max(...series.map((d) => d.revenue), 0);
    if (max === 0) {
        return `<div class="vc-chart-empty">No promotional sales in this period yet.</div>`;
    }
    const niceMax = niceCeil(max);
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const slot = innerW / series.length;
    const bw = Math.max(2, Math.min(28, slot - 2));
    const y = (v) => padT + innerH - (v / niceMax) * innerH;
    const ticks = [0, niceMax / 2, niceMax];
    const every = Math.ceil(series.length / 6);
    const bars = series.map((d, i) => {
        const x = padL + i * slot + (slot - bw) / 2;
        const h = Math.max(d.revenue > 0 ? 2 : 0, padT + innerH - y(d.revenue));
        const r = Math.min(4, bw / 2, h);
        const top = padT + innerH - h;
        const path = h > 0
            ? `M${x},${padT + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + innerH} Z`
            : "";
        const label = new Date(d.day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
        return `<g class="vc-bar" tabindex="0" data-label="${label}" data-value="${fmtUgx(d.revenue)}">
            <rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${innerH}" fill="transparent"/>
            ${path ? `<path d="${path}"/>` : ""}
            ${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="vc-axis">${label}</text>` : ""}
        </g>`;
    }).join("");
    const grid = ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="vc-grid"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" class="vc-axis">${compact(t)}</text>`).join("");
    return `<div class="vc-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily sales from promotions">${grid}${bars}</svg><div class="vc-tooltip" hidden></div></div>`;
}
function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
}
function compact(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + "K";
    return String(Math.round(v));
}
function bindChart(host) {
    const chart = host.querySelector(".vc-chart");
    if (!chart) return;
    const tip = chart.querySelector(".vc-tooltip");
    const show = (g) => {
        const rc = chart.getBoundingClientRect();
        const rb = g.getBoundingClientRect();
        tip.textContent = "";
        const v = document.createElement("strong"); v.textContent = g.dataset.value;
        const l = document.createElement("span"); l.textContent = g.dataset.label;
        tip.append(v, l);
        tip.hidden = false;
        const left = Math.min(Math.max(rb.left - rc.left + rb.width / 2, 50), rc.width - 50);
        tip.style.left = left + "px";
        chart.querySelectorAll(".vc-bar").forEach((b) => b.classList.toggle("vc-bar-hover", b === g));
    };
    const hide = () => { tip.hidden = true; chart.querySelectorAll(".vc-bar").forEach((b) => b.classList.remove("vc-bar-hover")); };
    chart.querySelectorAll(".vc-bar").forEach((g) => {
        g.addEventListener("pointerenter", () => show(g));
        g.addEventListener("focus", () => show(g));
        g.addEventListener("blur", hide);
    });
    chart.addEventListener("pointerleave", hide);
}

window.vcPromoDays = (d) => { promo.days = d; loadPromoOverview(promo.overviewHost); };
window.vcToggleHighlights = () => { promo.highlightsOpen = !promo.highlightsOpen; loadPromoOverview(promo.overviewHost); };
// Desktop "View All" opens the full campaign list as its own page
// (vendor-promo-monitor.js vdOpenCampaignsPage); scroll is the fallback.
window.vcScrollToCampaigns = () => {
    if (typeof vdOpenCampaignsPage === "function") { vdOpenCampaignsPage(); return; }
    const el = document.getElementById(promo.listHost);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

// --- Campaign list (View All) ----------------------------------------------

async function loadCampaigns(hostId, mode) {
    promo.listHost = hostId;
    promo.listMode = mode;
    const host = document.getElementById(hostId);
    if (!host) return;
    if (!host.querySelector(".vc-camp-shell")) {
        host.innerHTML = `<div class="vc-camp-shell">
            <div class="vc-camp-head">
                <div class="vc-pillbar vc-pillbar-scroll" id="vc-camp-pills"></div>
                <label class="vc-search vc-camp-search"><input type="search" placeholder="Search by promotion name" oninput="vcCampSearch(this.value)" aria-label="Search by promotion name"><span>${ICON.search}</span></label>
            </div>
            <div id="vc-camp-body"><div class="vm-loading-state">Loading...</div></div>
        </div>`;
    }
    renderCampaignPills();
    const body = document.getElementById("vc-camp-body");
    body.classList.add("vc-refetching");
    try {
        const qs = new URLSearchParams({ status: promo.status, q: promo.q, page: promo.page, limit: promo.limit });
        const data = await api(`/api/vendors/me/campaigns?${qs}`);
        body.classList.remove("vc-refetching");
        if (data.error) { body.innerHTML = `<p class="vc-empty">${esc(data.error)}</p>`; return; }
        renderCampaignList(body, data);
    } catch (e) {
        body.classList.remove("vc-refetching");
        console.error("loadCampaigns error:", e);
        body.innerHTML = '<p class="vc-empty">Could not load campaigns.</p>';
    }
}

function renderCampaignPills() {
    const el = document.getElementById("vc-camp-pills");
    if (!el) return;
    el.innerHTML = `<span class="vc-pill-label">Status:</span>` + CAMPAIGN_PILLS.map(([k, l]) =>
        `<button type="button" class="vc-pill vc-pill-caps${promo.status === k ? " vc-pill-active" : ""}" onclick="vcCampStatus('${k}')">${l}</button>`).join("");
}

function campaignAction(c) {
    if (c.status === "open") return `<button type="button" class="vc-link-gold" onclick="vcOpenCampaign(${Number(c.id)})">${c.joined_count ? "Add Products" : "Join Promotion"}</button>`;
    return `<button type="button" class="vc-link-muted" onclick="vcOpenCampaign(${Number(c.id)})">View Products</button>`;
}

function renderCampaignList(body, data) {
    const rows = data.campaigns;
    const pager = pagerHtml({ total: data.total, page: data.page, limit: data.limit, onPage: "vcCampPage", onLimit: "vcCampLimit" });
    if (!rows.length) {
        body.innerHTML = `<p class="vc-empty">${promo.q ? "No promotions match your search." : "There are no promotions here."}</p>`;
        return;
    }
    if (promo.listMode === "table") {
        body.innerHTML = `<div class="vc-table-wrap"><table class="vc-table vc-camp-table">
            <thead><tr><th>Promotion</th><th>Registration End Date</th><th>Period</th><th>Discount Criteria</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>${rows.map((c) => `<tr>
                <td class="vc-camp-name">${esc(c.name)}${c.joined_count ? ` <span class="vc-badge vc-badge-gold">Joined</span>` : ""}</td>
                <td class="vc-nowrap">${fmtDateTime(c.registration_ends_at)}</td>
                <td class="vc-nowrap">${fmtDateTime(c.starts_at)}<br>${fmtDateTime(c.ends_at)}</td>
                <td class="vc-nowrap">${bandText(c)}</td>
                <td>${CAMPAIGN_STATUS_LABEL[c.status]}</td>
                <td>${campaignAction(c)}</td>
            </tr>`).join("")}</tbody>
        </table></div>${pager}`;
        return;
    }
    body.innerHTML = rows.map((c) => `<div class="vc-camp-card${c.joined_count ? " vc-camp-card-joined" : ""}">
        <div class="vc-kv"><span>Promotion</span><span class="vc-camp-name">${esc(c.name)}</span></div>
        <div class="vc-kv"><span>Registration End Date</span><span>${fmtDateTime(c.registration_ends_at)}</span></div>
        <div class="vc-kv"><span>Period</span><span>${fmtDateTime(c.starts_at)}<br>${fmtDateTime(c.ends_at)}</span></div>
        <div class="vc-kv"><span>Discount Criteria</span><span>${bandText(c)}</span></div>
        <div class="vc-kv"><span>Status</span><span>${CAMPAIGN_STATUS_LABEL[c.status]}${c.joined_count ? ` &middot; ${c.joined_count} joined` : ""}</span></div>
        <div class="vc-camp-card-action">${campaignAction(c)}</div>
    </div>`).join("") + pager;
}

function reloadCampaigns() { loadCampaigns(promo.listHost, promo.listMode); }
window.vcCampStatus = (k) => { promo.status = k; promo.page = 1; reloadCampaigns(); };
window.vcCampPage = (p) => { promo.page = p; reloadCampaigns(); };
window.vcCampLimit = (n) => { promo.limit = Number(n); promo.page = 1; reloadCampaigns(); };
window.vcCampSearch = (v) => {
    clearTimeout(promo.qTimer);
    promo.qTimer = setTimeout(() => { promo.q = v; promo.page = 1; reloadCampaigns(); }, 300);
};

// --- One campaign: entries + join -----------------------------------------

const ENTRY_BADGE = { pending: ["vc-badge-amber", "Awaiting review"], approved: ["vc-badge-green", "Approved"], rejected: ["vc-badge-red", "Rejected"] };
let campaignState = null;

window.vcOpenCampaign = async (id) => {
    const { el } = openSheet({ title: "Promotion", wide: true, body: '<div class="vm-loading-state">Loading...</div>' });
    try {
        const data = await api(`/api/vendors/me/campaigns/${Number(id)}`);
        if (data.error) { el.querySelector(".vc-sheet-body").innerHTML = `<p class="vc-empty">${esc(data.error)}</p>`; return; }
        campaignState = data;
        renderCampaignSheet(el);
    } catch (e) {
        console.error("vcOpenCampaign error:", e);
        el.querySelector(".vc-sheet-body").innerHTML = '<p class="vc-empty">Could not load this promotion.</p>';
    }
};

function renderCampaignSheet(el) {
    const { campaign: c, entries, eligible_products: products } = campaignState;
    el.querySelector(".vc-sheet-title").textContent = c.name;
    const open = c.status === "open";
    const band = c.band;
    const entriesHtml = entries.length
        ? entries.map((e) => {
            const [cls, label] = ENTRY_BADGE[e.status] || ["vc-badge-grey", e.status];
            return `<div class="vc-entry">
                <div class="vc-hl-main"><div class="vc-prod-name">${esc(e.product_name)}</div><div class="vc-prod-sku">${e.sku ? esc(e.sku) : "No SKU"}${e.rejection_reason ? ` &middot; ${esc(e.rejection_reason)}` : ""}</div></div>
                <div class="vc-hl-price"><div class="vc-hl-sale">${fmtUgx(e.proposed_sale_price)}</div><div class="vc-hl-was"><s>${fmtUgx(e.original_price)}</s> -${e.discount_pct}%</div></div>
                <div class="vc-entry-side"><span class="vc-badge ${cls}">${label}</span>${open && e.status === "pending" ? `<button type="button" class="vc-link-muted" onclick="vcWithdrawEntry(${Number(c.id)}, ${Number(e.id)})">Withdraw</button>` : ""}</div>
            </div>`;
        }).join("")
        : '<p class="vc-empty vc-empty-tight">You have no products in this promotion.</p>';

    const joinHtml = open
        ? (products.length
            ? `<h3 class="vc-h4">Add products</h3>
               <p class="vc-muted">Tick the products to nominate and set a sale price. Discount must be ${band.min != null ? `at least ${band.min}% and ` : ""}at most ${band.max}% off the current price. Lizimas reviews every nomination.</p>
               <div class="vc-join-list">${products.map((p) => `<label class="vc-join-row" data-id="${Number(p.id)}" data-price="${Number(p.price)}">
                    <input type="checkbox" class="vc-join-check" onchange="vcJoinCheck(this)">
                    <span class="vc-hl-main"><span class="vc-prod-name">${esc(p.name)}</span><span class="vc-prod-sku">${p.sku ? esc(p.sku) : "No SKU"} &middot; now ${fmtUgx(p.price)}</span></span>
                    <span class="vc-join-price"><input type="number" min="1" class="vc-input vc-join-sale" placeholder="Sale price" aria-label="Sale price for ${esc(p.name)}" oninput="vcJoinPrice(this)" disabled><span class="vc-join-pct"></span></span>
               </label>`).join("")}</div>`
            : '<p class="vc-empty vc-empty-tight">None of your approved products can join - they may already have a promotion during this period.</p>')
        : "";

    el.querySelector(".vc-sheet-body").innerHTML = `
        <div class="vc-camp-summary">
            <div class="vc-kv"><span>Status</span><span>${CAMPAIGN_STATUS_LABEL[c.status]}</span></div>
            <div class="vc-kv"><span>Registration End Date</span><span>${fmtDateTime(c.registration_ends_at)}</span></div>
            <div class="vc-kv"><span>Period</span><span>${fmtDateTime(c.starts_at)} &ndash; ${fmtDateTime(c.ends_at)}</span></div>
            <div class="vc-kv"><span>Discount Criteria</span><span>${bandText(c)}</span></div>
            ${c.description ? `<p class="vc-muted">${esc(c.description)}</p>` : ""}
        </div>
        <h3 class="vc-h4">Your products</h3>
        <div class="vc-card-plain">${entriesHtml}</div>
        ${joinHtml}`;
    let foot = el.parentElement.querySelector(".vc-sheet-foot");
    if (!foot) {
        foot = document.createElement("div");
        foot.className = "vc-sheet-foot";
        el.appendChild(foot);
    }
    foot.innerHTML = `<button type="button" class="vc-btn vc-btn-outline" onclick="vcCloseSheet()">Close</button>` +
        (open && products.length ? `<button type="button" class="vc-btn vc-btn-gold" id="vc-join-submit" onclick="vcSubmitJoin(${Number(c.id)})" disabled>Join Promotion</button>` : "");
}

function pctFor(row, value) {
    const price = Number(row.dataset.price);
    const sale = Number(value);
    if (!(sale > 0) || !(price > 0)) return null;
    return ((price - sale) / price) * 100;
}
function validateJoinRow(row) {
    const input = row.querySelector(".vc-join-sale");
    const out = row.querySelector(".vc-join-pct");
    const band = campaignState.campaign.band;
    const pct = pctFor(row, input.value);
    let err = "";
    if (input.value === "") err = "Set a price";
    else if (pct === null || pct <= 0) err = "Must be below current price";
    else if (band.min != null && pct + 1e-9 < band.min) err = `Min ${band.min}% off`;
    else if (pct - 1e-9 > band.max) err = `Max ${band.max}% off`;
    out.textContent = err || `-${Math.round(pct)}%`;
    out.className = "vc-join-pct" + (err ? " vc-join-pct-bad" : "");
    return !err;
}
function refreshJoinButton() {
    const checked = [...document.querySelectorAll(".vc-join-row")].filter((r) => r.querySelector(".vc-join-check").checked);
    const btn = document.getElementById("vc-join-submit");
    if (btn) {
        btn.disabled = checked.length === 0 || !checked.every(validateJoinRow);
        btn.textContent = checked.length ? `Join Promotion (${checked.length})` : "Join Promotion";
    }
}
window.vcJoinCheck = (cb) => {
    const row = cb.closest(".vc-join-row");
    const input = row.querySelector(".vc-join-sale");
    input.disabled = !cb.checked;
    if (cb.checked) {
        if (!input.value) {
            const band = campaignState.campaign.band;
            const pct = band.min != null ? band.min : Math.min(10, band.max);
            input.value = Math.floor(Number(row.dataset.price) * (1 - pct / 100));
        }
        validateJoinRow(row);
        setTimeout(() => input.focus(), 0);
    } else {
        row.querySelector(".vc-join-pct").textContent = "";
    }
    refreshJoinButton();
};
window.vcJoinPrice = () => refreshJoinButton();

window.vcSubmitJoin = async (id) => {
    const items = [...document.querySelectorAll(".vc-join-row")]
        .filter((r) => r.querySelector(".vc-join-check").checked)
        .map((r) => ({ product_id: Number(r.dataset.id), sale_price: Number(r.querySelector(".vc-join-sale").value) }));
    if (!items.length) return;
    const btn = document.getElementById("vc-join-submit");
    btn.disabled = true;
    try {
        const result = await api(`/api/vendors/me/campaigns/${Number(id)}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items })
        });
        if (result.error) { toast(result.error); btn.disabled = false; return; }
        toast(result.message || "Submitted for review.", "ok");
        await vcOpenCampaign(id);
        refreshPromotionViews();
    } catch (e) {
        console.error("vcSubmitJoin error:", e);
        toast("Could not submit. Please try again.");
        btn.disabled = false;
    }
};

window.vcWithdrawEntry = async (campaignId, entryId) => {
    try {
        const result = await api(`/api/vendors/me/campaigns/${Number(campaignId)}/entries/${Number(entryId)}`, { method: "DELETE" });
        if (result.error) { toast(result.error); return; }
        toast("Product withdrawn from the promotion.", "ok");
        await vcOpenCampaign(campaignId);
        refreshPromotionViews();
    } catch (e) {
        console.error("vcWithdrawEntry error:", e);
        toast("Could not withdraw. Please try again.");
    }
};

function refreshPromotionViews() {
    if (promo.listHost && document.getElementById(promo.listHost)) reloadCampaigns();
    if (promo.overviewHost && document.getElementById(promo.overviewHost)) loadPromoOverview(promo.overviewHost);
}

// ===========================================================================
// 4. Applications (Jumia API connections)
// ===========================================================================

const APP_TYPE_LABEL = { self_authorization: "Self Authorization", web_application: "Web Application" };
const APP_STATUS = {
    connected: ["vc-badge-green", "Connected"],
    disconnected: ["vc-badge-grey", "Not connected"],
    error: ["vc-badge-red", "Error"],
    token_expired: ["vc-badge-amber", "Token expired"]
};

// prefix "vm" (mobile) or "vd" (desktop) picks which shell's existing
// setup/test/activate/delete handlers each card calls.
function renderAppCards(host, apps, prefix) {
    if (!host) return;
    if (!apps || !apps.length) {
        host.innerHTML = '<p class="vc-empty">No Applications yet.</p>';
        return;
    }
    host.innerHTML = apps.map((a) => {
        const [cls, label] = APP_STATUS[a.connection_status] || ["vc-badge-grey", a.connection_status];
        const created = a.created_at ? new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";
        return `<div class="vc-app-card">
            <div class="vc-kv"><span>Name</span><span>${esc(a.name)}${a.is_active ? ' <span class="vc-badge vc-badge-gold">Active</span>' : ""}</span></div>
            <div class="vc-kv"><span>Application Type</span><span>${APP_TYPE_LABEL[a.app_type] || esc(a.app_type)}</span></div>
            <div class="vc-kv"><span>Client ID</span><span class="vc-mono vc-ellipsis" title="${esc(a.client_id || "")}">${a.client_id ? esc(a.client_id) : ""}</span></div>
            <div class="vc-kv"><span>Redirect URI</span><span class="vc-mono vc-ellipsis" title="${esc(a.redirect_uri || "")}">${a.redirect_uri ? esc(a.redirect_uri) : ""}</span></div>
            <div class="vc-kv"><span>Status</span><span><span class="vc-badge ${cls}" title="${esc(a.last_error || "")}">${label}</span>${a.jumia_shop_name ? `<div class="vc-prod-sku">${esc(a.jumia_shop_name)}</div>` : ""}</span></div>
            <div class="vc-kv"><span>Created At</span><span>${created}</span></div>
            <div class="vc-kv vc-kv-actions"><span>Actions</span><span class="vc-icon-row">
                ${a.connected && !a.is_active ? `<button type="button" class="vc-text-btn" onclick="${prefix}MakeJumiaAppActive(${Number(a.id)})">Make active</button>` : ""}
                ${a.is_active ? `<button type="button" class="vc-text-btn" onclick="${prefix}TestJumiaApp(${Number(a.id)})">Test</button>` : ""}
                <button type="button" class="vc-icon-btn" title="Delete" aria-label="Delete ${esc(a.name)}" onclick="${prefix}DeleteJumiaApp(${Number(a.id)})">${ICON.trash}</button>
                <button type="button" class="vc-icon-btn vc-icon-gold" title="${a.connected ? "Credentials" : "Connect"}" aria-label="Credentials for ${esc(a.name)}" onclick="${prefix}ShowJumiaAppSetup(${Number(a.id)})">${ICON.lock}</button>
            </span></div>
        </div>`;
    }).join("");
}

// Create Application dialog (bottom sheet on phones). Create stays
// disabled until a name AND a type are chosen; a duplicate name comes
// back from the server as 409 and is shown as a red toast without closing.
function openCreateAppSheet(prefix) {
    const { el } = openSheet({
        title: "Create Application",
        wide: true,
        body: `<div class="vc-uline-field" id="vc-app-name-field">
                <label class="vc-uline-label" for="vc-app-name">Application Name *</label>
                <input id="vc-app-name" class="vc-uline-input" placeholder="Application Name" maxlength="120" autocomplete="off">
                <div class="vc-uline-error" id="vc-app-name-error"></div>
            </div>
            <div class="vc-app-type-title">Application Type</div>
            <label class="vc-radio-block"><input type="radio" name="vc-app-type" value="web_application"><span class="vc-radio-dot"></span>
                <span><span class="vc-radio-title">Web Application (OAuth - Authorization Code Flow)</span>
                <span class="vc-radio-desc">This flow is used if:<br>- You want to integrate with a Web Application<br>- You want your users to authenticate and consent before they consume the Jumia API<br>- You have the callback URL in order to exchange an Access Token by Authorization Code</span></span></label>
            <label class="vc-radio-block"><input type="radio" name="vc-app-type" value="self_authorization"><span class="vc-radio-dot"></span>
                <span><span class="vc-radio-title">Self Authorization (Integration without User interaction)</span>
                <span class="vc-radio-desc">This flow is used if:<br>- You do not have a Web Application<br>- You want to integrate Machine-to-machine without Users Authentication</span></span></label>`,
        footer: `<button type="button" class="vc-btn vc-btn-outline vc-btn-caps" onclick="vcCloseSheet()">Close</button><button type="button" class="vc-btn vc-btn-gold vc-btn-caps" id="vc-app-create" disabled>Create</button>`
    });
    const name = el.querySelector("#vc-app-name");
    const field = el.querySelector("#vc-app-name-field");
    const errEl = el.querySelector("#vc-app-name-error");
    const create = document.getElementById("vc-app-create");
    const type = () => { const r = el.querySelector('input[name="vc-app-type"]:checked'); return r ? r.value : null; };
    const refresh = () => { create.disabled = !(name.value.trim() && type()); };
    const validate = () => {
        const bad = !name.value.trim();
        field.classList.toggle("vc-uline-invalid", bad);
        errEl.textContent = bad ? "This field is required" : "";
        return !bad;
    };
    name.addEventListener("input", () => { if (field.classList.contains("vc-uline-invalid")) validate(); refresh(); });
    name.addEventListener("blur", validate);
    el.querySelectorAll('input[name="vc-app-type"]').forEach((r) => r.addEventListener("change", refresh));
    create.onclick = async () => {
        if (!validate() || !type()) return;
        create.disabled = true;
        try {
            const created = await api("/api/vendors/me/jumia/applications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.value.trim(), app_type: type() })
            });
            if (created.error) { toast(created.error); refresh(); return; }
            closeSheet();
            if (prefix === "vm") {
                await vmLoadJumia();
                vmShowJumiaAppSetup(created.id);
            } else {
                await vdLoadJumia();
                vdShowJumiaAppSetup(created.id);
                const setup = document.getElementById("vd-jumia-app-setup-view");
                if (setup) setup.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        } catch (e) {
            console.error("create application error:", e);
            toast("Could not connect to server.");
            refresh();
        }
    };
    setTimeout(() => name.focus(), 50);
}

// ===========================================================================
// 5. Users + Assign Permissions
// ===========================================================================

// Jumia order and wording (Assign Permissions dialog).
const ROLE_ORDER = [
    "vc_promotion_manager", "vc_product_manager", "vc_advertising_manager", "vc_finance_viewer",
    "vc_order_viewer", "vc_product_viewer", "vc_product_update", "vc_shop_viewer",
    "vc_order_manager", "vc_shop_manager", "vc_order_report"
];
const ROLE_DESC = {
    vc_promotion_manager: "User can view, export, import and manage Promotions",
    vc_product_manager: "User can view, export, import and manage Products",
    vc_advertising_manager: "User can view Advertising features",
    vc_finance_viewer: "User can view Account Statements and export Transactions",
    vc_order_viewer: "User can view and export Orders and Order Items",
    vc_product_viewer: "User can view and export Products",
    vc_product_update: "User can update existing Products",
    vc_shop_viewer: "User can view and export everything of your Master Shop",
    vc_order_manager: "User can view, export and manage Orders",
    vc_shop_manager: "User can view, export and manage everything of your Master Shop",
    vc_order_report: "Can receive order email reports"
};

const users = { q: "", page: 1, limit: 10, shopName: null, busy: new Set() };

async function ensureShopName() {
    if (users.shopName) return users.shopName;
    try {
        const v = await api("/api/vendors/me");
        users.shopName = v && v.business_name ? v.business_name : "";
    } catch (e) { users.shopName = ""; }
    return users.shopName;
}

function staffList() {
    const q = users.q.trim().toLowerCase();
    return (vdStaffCache || []).filter((s) => !q || String(s.name).toLowerCase().includes(q) || String(s.email).toLowerCase().includes(q));
}

async function renderUsersMobile() {
    const host = document.getElementById("vm-users-list");
    if (!host) return;
    await ensureShopName();
    const all = staffList();
    const start = (users.page - 1) * users.limit;
    const rows = all.slice(start, start + users.limit);
    host.innerHTML = rows.length
        ? rows.map(userCardHtml).join("") + pagerHtml({ total: all.length, page: users.page, limit: users.limit, onPage: "vcUsersPage", onLimit: "vcUsersLimit" })
        : `<p class="vc-empty">${users.q ? "No users match your search." : "You haven't added any users yet."}</p>`;
}

function userCardHtml(s) {
    const roles = s.roles || [];
    return `<div class="vc-user-card">
        <div class="vc-kv"><span>Name</span><span>${esc(s.name)}</span></div>
        <div class="vc-kv"><span>Email</span><span class="vc-ellipsis" title="${esc(s.email)}">${esc(s.email)}</span></div>
        <div class="vc-kv"><span>Shop(s)</span><span>${esc(users.shopName || "-")}</span></div>
        <div class="vc-kv"><span>Enable to receive order report</span><span>${switchHtml({ checked: roles.includes("vc_order_report"), onchange: `vcToggleOrderReport(${Number(s.id)}, this)`, label: "Receive order report" })}</span></div>
        <div class="vc-kv vc-kv-actions"><span>Actions</span><span class="vc-icon-row">
            <button type="button" class="vc-icon-btn" title="Assign permissions" aria-label="Assign permissions for ${esc(s.name)}" onclick="vcOpenPermissions(${Number(s.id)})">${ICON.shield}</button>
            <button type="button" class="vc-icon-btn" title="More actions" aria-label="More actions for ${esc(s.name)}" onclick="vcUserMenu(${Number(s.id)}, this)">${ICON.kebab}</button>
            ${switchHtml({ checked: s.enabled, onchange: `vcSetUserEnabled(${Number(s.id)}, this.checked, this)`, label: s.enabled ? "User active" : "User inactive" })}
        </span></div>
        ${s.must_reset_password ? '<div class="vc-prod-sku vc-user-note">Invite pending - they haven\'t set their password yet.</div>' : ""}
    </div>`;
}

// Desktop Users table - same actions as the mobile cards.
function renderUsersDesktop() {
    const container = document.getElementById("vd-staff-table");
    if (!container) return;
    ensureShopName().then(() => {
        const rows = staffList();
        if (!rows.length) {
            container.innerHTML = `<p class="vc-empty">${users.q ? "No users match your search." : "You haven't added any users yet."}</p>`;
            return;
        }
        container.innerHTML = `<table class="vc-table">
            <thead><tr><th>Name</th><th>Email</th><th>Shop(s)</th><th>Enable to receive order report</th><th>Actions</th></tr></thead>
            <tbody>${rows.map((s) => `<tr>
                <td>${esc(s.name)}${s.must_reset_password ? '<div class="vc-prod-sku">Invite pending</div>' : ""}</td>
                <td>${esc(s.email)}</td>
                <td>${esc(users.shopName || "-")}</td>
                <td>${switchHtml({ checked: (s.roles || []).includes("vc_order_report"), onchange: `vcToggleOrderReport(${Number(s.id)}, this)`, label: "Receive order report" })}</td>
                <td><span class="vc-icon-row">
                    <button type="button" class="vc-icon-btn" title="Assign permissions" aria-label="Assign permissions for ${esc(s.name)}" onclick="vcOpenPermissions(${Number(s.id)})">${ICON.shield}</button>
                    <button type="button" class="vc-icon-btn" title="More actions" aria-label="More actions for ${esc(s.name)}" onclick="vcUserMenu(${Number(s.id)}, this)">${ICON.kebab}</button>
                    ${switchHtml({ checked: s.enabled, onchange: `vcSetUserEnabled(${Number(s.id)}, this.checked, this)`, label: s.enabled ? "User active" : "User inactive" })}
                </span></td>
            </tr>`).join("")}</tbody>
        </table>`;
    });
}

function rerenderUsers() {
    renderUsersMobile();
    renderUsersDesktop();
}

async function reloadStaff() {
    const result = await api("/api/vendors/me/staff");
    if (!result.error) {
        vdStaffCache = result.staff || [];
        vdStaffAvailableRoles = result.availableRoles || [];
    }
    rerenderUsers();
}

async function saveRoles(id, roles) {
    return api(`/api/vendors/me/staff/${Number(id)}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles })
    });
}

window.vcUsersPage = (p) => { users.page = p; renderUsersMobile(); };
window.vcUsersLimit = (n) => { users.limit = Number(n); users.page = 1; renderUsersMobile(); };
window.vcUsersSearch = (v) => { users.q = v; users.page = 1; rerenderUsers(); };

window.vcToggleOrderReport = async (id, input) => {
    const s = vdStaffCache.find((x) => x.id === id);
    if (!s) return;
    const on = input.checked;
    const roles = new Set(s.roles || []);
    if (on) roles.add("vc_order_report"); else roles.delete("vc_order_report");
    input.disabled = true;
    try {
        const r = await saveRoles(id, [...roles]);
        if (r.error) { input.checked = !on; toast(r.error); return; }
        s.roles = [...roles];
        toast(on ? `${s.name} will receive order email reports.` : `${s.name} will no longer receive order email reports.`, "ok");
    } catch (e) {
        input.checked = !on;
        toast("Could not update. Please try again.");
    } finally {
        input.disabled = false;
    }
};

window.vcSetUserEnabled = async (id, enabled, input) => {
    const s = vdStaffCache.find((x) => x.id === id);
    if (!s) return;
    if (!enabled && !confirm(`Deactivate ${s.name}? They will no longer be able to use any part of your vendor account.`)) {
        if (input) input.checked = true;
        return;
    }
    if (input) input.disabled = true;
    try {
        const r = await api(`/api/vendors/me/staff/${Number(id)}/enabled`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled })
        });
        if (r.error) { if (input) input.checked = !enabled; toast(r.error); return; }
        toast(enabled ? `${s.name} activated.` : `${s.name} deactivated.`, "ok");
        await reloadStaff();
    } catch (e) {
        if (input) input.checked = !enabled;
        toast("Could not update this user.");
    } finally {
        if (input) input.disabled = false;
    }
};

window.vcRemoveUser = async (id) => {
    const s = vdStaffCache.find((x) => x.id === id);
    if (!confirm(`Remove ${s ? s.name : "this user"} from your account? This can't be undone.`)) return;
    try {
        const r = await api(`/api/vendors/me/staff/${Number(id)}`, { method: "DELETE" });
        if (r.error) { toast(r.error); return; }
        toast("User removed.", "ok");
        await reloadStaff();
    } catch (e) {
        toast("Could not remove this user.");
    }
};

window.vcUserMenu = (id, anchor) => {
    const s = vdStaffCache.find((x) => x.id === id);
    if (!s) return;
    openMenu(anchor, [
        { label: "Activate User", icon: ICON.userPlus, disabled: s.enabled, onClick: () => vcSetUserEnabled(id, true) },
        { label: "Deactivate User", icon: ICON.userOff, disabled: !s.enabled, onClick: () => vcSetUserEnabled(id, false) },
        { label: "Remove User", icon: ICON.userMinus, danger: true, onClick: () => vcRemoveUser(id) }
    ]);
};

// Each switch saves on its own, like Jumia - no separate Save button.
window.vcOpenPermissions = (id) => {
    const s = vdStaffCache.find((x) => x.id === id);
    if (!s) return;
    const known = new Map((vdStaffAvailableRoles || []).map((r) => [r.code, r.label]));
    const codes = ROLE_ORDER.filter((c) => known.has(c)).concat([...known.keys()].filter((c) => !ROLE_ORDER.includes(c)));
    const roles = new Set(s.roles || []);
    openSheet({
        title: "Assign Permissions",
        wide: true,
        body: `<p class="vc-perm-intro">Toggle the switches to give or remove permissions. You can assign one or more permission(s) to the same user.</p>
            <div class="vc-perm-list">${codes.map((code) => `<div class="vc-perm-row">
                <div class="vc-perm-text"><div class="vc-perm-name">${esc(known.get(code))}</div><div class="vc-perm-desc">${esc(ROLE_DESC[code] || known.get(code))}</div></div>
                <div class="vc-perm-state"><span class="vc-perm-label${roles.has(code) ? " vc-on" : ""}" id="vc-perm-l-${code}">${roles.has(code) ? "ACTIVE" : "INACTIVE"}</span>
                ${switchHtml({ checked: roles.has(code), onchange: `vcTogglePermission(${Number(id)}, '${code}', this)`, label: known.get(code) })}</div>
            </div>`).join("")}</div>`,
        footer: `<span></span><button type="button" class="vc-btn vc-btn-soft vc-btn-caps" onclick="vcCloseSheet()">Close</button>`,
        onClose: rerenderUsers
    });
};

window.vcTogglePermission = async (id, code, input) => {
    const s = vdStaffCache.find((x) => x.id === id);
    if (!s) return;
    const on = input.checked;
    const roles = new Set(s.roles || []);
    if (on) roles.add(code); else roles.delete(code);
    const label = document.getElementById(`vc-perm-l-${code}`);
    input.disabled = true;
    try {
        const r = await saveRoles(id, [...roles]);
        if (r.error) { input.checked = !on; toast(r.error); return; }
        s.roles = [...roles];
        if (label) { label.textContent = on ? "ACTIVE" : "INACTIVE"; label.classList.toggle("vc-on", on); }
    } catch (e) {
        input.checked = !on;
        toast("Could not update permissions. Please try again.");
    } finally {
        input.disabled = false;
    }
};

// ===========================================================================
// 6. Advertise your Products - Sponsored Products intro (Lizimas colours)
// ===========================================================================

function adsHeroHtml() {
    const benefit = (tone, icon, title, text) => `<div class="vc-ad-benefit">
        <span class="vc-ad-benefit-icon vc-tone-${tone}">${icon}</span>
        <div><div class="vc-ad-benefit-title">${title}</div><div class="vc-ad-benefit-text">${text}</div></div>
    </div>`;
    const phone = `<svg class="vc-ad-illus" viewBox="0 0 240 250" aria-hidden="true">
        <ellipse cx="150" cy="120" rx="95" ry="110" fill="#fff4d6"/>
        <g transform="rotate(-6 120 125)">
            <rect x="52" y="22" width="150" height="212" rx="18" fill="#fff" stroke="#e2e4ea" stroke-width="2"/>
            <rect x="64" y="38" width="126" height="16" rx="8" fill="#f4f5f7"/>
            <circle cx="74" cy="46" r="4" fill="none" stroke="#9aa1ae" stroke-width="1.6"/>
            <rect x="64" y="62" width="126" height="78" rx="10" fill="#f4f5f7" stroke="#f4b400" stroke-width="2"/>
            <rect x="72" y="70" width="52" height="62" rx="8" fill="#1a1a2e"/>
            <path d="M86 108v-10a12 12 0 0 1 24 0v10" fill="none" stroke="#f4b400" stroke-width="4" stroke-linecap="round"/>
            <rect x="82" y="104" width="8" height="14" rx="3" fill="#f4b400"/><rect x="106" y="104" width="8" height="14" rx="3" fill="#f4b400"/>
            <rect x="132" y="72" width="52" height="14" rx="4" fill="#f4b400"/>
            <text x="158" y="82" text-anchor="middle" font-size="8.5" font-weight="700" fill="#1a1a2e" font-family="sans-serif">Sponsored</text>
            <rect x="132" y="94" width="44" height="6" rx="3" fill="#d6d9e0"/><rect x="132" y="106" width="30" height="6" rx="3" fill="#e5e7eb"/>
            <rect x="170" y="118" width="14" height="14" rx="3" fill="#1a1a2e"/>
            <g fill="#f4f5f7"><rect x="64" y="150" width="38" height="42" rx="8"/><rect x="108" y="150" width="38" height="42" rx="8"/><rect x="152" y="150" width="38" height="42" rx="8"/></g>
            <path d="M72 180c6-8 14-9 22-4l2 6H72z" fill="#9aa1ae"/>
            <rect x="120" y="156" width="14" height="30" rx="3" fill="#1a1a2e"/><rect x="122" y="159" width="10" height="22" rx="2" fill="#f4b400"/>
            <path d="M160 170h22l-3 16h-16z" fill="#c98f00"/><path d="M165 170a6 6 0 0 1 12 0" fill="none" stroke="#c98f00" stroke-width="2"/>
            <g fill="#e5e7eb"><rect x="64" y="200" width="30" height="5" rx="2.5"/><rect x="108" y="200" width="30" height="5" rx="2.5"/><rect x="152" y="200" width="30" height="5" rx="2.5"/></g>
        </g>
        <g fill="#1a1a2e"><rect x="196" y="200" width="9" height="22" rx="2"/><rect x="209" y="190" width="9" height="32" rx="2"/><rect x="222" y="176" width="9" height="46" rx="2"/></g>
        <path d="M190 190c14-6 26-16 36-32" fill="none" stroke="#f4b400" stroke-width="3" stroke-linecap="round"/><path d="m220 156 8-1-1 8" fill="none" stroke="#f4b400" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <g stroke="#f4b400" stroke-width="3" stroke-linecap="round"><path d="M40 20l8 10"/><path d="M58 8l2 12"/><path d="M28 38l12 2"/></g>
    </svg>`;
    return `<section class="vc-ads-hero">
        <div class="vc-ads-brand">Lizimas <span>Store</span></div>
        <div class="vc-ads-top">
            <div class="vc-ads-copy">
                <h2 class="vc-ads-title">Get Visibility and Sales for your products on Lizimas Store with <span>Sponsored Products</span></h2>
                <p class="vc-ads-lead">Sponsored Products help you promote your products to the most suitable shoppers, in prominent locations across Lizimas Store, including the Search Page, Category Page and Product Page.</p>
            </div>
            ${phone}
        </div>
        <div class="vc-ads-store">
            <span class="vc-ad-benefit-icon vc-tone-navy"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/><path d="M9 20v-5h6v5"/></svg></span>
            <div><div class="vc-ad-benefit-title">Sponsored Products for your store</div><div class="vc-ad-benefit-text">Promote your products to reach more shoppers and increase your visibility.</div></div>
        </div>
        <h3 class="vc-ads-h3">Advantages of Using Sponsored Products</h3>
        ${benefit("navy", '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>', "Increase your Visibility", "Showcase your products prominently in search results, category pages and product pages.")}
        ${benefit("gold", '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>', "Showcase your Products", "Promote multiple products to increase visibility for new products, special offers or items you want to move faster.")}
        ${benefit("green", '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 14 6-6 4 4 8-8"/><path d="M15 4h6v6"/><path d="M4 20v-2M9 20v-4M14 20v-3M19 20v-6"/></svg>', "Boost Sales", "Increase opportunities to generate sales and track campaign performance using advertising metrics such as ROAS.")}
        ${benefit("amber", '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>', "Self Service Campaigns", "Have control over your campaigns with options to choose your bids, budgets and promoted products.")}
        <div class="vc-ads-cta"><button type="button" class="vc-btn vc-btn-gold vc-btn-big" onclick="vcStartAdCampaign()">Create a campaign</button></div>
    </section>`;
}

window.vcStartAdCampaign = () => {
    if (isMobileShell() && typeof vmShowAdCampaignCreate === "function") vmShowAdCampaignCreate();
    else if (typeof vdShowCreateAdCampaignForm === "function") vdShowCreateAdCampaignForm();
};

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".vc-ads-hero-host").forEach((h) => { h.innerHTML = adsHeroHtml(); });
});

// ===========================================================================
// Public hooks used by vendor-mobile.js / vendor-dashboard.js
// ===========================================================================

window.vcCloseSheet = closeSheet;
window.vcToast = toast;
window.vcLoadStock = loadStock;
window.vcLoadPromoOverview = loadPromoOverview;
window.vcLoadCampaigns = loadCampaigns;
window.vcRenderAppCards = renderAppCards;
window.vcOpenCreateAppSheet = openCreateAppSheet;
window.vcRenderUsersMobile = renderUsersMobile;
window.vcRenderUsersDesktop = renderUsersDesktop;

})();
