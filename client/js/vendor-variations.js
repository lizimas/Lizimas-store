// The Variants cards on the vendor product form (Ryan, Oct 2026).
// The first card is the product itself (its inputs are the form's own SKU,
// GTIN, quantity, price and sale fields). "ADD VARIATION" adds a card for
// another size / version with its own SKU, GTIN, quantity and price. They are
// saved after the product itself, through PUT /api/vendors/products/:id/variations.
//
//   VdVariations.reset()                 the form was cleared
//   VdVariations.load(productId)         a product was opened for editing
//   VdVariations.problem()               -> "message" | null, and marks the field
//   VdVariations.save(productId)         -> { ok, message }
//   VdVariations.count()                 number of cards
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const SUFFIX = "ULZMS";
    const state = { usesColours: false, loaded: false, hadVariations: false };
    const cardsHost = () => $("vdv-cards");
    const cards = () => Array.from(document.querySelectorAll("#vdv-cards > .lzj-card"));
    const extraCards = () => cards().filter((c) => !c.dataset.main);
    const field = (card, cls) => card.querySelector("." + cls);
    const baseSku = (v) => { const t = String(v || "").trim().toUpperCase(); return t.endsWith(SUFFIX) && t.length > SUFFIX.length ? t.slice(0, -SUFFIX.length) : t; };

    function cardHtml(v) {
        v = v || {};
        return `<div class="lzj-card-head">
                <input type="checkbox" class="vdv-pick" aria-label="Select this variation">
                <span class="lzj-card-title"></span>
                <button type="button" class="lzj-card-fold" aria-label="Collapse or expand"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg></button>
            </div>
            <div class="lzj-card-body">
                <div class="lzj-row lzj-c4">
                    <div class="lzj-f"><label>Variation <b>*</b></label><input type="text" class="vdv-name" maxlength="50" placeholder="..." value="${esc(v.name)}"></div>
                    <div class="lzj-f"><label>Seller SKU <b>*</b></label><div class="lzj-affix"><input type="text" class="vdv-sku" maxlength="50" autocomplete="off" placeholder="Seller SKU" style="text-transform:uppercase;" value="${esc(baseSku(v.sku))}"><span>${SUFFIX}</span></div></div>
                    <div class="lzj-f"><label>GTIN Barcode</label><input type="text" class="vdv-gtin" maxlength="32" placeholder="GTIN Barcode" value="${esc(v.gtin)}"></div>
                    <div class="lzj-f"><label>Quantity</label><input type="number" class="vdv-qty" min="0" step="1" placeholder="Quantity" value="${v.stock == null ? "" : esc(v.stock)}"></div>
                </div>
                <div class="lzj-row lzj-c4">
                    <div class="lzj-f"><label>Price <b>*</b></label><div class="lzj-affix"><input type="number" class="vdv-price" min="0" placeholder="Price" value="${v.payout == null ? "" : esc(v.payout)}"><span>UGX</span></div></div>
                    <div class="lzj-f"><label>Sale Price</label><div class="lzj-affix"><input type="number" class="vdv-sale" placeholder="Sale Price" disabled title="The sale is set on the first variation and covers the whole product"><span>UGX</span></div></div>
                    <div class="lzj-f"><label>Sale Start Date</label><input type="text" class="vdv-start" placeholder="Start Date" disabled></div>
                    <div class="lzj-f"><label>Sale End Date</label><input type="text" class="vdv-end" placeholder="End Date" disabled></div>
                </div>
                <div class="lzj-card-foot"><button type="button" class="lzj-del"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9z"/></svg> Delete</button></div>
            </div>`;
    }

    function addCard(v, quiet) {
        const host = cardsHost();
        if (!host) return null;
        const card = document.createElement("div");
        card.className = "lzj-card";
        card.innerHTML = cardHtml(v);
        host.appendChild(card);
        // A new card starts from the first one's price, which is what most sizes share.
        if (!v && $("product-payout") && $("product-payout").value) field(card, "vdv-price").value = $("product-payout").value;
        refresh();
        if (!quiet) { const n = field(card, "vdv-name"); if (n) n.focus(); }
        return card;
    }

    function refresh() {
        const list = cards();
        list.forEach((card) => {
            const name = (field(card, "vdv-name") || {}).value || "";
            const qty = (field(card, "vdv-qty") || {}).value || "0";
            card.querySelector(".lzj-card-title").textContent = `Variation (${name.trim() || "..."}), Quantity (${Number(qty) || 0})`;
        });
        const picked = list.filter((c) => c.querySelector(".vdv-pick").checked).length;
        const all = $("vdv-all"), dates = $("vdv-dates"), bulk = $("vdv-bulk"), fold = $("vdv-collapse");
        if (all) all.checked = picked > 0 && picked === list.length;
        if (dates) dates.disabled = !picked;
        if (bulk) { bulk.disabled = !picked; bulk.querySelector("span").textContent = picked ? `Bulk Edit (${picked})` : "Bulk Edit"; }
        if (fold) {
            const allFolded = list.length > 0 && list.every((c) => c.classList.contains("lzj-folded"));
            fold.querySelector("span").textContent = allFolded ? "Expand All" : "Collapse All";
            fold.querySelector("svg").style.transform = allFolded ? "rotate(180deg)" : "";
        }
        // The first card's name is only needed once there are other variations.
        const main = list[0], extras = list.length > 1;
        if (main) {
            const label = main.querySelector('label[for="product-variation-name"]');
            if (label) label.innerHTML = "Variation" + (extras ? " <b>*</b>" : "");
        }
        const add = $("vdv-add"), note = $("vdv-note");
        if (add) add.hidden = state.usesColours;
        if (note) note.textContent = state.usesColours
            ? "This product uses colours: set the stock, price and SKU of each colour and size in the Variants table below the form."
            : "Add a variation for each other size or version you sell (for example S, M, L or 64GB, 128GB). Each one has its own SKU, quantity and price.";
    }

    function mark(input, message) {
        const f = input && input.closest(".lzj-f");
        if (!f) return;
        f.classList.toggle("lzj-bad", !!message);
        let m = f.querySelector(".lzj-msg");
        if (!message) { if (m) m.remove(); return; }
        if (!m) { m = document.createElement("span"); m.className = "lzj-msg"; f.appendChild(m); }
        m.textContent = message;
    }

    // -> message | null. Only the extra cards are checked here; the form checks the first one.
    function problem() {
        const list = cards();
        let first = null;
        const fail = (input, message, card) => { mark(input, message); if (!first) { first = { input, card, text: message }; } };
        document.querySelectorAll("#vdv-cards .lzj-bad").forEach((f) => { f.classList.remove("lzj-bad"); const m = f.querySelector(".lzj-msg"); if (m) m.remove(); });
        if (list.length < 2) return null;
        const names = new Set(), skus = new Set();
        list.forEach((card, i) => {
            const name = field(card, "vdv-name"), sku = field(card, "vdv-sku"), price = field(card, "vdv-price"), qty = field(card, "vdv-qty");
            const n = name.value.trim().toLowerCase();
            if (!n) fail(name, "This field is required.", card);
            else if (names.has(n)) fail(name, "Each variation needs its own name.", card);
            names.add(n);
            const s = baseSku(sku.value);
            if (!s) fail(sku, "This field is required.", card);
            else if (!/^[A-Z0-9][A-Z0-9._\/-]*$/.test(s)) fail(sku, "Use letters, numbers and - . / _ only.", card);
            else if (skus.has(s)) fail(sku, "Each variation needs its own SKU.", card);
            skus.add(s);
            if (!(Number(price.value) > 0)) fail(price, "This field is required.", card);
            if (qty.value !== "" && (!Number.isInteger(Number(qty.value)) || Number(qty.value) < 0)) fail(qty, "Use a whole number.", card);
        });
        if (!first) return null;
        first.card.classList.remove("lzj-folded");
        if (first.input.scrollIntoView) first.input.scrollIntoView({ behavior: "smooth", block: "center" });
        return "Check the variation outlined in red: " + first.text;
    }

    function payload() {
        return cards().map((card) => ({
            name: field(card, "vdv-name").value.trim(),
            sku: baseSku(field(card, "vdv-sku").value),
            gtin: field(card, "vdv-gtin").value.trim(),
            stock: Number(field(card, "vdv-qty").value || 0),
            payout: Number(field(card, "vdv-price").value || 0)
        }));
    }

    async function save(productId) {
        if (state.usesColours || !productId) return { ok: true };
        const list = payload();
        // Nothing to do for a product that has, and had, no variations.
        if (list.length < 2 && !list[0].name && !state.hadVariations) return { ok: true };
        try {
            const data = await vendorAuthorizedFetch(`/api/vendors/products/${productId}/variations`, {
                method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variations: list })
            });
            if (data && data.error) return { ok: false, message: data.error };
            state.hadVariations = !!(data && data.count);
            return { ok: true, count: data && data.count };
        } catch (e) { return { ok: false, message: "Could not connect to server." }; }
    }

    function reset() {
        extraCards().forEach((c) => c.remove());
        state.usesColours = false; state.loaded = false; state.hadVariations = false;
        const n = $("product-variation-name"); if (n) n.value = "";
        cards().forEach((c) => { c.classList.remove("lzj-folded"); c.querySelector(".vdv-pick").checked = false; });
        closePanel(); refresh();
    }

    async function load(productId) {
        reset();
        if (!productId) return;
        try {
            const data = await vendorAuthorizedFetch(`/api/vendors/products/${productId}/variations`);
            if (!data || data.error) return;
            if (String(($("product-id") || {}).value) !== String(productId)) return;   // another product was opened meanwhile
            state.usesColours = !!data.usesColours;
            const list = data.variations || [];
            state.hadVariations = list.length > 0;
            if (list.length) {
                const first = list[0], main = cards()[0];
                $("product-variation-name").value = first.name || "";
                // With variations the first card shows the first variation's own stock.
                if (field(main, "vdv-qty")) field(main, "vdv-qty").value = first.stock;
                if (first.gtin && !field(main, "vdv-gtin").value) field(main, "vdv-gtin").value = first.gtin;
                list.slice(1).forEach((v) => addCard({ name: v.name, sku: v.sku, gtin: v.gtin, stock: v.stock, payout: v.payout == null ? ($("product-payout") || {}).value : v.payout }, true));
            }
            state.loaded = true;
            refresh();
        } catch (e) { /* the form still works without them */ }
    }

    // ---- Edit Date / Bulk Edit panel ----
    function closePanel() { const p = $("vdv-panel"); if (p) { p.hidden = true; p.innerHTML = ""; } }
    function openPanel(kind) {
        const p = $("vdv-panel");
        if (!p) return;
        const picked = cards().filter((c) => c.querySelector(".vdv-pick").checked);
        if (!picked.length) return;
        p.hidden = false;
        if (kind === "dates") {
            p.innerHTML = `<div class="lzj-vpanel-title">Sale dates</div>
                <div class="lzj-row lzj-c3">
                    <div class="lzj-f"><label>Sale Start Date</label><input type="date" id="vdv-p-start" value="${esc(($("product-sale-start") || {}).value)}"></div>
                    <div class="lzj-f"><label>Sale End Date</label><input type="date" id="vdv-p-end" value="${esc(($("product-sale-end") || {}).value)}"></div>
                </div>
                <div class="lzj-vpanel-acts"><button type="button" class="lzj-tool" data-x>Cancel</button><button type="button" class="lzj-tool lzj-tool-act" data-ok>Apply</button></div>`;
            p.querySelector("[data-ok]").onclick = () => {
                $("product-sale-start").value = $("vdv-p-start").value; $("product-sale-end").value = $("vdv-p-end").value;
                if (typeof scheduleVendorPricingPreview === "function") scheduleVendorPricingPreview();
                closePanel();
            };
        } else {
            p.innerHTML = `<div class="lzj-vpanel-title">Change ${picked.length} selected variation${picked.length === 1 ? "" : "s"} <span style="font-weight:400; color:#8a8f98;">(leave a box empty to keep what is there)</span></div>
                <div class="lzj-row lzj-c3">
                    <div class="lzj-f"><label>Price</label><div class="lzj-affix"><input type="number" id="vdv-p-price" min="0" placeholder="Price"><span>UGX</span></div></div>
                    <div class="lzj-f"><label>Quantity</label><input type="number" id="vdv-p-qty" min="0" step="1" placeholder="Quantity"></div>
                </div>
                <div class="lzj-vpanel-acts"><button type="button" class="lzj-tool" data-x>Cancel</button><button type="button" class="lzj-tool lzj-tool-act" data-ok>Apply</button></div>`;
            p.querySelector("[data-ok]").onclick = () => {
                const price = $("vdv-p-price").value, qty = $("vdv-p-qty").value;
                picked.forEach((card) => {
                    if (price !== "") field(card, "vdv-price").value = price;
                    if (qty !== "") field(card, "vdv-qty").value = qty;
                });
                if (typeof scheduleVendorPricingPreview === "function") scheduleVendorPricingPreview();
                closePanel(); refresh();
            };
        }
        p.querySelector("[data-x]").onclick = closePanel;
        const firstInput = p.querySelector("input"); if (firstInput) firstInput.focus();
    }

    function init() {
        const host = cardsHost();
        if (!host || host.dataset.bound) return;
        host.dataset.bound = "1";
        host.addEventListener("input", (e) => { if (e.target.closest(".lzj-bad")) mark(e.target, ""); refresh(); });
        host.addEventListener("change", refresh);
        host.addEventListener("click", (e) => {
            const card = e.target.closest(".lzj-card");
            if (!card) return;
            if (e.target.closest(".lzj-card-fold")) { card.classList.toggle("lzj-folded"); refresh(); }
            else if (e.target.closest(".lzj-del")) { card.remove(); refresh(); }
        });
        const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
        on("vdv-add", () => addCard());
        on("vdv-collapse", () => { const list = cards(); const fold = !list.every((c) => c.classList.contains("lzj-folded")); list.forEach((c) => c.classList.toggle("lzj-folded", fold)); refresh(); });
        on("vdv-dates", () => openPanel("dates"));
        on("vdv-bulk", () => openPanel("bulk"));
        const all = $("vdv-all");
        if (all) all.addEventListener("change", () => { cards().forEach((c) => { c.querySelector(".vdv-pick").checked = all.checked; }); refresh(); });
        refresh();
    }

    window.VdVariations = { reset, load, problem, save, count: () => cards().length, refresh };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
