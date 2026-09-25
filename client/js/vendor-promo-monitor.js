// Monitor your promotions - vendor desktop page + mobile screen (Ryan, Sept 2026).
//
// Jumia Vendor Center "Promotions > Monitoring" layout in Lizimas colours:
// breadcrumb, title, EXPORT, STATUS: ALL / ONGOING / EXPIRED, and a table
// Product / Seller SKU / Page Views / Items Sold / Revenue / Period / Country.
// Opened from "Monitor your promotions" on the Advertise your Products page
// (it replaced the old "+ New Campaign" button - "Create a campaign" in the
// banner above still starts a new ad campaign).
//
// Data: GET /api/vendors/me/promotions/monitoring (promotionCampaignController
// getPromotionMonitoring). Page views are counted from migration 128 onward.

let vpmonRows = [];
let vpmonStatus = "all";

const vpmonEsc = (v) => (typeof vendorEsc === "function" ? vendorEsc(v == null ? "" : v) : String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
const vpmonDay = (v) => { const d = new Date(v); return isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const vpmonKind = (r) => (r.kind === "flash_sale" ? `Lizimas flash sale${r.campaign_name ? `: ${r.campaign_name}` : ""}` : r.campaign_name ? `Campaign: ${r.campaign_name}` : "Your promotion");

// Desktop: show the Monitoring page (a tab-content section with no sidebar
// button of its own - Promotions stays highlighted, as on Jumia).
function vdOpenPromoMonitoring() {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    const promoBtn = document.querySelector('.tab-btn[data-tab="promotions"]');
    if (promoBtn) promoBtn.classList.add("active");
    const page = document.getElementById("tab-promo-monitoring");
    if (page) page.classList.remove("hidden");
    window.scrollTo({ top: 0 });
    vpmonLoad();
}

// Desktop: Promotions Management > View All - the full campaign list page.
function vdOpenCampaignsPage() {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    const promoBtn = document.querySelector('.tab-btn[data-tab="promotions"]');
    if (promoBtn) promoBtn.classList.add("active");
    const page = document.getElementById("tab-promo-campaigns");
    if (page) page.classList.remove("hidden");
    window.scrollTo({ top: 0 });
    if (typeof vcLoadCampaigns === "function") vcLoadCampaigns("vd-promo-campaigns", "table");
}

function vdToggleCampaignFilters(btn) {
    const host = document.getElementById("vd-promo-campaigns");
    if (!host) return;
    const hidden = host.classList.toggle("vpc-filters-hidden");
    if (btn) btn.setAttribute("aria-pressed", String(!hidden));
}

function vdOpenPromotionsTab() {
    const btn = document.querySelector('.tab-btn[data-tab="promotions"]');
    if (btn) btn.click();
}

function vmOpenPromoMonitoring() {
    if (typeof vmShowScreen === "function") vmShowScreen("promo-monitoring");
    vpmonLoad();
}

async function vpmonLoad() {
    ["vpmon-desktop", "vpmon-mobile"].forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = '<div class="vpmon-empty">Loading...</div>'; });
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/promotions/monitoring");
        if (data && data.error) throw new Error(data.error);
        vpmonRows = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("vpmonLoad error:", error);
        vpmonRows = [];
        ["vpmon-desktop", "vpmon-mobile"].forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = '<div class="vpmon-empty">Could not load your promotions.</div>'; });
        return;
    }
    vpmonRender();
}

function vpmonSetStatus(s) {
    vpmonStatus = s;
    vpmonRender();
}

function vpmonFiltered() {
    return vpmonStatus === "all" ? vpmonRows : vpmonRows.filter((r) => r.status === vpmonStatus);
}

function vpmonRender() {
    document.querySelectorAll(".vpmon-status").forEach((host) => {
        host.innerHTML = `<span class="vpmon-status-label">Status:</span>` + [["all", "All"], ["ongoing", "Ongoing"], ["expired", "Expired"]].map(([k, l]) =>
            `<button type="button" class="vpmon-pill vpmon-pill-${k}${vpmonStatus === k ? " vpmon-pill-on" : ""}" aria-pressed="${vpmonStatus === k}" onclick="vpmonSetStatus('${k}')">${k === "all" ? "" : '<span class="vpmon-dot"></span>'}${l}</button>`).join("");
    });
    const rows = vpmonFiltered();
    const desk = document.getElementById("vpmon-desktop");
    if (desk) {
        desk.innerHTML = `<table class="vp-table vpmon-table"><thead><tr><th>Product</th><th>Seller SKU</th><th class="vp-num">Page Views</th><th class="vp-num">Items Sold</th><th class="vp-num">Revenue (UGX)</th><th>Period</th><th>Country</th></tr></thead><tbody>${rows.map((r) => `<tr>
            <td><div class="vpmon-product">${vpmonEsc(r.product_name)}</div><div class="vpmon-kind"><span class="vpmon-badge vpmon-badge-${r.status}">${r.status === "ongoing" ? "Ongoing" : "Expired"}</span>${vpmonEsc(vpmonKind(r))}${r.promo_price != null ? ` &middot; UGX ${Number(r.promo_price).toLocaleString()}` : ""}</div></td>
            <td>${vpmonEsc(r.sku || "—")}<div class="vpmon-kind">${vpmonEsc(r.lizimas_sku || "")}</div></td>
            <td class="vp-num">${Number(r.page_views).toLocaleString()}</td>
            <td class="vp-num">${Number(r.items_sold).toLocaleString()}</td>
            <td class="vp-num">${Number(r.revenue).toLocaleString()}</td>
            <td class="vpmon-period">${vpmonDay(r.starts_at)} &ndash; ${vpmonDay(r.ends_at)}</td>
            <td>${vpmonEsc(r.country || "Uganda")}</td>
        </tr>`).join("") || '<tr><td colspan="7" class="vpmon-empty">No sales from promotions with this filter.</td></tr>'}</tbody></table>`;
    }
    const mob = document.getElementById("vpmon-mobile");
    if (mob) {
        mob.innerHTML = rows.map((r) => `<div class="vpmon-card">
            <div class="vpmon-card-top"><div class="vpmon-product">${vpmonEsc(r.product_name)}</div><span class="vpmon-badge vpmon-badge-${r.status}">${r.status === "ongoing" ? "Ongoing" : "Expired"}</span></div>
            <div class="vpmon-kind">${vpmonEsc(vpmonKind(r))} &middot; Seller SKU ${vpmonEsc(r.sku || "—")}</div>
            <div class="vpmon-stats"><div><b>${Number(r.page_views).toLocaleString()}</b><span>Page Views</span></div><div><b>${Number(r.items_sold).toLocaleString()}</b><span>Items Sold</span></div><div><b>UGX ${Number(r.revenue).toLocaleString()}</b><span>Revenue</span></div></div>
            <div class="vpmon-kind">${vpmonDay(r.starts_at)} &ndash; ${vpmonDay(r.ends_at)} &middot; ${vpmonEsc(r.country || "Uganda")}</div>
        </div>`).join("") || '<div class="vpmon-empty">No sales from promotions with this filter.</div>';
    }
}

function vpmonExport() {
    const rows = vpmonFiltered();
    if (!rows.length) {
        if (typeof window.vcToast === "function") window.vcToast("Nothing to export with this filter.", "error"); else alert("Nothing to export with this filter.");
        return;
    }
    const cell = (v) => { let s = String(v == null ? "" : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["Product", "Seller SKU", "Lizimas Store SKU", "Promotion", "Status", "Promo Price (UGX)", "Page Views", "Items Sold", "Revenue (UGX)", "Start", "End", "Country"]]
        .concat(rows.map((r) => [r.product_name, r.sku || "", r.lizimas_sku || "", vpmonKind(r), r.status, r.promo_price == null ? "" : r.promo_price, r.page_views, r.items_sold, r.revenue, vpmonDay(r.starts_at), vpmonDay(r.ends_at), r.country || "Uganda"]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `lizimas-promotion-monitoring-${vpmonDay(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
