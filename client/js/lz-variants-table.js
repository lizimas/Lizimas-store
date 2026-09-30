// Variants table for the Add / Edit Product forms (Sept 2026).
//
// One row per colour, per size, or per colour + size (whatever the product
// has): colour swatch, price (admin) or payout (vendor), stock, SKU and the
// colour's photo. "Use these stock numbers" switches the product to
// per-variant stock (the storefront then uses each row's stock).
//
//   LzVariantsTable.mount(host, {
//       productId, mode: "admin" | "vendor",
//       api: (url, opts) => Promise<json>,     // authorised fetch
//       stockEnabled: bool,                    // product.variant_stock_enabled
//       productPrice: number                   // shown as the default price
//   });
//   LzVariantsTable.reload(host)
(function () {
    "use strict";

    const STYLE_ID = "lzvt-style";
    const CSS = `
.lzvt { width: 100%; }
.lzvt-wrap { width: 100%; overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 10px; }
.lzvt table { width: 100% !important; border-collapse: collapse; font-size: 13px; min-width: 560px; display: table !important; }
.lzvt th { text-align: left; font-weight: 700; color: #374151; background: #f6f7f9; padding: 9px 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
.lzvt td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
.lzvt tr:last-child td { border-bottom: 0; }
.lzvt input { padding: 7px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box; font-family: inherit; }
.lzvt input.lzvt-num { width: 92px; }
.lzvt input.lzvt-price { width: 120px; }
.lzvt input.lzvt-sku { width: 130px; text-transform: uppercase; }
.lzvt-colour { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; white-space: nowrap; }
.lzvt-dot { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,.18); flex: 0 0 16px; }
.lzvt-dot.lzvt-nohex { background: repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 50% / 6px 6px; }
.lzvt-photo { width: 38px; height: 38px; border-radius: 6px; object-fit: cover; border: 1px solid #e5e7eb; display: block; }
.lzvt-nophoto { font-size: 11.5px; color: #9ca3af; }
.lzvt-cust { font-size: 12px; color: #6b7280; white-space: nowrap; }
.lzvt-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.lzvt-bar button { padding: 9px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.lzvt-save { background: #1a1a2e; color: #fff; border: 0; }
.lzvt-gen { background: #fff; color: #1a1a2e; border: 1.5px solid #1a1a2e; }
.lzvt-mode { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: #1f2937; margin-left: auto; cursor: pointer; }
.lzvt-mode input { width: 16px; height: 16px; }
.lzvt-msg { font-size: 12.5px; margin-top: 8px; min-height: 1em; color: #374151; }
.lzvt-msg.lzvt-bad { color: #b42318; }
.lzvt-empty { font-size: 13px; color: #4b5563; padding: 12px; border: 1px dashed #cbd0d8; border-radius: 10px; background: #fafbfc; }
.lzvt-foot { font-size: 12px; color: #6b7280; margin-top: 6px; }`;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const st = document.createElement("style");
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
    }
    function esc(v) {
        return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    const money = (n) => "UGX " + Number(n || 0).toLocaleString();

    function base(st) {
        return st.mode === "vendor" ? "/api/vendors/products/" + st.productId : "/api/products/" + st.productId;
    }

    async function reload(host) {
        const st = host._lzvt;
        if (!st) return;
        host.querySelector(".lzvt-body").innerHTML = '<div class="lzvt-empty">Loading variants...</div>';
        try {
            const r = await fetch("/api/products/" + st.productId + "/options");
            const opts = r.ok ? await r.json() : { colors: [], sizes: [], variants: [] };
            st.colors = opts.colors || [];
            st.sizes = opts.sizes || [];
            st.variants = opts.variants || [];
            st.vendorPrices = {};
            if (st.mode === "vendor" && st.variants.length) {
                try {
                    const vp = await st.api(base(st) + "/variant-prices");
                    (vp.variants || []).forEach((v) => { st.vendorPrices[v.id] = v; });
                } catch (e) { /* optional */ }
            }
            draw(host);
        } catch (e) {
            host.querySelector(".lzvt-body").innerHTML = '<div class="lzvt-empty">Could not load the variants.</div>';
        }
    }

    function draw(host, message, bad) {
        const st = host._lzvt;
        const body = host.querySelector(".lzvt-body");
        const colorById = {}, sizeById = {};
        st.colors.forEach((c) => { colorById[c.id] = c; });
        st.sizes.forEach((z) => { sizeById[z.id] = z; });
        const hasColors = st.colors.length > 0, hasSizes = st.sizes.length > 0;
        // Only rows for the product's current colours/sizes (standalone
        // options such as "1L / 2L" are managed in their own list).
        const rows = st.variants.filter((v) => v.color_id !== null || v.size_id !== null);

        if (!hasColors && !hasSizes) {
            body.innerHTML = '<div class="lzvt-empty">Choose colours or sizes above and save the product - the table of prices, stock and SKUs appears here.</div>';
            return;
        }
        const expected = hasColors && hasSizes ? st.colors.length * st.sizes.length : (hasColors ? st.colors.length : st.sizes.length);
        const genBtn = '<button type="button" class="lzvt-gen">' + (rows.length ? "Add missing rows" : "Make the table") + "</button>";

        if (!rows.length) {
            body.innerHTML = '<div class="lzvt-empty">Make one row for each ' +
                (hasColors && hasSizes ? "colour and size (" + st.colors.length + " &times; " + st.sizes.length + " = " + expected + " rows)"
                    : hasColors ? "colour (" + expected + " rows)" : "size (" + expected + " rows)") +
                ", then fill in price, stock and SKU.</div><div class=\"lzvt-bar\">" + genBtn + "</div>" +
                '<div class="lzvt-msg' + (bad ? " lzvt-bad" : "") + '" aria-live="polite">' + esc(message || "") + "</div>";
            wire(host);
            return;
        }

        const isVendor = st.mode === "vendor";
        const priceHead = isVendor ? "Your payout (UGX)" : "Price (UGX)";
        const html = rows.map((v) => {
            const c = colorById[v.color_id], z = sizeById[v.size_id];
            const vp = st.vendorPrices[v.id];
            const own = isVendor
                ? (vp && vp.vendor_payout != null ? Number(vp.vendor_payout) : "")
                : (v.own_price ? Number(v.price) : "");
            const photo = c && c.image_path ? '<img class="lzvt-photo" src="' + esc(c.image_path) + '" alt="">' : '<span class="lzvt-nophoto">No photo</span>';
            return "<tr data-id=\"" + v.id + "\">" +
                (hasColors ? '<td data-label="Colour">' + (c
                    ? '<span class="lzvt-colour"><span class="lzvt-dot' + (c.hex ? "" : " lzvt-nohex") + '"' + (c.hex ? ' style="background:' + esc(c.hex) + '"' : "") + "></span>" + esc(c.name) + "</span>"
                    : "&mdash;") + "</td>" : "") +
                (hasSizes ? '<td data-label="Size">' + (z ? esc(z.name) : "&mdash;") + "</td>" : "") +
                '<td data-label="' + priceHead + '"><input type="number" min="1" step="1" class="lzvt-price" data-orig="' + esc(own) + '" value="' + esc(own) +
                    '" placeholder="' + (isVendor ? "Product payout" : esc(Number(st.productPrice || v.price || 0).toLocaleString())) + '">' +
                    (isVendor && vp ? '<div class="lzvt-cust">Customer pays ' + money(vp.price || vp.product_price) + "</div>" : "") + "</td>" +
                '<td data-label="Stock"><input type="number" min="0" step="1" class="lzvt-num lzvt-stock" value="' + (Number(v.stock) || 0) + '"></td>' +
                '<td data-label="SKU"><input type="text" class="lzvt-sku" maxlength="64" data-orig="' + esc(v.sku || "") + '" value="' + esc(v.sku || "") + '" placeholder="Optional"></td>' +
                (hasColors ? '<td data-label="Photo">' + photo + "</td>" : "") +
            "</tr>";
        }).join("");
        const inStock = rows.filter((v) => Number(v.stock) > 0).length;
        const total = rows.reduce((n, v) => n + (Number(v.stock) || 0), 0);

        body.innerHTML =
            '<div class="lzvt-wrap"><table><thead><tr>' +
                (hasColors ? "<th>Colour</th>" : "") + (hasSizes ? "<th>Size</th>" : "") +
                "<th>" + priceHead + "</th><th>Stock</th><th>SKU</th>" + (hasColors ? "<th>Photo</th>" : "") +
            "</tr></thead><tbody>" + html + "</tbody></table></div>" +
            '<div class="lzvt-foot">' + rows.length + " rows, " + inStock + " with stock (" + total + " units). " +
                (isVendor ? "Leave a payout blank to sell that row at your product payout." : "Leave a price blank to sell that row at the product price.") +
                (hasColors ? " A colour's photo is the first photo you linked to it." : "") + "</div>" +
            '<div class="lzvt-bar">' +
                '<button type="button" class="lzvt-save">Save variants</button>' +
                (rows.length < expected ? genBtn : "") +
                '<label class="lzvt-mode"><input type="checkbox" class="lzvt-use"' + (st.stockEnabled ? " checked" : "") + "> Use these stock numbers on the store</label>" +
            "</div>" +
            '<div class="lzvt-msg' + (bad ? " lzvt-bad" : "") + '" aria-live="polite">' + esc(message || "") + "</div>";
        wire(host);
    }

    function wire(host) {
        const st = host._lzvt;
        const say = (t, bad) => {
            const m = host.querySelector(".lzvt-msg");
            if (m) { m.textContent = t || ""; m.classList.toggle("lzvt-bad", !!bad); }
        };
        const gen = host.querySelector(".lzvt-gen");
        if (gen) gen.onclick = async () => {
            say("Making the table...");
            try {
                const d = await st.api(base(st) + "/variants/generate", { method: "POST" });
                if (d && d.error) { say(d.error, true); return; }
                await reload(host);
                draw(host, (d.created || 0) + " rows added.");
            } catch (e) { say(e.message || "Could not make the table.", true); }
        };
        const save = host.querySelector(".lzvt-save");
        if (save) save.onclick = async () => {
            const updates = [];
            let problem = null;
            host.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
                const u = { variant_id: Number(tr.dataset.id), stock: Number(tr.querySelector(".lzvt-stock").value) };
                if (!Number.isInteger(u.stock) || u.stock < 0) problem = "Stock must be a whole number, 0 or more.";
                const p = tr.querySelector(".lzvt-price");
                if (p.value.trim() !== (p.dataset.orig || "")) {
                    const val = p.value.trim() === "" ? null : Number(p.value);
                    if (val !== null && !(val > 0)) problem = "A price must be more than 0, or left blank.";
                    if (st.mode === "vendor") u.payout = val; else u.price = val;
                }
                const s = tr.querySelector(".lzvt-sku");
                if (s.value.trim().toUpperCase() !== (s.dataset.orig || "").toUpperCase()) u.sku = s.value.trim();
                updates.push(u);
            });
            if (problem) { say(problem, true); return; }
            say("Saving...");
            try {
                const d = await st.api(base(st) + "/variants/stock", {
                    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates })
                });
                if (d && d.error) { say(d.error, true); return; }
                await reload(host);
                draw(host, "Saved. " + d.in_stock + " of " + d.total + " rows have stock (" + d.total_stock + " units).");
            } catch (e) { say(e.message || "Could not save the variants.", true); }
        };
        const use = host.querySelector(".lzvt-use");
        if (use) use.onchange = async () => {
            const target = use.checked;
            try {
                const d = await st.api(base(st) + "/variant-stock", {
                    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: target })
                });
                if (d && d.error) { use.checked = !target; say(d.error, true); return; }
                st.stockEnabled = !!d.variant_stock_enabled;
                say(st.stockEnabled ? "The store now uses each row's stock." : "The store now uses the product's Stock figure.");
                if (typeof st.onModeChange === "function") st.onModeChange(st.stockEnabled);
            } catch (e) { use.checked = !target; say(e.message || "Could not change this.", true); }
        };
    }

    function mount(host, opts) {
        if (!host) return;
        ensureStyle();
        host._lzvt = Object.assign({ mode: "admin", colors: [], sizes: [], variants: [], vendorPrices: {} }, opts || {});
        host.innerHTML = '<div class="lzvt"><div class="lzvt-body"></div></div>';
        if (!host._lzvt.productId) {
            host.querySelector(".lzvt-body").innerHTML =
                '<div class="lzvt-empty">Choose colours or sizes above, then press <strong>Save as Draft</strong> - the table of prices, stock and SKUs appears here.</div>';
            return;
        }
        reload(host);
    }

    window.LzVariantsTable = { mount, reload };
})();
