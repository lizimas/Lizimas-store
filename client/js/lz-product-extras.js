// The parts of the vendor product form that staff and admin use too (Ryan,
// Oct 2026): rich-text Product description and Highlights, the Product
// details block (Model, Production country, Condition, What's in the box,
// Product warranty) and the specification fields that depend on the chosen
// category (lz-category-specs.js).
//
// The page keeps its own form. This file finds #product-description,
// #product-category and #specs-list, builds the extra fields around them and
// offers three calls to the page's script:
//
//   LzProductExtras.fill(product | null)   when a product is opened / the form is cleared
//   LzProductExtras.appendTo(formData)     just before the product is saved
//   LzProductExtras.specRows()             the filled-in category fields, as { label, value }
//
// The page's collectSpecRows() is extended automatically, and the hidden
// plain-text description is kept in step with the editor, so the existing
// "description is required" checks keep working.
(function () {
    "use strict";
    const rich = {};
    let categories = null, busy = false, lastCategory = null;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const api = () => (typeof API_URL !== "undefined" ? API_URL : "");
    const token = () => (typeof getToken === "function" ? getToken() : typeof getStaffToken === "function" ? getStaffToken() : "");

    const COUNTRIES = ["Uganda", "Kenya", "Tanzania", "Rwanda", "South Africa", "Nigeria", "Egypt", "China", "India", "Turkey", "United Arab Emirates", "United Kingdom", "United States", "Germany", "France", "Italy", "Japan", "South Korea", "Vietnam", "Thailand", "Malaysia", "Indonesia"];
    const CSS = `
.lzx-label{display:block;font-size:13px;font-weight:600;color:#333;margin:12px 0 4px}
.lzx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0}
.lzx-grid label{display:block;font-size:13px;font-weight:600;color:#333}
.lzx-grid input,.lzx-grid select{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit;font-size:14px;font-weight:400}
.lzx-block{width:100%;min-width:0}
#lzx-block .lzr-bar select.lzr-block{padding:0 6px !important;font-size:15px !important}
#specs-template{margin:0 0 14px}
.vd-cat-title{font-size:13.5px;font-weight:700;color:#1a1a2e;margin:0 0 8px}
.vd-cat-title span{font-weight:400;color:#888;font-size:12.5px}
.vd-cat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.vd-cat-field{display:block;min-width:0}
.vd-cat-field>span{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:4px}
.vd-cat-field input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit;font-size:14px}`;

    async function uploadImage(file) {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch(`${api()}/api/products/description-blocks/image`, { method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.image_url) throw new Error(j.message || j.error || "The picture could not be uploaded.");
        return j.image_url;
    }
    function syncDescription() {
        const t = $("product-description");
        if (t && rich.description) t.value = rich.description.getText();
    }

    function build() {
        const textarea = $("product-description");
        if (!textarea || $("lzx-block")) return;
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const block = document.createElement("div");
        block.id = "lzx-block";
        block.className = "lzx-block";
        block.innerHTML = `
            <span class="lzx-label">Product description *</span><div id="lzx-description"></div>
            <span class="lzx-label">Highlights</span><div id="lzx-highlights"></div>
            <div class="lzx-grid">
                <label>Model<input type="text" id="product-model" maxlength="120" placeholder="Ex: MD-1234"></label>
                <label>Production country<input type="text" id="product-production-country" maxlength="80" list="lzx-countries" placeholder="Ex: China"></label>
                <label>Condition<select id="product-condition"><option value="new">New</option><option value="pre_used">Pre-Used</option><option value="refurbished">Refurbished</option></select></label>
            </div>
            <datalist id="lzx-countries">${COUNTRIES.map((c) => `<option>${c}</option>`).join("")}</datalist>
            <span class="lzx-label">What's in the box</span><div id="lzx-box"></div>
            <span class="lzx-label">Product warranty</span><div id="lzx-warranty"></div>`;
        // After the plain box and its word counter; both stay in the page, hidden.
        let anchor = textarea;
        if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains("lz-text-count")) anchor = anchor.nextElementSibling;
        anchor.insertAdjacentElement("afterend", block);

        if (window.LzRichEditor) {
            const make = (id, placeholder, onChange) => LzRichEditor.mount($(id), { placeholder, uploadImage, onChange });
            rich.description = make("lzx-description", "Include only product-related information. Write clearly and concisely, and make sure the description matches the product photos.", syncDescription);
            rich.highlights = make("lzx-highlights", "Key features in bullet points, at least 4 for a good listing. Ex: Lightweight design - Noise cancellation - 20-hour battery life");
            rich.box = make("lzx-box", "Ex: 1x Headphone, 1x Charging Cable, 1x User Manual [everything included in the package]");
            rich.warranty = make("lzx-warranty", "Ex: 1 year limited warranty [the warranty terms covering the product]");
            textarea.style.setProperty("display", "none", "important");
            if (anchor !== textarea) anchor.style.display = "none";
            if (textarea.value.trim()) rich.description.setText(textarea.value);
        } else {
            // No editor script on this page: keep the plain description box.
            ["lzx-description", "lzx-highlights", "lzx-box", "lzx-warranty"].forEach((id) => { const h = $(id); if (h) { if (h.previousElementSibling) h.previousElementSibling.remove(); h.remove(); } });
        }

        const list = $("specs-list");
        if (list && !$("specs-template")) {
            const tpl = document.createElement("div");
            tpl.id = "specs-template";
            tpl.hidden = true;
            list.insertAdjacentElement("beforebegin", tpl);
            if (window.MutationObserver) {
                let t = null;
                new MutationObserver(() => { if (busy) return; clearTimeout(t); t = setTimeout(renderSpecs, 150); }).observe(list, { childList: true });
            }
        }
        const select = $("product-category");
        if (select) {
            select.addEventListener("change", renderSpecs);
            // Some pickers set the value from code, which fires no event.
            setInterval(() => { if (select.value !== lastCategory) renderSpecs(); }, 700);
        }
        // The page's own rows plus the category's fields.
        if (typeof window.collectSpecRows === "function" && !window.collectSpecRows.lzx) {
            const own = window.collectSpecRows;
            window.collectSpecRows = function () { return specRows().concat(own.apply(this, arguments)); };
            window.collectSpecRows.lzx = true;
        }
        loadCategories();
    }

    async function loadCategories() {
        try {
            const res = await fetch(`${api()}/api/products/categories`);
            const list = await res.json();
            categories = new Map((Array.isArray(list) ? list : list.categories || []).map((c) => [Number(c.id), c]));
            lastCategory = null;
            renderSpecs();
        } catch (e) { categories = new Map(); }
    }
    function categoryPath(id) {
        const names = [];
        let c = categories && categories.get(Number(id)), guard = 0;
        while (c && guard++ < 8) { names.unshift(c.name); c = categories.get(Number(c.parent_id)); }
        if (!names.length) {
            const select = $("product-category");
            const opt = select && select.selectedOptions && select.selectedOptions[0];
            if (opt && opt.value) names.push(opt.textContent.replace(/^[\s—–>-]+/, "").trim());
        }
        return names;
    }

    function renderSpecs() {
        const host = $("specs-template"), select = $("product-category");
        if (!host || !select || !window.LzCategorySpecs || busy) return;
        busy = true;
        try {
            lastCategory = select.value;
            const path = select.value ? categoryPath(select.value) : [];
            const tpl = path.length ? LzCategorySpecs.forPath(path) : { fields: [] };
            // Keep what is already typed, and take over matching rows from the list below.
            const have = new Map();
            host.querySelectorAll(".vd-cat-field").forEach((fl) => { const v = fl.querySelector(".spec-value-input").value.trim(); if (v) have.set(fl.dataset.key, v); });
            const wanted = new Set(tpl.fields.map((x) => x.label.toLowerCase()));
            document.querySelectorAll("#specs-list > div").forEach((row) => {
                const l = row.querySelector(".spec-label-input"), v = row.querySelector(".spec-value-input");
                if (l && v && wanted.has(l.value.trim().toLowerCase())) { if (v.value.trim()) have.set(l.value.trim().toLowerCase(), v.value.trim()); row.remove(); }
            });
            // A filled-in field the new category doesn't have goes to the list, so nothing typed is lost.
            have.forEach((v, k) => {
                if (wanted.has(k)) return;
                const old = Array.from(host.querySelectorAll(".vd-cat-field")).find((fl) => fl.dataset.key === k);
                if (old && typeof window.addSpecRow === "function") window.addSpecRow(old.dataset.label, v);
            });
            if (!tpl.fields.length) { host.innerHTML = ""; host.hidden = true; return; }
            host.hidden = false;
            host.innerHTML = `<div class="vd-cat-title">Specifications for ${esc(path[path.length - 1] || tpl.group)} <span>(fill in what applies - empty ones are left out)</span></div><div class="vd-cat-grid">`
                + tpl.fields.map((x, i) => `<label class="vd-cat-field" data-label="${esc(x.label)}" data-key="${esc(x.label.toLowerCase())}"><span>${esc(x.label)}</span>
                    <input type="text" class="spec-value-input" maxlength="200" placeholder="${esc(x.hint)}"${x.kind === "n" ? ' inputmode="decimal"' : ""}${x.options ? ` list="lzx-opt-${i}"` : ""}>
                    ${x.options ? `<datalist id="lzx-opt-${i}">${x.options.map((o) => `<option>${esc(o)}</option>`).join("")}</datalist>` : ""}</label>`).join("") + "</div>";
            host.querySelectorAll(".vd-cat-field").forEach((fl) => { const v = have.get(fl.dataset.key); if (v) fl.querySelector(".spec-value-input").value = v; });
        } finally { busy = false; }
    }

    function specRows() {
        const rows = [];
        document.querySelectorAll("#specs-template .vd-cat-field").forEach((fl) => {
            const value = fl.querySelector(".spec-value-input").value.trim();
            if (value) rows.push({ label: fl.dataset.label, value });
        });
        return rows;
    }

    function fill(product) {
        build();
        const set = (id, v) => { const el = $(id); if (el) el.value = v; };
        set("product-model", (product && product.model) || "");
        set("product-production-country", (product && product.production_country) || "");
        set("product-condition", (product && product.item_condition) || "new");
        const tpl = $("specs-template");
        if (tpl) { tpl.innerHTML = ""; tpl.hidden = true; }
        lastCategory = null;
        if (rich.description) {
            if (product && product.description_html) rich.description.setHTML(product.description_html);
            else rich.description.setText(product ? product.description || "" : "");     // older listings: plain text
            rich.highlights.setHTML((product && product.highlights_html) || "");
            rich.box.setHTML((product && product.box_contents_html) || "");
            rich.warranty.setHTML((product && product.warranty_html) || "");
            syncDescription();
        }
        setTimeout(renderSpecs, 500);       // once the category and the saved specifications are in place
    }

    function appendTo(formData) {
        if (rich.description) {
            formData.append("description_html", rich.description.getHTML());
            formData.append("highlights_html", rich.highlights.getHTML());
            formData.append("box_contents_html", rich.box.getHTML());
            formData.append("warranty_html", rich.warranty.getHTML());
        }
        if ($("product-model")) {
            formData.append("model", $("product-model").value || "");
            formData.append("production_country", $("product-production-country").value || "");
            formData.append("item_condition", $("product-condition").value || "new");
        }
    }

    window.LzProductExtras = { fill, appendTo, specRows, refresh: renderSpecs };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
