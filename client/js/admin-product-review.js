// Product Approval (Ryan, Sept 2026) - Admin › Staff & Approvals.
//
// 1. The list: status tabs with counts, filters (category, seller, dates,
//    flag), search by name or SKU, thumbnails, bulk approve/reject, pages.
//    Cards on phones.
// 2. The review sections used by admin-product-view.js: overview, pricing
//    with price comparison (similar Lizimas items + Jumia prices recorded by
//    admin), seller information, compliance checks, internal notes,
//    approval history, and the decision panel (Approve · Request Changes ·
//    Reject · Under Investigation · Save as Draft) with the reason dropdown.
// API: server/controllers/productReviewController.js. Uses authorizedFetch
// from admin.js.
(function () {
    "use strict";
    const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const ugx = (n) => (n == null || n === "" ? "-" : "UGX " + Math.round(Number(n)).toLocaleString());
    const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
    const when = (d) => (d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
    const API = "/api/admin/product-reviews";

    async function call(path, method, body) {
        const r = await fetch(`${API_URL}${path}`, {
            method, cache: "no-store",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
            body: body ? JSON.stringify(body) : undefined
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d.error || `Request failed (${r.status})`) + (d.detail ? ` (${d.detail})` : ""));
        return d;
    }

    let META = null;
    async function meta() {
        if (!META) META = await authorizedFetch(`${API}/meta`);
        return META;
    }

    const STATUS_STYLE = {
        pending: ["#FEF3C7", "#92400E"], approved: ["#DCFCE7", "#166534"], rejected: ["#FEE2E2", "#991B1B"],
        changes_requested: ["#FFEDD5", "#9A3412"], under_investigation: ["#EDE9FE", "#5B21B6"], draft: ["#E5E7EB", "#374151"]
    };
    function badge(status, label) {
        const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
        return `<span class="pr-badge" style="background:${s[0]}; color:${s[1]};">${esc(label || status)}</span>`;
    }
    function flagChips(flags, m) {
        return (flags || []).map((f) => `<span class="pr-flag">${esc((m.flags || {})[f] || f)}</span>`).join("");
    }

    // ================================================================ LIST ==
    const st = { status: "pending", q: "", category: "", seller: "", from: "", to: "", flag: "", sort: "newest", page: 1, selected: new Set(), data: null };

    function root() { return document.getElementById("pr-root"); }

    async function load() {
        const el = root();
        if (!el) return;
        const m = await meta().catch(() => null);
        if (!m) { el.innerHTML = '<p class="no-data">Could not load the approval list.</p>'; return; }
        if (!el.dataset.ready) { el.innerHTML = shell(m); el.dataset.ready = "1"; wireShell(el); }
        const p = new URLSearchParams();
        Object.entries({ status: st.status, q: st.q, category: st.category, seller: st.seller, from: st.from, to: st.to, flag: st.flag, sort: st.sort, page: st.page })
            .forEach(([k, v]) => { if (v !== "" && v != null) p.set(k, v); });
        el.querySelector(".pr-results").innerHTML = '<p class="pr-muted" style="padding:14px;">Loading…</p>';
        try {
            st.data = await authorizedFetch(`${API}?${p}`);
        } catch (e) {
            el.querySelector(".pr-results").innerHTML = `<p class="no-data">${esc(e.message)}</p>`;
            return;
        }
        if (st.data.error) { el.querySelector(".pr-results").innerHTML = `<p class="no-data">${esc(st.data.error)}${st.data.detail ? `<br><small>${esc(st.data.detail)}</small>` : ""}</p>`; return; }
        renderTabs(m); renderFilters(); renderResults(m);
    }

    function shell(m) {
        return `
        <div class="pr-tabs" role="tablist"></div>
        <div class="pr-filters">
            <input type="search" class="pr-search" placeholder="Search by name or SKU - or paste a list of SKUs" aria-label="Search by product name or SKU, or paste a list of SKUs">
            <select class="pr-f" data-f="category" aria-label="Category"><option value="">All categories</option></select>
            <select class="pr-f" data-f="seller" aria-label="Seller"><option value="">All sellers</option><option value="lizimas">Lizimas Store (own)</option></select>
            <select class="pr-f" data-f="flag" aria-label="Flag"><option value="">Any flag</option>${Object.entries(m.flags).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
            <label class="pr-date">From <input type="date" class="pr-f" data-f="from"></label>
            <label class="pr-date">To <input type="date" class="pr-f" data-f="to"></label>
            <select class="pr-f" data-f="sort" aria-label="Sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="price">Highest price</option></select>
        </div>
        <div class="pr-bulk" hidden>
            <span class="pr-bulk-count"></span>
            <button type="button" class="pr-btn pr-approve" data-bulk="approve">Bulk Approve</button>
            <button type="button" class="pr-btn pr-reject" data-bulk="reject">Bulk Reject</button>
            <button type="button" class="pr-btn pr-plain" data-bulk="clear">Clear</button>
        </div>
        <div class="pr-results"></div>
        <div class="pr-pages"></div>`;
    }

    function wireShell(el) {
        let t = null;
        el.querySelector(".pr-search").addEventListener("input", (e) => {
            clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load(); }, 300);
        });
        el.querySelectorAll(".pr-f").forEach((f) => f.addEventListener("change", () => { st[f.dataset.f] = f.value; st.page = 1; load(); }));
        el.addEventListener("click", (e) => {
            const tab = e.target.closest("[data-status]");
            if (tab) { st.status = tab.dataset.status; st.page = 1; st.selected.clear(); load(); return; }
            const pg = e.target.closest("[data-page]");
            if (pg) { st.page = Number(pg.dataset.page); load(); return; }
            const rv = e.target.closest("[data-review]");
            if (rv) { if (typeof openAdminProductView === "function") openAdminProductView(Number(rv.dataset.review)); return; }
            const b = e.target.closest("[data-bulk]");
            if (b) bulk(b.dataset.bulk);
        });
        el.addEventListener("change", (e) => {
            if (e.target.matches("[data-pick]")) {
                const id = Number(e.target.dataset.pick);
                e.target.checked ? st.selected.add(id) : st.selected.delete(id);
                syncBulk();
            } else if (e.target.matches("[data-pick-all]")) {
                (st.data.items || []).forEach((it) => { e.target.checked ? st.selected.add(it.id) : st.selected.delete(it.id); });
                el.querySelectorAll("[data-pick]").forEach((c) => { c.checked = e.target.checked; });
                syncBulk();
            }
        });
    }

    function renderTabs(m) {
        const c = st.data.counts || {};
        const tabs = [["pending", "Pending Review"], ["changes_requested", "Changes Requested"], ["under_investigation", "Under Investigation"], ["rejected", "Rejected"], ["draft", "Draft"], ["all", "All"]];
        const total = Object.values(c).reduce((a, b) => a + b, 0);
        root().querySelector(".pr-tabs").innerHTML = tabs.map(([k, label]) =>
            `<button type="button" role="tab" aria-selected="${st.status === k}" class="pr-tab${st.status === k ? " is-on" : ""}" data-status="${k}">${esc(label)} <span>${k === "all" ? total : (c[k] || 0)}</span></button>`).join("");
    }

    function renderFilters() {
        const el = root();
        const fill = (sel, rows, keep) => {
            const s = el.querySelector(`[data-f="${sel}"]`);
            const fixed = [...s.querySelectorAll("option")].slice(0, keep).map((o) => o.outerHTML).join("");
            s.innerHTML = fixed + rows.map((r) => `<option value="${r.id}">${esc(r.name || r.business_name)}</option>`).join("");
            s.value = st[sel];
        };
        fill("category", st.data.categories || [], 1);
        fill("seller", st.data.sellers || [], 2);
    }

    function sellerName(it) { return it.vendor_id ? (it.vendor_business_name || "Vendor") : "Lizimas Store"; }

    function renderResults(m) {
        const el = root();
        const d = st.data;
        const items = d.items || [];
        const from = d.total ? (d.page - 1) * d.page_size + 1 : 0;
        const to = Math.min(d.total, d.page * d.page_size);
        let head = `<p class="pr-count">Showing ${from}–${to} of ${d.total} ${st.status === "all" ? "products" : esc((m.statuses[st.status] || st.status).toLowerCase())} products</p>`;
        if (d.sku_list) {
            const miss = d.sku_list.missing || [];
            head = `<div class="pr-skulist">
                <b>SKU list:</b> found ${d.sku_list.asked - miss.length} of ${d.sku_list.asked}${items.length ? ` - tick the box at the top of the table to select all ${items.length}, then Bulk Approve.` : "."}
                ${miss.length ? `<div class="pr-skumiss">Not in ${esc(st.status === "all" ? "the list" : (m.statuses[st.status] || st.status))}: ${miss.map(esc).join(", ")} <small>(already decided - e.g. approved - or no such SKU. The All tab shows them all.)</small></div>` : ""}
            </div>`;
        }
        if (!items.length) {
            el.querySelector(".pr-results").innerHTML = head + '<p class="no-data">No products here.</p>';
            el.querySelector(".pr-pages").innerHTML = ""; syncBulk(); return;
        }
        const thumb = (it) => it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : '<span class="pr-noimg">No photo</span>';
        const skuLine = (it) => [it.sku ? `SKU ${esc(it.sku)}` : "", it.lizimas_sku ? `Lizimas ${esc(it.lizimas_sku)}` : ""].filter(Boolean).join(" · ");
        el.querySelector(".pr-results").innerHTML = head + `
            <table class="pr-table">
                <thead><tr>
                    <th class="pr-pick"><input type="checkbox" data-pick-all aria-label="Select all on this page"></th>
                    <th>Img</th><th>Product</th><th>Seller</th><th>Price</th><th>Category</th><th>Status</th><th>Submitted</th><th></th>
                </tr></thead>
                <tbody>${items.map((it) => `
                    <tr>
                        <td class="pr-pick"><input type="checkbox" data-pick="${it.id}" ${st.selected.has(it.id) ? "checked" : ""} aria-label="Select ${esc(it.name)}"></td>
                        <td class="pr-thumb">${thumb(it)}</td>
                        <td class="pr-name"><button type="button" class="pr-link" data-review="${it.id}">${esc(it.name)}</button>
                            <div class="pr-sub">${skuLine(it)}${it.photo_count != null ? ` · ${it.photo_count} photo${it.photo_count === 1 ? "" : "s"}` : ""}</div>
                            ${flagChips(it.review_flags, m)}</td>
                        <td>${esc(sellerName(it))}</td>
                        <td class="pr-num">${ugx(it.price)}</td>
                        <td>${esc(it.category_name || "-")}</td>
                        <td>${badge(it.status, m.statuses[it.status])}</td>
                        <td>${esc(day(it.created_at))}</td>
                        <td><button type="button" class="pr-btn pr-review" data-review="${it.id}">Review</button></td>
                    </tr>`).join("")}</tbody>
            </table>
            <div class="pr-cards">${items.map((it) => `
                <div class="pr-card">
                    <label class="pr-card-pick"><input type="checkbox" data-pick="${it.id}" ${st.selected.has(it.id) ? "checked" : ""} aria-label="Select ${esc(it.name)}"></label>
                    <button type="button" class="pr-card-main" data-review="${it.id}">
                        <span class="pr-thumb">${thumb(it)}</span>
                        <span class="pr-card-text">
                            <span class="pr-card-name">${esc(it.name)}</span>
                            <span class="pr-sub">${skuLine(it)}</span>
                            <span class="pr-sub">${esc(sellerName(it))} · ${esc(day(it.created_at))}</span>
                            <span class="pr-card-row"><b>${ugx(it.price)}</b> ${badge(it.status, m.statuses[it.status])}</span>
                        </span>
                    </button>
                </div>`).join("")}</div>`;
        const pages = Math.ceil(d.total / d.page_size);
        el.querySelector(".pr-pages").innerHTML = pages > 1
            ? `${d.page > 1 ? `<button type="button" class="pr-btn pr-plain" data-page="${d.page - 1}">← Previous</button>` : ""}
               <span>Page ${d.page} of ${pages}</span>
               ${d.page < pages ? `<button type="button" class="pr-btn pr-plain" data-page="${d.page + 1}">Next →</button>` : ""}` : "";
        syncBulk();
    }

    function syncBulk() {
        const bar = root().querySelector(".pr-bulk");
        const n = st.selected.size;
        bar.hidden = !n;
        bar.querySelector(".pr-bulk-count").textContent = `${n} selected`;
    }

    async function bulk(action) {
        if (action === "clear") { st.selected.clear(); root().querySelectorAll("[data-pick],[data-pick-all]").forEach((c) => { c.checked = false; }); syncBulk(); return; }
        const ids = [...st.selected];
        if (!ids.length) return;
        let body = { action, ids };
        if (action === "reject") {
            const r = await reasonDialog(`Reject ${ids.length} product${ids.length === 1 ? "" : "s"}`);
            if (!r) return;
            body = { ...body, ...r };
        } else if (!window.confirm(`Approve ${ids.length} product${ids.length === 1 ? "" : "s"} and put ${ids.length === 1 ? "it" : "them"} live?`)) return;
        try {
            const out = await call(`${API}/bulk`, "POST", body);
            toast(out.message + (out.failed && out.failed.length ? ` ${out.failed.map((f) => f.error).filter(Boolean)[0] || ""}` : ""), out.failed && out.failed.length > 0);
            st.selected.clear();
            load();
        } catch (e) { toast(e.message, true); }
    }

    // Small reason picker for bulk reject.
    async function reasonDialog(title) {
        const m = await meta();
        return new Promise((resolve) => {
            const w = document.createElement("div");
            w.className = "pr-modal";
            w.innerHTML = `<div class="pr-modal-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
                <h3>${esc(title)}</h3>
                <label>Rejection reason <select class="pr-in" data-r="code"><option value="">Select reason…</option>${m.reasons.map((r) => `<option value="${r.code}">${esc(r.label)}</option>`).join("")}</select></label>
                <p class="pr-muted" data-r="hint"></p>
                <label>Extra details for the seller <textarea class="pr-in" data-r="text" rows="3" placeholder="Optional - required for 'Other'"></textarea></label>
                <p class="pr-error" data-r="err"></p>
                <div class="pr-modal-actions"><button type="button" class="pr-btn pr-plain" data-r="cancel">Cancel</button><button type="button" class="pr-btn pr-reject" data-r="ok">Reject</button></div>
            </div>`;
            document.body.appendChild(w);
            const q = (k) => w.querySelector(`[data-r="${k}"]`);
            q("code").onchange = () => { const r = m.reasons.find((x) => x.code === q("code").value); q("hint").textContent = r && r.vendor ? `Seller sees: "${r.vendor}"` : ""; };
            const done = (v) => { w.remove(); resolve(v); };
            q("cancel").onclick = () => done(null);
            q("ok").onclick = () => {
                const code = q("code").value, text = q("text").value.trim();
                if (!code) { q("err").textContent = "Pick a rejection reason."; return; }
                if (code === "other" && text.length < 5) { q("err").textContent = "Explain the reason when you pick 'Other'."; return; }
                done({ reason_code: code, reason_text: text });
            };
            q("code").focus();
        });
    }

    function toast(msg, bad) {
        const t = document.createElement("div");
        t.className = "pr-toast" + (bad ? " is-bad" : "");
        t.setAttribute("role", "status");
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), bad ? 12000 : 4200);
    }

    // ======================================================== REVIEW PAGE ==
    // Sections rendered inside admin-product-view.js (d = /full, r = /product-reviews/:id).
    function overview(d, r, m) {
        const p = d.product;
        const row = (k, v) => `<div class="pr-kv"><span>${k}</span><b>${v || '<i class="pr-muted">Not provided</i>'}</b></div>`;
        return `<section class="pr-sec" id="pr-overview">
            <h4>1. Product overview</h4>
            <div class="pr-kv-grid">
                ${row("Product name", esc(p.name))}
                ${row("SKU", esc(p.sku || ""))}
                ${row("Lizimas SKU", esc(p.lizimas_sku || ""))}
                ${row("Category", esc(d.category_path.join(" › ")))}
                ${row("Brand", esc(p.brand || ""))}
                ${row("Seller", r.seller.own ? "Lizimas Store (own product)" : esc(r.seller.business_name || p.vendor_business_name || "Vendor"))}
                ${row("Submitted", esc(when(p.created_at)))}
                ${row("Last reviewed", p.reviewed_at ? esc(when(p.reviewed_at)) : "Not yet")}
                ${row("Product ID", esc(p.id))}
                ${row("Status", badge(p.status, r.status_label))}
            </div>
            ${r.flags.length ? `<div style="margin-top:8px;">${flagChips(r.flags, m)}</div>` : ""}
        </section>`;
    }

    function flagPill(res) {
        if (!res) return "";
        return `<div class="pr-pflag is-${esc(res.flag)}"><span class="pr-dot"></span> Flag: ${esc(res.label)}${res.diff_percent != null && res.flag !== "unknown" ? ` <em>${res.diff_percent > 0 ? "+" : ""}${res.diff_percent}% vs typical</em>` : ""}<small>${esc(res.note)}</small></div>`;
    }
    function priceRows(s, price, labels) {
        labels = labels || ["Lowest", "Typical", "Highest"];
        const low = s.lowest != null ? s.lowest : s.lowest_price, typ = s.typical != null ? s.typical : s.typical_price, high = s.highest != null ? s.highest : s.highest_price;
        const cnt = s.count != null ? s.count : s.product_count;
        return `<div class="pr-prow"><span>${labels[0]}</span><b>${ugx(low)}</b></div>
            <div class="pr-prow"><span>${labels[1]}</span><b>${ugx(typ)}</b></div>
            <div class="pr-prow"><span>${labels[2]}</span><b>${ugx(high)}</b></div>
            ${cnt != null ? `<div class="pr-prow"><span>Products compared</span><b>${esc(cnt)}</b></div>` : ""}`;
    }

    function pricing(d, r) {
        const p = d.product, x = r.pricing;
        const own = !p.vendor_id;
        const sell = x.discounted_price || x.price;
        const top = [];
        top.push(`<div class="pr-prow pr-big"><span>Selling price</span><b>${ugx(x.price)}</b></div>`);
        if (x.discount_percent) top.push(`<div class="pr-prow"><span>With discount (${x.discount_percent}%)</span><b>${ugx(x.discounted_price)}</b></div>`);
        if (own) {
            top.push(`<div class="pr-prow pr-costrow"><span>Cost price <small class="pr-muted">(what Lizimas pays - admin only)</small></span>
                <span class="pr-costin"><input class="pr-in" inputmode="numeric" data-pr="cost" value="${x.cost_price != null ? esc(Math.round(x.cost_price)) : ""}" placeholder="e.g. 29,145" aria-label="Cost price in UGX">
                <button type="button" class="pr-btn pr-plain" data-pr="save-cost">Save</button></span></div>`);
        } else {
            top.push(`<div class="pr-prow"><span>Cost (seller's payout)</span><b>${ugx(x.cost_price)}</b></div>`);
            top.push(`<div class="pr-prow"><span>Commission</span><b>${x.commission_rate != null ? Math.round(x.commission_rate * 1000) / 10 + "%" : "-"}${x.fixed_fee ? ` + ${ugx(x.fixed_fee)}` : ""}</b></div>`);
        }
        top.push(x.margin
            ? `<div class="pr-prow pr-big"><span>Margin</span><b>${x.margin.times}× <small class="pr-muted">(${x.margin.percent}% · ${ugx(x.margin.profit)} per unit${x.discount_percent ? " after discount" : ""})</small></b></div>`
            : `<div class="pr-prow"><span>Margin</span><b class="pr-muted">${own ? "Add the cost price to see it" : "-"}</b></div>`);

        const internal = `<div class="pr-pcard">
            <div class="pr-pcard-title">1. Internal comparison <small class="pr-muted">Lizimas Store · ${x.internal.basis === "similar" ? "similar products" : "same category"}</small></div>
            ${x.internal.enough ? priceRows(x.internal, sell, ["Lowest", "Typical price", "Highest"]) : `<p class="pr-muted">Not enough live products to compare (${x.internal.count} found).</p>`}
            ${flagPill(x.internal.result)}
        </div>`;

        const last = x.market[0];
        const ref = x.market_reference;
        const req = x.market_required
            ? `<div class="pr-req${x.market_missing ? " is-missing" : ""}">${x.market_missing
                ? `Required: products from ${ugx(x.market_threshold)} need Jumia prices (last ${x.market_max_age_days} days) before approval.`
                : "Jumia check done - required for this price."}</div>` : "";
        const market = `<div class="pr-pcard">
            <div class="pr-pcard-title pr-row-between">2. External comparison <small class="pr-muted">Jumia Uganda</small>
                <a class="pr-btn pr-plain pr-sm" href="${esc(x.market_search.jumia_url)}" target="_blank" rel="noopener noreferrer">Search Jumia ↗</a></div>
            <p class="pr-muted" style="margin-top:0;">Search: "${esc(x.market_search.term)}"</p>
            ${req}
            ${last ? priceRows(last, sell) + flagPill(last.result) +
                `<p class="pr-muted">Last checked by ${esc(last.checked_by_name || "admin")} · ${esc(day(last.checked_at))}${x.market.length > 1 ? ` · ${x.market.length} checks saved` : ""}</p>`
              : ref ? `<div class="pr-ref"><b>Reference</b> - no Jumia prices for this product yet. Latest for a similar product
                    (<button type="button" class="pr-link" data-review="${ref.product_id}">${esc(ref.name)}</button>, ${esc(day(ref.checked_at))}):
                    ${priceRows(ref, sell)}${flagPill(ref.result)}</div>`
              : '<p class="pr-muted">No Jumia prices recorded yet.</p>'}
            <div class="pr-mform">
                <div class="pr-subhead" style="margin-top:6px;">Fastest: paste the Jumia results page</div>
                <p class="pr-muted" style="margin-top:0;">Open Search Jumia, refine the results if needed, press <kbd>Cmd</kbd>+<kbd>A</kbd> then <kbd>Cmd</kbd>+<kbd>C</kbd> (Ctrl on Windows), and paste below.</p>
                <textarea class="pr-in" rows="3" data-pr="paste" placeholder="Paste the Jumia page here…"></textarea>
                <button type="button" class="pr-btn pr-plain" data-pr="read-paste">Read prices</button>
                <span class="pr-muted" data-pr="paste-msg" aria-live="polite"></span>
                <div class="pr-subhead">Or type them</div>
                <div class="pr-mgrid">
                    <label>Lowest price <input class="pr-in" inputmode="numeric" data-m="lowest_price"></label>
                    <label>Typical price <input class="pr-in" inputmode="numeric" data-m="typical_price"></label>
                    <label>Highest price <input class="pr-in" inputmode="numeric" data-m="highest_price"></label>
                    <label>How many products <input class="pr-in" inputmode="numeric" data-m="product_count"></label>
                </div>
                <input type="hidden" data-m="search_term" value="${esc(x.market_search.term)}">
                <button type="button" class="pr-btn pr-dark" data-pr="save-market">Save prices</button>
                <span class="pr-error" data-pr="market-msg" role="alert"></span>
            </div>
        </div>`;
        const combined = x.combined ? `<div class="pr-combined is-${esc(x.combined.tone)}">${esc(x.combined.text)}</div>` : "";
        return `<section class="pr-sec" id="pr-pricing">
            <h4>3. Pricing &amp; market comparison</h4>
            <div class="pr-pcard pr-pmain">${top.join("")}</div>
            ${combined}
            <div class="pr-pcards">${internal}${market}</div>
        </section>`;
    }

    function seller(r) {
        const s = r.seller;
        if (s.own) {
            return `<section class="pr-sec" id="pr-seller"><h4>7. Seller information</h4>
                <div class="pr-kv-grid">
                    <div class="pr-kv"><span>Seller</span><b>Lizimas Store (own product)</b></div>
                    <div class="pr-kv"><span>Added by</span><b>${esc(s.submitted_by || "Staff")}${s.submitted_by_email ? ` · ${esc(s.submitted_by_email)}` : ""}</b></div>
                </div></section>`;
        }
        const recent = (s.recent || []).map((x) => `<button type="button" class="pr-mini" data-review="${x.id}">
            ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : '<span class="pr-noimg">No photo</span>'}
            <span>${esc(x.name)}</span><small>${ugx(x.price)} · ${esc(x.status)}</small></button>`).join("");
        return `<section class="pr-sec" id="pr-seller"><h4>7. Seller information</h4>
            <div class="pr-kv-grid">
                <div class="pr-kv"><span>Shop name</span><b>${esc(s.business_name || "-")}</b></div>
                <div class="pr-kv"><span>Owner</span><b>${esc(s.owner_name || "-")}</b></div>
                <div class="pr-kv"><span>Phone</span><b>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : "-"}</b></div>
                <div class="pr-kv"><span>Email</span><b>${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : "-"}</b></div>
                <div class="pr-kv"><span>Account</span><b>${esc(s.status || "-")}${s.shop_id ? ` · Shop ${esc(s.shop_id)}` : ""}</b></div>
                <div class="pr-kv"><span>Approval rate</span><b>${s.approval_rate != null ? s.approval_rate + "%" : "No decisions yet"} <small class="pr-muted">(${s.products.approved} approved · ${s.products.rejected} rejected · ${s.products.pending} pending)</small></b></div>
                <div class="pr-kv"><span>Seller score</span><b>${s.seller_score != null ? s.seller_score + "/100" : "New seller"}</b></div>
            </div>
            ${recent ? `<div class="pr-subhead">Seller's other products</div><div class="pr-minis">${recent}</div>` : ""}
        </section>`;
    }

    function compliance(d, r, m) {
        const icon = { ok: "✓", warn: "!", fail: "✕" };
        const c = r.compliance;
        const list = c.checks.map((x) => `<li class="pr-chk is-${x.state}"><span class="pr-chk-i" aria-hidden="true">${icon[x.state]}</span><b>${esc(x.label)}</b> <span>${esc(x.detail)}</span></li>`).join("");
        const dupRows = (rows, why) => rows.map((x) => `<li><button type="button" class="pr-link" data-review="${x.id}">${esc(x.name)}</button> <small class="pr-muted">${esc(why)} · ${esc(x.business_name || "Lizimas Store")} · ${esc(x.status)}${x.price ? ` · ${ugx(x.price)}` : ""}</small></li>`).join("");
        const dups = (c.same_photo.length || c.same_name.length)
            ? `<div class="pr-subhead">Similar products already listed</div><ul class="pr-dups">${dupRows(c.same_photo, "same photo")}${dupRows(c.same_name, "similar name")}</ul>` : "";
        const manual = d.product.vendor_id && ["pending", "changes_requested", "under_investigation"].includes(d.product.status)
            ? `<div class="pr-subhead">Manual photo checks <small class="pr-muted">(tick both before approving)</small></div>
               <label class="pr-tick"><input type="checkbox" data-apv-check> No watermarks, logos or text stamped on any photo</label>
               <label class="pr-tick"><input type="checkbox" data-apv-check> Any person in the photos suits the product (e.g. a model wearing clothing) - otherwise no people</label>` : "";
        const flags = Object.entries(m.flags).map(([k, v]) => `<label class="pr-flagtoggle"><input type="checkbox" data-flag="${k}" ${r.flags.includes(k) ? "checked" : ""}> ${esc(v)}</label>`).join("");
        return `<section class="pr-sec" id="pr-compliance"><h4>8. Compliance checks</h4>
            <ul class="pr-chks">${list}</ul>${dups}${manual}
            <div class="pr-subhead">Flags</div><div class="pr-flagtoggles">${flags}</div>
        </section>`;
    }

    function notes(r) {
        const list = r.notes.map((n) => `<li><div>${esc(n.body)}</div><small class="pr-muted">${esc(n.author_name || "Admin")} · ${esc(when(n.created_at))}</small></li>`).join("");
        return `<section class="pr-sec" id="pr-notes"><h4>11. Admin notes <small class="pr-muted">(internal - sellers never see these)</small></h4>
            <textarea class="pr-in" rows="3" data-pr="note" placeholder="Write a note for the team…"></textarea>
            <button type="button" class="pr-btn pr-dark" data-pr="add-note">Add note</button>
            <ul class="pr-notes">${list || '<li class="pr-muted">No notes yet.</li>'}</ul>
        </section>`;
    }

    const ACTION_WORD = { approve: "Approved", reject: "Rejected", request_changes: "Requested changes", investigate: "Put under investigation",
        draft: "Saved as draft", resubmitted: "Seller resubmitted", edited: "Seller edited (back to review)", flags: "Flags", cost: "Cost price updated" };
    function history(r, m) {
        const reason = (code) => { const x = (m.reasons || []).find((y) => y.code === code); return x ? x.label : code; };
        const rows = r.history.map((h) => `<li>
            <b>${esc(ACTION_WORD[h.action] || h.action)}</b>${h.to_status ? ` → ${badge(h.to_status, m.statuses[h.to_status])}` : ""}
            ${h.reason_code ? `<div>${esc(reason(h.reason_code))}</div>` : ""}${h.reason_text ? `<div class="pr-muted">${esc(h.reason_text)}</div>` : ""}
            <small class="pr-muted">${esc(h.actor_name || h.actor_role || "System")} · ${esc(when(h.created_at))}</small></li>`).join("");
        return `<section class="pr-sec" id="pr-history"><h4>12. Approval history</h4>
            <ul class="pr-hist">${rows || `<li class="pr-muted">No decisions yet - submitted ${esc(when(r._created))}.</li>`}</ul></section>`;
    }

    function decision(d, r, m) {
        const p = d.product;
        const can = (a) => { const x = m.actions[a]; return x && x.from.includes(p.status) && (!x.own_only || !p.vendor_id); };
        const btn = (a, cls, label) => can(a) ? `<button type="button" class="pr-btn ${cls}" data-act="${a}">${label}</button>` : "";
        const buttons = [
            btn("approve", "pr-approve", "Approve &amp; Publish"),
            btn("request_changes", "pr-changes", "Request Changes"),
            btn("reject", "pr-reject", "Reject"),
            btn("investigate", "pr-invest", "Under Investigation"),
            btn("draft", "pr-plain", "Save as Draft")
        ].join("");
        return `<section class="pr-sec pr-decide" id="pr-decide">
            <h4>9–10. Decision</h4>
            <div class="pr-decide-status">Current status: ${badge(p.status, r.status_label)}</div>
            ${p.rejection_reason ? `<div class="pr-muted" style="margin:6px 0;">Seller was told: "${esc(p.rejection_reason)}"</div>` : ""}
            <label class="pr-lbl">Reason <small class="pr-muted">(required to reject)</small>
                <select class="pr-in" data-pr="reason"><option value="">Select reason…</option>${m.reasons.map((x) => `<option value="${x.code}">${esc(x.label)}</option>`).join("")}</select></label>
            <p class="pr-muted" data-pr="reason-hint"></p>
            <label class="pr-lbl">Message to the seller <small class="pr-muted">(for Reject / Request Changes; for Under Investigation it's an internal note)</small>
                <textarea class="pr-in" rows="3" data-pr="text" placeholder="e.g. Please upload the original photos at 800×800 or larger."></textarea></label>
            <p class="pr-error" data-pr="err" role="alert"></p>
            <div class="pr-actions">${buttons || '<span class="pr-muted">No actions for this status.</span>'}</div>
        </section>`;
    }

    function wire(overlay, d, r, m, reopen) {
        const p = d.product;
        const q = (k) => overlay.querySelector(`[data-pr="${k}"]`);
        const sel = q("reason");
        if (sel) sel.onchange = () => {
            const x = m.reasons.find((y) => y.code === sel.value);
            q("reason-hint").textContent = x && x.vendor ? `Seller sees: "${x.vendor}"` : "";
        };
        // Approve waits for the manual photo checks on vendor products.
        const checks = overlay.querySelectorAll("[data-apv-check]");
        const approve = overlay.querySelectorAll('[data-act="approve"]');
        const sync = () => { const ok = [...checks].every((c) => c.checked); approve.forEach((b) => { b.disabled = !ok; b.title = ok ? "" : "Tick the manual photo checks first"; }); };
        if (checks.length) { checks.forEach((c) => { c.onchange = sync; }); sync(); }

        overlay.querySelectorAll("[data-act]").forEach((b) => {
            b.onclick = async () => {
                const action = b.dataset.act;
                const body = { action, reason_code: sel.value || undefined, reason_text: q("text").value.trim() };
                const err = q("err"); err.textContent = "";
                if (action === "approve" && b.dataset.needsMarket) {
                    err.textContent = `Record Jumia prices first - required for products from ${ugx(r.pricing.market_threshold)}.`;
                    const t = overlay.querySelector("#pr-pricing"); if (t) t.scrollIntoView({ behavior: "smooth" });
                    return;
                }
                if (action === "reject" && !body.reason_code) { err.textContent = "Pick a rejection reason."; sel.focus(); return; }
                if (action === "reject" && body.reason_code === "other" && body.reason_text.length < 5) { err.textContent = "Explain the reason in the message box."; return; }
                if (action === "request_changes" && !body.reason_code && body.reason_text.length < 5) { err.textContent = "Say what the seller needs to change."; q("text").focus(); return; }
                if (action === "investigate" && body.reason_text.length < 5) { err.textContent = "Add a short note on why (internal)."; q("text").focus(); return; }
                overlay.querySelectorAll("[data-act]").forEach((x) => { x.disabled = true; });
                try {
                    const out = await call(`${API}/${p.id}/decision`, "POST", body);
                    toast(out.message);
                    if (typeof closeAdminProductView === "function") closeAdminProductView();
                    load();
                    if (typeof loadProducts === "function") loadProducts();
                } catch (e) {
                    err.textContent = e.message;
                    overlay.querySelectorAll("[data-act]").forEach((x) => { x.disabled = false; });
                    sync && checks.length && sync();
                }
            };
        });

        const addNote = q("add-note");
        if (addNote) addNote.onclick = async () => {
            const body = q("note").value.trim();
            if (!body) return;
            addNote.disabled = true;
            try { await call(`${API}/${p.id}/notes`, "POST", { body }); reopen("pr-notes"); }
            catch (e) { toast(e.message, true); addNote.disabled = false; }
        };

        overlay.querySelectorAll("[data-flag]").forEach((c) => {
            c.onchange = async () => {
                const flags = [...overlay.querySelectorAll("[data-flag]")].filter((x) => x.checked).map((x) => x.dataset.flag);
                try { await call(`${API}/${p.id}/flags`, "PUT", { flags }); toast("Flags saved."); load(); }
                catch (e) { toast(e.message, true); c.checked = !c.checked; }
            };
        });

        const readPaste = q("read-paste");
        if (readPaste) readPaste.onclick = async () => {
            const pasted = q("paste").value;
            const msg = q("paste-msg");
            if (!pasted.trim()) { msg.textContent = "Paste the Jumia page first."; return; }
            msg.textContent = "Reading…";
            try {
                const out = await call(`${API}/${p.id}/market-price`, "POST", { pasted, dry_run: true });
                const x = out.parsed;
                const set = (k, v) => { const i = overlay.querySelector(`[data-m="${k}"]`); if (i) i.value = v != null ? v : ""; };
                set("lowest_price", x.lowest); set("typical_price", x.typical); set("highest_price", x.highest); set("product_count", x.prices.length);
                msg.textContent = `Found ${x.prices.length} price${x.prices.length === 1 ? "" : "s"}${x.dropped ? ` (left out ${x.dropped} odd one${x.dropped === 1 ? "" : "s"})` : ""} → ${out.result.label}. Check the numbers, then Save prices.`;
            } catch (e) { msg.textContent = e.message; }
        };
        const saveCost = q("save-cost");
        if (saveCost) saveCost.onclick = async () => {
            try { await call(`${API}/${p.id}/cost`, "PUT", { cost_price: q("cost").value.trim() }); toast("Cost price saved."); reopen("pr-pricing"); }
            catch (e) { toast(e.message, true); }
        };
        // Approval needs Jumia prices for higher-priced products.
        if (r.pricing.market_missing) {
            overlay.querySelectorAll('[data-act="approve"]').forEach((b) => {
                b.dataset.needsMarket = "1";
                b.title = "Record Jumia prices first (Pricing section)";
            });
        }

        const saveMarket = q("save-market");
        if (saveMarket) saveMarket.onclick = async () => {
            const body = {};
            overlay.querySelectorAll("[data-m]").forEach((i) => { body[i.dataset.m] = i.value.trim(); });
            body.source = "jumia.ug";
            try { await call(`${API}/${p.id}/market-price`, "POST", body); reopen("pr-pricing"); }
            catch (e) { q("market-msg").textContent = e.message; }
        };

        overlay.querySelectorAll("[data-review]").forEach((b) => {
            b.onclick = () => { if (Number(b.dataset.review) !== p.id) openAdminProductView(Number(b.dataset.review)); };
        });
    }

    window.LzReview = { meta, overview, pricing, seller, compliance, notes, history, decision, wire, badge, load, toast };
    window.prLoad = load;
})();
