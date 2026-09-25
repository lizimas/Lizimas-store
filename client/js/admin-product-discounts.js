// Admin > Discount Promotions (migration 132, Ryan Sept 2026).
//
// Puts a PERCENT discount on one or many products, each with its own %.
// Only the % is saved, so the price customers pay always follows the
// product's current price (30% off stays 30% off when 500,000 becomes
// 700,000). The admin can type either the % or the final price customers
// should pay - the other one is worked out and shown next to it.
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ugx = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString();
    const pctText = (p) => (Math.round(Number(p) * 100) / 100).toString() + "%";

    // Same maths as server/utils/productDiscounts.js
    const priceAfter = (price, pct) => Math.round(price * (1 - pct / 100));
    const pctFor = (price, target) => (1 - target / price) * 100;

    let selected = []; // { id, name, sku, price, image, vendor, mode: "percent"|"target", percent, target, error }
    let results = [];
    let listShow = "current";
    let current = [];
    let searchTimer = null;

    async function api(path, opts = {}) {
        const token = typeof getToken === "function" ? getToken() : localStorage.getItem("adminToken");
        const res = await fetch(path, {
            ...opts,
            cache: "no-store",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
        });
        let body = null;
        try { body = await res.json(); } catch (e) { /* empty */ }
        if (!res.ok) {
            const err = new Error((body && body.error) || `HTTP ${res.status}`);
            err.body = body;
            throw err;
        }
        return body;
    }

    function toast(msg) {
        if (typeof showToast === "function") showToast(msg); else console.log(msg);
    }

    // --- product search -----------------------------------------------------
    async function search() {
        const q = $("pdx-search").value.trim();
        $("pdx-results").innerHTML = `<p class="pdx-muted">Searching&hellip;</p>`;
        try {
            results = await api(`/api/admin/product-discounts/products?q=${encodeURIComponent(q)}`);
            renderResults();
        } catch (e) {
            $("pdx-results").innerHTML = `<p class="pdx-err">${esc(e.message)}</p>`;
        }
    }

    function renderResults() {
        if (!results.length) { $("pdx-results").innerHTML = `<p class="pdx-muted">No products found.</p>`; return; }
        const chosen = new Set(selected.map((s) => s.id));
        $("pdx-results").innerHTML = results.map((p) => `
            <label class="pdx-result${chosen.has(p.id) ? " is-added" : ""}">
                <input type="checkbox" data-pick="${p.id}" ${chosen.has(p.id) ? "checked disabled" : ""}>
                ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="pdx-noimg"></span>`}
                <span class="pdx-r-main">
                    <b>${esc(p.name)}</b>
                    <small>${esc(p.sku || "")} &middot; ${esc(p.vendor)}${p.category ? " &middot; " + esc(p.category) : ""}${p.live ? "" : " &middot; <em>not live</em>"}</small>
                </span>
                <span class="pdx-r-price">${ugx(p.price)}
                    ${p.current_percent != null ? `<small class="pdx-tag">now ${pctText(p.current_percent)} off</small>` : ""}
                    ${p.overridden_by ? `<small class="pdx-tag pdx-tag-warn">${esc(p.overridden_by)} running</small>` : ""}
                </span>
            </label>`).join("");
    }

    function addPicked() {
        const ids = [...document.querySelectorAll("#pdx-results input[data-pick]:checked:not(:disabled)")].map((b) => Number(b.dataset.pick));
        if (!ids.length) { toast("Tick the products to add first"); return; }
        const def = Number($("pdx-default-pct").value);
        ids.forEach((id) => {
            const p = results.find((r) => r.id === id);
            if (!p || selected.some((s) => s.id === id)) return;
            // Start from the "same % for all" box, else from the product's
            // existing discount (as its exact price, so nothing shifts).
            const row = { id: p.id, name: p.name, sku: p.sku, price: p.price, image: p.image, vendor: p.vendor,
                mode: "percent", percent: null, target: null, error: null, overridden_by: p.overridden_by };
            if (def > 0 && def < 100) row.percent = def;
            else if (p.current_percent) { row.mode = "target"; row.target = priceAfter(p.price, p.current_percent); }
            selected.push(row);
        });
        renderSelected();
        renderResults();
    }

    // --- selected table -----------------------------------------------------
    function rowNumbers(s) {
        if (s.mode === "target" && s.target > 0 && s.target < s.price) {
            return { pct: pctFor(s.price, s.target), pays: Math.round(s.target) };
        }
        if (s.mode === "percent" && s.percent > 0 && s.percent < 100) {
            return { pct: s.percent, pays: priceAfter(s.price, s.percent) };
        }
        return { pct: null, pays: null };
    }

    function renderSelected() {
        $("pdx-sel-count").textContent = selected.length ? `(${selected.length})` : "";
        $("pdx-save").disabled = !selected.length;
        if (!selected.length) {
            $("pdx-selected").innerHTML = `<tr><td colspan="6" class="pdx-muted">No products yet &mdash; search above, tick products and press <b>Add to discount</b>.</td></tr>`;
            return;
        }
        $("pdx-selected").innerHTML = selected.map((s, i) => {
            const n = rowNumbers(s);
            const pctVal = s.mode === "percent" ? (s.percent ?? "") : (n.pct != null ? Math.round(n.pct * 100) / 100 : "");
            const payVal = s.mode === "target" ? (s.target ?? "") : (n.pays ?? "");
            return `
            <tr data-row="${i}" class="${s.error ? "pdx-row-err" : ""}">
                <td data-label="Product"><b>${esc(s.name)}</b><br><small class="pdx-muted">${esc(s.sku || "")} &middot; ${esc(s.vendor)}</small>
                    ${s.overridden_by ? `<br><small class="pdx-tag pdx-tag-warn">A ${esc(s.overridden_by)} is running &mdash; it wins until it ends</small>` : ""}
                    ${s.error ? `<br><small class="pdx-err">${esc(s.error)}</small>` : ""}</td>
                <td data-label="Old price (current)">${ugx(s.price)}</td>
                <td data-label="% off"><div class="pdx-inwrap"><input type="number" inputmode="decimal" min="0.01" max="99.99" step="any" data-pct="${i}" value="${pctVal}" class="${s.mode === "percent" ? "pdx-driver" : ""}"><span>%</span></div></td>
                <td data-label="Customer pays"><div class="pdx-inwrap"><span>UGX</span><input type="number" inputmode="numeric" min="1" step="1" data-pay="${i}" value="${payVal}" class="${s.mode === "target" ? "pdx-driver" : ""}"></div></td>
                <td data-label="Saving" data-saving="${i}">${n.pays != null ? ugx(s.price - n.pays) : "&mdash;"}</td>
                <td><button type="button" class="pdx-x" data-remove="${i}" title="Remove">&times;</button></td>
            </tr>`;
        }).join("");
    }

    function onSelectedInput(e) {
        const t = e.target;
        const i = Number(t.dataset.pct ?? t.dataset.pay);
        if (Number.isNaN(i) || !selected[i]) return;
        const s = selected[i];
        s.error = null;
        const tr = t.closest("tr");
        if (t.dataset.pct !== undefined) {
            s.mode = "percent"; s.percent = t.value === "" ? null : Number(t.value);
            const n = rowNumbers(s);
            tr.querySelector("[data-pay]").value = n.pays ?? "";
        } else {
            s.mode = "target"; s.target = t.value === "" ? null : Number(t.value);
            const n = rowNumbers(s);
            tr.querySelector("[data-pct]").value = n.pct != null ? Math.round(n.pct * 100) / 100 : "";
        }
        tr.querySelector("[data-pct]").classList.toggle("pdx-driver", s.mode === "percent");
        tr.querySelector("[data-pay]").classList.toggle("pdx-driver", s.mode === "target");
        const n = rowNumbers(s);
        tr.querySelector("[data-saving]").innerHTML = n.pays != null ? ugx(s.price - n.pays) : "&mdash;";
        tr.classList.remove("pdx-row-err");
    }

    function applyAll() {
        const v = Number($("pdx-default-pct").value);
        if (!(v > 0 && v < 100)) { toast("Enter a % between 0 and 100 first"); return; }
        selected.forEach((s) => { s.mode = "percent"; s.percent = v; s.error = null; });
        renderSelected();
    }

    async function save() {
        let bad = false;
        const items = selected.map((s) => {
            const n = rowNumbers(s);
            if (n.pays == null) { s.error = "Enter a % (0-100) or a final price below the current price"; bad = true; }
            return s.mode === "target" ? { product_id: s.id, target_price: s.target } : { product_id: s.id, percent: s.percent };
        });
        if (bad) { renderSelected(); return; }
        const body = {
            items,
            label: $("pdx-label").value.trim() || null,
            starts_at: $("pdx-starts").value ? new Date($("pdx-starts").value).toISOString() : null,
            ends_at: $("pdx-ends").value ? new Date($("pdx-ends").value).toISOString() : null
        };
        $("pdx-save").disabled = true;
        try {
            const r = await api("/api/admin/product-discounts", { method: "POST", body: JSON.stringify(body) });
            toast(`Discount saved on ${r.saved.length} product${r.saved.length === 1 ? "" : "s"}`);
            selected = [];
            $("pdx-label").value = ""; $("pdx-starts").value = ""; $("pdx-ends").value = "";
            renderSelected();
            if (results.length) renderResults();
            listShow = "current";
            loadCurrent();
        } catch (e) {
            if (e.body && Array.isArray(e.body.errors)) {
                e.body.errors.forEach((er) => { const s = selected.find((x) => x.id === Number(er.product_id)); if (s) s.error = er.error; });
                renderSelected();
            }
            toast(e.message);
        } finally {
            $("pdx-save").disabled = !selected.length;
        }
    }

    // --- current / ended list -----------------------------------------------
    async function loadCurrent() {
        document.querySelectorAll("[data-pdx-show]").forEach((b) => b.classList.toggle("is-on", b.dataset.pdxShow === listShow));
        $("pdx-end-selected").hidden = listShow !== "current";
        $("pdx-list").innerHTML = `<tr><td colspan="8" class="pdx-muted">Loading&hellip;</td></tr>`;
        try {
            current = await api(`/api/admin/product-discounts?show=${listShow}`);
            renderCurrent();
        } catch (e) {
            $("pdx-list").innerHTML = `<tr><td colspan="8" class="pdx-err">${esc(e.message)}</td></tr>`;
        }
    }

    const fmtDate = (d) => d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "No end";
    const STATUS = { running: "Running", scheduled: "Scheduled", expired: "Expired", ended: "Ended" };

    function renderCurrent() {
        $("pdx-list-count").textContent = `(${current.length})`;
        if (!current.length) {
            $("pdx-list").innerHTML = `<tr><td colspan="8" class="pdx-muted">${listShow === "current" ? "No discounts running." : "Nothing ended yet."}</td></tr>`;
            return;
        }
        $("pdx-list").innerHTML = current.map((d) => `
            <tr>
                <td>${listShow === "current" ? `<input type="checkbox" data-end="${d.id}">` : ""}</td>
                <td data-label="Product"><b>${esc(d.name)}</b><br><small class="pdx-muted">${esc(d.sku || "")} &middot; ${esc(d.vendor)}${d.label ? " &middot; " + esc(d.label) : ""}</small>
                    ${d.overridden_by && d.status === "running" ? `<br><small class="pdx-tag pdx-tag-warn">${esc(d.overridden_by)} price is showing instead</small>` : ""}</td>
                <td data-label="Current price">${ugx(d.price)}</td>
                <td data-label="% off"><b>${pctText(d.percent)}</b></td>
                <td data-label="Customer pays">${ugx(d.sale_price)}</td>
                <td data-label="Dates"><small>${esc(fmtDate(d.starts_at))}<br>&rarr; ${esc(fmtDate(d.ends_at))}</small></td>
                <td data-label="Status"><span class="pdx-st pdx-st-${d.status}">${STATUS[d.status] || d.status}</span></td>
                <td>${listShow === "current"
                    ? `<button type="button" class="pdx-link" data-edit="${d.id}">Edit</button> <button type="button" class="pdx-link pdx-danger" data-end-one="${d.id}">End</button>`
                    : `<button type="button" class="pdx-link" data-edit="${d.id}">Reuse</button>`}</td>
            </tr>`).join("");
    }

    async function endIds(ids) {
        if (!ids.length) { toast("Tick the discounts to end"); return; }
        if (!confirm(`End ${ids.length} discount${ids.length === 1 ? "" : "s"} now? Prices go back to normal straight away.`)) return;
        try {
            const r = await api("/api/admin/product-discounts/end", { method: "PATCH", body: JSON.stringify({ ids }) });
            toast(`Ended ${r.ended}`);
            loadCurrent();
        } catch (e) { toast(e.message); }
    }

    function editRow(id) {
        const d = current.find((x) => x.id === id);
        if (!d) return;
        const existing = selected.find((s) => s.id === d.product_id);
        // Loaded as the exact price customers pay today, so re-saving
        // without changes keeps the same discount.
        if (existing) { existing.mode = "target"; existing.target = d.sale_price; existing.error = null; }
        else selected.push({ id: d.product_id, name: d.name, sku: d.sku, price: d.price, image: d.image, vendor: d.vendor,
            mode: "target", percent: null, target: d.sale_price, error: null, overridden_by: d.overridden_by });
        renderSelected();
        $("pdx-builder").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // --- wiring -------------------------------------------------------------
    let wired = false;
    function init() {
        if (!$("tab-product-discounts")) return;
        if (!wired) {
            wired = true;
            $("pdx-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 300); });
            $("pdx-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); search(); } });
            $("pdx-add").addEventListener("click", addPicked);
            $("pdx-select-all").addEventListener("click", () => document.querySelectorAll("#pdx-results input[data-pick]:not(:disabled)").forEach((b) => { b.checked = true; }));
            $("pdx-apply-all").addEventListener("click", applyAll);
            $("pdx-clear").addEventListener("click", () => { selected = []; renderSelected(); renderResults(); });
            $("pdx-selected").addEventListener("input", onSelectedInput);
            $("pdx-selected").addEventListener("click", (e) => {
                const b = e.target.closest("[data-remove]");
                if (b) { selected.splice(Number(b.dataset.remove), 1); renderSelected(); if (results.length) renderResults(); }
            });
            $("pdx-save").addEventListener("click", save);
            document.querySelectorAll("[data-pdx-show]").forEach((b) => b.addEventListener("click", () => { listShow = b.dataset.pdxShow; loadCurrent(); }));
            $("pdx-end-selected").addEventListener("click", () => endIds([...document.querySelectorAll("#pdx-list input[data-end]:checked")].map((b) => Number(b.dataset.end))));
            $("pdx-list").addEventListener("click", (e) => {
                const one = e.target.closest("[data-end-one]");
                if (one) endIds([Number(one.dataset.endOne)]);
                const ed = e.target.closest("[data-edit]");
                if (ed) editRow(Number(ed.dataset.edit));
            });
            renderSelected();
            search();
        }
        loadCurrent();
    }

    document.addEventListener("click", (e) => {
        if (e.target.closest('.tab-btn[data-tab="product-discounts"]')) setTimeout(init, 0);
    });
    window.LzProductDiscounts = { init, priceAfter, pctFor };
})();
