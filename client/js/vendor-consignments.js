// Consignment Orders - vendor desktop (Ryan, Sept 2026).
//
// Follows Jumia Vendor Center's Products > Consignment page, in Lizimas
// colours: breadcrumb, STATUS pills (All / Open / Closed / Received /
// Received Incomplete / Cancelled / More), COUNTRY + DATE chips, Filters /
// Export / Bulk Creation, a bulk-action select + go button, CO Number search,
// Seller SKU / Lizimas Store SKU / Product name search, a list (CO Number /
// User, Quantity, Total Value, Actions) with pager, and a details panel on
// the right for the selected consignment order (CO).
//
// Loaded after vendor-dashboard.js: it replaces vdLoadConsignments and
// reuses vdShowCreateConsignmentForm / vdMarkConsignmentInTransit /
// vdCancelConsignment / vendorAuthorizedFetch / vendorEsc from there.
//
// Status mapping (vendor_consignments.status):
//   Open                = requested, in_transit
//   Closed              = received, partially_received, rejected, cancelled
//   Received            = received
//   Received Incomplete = partially_received
//   Cancelled           = cancelled
//   More > Requested / In Transit / Rejected

let vcoAll = [];
const vcoState = { status: "all", date: "all", hub: "", from: "", to: "", co: "", field: "seller", q: "", page: 1, perPage: 10, selectedId: null, bulk: "" };
const vcoSelected = new Set();

const VCO_STATUS_TESTS = {
    all: () => true,
    open: (s) => s === "requested" || s === "in_transit",
    closed: (s) => ["received", "partially_received", "rejected", "cancelled"].includes(s),
    received: (s) => s === "received",
    received_incomplete: (s) => s === "partially_received",
    cancelled: (s) => s === "cancelled",
    requested: (s) => s === "requested",
    in_transit: (s) => s === "in_transit",
    rejected: (s) => s === "rejected"
};
const VCO_MAIN_PILLS = [["all", "All"], ["open", "Open"], ["closed", "Closed"], ["received", "Received"], ["received_incomplete", "Received Incomplete"], ["cancelled", "Cancelled"]];
const VCO_MORE_PILLS = [["requested", "Requested"], ["in_transit", "In Transit"], ["rejected", "Rejected"]];
const VCO_COUNT_PILLS = new Set(["open", "received_incomplete"]); // counts shown on these, as on Jumia
const VCO_DATES = [["all", "All"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["year", "This year"]];
const VCO_STATUS_LABEL = { requested: "Requested", in_transit: "In Transit", received: "Received", partially_received: "Received Incomplete", rejected: "Rejected", cancelled: "Cancelled" };
const VCO_STATUS_CLASS = { requested: "vp-qc-wait", in_transit: "vp-qc-wait", received: "vp-qc-ok", partially_received: "vp-qc-warn", rejected: "vp-qc-bad", cancelled: "vp-qc-bad" };

const vcoEsc = (v) => (typeof vendorEsc === "function" ? vendorEsc(v == null ? "" : v) : String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
const vcoCoNumber = (c) => `CO-${String(c.id).padStart(6, "0")}`;
const vcoQty = (c) => (c.items || []).reduce((n, i) => n + (Number(i.quantity_requested) || 0), 0);
const vcoValue = (c) => (c.items || []).reduce((n, i) => n + (Number(i.quantity_requested) || 0) * (Number(i.product_price) || 0), 0);
const vcoDay = (v) => { const d = new Date(v); return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function vcoDateRange(key) {
    const t = new Date();
    const back = (n) => { const d = new Date(t); d.setDate(d.getDate() - n); return vcoDay(d); };
    if (key === "7") return [back(6), vcoDay(t)];
    if (key === "30") return [back(29), vcoDay(t)];
    if (key === "90") return [back(89), vcoDay(t)];
    if (key === "year") return [`${t.getFullYear()}-01-01`, vcoDay(t)];
    return ["", ""];
}

function vcoRows() {
    const test = VCO_STATUS_TESTS[vcoState.status] || VCO_STATUS_TESTS.all;
    const co = vcoState.co.trim().toLowerCase().replace(/^co-?0*/, "");
    const q = vcoState.q.trim().toLowerCase();
    const [pFrom, pTo] = vcoDateRange(vcoState.date);
    const from = vcoState.from || pFrom;
    const to = vcoState.to || pTo;
    return vcoAll.filter((c) => {
        if (!test(c.status)) return false;
        if (co && !String(c.id).includes(co)) return false;
        if (vcoState.hub && String(c.dropoff_point_id) !== String(vcoState.hub)) return false;
        const day = vcoDay(c.created_at);
        if (from && day < from) return false;
        if (to && day > to) return false;
        if (q) {
            const key = vcoState.field === "lizimas" ? "product_lizimas_sku" : vcoState.field === "name" ? "product_name" : "product_sku";
            if (!(c.items || []).some((i) => String(i[key] || "").toLowerCase().includes(q))) return false;
        }
        return true;
    });
}

async function vdLoadConsignments() {
    const list = document.getElementById("vco-list");
    if (!list) return;
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/consignments");
        if (data && data.error) { list.innerHTML = `<div class="vco-empty">${vcoEsc(data.error)}</div>`; return; }
        vcoAll = Array.isArray(data) ? data : [];
        if (typeof vdConsignmentsCache !== "undefined") vdConsignmentsCache = vcoAll;
        [...vcoSelected].forEach((id) => { if (!vcoAll.some((c) => c.id === id)) vcoSelected.delete(id); });
        if (vcoState.selectedId && !vcoAll.some((c) => c.id === vcoState.selectedId)) vcoState.selectedId = null;
        vcoRender();
    } catch (error) {
        console.error("vdLoadConsignments error:", error);
        list.innerHTML = '<div class="vco-empty">Could not load consignments.</div>';
    }
}

function vcoRender() {
    vcoRenderPills();
    vcoRenderList();
    vcoRenderDetail();
}

function vcoRenderPills() {
    const host = document.getElementById("vco-pills");
    if (!host) return;
    const count = (k) => vcoAll.filter((c) => VCO_STATUS_TESTS[k](c.status)).length;
    const pill = ([k, label]) => `<button type="button" class="vco-pill${vcoState.status === k ? " vco-pill-on" : ""}" onclick="vcoSetStatus('${k}')">${vcoState.status === k ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ""}${label}${VCO_COUNT_PILLS.has(k) ? ` (${count(k)})` : ""}</button>`;
    const moreOn = VCO_MORE_PILLS.some(([k]) => k === vcoState.status);
    const moreLabel = moreOn ? VCO_MORE_PILLS.find(([k]) => k === vcoState.status)[1] : "More";
    host.innerHTML = VCO_MAIN_PILLS.map(pill).join("") + `<div class="vp-dd"><button type="button" class="vco-pill${moreOn ? " vco-pill-on" : ""}" data-vp-menu onclick="vpToggleMenu('vco-more-menu', event)">${moreLabel} <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button><div id="vco-more-menu" class="vp-menu" hidden>${VCO_MORE_PILLS.map(([k, l]) => `<button type="button" onclick="vcoSetStatus('${k}')">${l} (${count(k)})</button>`).join("")}</div></div>`;
    const dateChip = document.getElementById("vco-date-chip");
    if (dateChip) dateChip.textContent = vcoState.from || vcoState.to ? `${vcoState.from || "…"} / ${vcoState.to || "…"}` : VCO_DATES.find(([k]) => k === vcoState.date)[1];
    const dateMenu = document.getElementById("vco-date-menu");
    if (dateMenu) dateMenu.innerHTML = VCO_DATES.map(([k, l]) => `<button type="button" onclick="vcoSetDate('${k}')">${l}</button>`).join("");
}

function vcoRenderList() {
    const list = document.getElementById("vco-list");
    const pager = document.getElementById("vco-pager");
    if (!list) return;
    const rows = vcoRows();
    const pages = Math.max(1, Math.ceil(rows.length / vcoState.perPage));
    vcoState.page = Math.min(Math.max(1, vcoState.page), pages);
    const start = (vcoState.page - 1) * vcoState.perPage;
    const pageRows = rows.slice(start, start + vcoState.perPage);
    const allOn = pageRows.length > 0 && pageRows.every((c) => vcoSelected.has(c.id));
    const body = pageRows.map((c) => {
        const canShip = c.status === "requested";
        const canCancel = c.status === "requested" || c.status === "in_transit";
        return `<tr class="${vcoState.selectedId === c.id ? "vco-row-on" : ""}" onclick="vcoSelect(${Number(c.id)}, event)">
            <td class="vp-col-check"><input type="checkbox" aria-label="Select ${vcoCoNumber(c)}"${vcoSelected.has(c.id) ? " checked" : ""} onchange="vcoToggle(${Number(c.id)}, this.checked)"></td>
            <td><button type="button" class="vco-co" onclick="vcoSelect(${Number(c.id)})">${vcoCoNumber(c)}</button><div class="vco-user">${vcoEsc(c.requested_by_name || "Shop owner")}</div><span class="vp-qc ${VCO_STATUS_CLASS[c.status] || "vp-qc-wait"}">${VCO_STATUS_LABEL[c.status] || vcoEsc(c.status)}</span></td>
            <td class="vp-num">${vcoQty(c).toLocaleString()}</td>
            <td class="vp-num">UGX ${vcoValue(c).toLocaleString()}</td>
            <td class="vco-actions">${canShip ? `<button type="button" class="vp-link" onclick="event.stopPropagation(); vdMarkConsignmentInTransit(${Number(c.id)})">Mark shipped</button>` : ""}${canCancel ? `<button type="button" class="vp-link vp-danger" onclick="event.stopPropagation(); vdCancelConsignment(${Number(c.id)})">Cancel</button>` : ""}${!canShip && !canCancel ? '<span class="vp-muted">&mdash;</span>' : ""}</td>
        </tr>`;
    }).join("");
    list.innerHTML = `<table class="vp-table vco-table"><thead><tr>
            <th class="vp-col-check"><input type="checkbox" aria-label="Select all on this page"${allOn ? " checked" : ""}${pageRows.length ? "" : " disabled"} onchange="vcoToggleAll(this.checked)"></th>
            <th>CO Number / User</th><th class="vp-num">Quantity</th><th class="vp-num">Total Value</th><th>Actions</th>
        </tr></thead><tbody>${body || '<tr><td colspan="5" class="vco-empty">No Consignments to list.</td></tr>'}</tbody></table>`;
    if (pager) {
        const btn = (icon, page, label, off) => `<button type="button" class="vp-pg-btn" aria-label="${label}" ${off ? "disabled" : ""} onclick="vcoGoPage(${page})">${icon}</button>`;
        const I = typeof VP_ICON !== "undefined" ? VP_ICON : { first: "|&lt;", prev: "&lt;", right: "&gt;", last: "&gt;|" };
        pager.innerHTML = `<label class="vp-per">Items per page: <select onchange="vcoSetPerPage(this.value)">${[10, 20, 50, 100].map((n) => `<option${n === vcoState.perPage ? " selected" : ""}>${n}</option>`).join("")}</select></label>
            <div class="vp-pager-nav"><span class="vp-range">${rows.length ? `${start + 1}&ndash;${start + pageRows.length} of ${rows.length}` : "0 of 0"}</span>${btn(I.first, 1, "First page", vcoState.page <= 1)}${btn(I.prev, vcoState.page - 1, "Previous page", vcoState.page <= 1)}${btn(I.right, vcoState.page + 1, "Next page", vcoState.page >= pages)}${btn(I.last, pages, "Last page", vcoState.page >= pages)}</div>`;
    }
    vcoRefreshBulk();
}

function vcoRenderDetail() {
    const host = document.getElementById("vco-detail");
    if (!host) return;
    const c = vcoAll.find((x) => x.id === vcoState.selectedId);
    if (!c) {
        host.innerHTML = '<div class="vco-detail-empty"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg><p>Select a consignment order to see its products and progress.</p></div>';
        return;
    }
    const steps = [["requested", "Requested"], ["in_transit", "In Transit"], ["received", "Received"]];
    const reachedIdx = { requested: 0, in_transit: 1, received: 2, partially_received: 2 }[c.status];
    const timeline = ["cancelled", "rejected"].includes(c.status)
        ? `<div class="vco-stop">${VCO_STATUS_LABEL[c.status]}${c.admin_notes ? ` &middot; ${vcoEsc(c.admin_notes)}` : ""}</div>`
        : `<ol class="vco-steps">${steps.map(([k, l], i) => `<li class="${i <= reachedIdx ? "vco-step-on" : ""}">${i === 2 && c.status === "partially_received" ? "Received Incomplete" : l}</li>`).join("")}</ol>`;
    const items = (c.items || []).map((i) => `<tr>
        <td><div class="vco-item-name">${vcoEsc(i.product_name)}</div><div class="vco-item-sku">Seller SKU: ${vcoEsc(i.product_sku || "—")}</div><div class="vco-item-sku">Lizimas SKU: ${vcoEsc(i.product_lizimas_sku || "—")}</div></td>
        <td class="vp-num">${Number(i.quantity_requested) || 0}</td>
        <td class="vp-num">${i.quantity_received == null ? "&mdash;" : Number(i.quantity_received)}</td>
        <td class="vp-num">UGX ${((Number(i.quantity_requested) || 0) * (Number(i.product_price) || 0)).toLocaleString()}</td>
    </tr>`).join("");
    host.innerHTML = `<div class="vco-detail-head">
            <div><div class="vco-detail-co">${vcoCoNumber(c)}</div><div class="vco-detail-meta">Created ${vcoDay(c.created_at)} by ${vcoEsc(c.requested_by_name || "Shop owner")}</div></div>
            <span class="vp-qc ${VCO_STATUS_CLASS[c.status] || "vp-qc-wait"}">${VCO_STATUS_LABEL[c.status] || vcoEsc(c.status)}</span>
        </div>
        ${timeline}
        <dl class="vco-facts">
            <div><dt>Ship to hub</dt><dd>${vcoEsc(c.dropoff_point_name)}<br><span class="vp-muted">${vcoEsc(c.dropoff_point_address || "")}</span></dd></div>
            <div><dt>Quantity</dt><dd>${vcoQty(c).toLocaleString()} units</dd></div>
            <div><dt>Total value</dt><dd>UGX ${vcoValue(c).toLocaleString()}</dd></div>
            ${c.vendor_notes ? `<div><dt>Your notes</dt><dd>${vcoEsc(c.vendor_notes)}</dd></div>` : ""}
            ${c.admin_notes ? `<div><dt>Lizimas notes</dt><dd>${vcoEsc(c.admin_notes)}</dd></div>` : ""}
        </dl>
        <table class="vp-table vco-items"><thead><tr><th>Product</th><th class="vp-num">Sent</th><th class="vp-num">Received</th><th class="vp-num">Value</th></tr></thead><tbody>${items || '<tr><td colspan="4" class="vco-empty">No products.</td></tr>'}</tbody></table>`;
}

// --- Interactions -----------------------------------------------------------

function vcoSetStatus(k) { if (typeof vpCloseMenus === "function") vpCloseMenus(); vcoState.status = k; vcoState.page = 1; vcoRender(); }
function vcoSetDate(k) { if (typeof vpCloseMenus === "function") vpCloseMenus(); vcoState.date = k; vcoState.from = ""; vcoState.to = ""; vcoState.page = 1; vcoRender(); }
function vcoSetSearch(key, v) { vcoState[key] = v || ""; vcoState.page = 1; vcoRenderList(); }
function vcoSetField(v) { vcoState.field = v; vcoState.page = 1; vcoRenderList(); }
function vcoGoPage(p) { vcoState.page = p; vcoRenderList(); }
function vcoSetPerPage(n) { vcoState.perPage = Number(n) || 10; vcoState.page = 1; vcoRenderList(); }
function vcoSelect(id, ev) {
    if (ev && ev.target && ev.target.closest("input, button")) return;
    vcoState.selectedId = id;
    vcoRenderList();
    vcoRenderDetail();
}
function vcoToggle(id, on) { if (on) vcoSelected.add(id); else vcoSelected.delete(id); vcoRenderList(); }
function vcoToggleAll(on) {
    const rows = vcoRows().slice((vcoState.page - 1) * vcoState.perPage, vcoState.page * vcoState.perPage);
    rows.forEach((c) => (on ? vcoSelected.add(c.id) : vcoSelected.delete(c.id)));
    vcoRenderList();
}
function vcoSetBulk(v) { vcoState.bulk = v; vcoRefreshBulk(); }
function vcoRefreshBulk() {
    const go = document.getElementById("vco-bulk-go");
    if (go) go.disabled = !(vcoState.bulk && vcoSelected.size);
}

async function vcoBulkGo() {
    const action = vcoState.bulk;
    const chosen = vcoAll.filter((c) => vcoSelected.has(c.id));
    const eligible = chosen.filter((c) => (action === "cancel" ? ["requested", "in_transit"].includes(c.status) : c.status === "requested"));
    if (!eligible.length) {
        vcoToast(action === "cancel" ? "Only Requested or In Transit orders can be cancelled." : "Only Requested orders can be marked as shipped.", "error");
        return;
    }
    const verb = action === "cancel" ? "Cancel" : "Mark as shipped";
    const skipped = chosen.length - eligible.length;
    if (!confirm(`${verb}: ${eligible.length} consignment order${eligible.length === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped - wrong status)` : ""}?`)) return;
    let ok = 0;
    const failed = [];
    for (const c of eligible) {
        try {
            const r = await vendorAuthorizedFetch(`/api/vendors/me/consignments/${c.id}/${action === "cancel" ? "cancel" : "in-transit"}`, { method: "POST" });
            if (r && r.error) failed.push(`${vcoCoNumber(c)}: ${r.error}`); else ok++;
        } catch (e) { failed.push(`${vcoCoNumber(c)}: could not connect`); }
    }
    vcoSelected.clear();
    vcoState.bulk = "";
    const sel = document.getElementById("vco-bulk-select");
    if (sel) sel.value = "";
    await vdLoadConsignments();
    vcoToast(`${ok} updated${failed.length ? `, ${failed.length} failed - ${failed[0]}` : ""}${skipped ? `, ${skipped} skipped` : ""}.`, failed.length ? "error" : "ok");
}

function vcoToast(msg, kind) {
    if (typeof window.vcToast === "function") window.vcToast(msg, kind);
    else alert(msg);
}

function vcoExport(scope) {
    if (typeof vpCloseMenus === "function") vpCloseMenus();
    const rows = scope === "all" ? vcoAll : vcoRows();
    if (!rows.length) { vcoToast("Nothing to export in this view.", "error"); return; }
    const cell = (v) => { let s = String(v == null ? "" : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["CO Number", "Status", "Created", "Hub", "Product", "Seller SKU", "Lizimas Store SKU", "Quantity Sent", "Quantity Received", "Value (UGX)"]];
    rows.forEach((c) => (c.items && c.items.length ? c.items : [{}]).forEach((i) => lines.push([
        vcoCoNumber(c), VCO_STATUS_LABEL[c.status] || c.status, vcoDay(c.created_at), c.dropoff_point_name, i.product_name || "", i.product_sku || "", i.product_lizimas_sku || "",
        i.quantity_requested == null ? "" : i.quantity_requested, i.quantity_received == null ? "" : i.quantity_received, (Number(i.quantity_requested) || 0) * (Number(i.product_price) || 0)
    ])));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `lizimas-consignments-${vcoDay(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Filters drawer: hub + custom created-date range.
function vcoOpenFilters() {
    if (typeof vpCloseMenus === "function") vpCloseMenus();
    vcoCloseFilters();
    const hubs = [...new Map(vcoAll.map((c) => [c.dropoff_point_id, c.dropoff_point_name])).entries()];
    const overlay = document.createElement("div");
    overlay.className = "vp-drawer-overlay";
    overlay.id = "vco-filters";
    overlay.innerHTML = `<aside class="vp-drawer" role="dialog" aria-modal="true" aria-labelledby="vco-f-title">
        <div class="vp-drawer-head"><button type="button" class="vp-drawer-back" aria-label="Close" onclick="vcoCloseFilters()"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="11 6 5 12 11 18"/></svg></button><h2 class="vp-drawer-title" id="vco-f-title">Filters</h2></div>
        <div class="vp-drawer-body">
            <label class="vco-f-label" for="vco-f-hub">Hub</label>
            <select id="vco-f-hub" class="vco-f-input"><option value="">All hubs</option>${hubs.map(([id, name]) => `<option value="${Number(id)}"${String(vcoState.hub) === String(id) ? " selected" : ""}>${vcoEsc(name)}</option>`).join("")}</select>
            <div class="vco-f-label">Creation date</div>
            <div class="vco-f-range"><input type="date" id="vco-f-from" class="vco-f-input" aria-label="From date" value="${vcoState.from}"><span>&ndash;</span><input type="date" id="vco-f-to" class="vco-f-input" aria-label="To date" value="${vcoState.to}"></div>
            <div class="vco-f-error" id="vco-f-error" role="alert"></div>
        </div>
        <div class="vp-drawer-foot">
            <div class="vp-drawer-btns"><button type="button" class="vp-btn vp-btn-outline vp-drawer-default" onclick="vcoCloseFilters()">Cancel</button><button type="button" class="vp-btn vp-btn-gold vp-drawer-apply" onclick="vcoApplyFilters()">Apply filters</button></div>
            <button type="button" class="vp-drawer-reset" onclick="vcoResetFilters()">Reset Filters</button>
        </div>
    </aside>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) vcoCloseFilters(); });
    document.body.appendChild(overlay);
}
function vcoCloseFilters() { const f = document.getElementById("vco-filters"); if (f) f.remove(); }
function vcoApplyFilters() {
    const from = document.getElementById("vco-f-from").value;
    const to = document.getElementById("vco-f-to").value;
    if (from && to && from > to) { document.getElementById("vco-f-error").textContent = "The start date must be on or before the end date."; return; }
    vcoState.hub = document.getElementById("vco-f-hub").value;
    vcoState.from = from; vcoState.to = to;
    if (from || to) vcoState.date = "all";
    vcoState.page = 1;
    vcoCloseFilters();
    vcoRender();
}
function vcoResetFilters() {
    vcoState.hub = ""; vcoState.from = ""; vcoState.to = ""; vcoState.date = "all"; vcoState.page = 1;
    vcoCloseFilters();
    vcoRender();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") vcoCloseFilters(); });
