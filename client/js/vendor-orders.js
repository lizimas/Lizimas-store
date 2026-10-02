// Orders panel - vendor phone + computer (Ryan, Oct 2026), in the Vendor
// Center layout and Lizimas colours:
//   STATUS pills with counts, COUNTRY and DATE chips, "Order actions" + go
//   button, search by order number / Seller SKU, the orders table (cards on
//   a phone), pager + items per page, a Filters drawer (currency, country,
//   order creation date, printed, payment method, shipping info) and an
//   Export drawer (scope + CSV, with a History tab).
//
// Loaded AFTER vendor-dashboard.js and vendor-mobile.js. It replaces
// vmRenderOrdersPills / vmRenderOrdersList, so every existing refresh path
// (vmLoadOrders, loadVendorOrders after a stage change) redraws this panel.
// It reuses vendorOrdersCache, VENDOR_NEXT_STAGE(+_BUTTON_LABEL),
// advanceVendorOrderStage, markVendorHandedOver, dropoffPointOptions,
// vendorAuthorizedFetch and vendorEsc.
//
// How Lizimas order stages map to the status pills:
//   Pending        new, accepted, processing
//   Ready to Ship  ready_for_handover
//   Shipped        handed_over, in_delivery
//   Delivered      completed
//   Canceled       cancelled
//   Rejected       rejected (at Lizimas inspection - comes back to re-prepare)
//   Returned       return_in_progress, forfeited

const VO_STATUS = [
    ["all", "All", null],
    ["pending", "Pending", ["new", "accepted", "processing"]],
    ["ready", "Ready to Ship", ["ready_for_handover"]],
    ["shipped", "Shipped", ["handed_over", "in_delivery"]],
    ["delivered", "Delivered", ["completed"]],
    ["canceled", "Canceled", ["cancelled"]],
    ["rejected", "Rejected", ["rejected"]],
    ["returned", "Returned", ["return_in_progress", "forfeited"]]
];
const VO_COUNTED = new Set(["pending", "ready", "shipped"]);   // pills that always show a count
const VO_DEFAULTS = { currency: "local", preset: "6m", from: "", to: "", printed: "all", payment: "all", shipping: "all" };
const voState = { status: "all", orderNo: "", sku: "", page: 1, perPage: 20, action: "", ...VO_DEFAULTS };
const voSelected = new Set();
let voUsdRate = null;
let voDraft = null;

const voEsc = (v) => (typeof vendorEsc === "function" ? vendorEsc(v == null ? "" : v) : String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
const voWide = () => window.matchMedia("(min-width: 1024px)").matches;
const voDay = (v) => { if (!v) return ""; const d = new Date(v); if (isNaN(d)) return ""; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const voDateTime = (v) => { if (!v) return "-"; const d = new Date(v); return isNaN(d) ? "-" : d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const voIsPostpaid = (o) => /cash|cod|delivery/i.test(String(o.payment_method || ""));
const voPayLabel = (o) => {
    const m = String(o.payment_method || "").toLowerCase();
    if (!m) return "-";
    if (voIsPostpaid(o)) return "Cash on delivery";
    if (/card/.test(m)) return "Card";
    if (/airtel/.test(m)) return "Airtel Money";
    if (/momo|mtn|mobile/.test(m)) return "Mobile Money";
    return o.payment_method;
};
const voShipLabel = (o) => (o.fulfillment_type === "lizimas_fulfilled" ? "Fulfillment by Lizimas" : "Drop-off by vendor");
const voSku = (o) => o.sku || o.product_sku || "";

function voMoney(v) {
    const n = Number(v) || 0;
    if (voState.currency === "usd" && voUsdRate) return "USD " + (n / voUsdRate).toFixed(2);
    return "UGX " + Math.round(n).toLocaleString();
}

const VO_PRESETS = [["yesterday", "Yesterday"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["6m", "Last 6 months"], ["year", "This year"]];
function voPresetRange(key) {
    const end = new Date(); const start = new Date();
    if (key === "yesterday") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
    else if (key === "7d") start.setDate(start.getDate() - 6);
    else if (key === "30d") start.setDate(start.getDate() - 29);
    else if (key === "90d") start.setDate(start.getDate() - 89);
    else if (key === "6m") start.setMonth(start.getMonth() - 6);
    else if (key === "year") { start.setMonth(0); start.setDate(1); }
    else if (key !== "today") return null;
    return { from: voDay(start), to: voDay(end) };
}
function voRange() {
    if (voState.preset) return voPresetRange(voState.preset) || { from: "", to: "" };
    return { from: voState.from, to: voState.to };
}

// Everything except the status pill - so the pill counts follow the filters.
function voFiltered() {
    const all = (typeof vendorOrdersCache !== "undefined" && Array.isArray(vendorOrdersCache)) ? vendorOrdersCache : [];
    const r = voRange();
    const no = voState.orderNo.trim().replace(/^#/, "");
    const sku = voState.sku.trim().toLowerCase();
    return all.filter((o) => {
        const d = voDay(o.created_at);
        if (r.from && d < r.from) return false;
        if (r.to && d > r.to) return false;
        if (no && !String(o.order_id).includes(no)) return false;
        if (sku && !voSku(o).toLowerCase().includes(sku)) return false;
        if (voState.printed === "yes" && !o.label_printed_at) return false;
        if (voState.printed === "no" && o.label_printed_at) return false;
        if (voState.payment === "prepaid" && voIsPostpaid(o)) return false;
        if (voState.payment === "postpaid" && !voIsPostpaid(o)) return false;
        if (voState.shipping === "vendor" && o.fulfillment_type === "lizimas_fulfilled") return false;
        if (voState.shipping === "lizimas" && o.fulfillment_type !== "lizimas_fulfilled") return false;
        return true;
    });
}
function voInStatus(o, key) {
    const def = VO_STATUS.find((s) => s[0] === key);
    return !def || !def[2] || def[2].includes(o.stage);
}
function voRows() { return voFiltered().filter((o) => voInStatus(o, voState.status)); }
function voPage(rows) {
    const pages = Math.max(1, Math.ceil(rows.length / voState.perPage));
    if (voState.page > pages) voState.page = pages;
    const start = (voState.page - 1) * voState.perPage;
    return { pages, start, pageRows: rows.slice(start, start + voState.perPage) };
}

// --- Rendering --------------------------------------------------------------

function vmRenderOrdersPills() {
    const el = document.getElementById("vm-orders-pills");
    if (!el) return;
    const base = voFiltered();
    el.innerHTML = VO_STATUS.map(([key, label]) => {
        const n = base.filter((o) => voInStatus(o, key)).length;
        const on = voState.status === key;
        const count = key !== "all" && (VO_COUNTED.has(key) || n) ? " (" + n + ")" : "";
        return `<button type="button" class="vo-pill${on ? " vo-pill-on" : ""}" aria-pressed="${on}" onclick="voSetStatus('${key}')">${on ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ""}${label}${count}</button>`;
    }).join("");
    const crumb = document.getElementById("vo-crumb");
    if (crumb) crumb.textContent = (VO_STATUS.find((s) => s[0] === voState.status) || VO_STATUS[0])[1];
    const r = voRange();
    const chips = document.getElementById("vo-chips");
    if (chips) {
        chips.innerHTML = '<span class="vo-label">Country</span><button type="button" class="vo-chip" onclick="voOpenFilters()">Uganda</button>'
            + (r.from || r.to ? `<span class="vo-label">Date</span><button type="button" class="vo-chip" onclick="voOpenFilters()">${voEsc(r.from || "...")} / ${voEsc(r.to || "...")}</button>` : "")
            + (voState.currency === "usd" ? '<span class="vo-label">Currency</span><button type="button" class="vo-chip" onclick="voOpenFilters()">USD</button>' : "")
            + (voState.printed !== "all" ? `<button type="button" class="vo-chip" onclick="voOpenFilters()">${voState.printed === "yes" ? "Printed" : "Not printed"}</button>` : "")
            + (voState.payment !== "all" ? `<button type="button" class="vo-chip" onclick="voOpenFilters()">${voState.payment === "prepaid" ? "Prepaid" : "Postpaid"}</button>` : "")
            + (voState.shipping !== "all" ? `<button type="button" class="vo-chip" onclick="voOpenFilters()">${voState.shipping === "lizimas" ? "Fulfillment by Lizimas" : "Drop-off by vendor"}</button>` : "");
    }
}

function voStatusBadge(o) {
    const cls = (typeof VENDOR_STAGE_BADGE_CLASS !== "undefined" && VENDOR_STAGE_BADGE_CLASS[o.stage]) || "status-pending";
    return `<span class="status-badge ${cls}">${voEsc(o.stageLabel || o.stage)}</span>`;
}
function voRowActions(o) {
    const id = Number(o.order_item_id);
    if (typeof VENDOR_NEXT_STAGE !== "undefined" && o.stage in VENDOR_NEXT_STAGE) {
        const next = VENDOR_NEXT_STAGE[o.stage];
        return `<button type="button" class="vo-act" onclick="advanceVendorOrderStage(${id}, '${next}')">${voEsc(VENDOR_NEXT_STAGE_BUTTON_LABEL[next] || "Next")}</button>`;
    }
    if (o.stage === "ready_for_handover") {
        return `<select id="dropoff-select-${id}" class="vo-dropoff" aria-label="Drop-off point"><option value="">Choose drop-off point</option>${typeof dropoffPointOptions === "function" ? dropoffPointOptions() : ""}</select>
            <button type="button" class="vo-act vo-act-green" onclick="markVendorHandedOver(${id})">Mark Handed Over</button>`;
    }
    if (o.stage === "rejected") return `<span class="vo-note-bad">Rejected: ${voEsc(o.rejection_reason || "no reason given")}</span>`;
    return '<span class="vo-muted">&mdash;</span>';
}
function voCheck(o) {
    const id = Number(o.order_item_id), on = voSelected.has(id);
    return `<button type="button" class="vo-check${on ? " vo-checked" : ""}" aria-label="Select order ${Number(o.order_id)}" aria-pressed="${on}" onclick="voToggle(${id})">${on ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a1a2e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ""}</button>`;
}
function voTableRow(o) {
    const total = Number(o.price) * Number(o.quantity);
    return `<tr>
        <td class="vo-c-check">${voCheck(o)}</td>
        <td><strong>#${Number(o.order_id)}</strong><div class="vo-sub">Item ${Number(o.order_item_id)}</div></td>
        <td class="vo-c-prod"><div class="vo-prod">${o.product_image ? `<img src="${voEsc(o.product_image)}" alt="" loading="lazy">` : ""}<div><div>${voEsc(o.product_name)}</div><div class="vo-sub">SKU: ${voSku(o) ? voEsc(voSku(o)) : "&mdash;"}</div></div></div></td>
        <td class="vo-nowrap">${voDateTime(o.created_at)}</td>
        <td class="vo-nowrap">${voDateTime(o.delivered_at || o.handed_over_at || o.order_updated_at || o.created_at)}</td>
        <td>${voEsc(voPayLabel(o))}<div class="vo-sub">${voIsPostpaid(o) ? "Postpaid" : "Prepaid"}</div></td>
        <td class="vo-nowrap"><strong>${voMoney(total)}</strong></td>
        <td>${Number(o.quantity)}</td>
        <td>${o.label_printed_at ? '<span class="vo-ok">Printed</span>' : '<span class="vo-muted">Not printed</span>'}</td>
        <td>${voEsc(voShipLabel(o))}${o.dropoff_point_name ? `<div class="vo-sub">${voEsc(o.dropoff_point_name)}</div>` : ""}</td>
        <td>${voStatusBadge(o)}</td>
        <td class="vo-c-act">${voRowActions(o)}</td>
    </tr>`;
}
function voCard(o) {
    const total = Number(o.price) * Number(o.quantity);
    return `<div class="vo-card">
        ${voCheck(o)}
        <div class="vo-card-body">
            <div class="vo-card-top"><strong>Order #${Number(o.order_id)}</strong>${voStatusBadge(o)}</div>
            <div class="vo-card-name">${voEsc(o.product_name)}</div>
            <div class="vo-sub">SKU: ${voSku(o) ? voEsc(voSku(o)) : "&mdash;"} &middot; Qty ${Number(o.quantity)}</div>
            <div class="vo-sub">${voDateTime(o.created_at)} &middot; ${voEsc(voPayLabel(o))} (${voIsPostpaid(o) ? "Postpaid" : "Prepaid"})</div>
            <div class="vo-sub">${voEsc(voShipLabel(o))}${o.dropoff_point_name ? " &middot; " + voEsc(o.dropoff_point_name) : ""} &middot; ${o.label_printed_at ? "Label printed" : "Label not printed"}</div>
            <div class="vo-card-foot"><strong>${voMoney(total)}</strong></div>
            <div class="vo-card-act">${voRowActions(o)}</div>
        </div>
    </div>`;
}

function vmRenderOrdersList() {
    const el = document.getElementById("vm-orders-list");
    if (!el) return;
    const rows = voRows();
    const live = new Set(rows.map((o) => Number(o.order_item_id)));
    [...voSelected].forEach((id) => { if (!live.has(id)) voSelected.delete(id); });
    const { pages, start, pageRows } = voPage(rows);
    const allOn = pageRows.length > 0 && pageRows.every((o) => voSelected.has(Number(o.order_item_id)));
    if (voWide()) {
        el.innerHTML = `<div class="vo-table-wrap"><table class="vo-table"><thead><tr>
            <th class="vo-c-check"><button type="button" class="vo-check${allOn ? " vo-checked" : ""}" aria-label="Select all on this page" onclick="voToggleAll()" ${pageRows.length ? "" : "disabled"}>${allOn ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a1a2e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ""}</button></th>
            <th>Order Number</th><th>Product</th><th>Order Date</th><th>Updated Date</th><th>Payment Method</th><th>Price</th><th>#</th><th>Labels</th><th>Shipment Method</th><th>Status</th><th>Actions</th>
        </tr></thead><tbody>${pageRows.map(voTableRow).join("")}</tbody></table>
        ${pageRows.length ? "" : '<div class="vo-empty">No orders to display!</div>'}</div>`;
    } else {
        el.innerHTML = `<div class="vo-selall"><button type="button" class="vo-check${allOn ? " vo-checked" : ""}" aria-label="Select all on this page" onclick="voToggleAll()" ${pageRows.length ? "" : "disabled"}>${allOn ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#1a1a2e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ""}</button><span>${voSelected.size ? voSelected.size + " selected" : "Select all on this page"}</span></div>`
            + (pageRows.length ? pageRows.map(voCard).join("") : '<div class="vo-empty">No orders to display!</div>');
    }
    const pager = document.getElementById("vo-pager");
    if (pager) {
        const from = rows.length ? start + 1 : 0, to = start + pageRows.length;
        const nav = (label, page, off, d) => `<button type="button" class="vo-nav" aria-label="${label}" ${off ? "disabled" : ""} onclick="voGo(${page})"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg></button>`;
        pager.innerHTML = `<label>Items per page: <select onchange="voSetPerPage(this.value)" aria-label="Items per page">${[20, 50, 100].map((n) => `<option${n === voState.perPage ? " selected" : ""}>${n}</option>`).join("")}</select></label>
            <span class="vo-range">${from}${to > from ? "&ndash;" + to : ""} of ${rows.length}</span>
            ${nav("First page", 1, voState.page <= 1, '<path d="M18 6l-6 6 6 6M7 6v12"/>')}${nav("Previous page", voState.page - 1, voState.page <= 1, '<path d="M15 6l-6 6 6 6"/>')}${nav("Next page", voState.page + 1, voState.page >= pages, '<path d="M9 6l6 6-6 6"/>')}${nav("Last page", pages, voState.page >= pages, '<path d="M6 6l6 6-6 6M17 6v12"/>')}`;
    }
    voRefreshGo();
}
function voRenderAll() { vmRenderOrdersPills(); vmRenderOrdersList(); }

// --- Actions on the page ----------------------------------------------------

function voSetStatus(key) { voState.status = key; voState.page = 1; voSelected.clear(); voRenderAll(); }
function voSearch(field, value) { voState[field] = value || ""; voState.page = 1; voRenderAll(); }
function voGo(page) { voState.page = Math.max(1, page); vmRenderOrdersList(); }
function voSetPerPage(n) { voState.perPage = Number(n) || 20; voState.page = 1; vmRenderOrdersList(); }
function voToggle(id) { if (voSelected.has(id)) voSelected.delete(id); else voSelected.add(id); vmRenderOrdersList(); }
function voToggleAll() {
    const { pageRows } = voPage(voRows());
    const allOn = pageRows.length > 0 && pageRows.every((o) => voSelected.has(Number(o.order_item_id)));
    pageRows.forEach((o) => (allOn ? voSelected.delete(Number(o.order_item_id)) : voSelected.add(Number(o.order_item_id))));
    vmRenderOrdersList();
}
function voSetAction(v) { voState.action = v; voRefreshGo(); }
function voRefreshGo() {
    const go = document.getElementById("vo-go");
    if (go) go.disabled = !(voState.action && voSelected.size > 0);
}
function voSelectedRows() {
    return ((typeof vendorOrdersCache !== "undefined" && vendorOrdersCache) || []).filter((o) => voSelected.has(Number(o.order_item_id)));
}

function voPrint(title, bodyHtml) {
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups for this site to print."); return false; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${voEsc(title)}</title><style>
        body { font-family: Arial, sans-serif; color: #111; margin: 18px; }
        h1 { font-size: 18px; margin: 0 0 12px; }
        .lbl { border: 2px solid #111; border-radius: 8px; padding: 14px 16px; margin: 0 0 14px; page-break-inside: avoid; width: 340px; display: inline-block; vertical-align: top; margin-right: 12px; }
        .lbl h2 { margin: 0 0 6px; font-size: 20px; } .lbl .brand { font-weight: 700; letter-spacing: .04em; font-size: 12px; }
        .lbl p { margin: 3px 0; font-size: 13px; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
        .box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #111; }
    </style></head><body>${bodyHtml}<script>window.onload = function () { window.print(); };<\/script></body></html>`);
    w.document.close();
    return true;
}

async function voApplyAction() {
    const rows = voSelectedRows();
    if (!voState.action || !rows.length) return;
    const ids = rows.map((o) => Number(o.order_item_id));
    if (voState.action === "labels") {
        const ok = voPrint("Order labels", rows.map((o) => `<div class="lbl"><div class="brand">LIZIMAS STORE</div><h2>Order #${Number(o.order_id)}</h2>
            <p><strong>${voEsc(o.product_name)}</strong></p><p>SKU: ${voEsc(voSku(o) || "-")}</p><p>Quantity: ${Number(o.quantity)} &nbsp; Item: ${Number(o.order_item_id)}</p>
            <p>${voEsc(voShipLabel(o))}${o.dropoff_point_name ? " - " + voEsc(o.dropoff_point_name) : ""}</p><p>${voEsc(voPayLabel(o))}</p></div>`).join(""));
        if (!ok) return;
        try { await vendorAuthorizedFetch("/api/vendors/order-items/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "printed", ids }) }); } catch (e) { /* printing itself worked */ }
        if (typeof loadVendorOrders === "function") await loadVendorOrders();
        voRenderAll();
        return;
    }
    if (voState.action === "checklist") {
        voPrint("Stock checklist", `<h1>Stock checklist - ${new Date().toLocaleDateString()}</h1><table><thead><tr><th>Picked</th><th>Order</th><th>Product</th><th>SKU</th><th>Qty</th></tr></thead><tbody>${
            rows.map((o) => `<tr><td><span class="box"></span></td><td>#${Number(o.order_id)}</td><td>${voEsc(o.product_name)}</td><td>${voEsc(voSku(o) || "-")}</td><td>${Number(o.quantity)}</td></tr>`).join("")}</tbody></table>`);
        return;
    }
    if (voState.action === "ready") {
        if (!confirm("Set " + ids.length + " selected item(s) to Ready to Ship?")) return;
        const r = await vendorAuthorizedFetch("/api/vendors/order-items/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ready", ids }) });
        alert(r.error || r.message || "Done.");
        voSelected.clear();
        if (typeof loadVendorOrders === "function") await loadVendorOrders();
        voRenderAll();
        return;
    }
    if (voState.action === "cancel") {
        const reason = (prompt("Why can't these " + ids.length + " item(s) be fulfilled? Lizimas Store will review the request and contact the customer.") || "").trim();
        if (!reason) return;
        const body = "Please cancel these order items:\n" + rows.map((o) => "- Order #" + o.order_id + ", item " + o.order_item_id + ": " + o.product_name + " x" + o.quantity).join("\n") + "\n\nReason: " + reason;
        const r = await vendorAuthorizedFetch("/api/vendors/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: "Cancel request: " + ids.length + " order item(s)", body, category: "orders" }) });
        alert(r.error ? r.error : "Cancel request sent to Lizimas Store. You can follow it in Messages.");
        if (!r.error) { voSelected.clear(); vmRenderOrdersList(); }
    }
}

// --- Drawers ----------------------------------------------------------------

function voCloseDrawer() { const d = document.getElementById("vo-drawer"); if (d) d.remove(); document.removeEventListener("keydown", voDrawerKey, true); }
function voDrawerKey(e) { if (e.key === "Escape") { e.stopPropagation(); voCloseDrawer(); } }
function voDrawer(inner) {
    voCloseDrawer();
    const o = document.createElement("div");
    o.className = "vo-drawer-back"; o.id = "vo-drawer";
    o.innerHTML = `<aside class="vo-drawer" role="dialog" aria-modal="true">${inner}</aside>`;
    o.addEventListener("click", (e) => { if (e.target === o) voCloseDrawer(); });
    document.body.appendChild(o);
    document.addEventListener("keydown", voDrawerKey, true);
    return o;
}

function voOpenFilters() {
    voDraft = { currency: voState.currency, preset: voState.preset, from: voState.from, to: voState.to, printed: voState.printed, payment: voState.payment, shipping: voState.shipping };
    voDrawer('<div id="vo-filters"></div>');
    voRenderFilters();
}
function voRenderFilters() {
    const host = document.getElementById("vo-filters");
    if (!host || !voDraft) return;
    const r = voDraft.preset ? (voPresetRange(voDraft.preset) || {}) : { from: voDraft.from, to: voDraft.to };
    const sel = (id, label, opts) => `<div class="vo-f-title2">${label}</div><select class="vo-f-select" aria-label="${label}" onchange="voDraft.${id} = this.value">${opts.map(([v, t]) => `<option value="${v}"${voDraft[id] === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;
    host.innerHTML = `
        <div class="vo-d-head"><button type="button" class="vo-d-back" aria-label="Close" onclick="voCloseDrawer()"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></button>
            <h3>Filters</h3><button type="button" class="vo-d-reset" onclick="voResetFilters()">Reset Filters</button></div>
        <div class="vo-d-body">
            <div class="vo-label">Currency</div>
            <div class="vo-f-radios"><label><input type="radio" name="vo-cur" ${voDraft.currency === "usd" ? "checked" : ""} onchange="voDraft.currency = 'usd'"> USD</label>
                <label><input type="radio" name="vo-cur" ${voDraft.currency !== "usd" ? "checked" : ""} onchange="voDraft.currency = 'local'"> Local</label></div>
            <div class="vo-f-title">Country</div>
            <div class="vo-f-country"><span class="vo-f-country-label">Countries *</span><select aria-label="Countries"><option>Uganda</option></select></div>
            <div class="vo-f-title">Order Creation Date</div>
            <div class="vo-f-presets">${VO_PRESETS.map(([k, t]) => `<button type="button" class="vo-pill${voDraft.preset === k ? " vo-pill-on" : ""}" aria-pressed="${voDraft.preset === k}" onclick="voDraft.preset = '${k}'; voRenderFilters()">${voDraft.preset === k ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ""}${t}</button>`).join("")}</div>
            <div class="vo-f-title2">Custom Range:</div>
            <div class="vo-f-range"><input type="date" aria-label="From" value="${voEsc(r.from || "")}" onchange="voDraft.preset = ''; voDraft.from = this.value; voDraft.to = this.parentElement.querySelectorAll('input')[1].value; voRenderFilters()">
                <span>&ndash;</span><input type="date" aria-label="To" value="${voEsc(r.to || "")}" onchange="voDraft.preset = ''; voDraft.to = this.value; voDraft.from = this.parentElement.querySelectorAll('input')[0].value; voRenderFilters()"></div>
            ${sel("printed", "Printed", [["all", "All"], ["yes", "Printed"], ["no", "Not Printed"]])}
            ${sel("payment", "Payment Method", [["all", "All"], ["prepaid", "Prepaid"], ["postpaid", "Postpaid"]])}
            ${sel("shipping", "Shipping Info", [["all", "All"], ["vendor", "Drop-off by vendor"], ["lizimas", "Fulfillment by Lizimas"]])}
        </div>
        <div class="vo-d-foot"><button type="button" class="vo-d-apply" onclick="voApplyFilters()">Apply Filters</button></div>`;
}
function voResetFilters() { voDraft = { ...VO_DEFAULTS }; voRenderFilters(); }
async function voApplyFilters() {
    if (voDraft.from && voDraft.to && voDraft.to < voDraft.from) { alert("The end date must be after the start date."); return; }
    if (voDraft.currency === "usd" && !voUsdRate) {
        try { const r = await vendorAuthorizedFetch("/api/vendors/fx-rate"); if (r && r.rate) voUsdRate = Number(r.rate); } catch (e) { /* stays in UGX */ }
        if (!voUsdRate) { alert("The USD rate isn't available right now - prices stay in UGX."); voDraft.currency = "local"; }
    }
    Object.assign(voState, voDraft);
    voState.page = 1;
    voCloseDrawer();
    voRenderAll();
}

let voExportTab = "export", voExportScope = "filtered";
function voOpenExport() { voExportTab = "export"; voExportScope = voSelected.size ? "selected" : "filtered"; voDrawer('<div id="vo-export"></div>'); voRenderExport(); }
async function voRenderExport() {
    const host = document.getElementById("vo-export");
    if (!host) return;
    const head = `<div class="vo-d-head vo-d-head-plain"><h3>Export Orders</h3>${voExportTab === "history" ? '<button type="button" class="vo-d-back" aria-label="Refresh" onclick="voRenderExport()"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 4v7h-7"/></svg></button>' : ""}
        <button type="button" class="vo-d-x" aria-label="Close" onclick="voCloseDrawer()"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <div class="vo-d-tabs" role="tablist"><button type="button" role="tab" aria-selected="${voExportTab === "export"}" class="${voExportTab === "export" ? "on" : ""}" onclick="voExportTab = 'export'; voRenderExport()">Export</button>
            <button type="button" role="tab" aria-selected="${voExportTab === "history"}" class="${voExportTab === "history" ? "on" : ""}" onclick="voExportTab = 'history'; voRenderExport()">History</button></div>`;
    if (voExportTab === "export") {
        host.innerHTML = head + `<div class="vo-d-body">
            <div class="vo-f-title2" style="margin-top:0;">Scope</div>
            <div class="vo-f-col"><label><input type="radio" name="vo-scope" ${voExportScope === "selected" ? "checked" : ""} ${voSelected.size ? "" : "disabled"} onchange="voExportScope = 'selected'"> Selected orders (${voSelected.size})</label>
                <label><input type="radio" name="vo-scope" ${voExportScope !== "selected" ? "checked" : ""} onchange="voExportScope = 'filtered'"> All filtered orders (${voRows().length})</label></div>
            <div class="vo-f-title2">Format</div>
            <div class="vo-f-col"><label><input type="radio" checked readonly> CSV (.csv)</label></div>
        </div><div class="vo-d-foot"><button type="button" class="vo-d-apply" onclick="voDoExport()">Export</button></div>`;
        return;
    }
    host.innerHTML = head + '<div class="vo-d-body"><div class="vo-empty">Loading...</div></div>';
    let list = [];
    try { const r = await vendorAuthorizedFetch("/api/vendors/me/order-exports"); list = (r && r.exports) || []; } catch (e) { list = []; }
    const body = host.querySelector(".vo-d-body");
    if (!body) return;
    body.innerHTML = `<table class="vo-hist"><thead><tr><th>Created At</th><th>File Name</th><th>Status</th><th>Download</th></tr></thead><tbody>${
        list.length ? list.map((x) => `<tr><td>${voDateTime(x.created_at)}</td><td>${voEsc(x.file_name)}<div class="vo-sub">${Number(x.row_count)} row(s)</div></td><td><span class="vo-ok">Completed</span></td>
            <td><button type="button" class="vo-act" onclick="voDownloadExport(${Number(x.id)})">Download</button></td></tr>`).join("")
            : '<tr><td colspan="4" class="vo-muted" style="padding:28px 16px;">No export history found.</td></tr>'}</tbody></table>`;
}
function voCsv(rows) {
    const cell = (v) => { let s = String(v == null ? "" : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ["Order Number", "Order Item", "Product", "Seller SKU", "Order Date", "Payment Method", "Payment", "Unit Price (UGX)", "Quantity", "Total (UGX)", "Label", "Shipment Method", "Drop-off Point", "Status"];
    return [head].concat(rows.map((o) => [o.order_id, o.order_item_id, o.product_name, voSku(o), voDay(o.created_at), voPayLabel(o), voIsPostpaid(o) ? "Postpaid" : "Prepaid",
        o.price, o.quantity, Number(o.price) * Number(o.quantity), o.label_printed_at ? "Printed" : "Not printed", voShipLabel(o), o.dropoff_point_name || "", o.stageLabel || o.stage]))
        .map((l) => l.map(cell).join(",")).join("\n");
}
function voSaveFile(name, csv) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function voDoExport() {
    const rows = voExportScope === "selected" ? voSelectedRows() : voRows();
    if (!rows.length) { alert("There are no orders to export in this view."); return; }
    const csv = voCsv(rows);
    const name = "lizimas-orders-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".csv";
    voSaveFile(name, csv);
    try { await vendorAuthorizedFetch("/api/vendors/me/order-exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_name: name, row_count: rows.length, csv }) }); } catch (e) { /* the file itself was saved */ }
    voExportTab = "history";
    voRenderExport();
}
async function voDownloadExport(id) {
    try {
        const r = await vendorAuthorizedFetch("/api/vendors/me/order-exports/" + id);
        if (r && r.csv) voSaveFile(r.file_name || "orders.csv", r.csv); else alert((r && r.error) || "Could not download that export.");
    } catch (e) { alert("Could not download that export."); }
}

let voWasWide = null;
window.addEventListener("resize", () => { const w = voWide(); if (voWasWide !== null && w !== voWasWide) vmRenderOrdersList(); voWasWide = w; });
