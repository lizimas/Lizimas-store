// "Preview" on the Add / Edit Product forms (Sept 2026): shows the product
// the way customers will see it - photos, name, price with the "Was" price,
// warranty, stock, colours, sizes, description (with its photo/text blocks)
// and specifications - straight from what is typed in the form, before it is
// saved. Nothing is sent anywhere.
//
//   LzProductPreview.open({ name, brand, price, was, warrantyMonths, stock,
//       photos: [url], colors: [{name, hex}], sizes: [name], description,
//       specs: [{label, value}], official: bool, sellerName })
(function () {
    "use strict";

    const STYLE_ID = "lzpp-style";
    const CSS = `
.lzpp-back { position: fixed; inset: 0; background: rgba(15,23,42,.55); z-index: 100000; display: flex; align-items: flex-start;
    justify-content: center; overflow-y: auto; padding: 24px 12px; }
.lzpp { background: #f1f2f4; width: min(1100px, 100%); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3); overflow: hidden; font-family: inherit; }
.lzpp-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #1a1a2e; color: #fff; padding: 12px 16px; }
.lzpp-top strong { font-size: 15px; }
.lzpp-top span { font-size: 12px; color: #cbd5e1; }
.lzpp-close { background: #f4b400; color: #1a1a2e; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer; font-family: inherit; }
.lzpp-body { padding: 16px; display: grid; gap: 16px; }
.lzpp-card { background: #fff; border-radius: 12px; padding: 18px; }
.lzpp-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
@media (min-width: 760px) { .lzpp-main { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); } }
.lzpp-photo { aspect-ratio: 1 / 1; background: #f6f7f9; border-radius: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.lzpp-photo img { width: 100%; height: 100%; object-fit: contain; }
.lzpp-nophoto { color: #9ca3af; font-size: 13px; }
.lzpp-thumbs { display: flex; gap: 8px; margin-top: 10px; overflow-x: auto; }
.lzpp-thumbs button { flex: 0 0 60px; height: 60px; border: 2px solid #e5e7eb; border-radius: 8px; padding: 0; overflow: hidden; background: #fff; cursor: pointer; }
.lzpp-thumbs button.on { border-color: #1a1a2e; }
.lzpp-thumbs img { width: 100%; height: 100%; object-fit: cover; }
.lzpp-badge { display: inline-block; background: #1a1a2e; color: #fff; font-size: 11.5px; font-weight: 700; padding: 3px 8px; border-radius: 4px; }
.lzpp h2 { font-size: 22px; margin: 8px 0 6px; color: #111827; line-height: 1.3; }
.lzpp-brand { font-size: 13.5px; color: #4b5563; }
.lzpp-price-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 12px; margin: 14px 0 6px; }
.lzpp-price { font-size: 26px; font-weight: 800; color: #16a34a; }
.lzpp-was { color: #9ca3af; font-size: 15px; }
.lzpp-off { background: #fff4d6; color: #a86b00; font-weight: 700; font-size: 13px; padding: 2px 8px; border-radius: 4px; }
.lzpp-warranty { color: #2c7a4b; font-size: 13.5px; }
.lzpp-stock { font-size: 13px; color: #4b5563; margin: 4px 0 12px; }
.lzpp-stock.out { color: #c0392b; font-weight: 700; }
.lzpp-label { font-size: 14px; font-weight: 600; color: #333; margin: 12px 0 8px; }
.lzpp-dots { display: flex; flex-wrap: wrap; gap: 10px; }
.lzpp-dot { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11.5px; color: #4b5563; }
.lzpp-dot span { width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(0,0,0,.18); }
.lzpp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px; }
.lzpp-tile { border: 1.5px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
.lzpp-tile.on { border: 2px solid #111827; }
.lzpp-tile-media { aspect-ratio: 1 / 1; background: #f6f7f9; display: block; }
.lzpp-tile-media img, .lzpp-tile-media span { width: 100%; height: 100%; object-fit: cover; display: block; }
.lzpp-tile-name { font-size: 12.5px; font-weight: 600; text-align: center; padding: 6px 4px; color: #1f2937; }
.lzpp-sizes { display: flex; flex-wrap: wrap; gap: 8px; }
.lzpp-sizes span { padding: 7px 14px; border: 1px solid #ccc; border-radius: 20px; font-size: 13px; }
.lzpp-cart { margin-top: 16px; width: 100%; padding: 13px; background: #f4b400; color: #1a1a2e; border: 0; border-radius: 8px; font-size: 15px; font-weight: 700; }
.lzpp h3 { font-size: 18px; margin: 0 0 12px; border-left: 4px solid #1a1a2e; padding-left: 10px; color: #111827; }
.lzpp-desc { white-space: pre-line; line-height: 1.6; font-size: 14.5px; color: #1f2937; }
.lzpp-specs { width: 100%; border-collapse: collapse; font-size: 14px; }
.lzpp-specs td { padding: 8px 0; border-bottom: 1px solid #eee; }
.lzpp-specs td:first-child { color: #666; width: 40%; }
.lzpp-empty { color: #9ca3af; font-size: 13px; }`;

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
    const ugx = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString();

    function open(d) {
        ensureStyle();
        d = d || {};
        const photos = (d.photos || []).filter(Boolean);
        const specs = (d.specs || []).filter((s) => s && String(s.label || "").trim() && String(s.value || "").trim());
        const was = Number(d.was) > Number(d.price) ? Number(d.was) : 0;
        const months = Number(d.warrantyMonths) || 0;
        let stockLine = "";
        if (d.stock !== null && d.stock !== undefined && !Number.isNaN(d.stock)) {
            stockLine = d.stock <= 0 ? '<div class="lzpp-stock out">Out of stock</div>'
                : '<div class="lzpp-stock">' + (d.stock <= 20 ? d.stock + (d.stock === 1 ? " item" : " items") + " in stock" : "In stock") + "</div>";
        }

        const back = document.createElement("div");
        back.className = "lzpp-back";
        back.setAttribute("role", "dialog");
        back.setAttribute("aria-modal", "true");
        back.setAttribute("aria-label", "Product preview");
        back.innerHTML =
            '<div class="lzpp">' +
                '<div class="lzpp-top"><div><strong>Preview</strong> <span>&mdash; how customers will see this product (not saved)</span></div>' +
                    '<button type="button" class="lzpp-close">Close preview</button></div>' +
                '<div class="lzpp-body">' +
                    '<div class="lzpp-card lzpp-main">' +
                        "<div>" +
                            '<div class="lzpp-photo">' + (photos.length ? '<img src="' + esc(photos[0]) + '" alt="">' : '<span class="lzpp-nophoto">No photos yet</span>') + "</div>" +
                            (photos.length > 1 ? '<div class="lzpp-thumbs">' + photos.map((p, i) =>
                                '<button type="button" class="' + (i === 0 ? "on" : "") + '" data-i="' + i + '"><img src="' + esc(p) + '" alt=""></button>').join("") + "</div>" : "") +
                        "</div>" +
                        "<div>" +
                            (d.official ? '<span class="lzpp-badge">Official Store</span>' : "") +
                            "<h2>" + esc(d.name || "Product name") + "</h2>" +
                            (d.brand ? '<div class="lzpp-brand">Brand: <strong>' + esc(d.brand) + "</strong></div>" : "") +
                            '<div class="lzpp-price-row"><span class="lzpp-price">' + (d.price ? ugx(d.price) : "Price not set") + "</span>" +
                                (was ? '<s class="lzpp-was">' + ugx(was) + '</s><span class="lzpp-off">-' + Math.round((1 - d.price / was) * 100) + "%</span>" : "") +
                                (months ? '<span class="lzpp-warranty">&#128737; ' + months + (months === 1 ? " Month" : " Months") + " Manufacturer Warranty</span>" : "") +
                            "</div>" + stockLine +
                            ((d.colors || []).length ? '<div class="lzpp-label">Color: <strong>' + esc(d.colors[0].name) + '</strong></div><div class="lzpp-tiles">' + d.colors.map((c, i) =>
                                '<span class="lzpp-tile' + (i === 0 ? " on" : "") + '"><span class="lzpp-tile-media">' +
                                    (c.photo ? '<img src="' + esc(c.photo) + '" alt="">' : '<span style="background:' + esc(c.hex || "#e5e7eb") + '"></span>') +
                                '</span><span class="lzpp-tile-name">' + esc(c.name) + "</span></span>").join("") + "</div>" : "") +
                            ((d.sizes || []).length ? '<div class="lzpp-label">Size</div><div class="lzpp-sizes">' + d.sizes.map((z) => "<span>" + esc(z) + "</span>").join("") + "</div>" : "") +
                            '<button type="button" class="lzpp-cart" disabled>Add To Cart</button>' +
                        "</div>" +
                    "</div>" +
                    '<div class="lzpp-card"><h3>Product Description</h3>' +
                        '<div class="lzpp-blocks pd-desc-blocks"></div>' +
                        (d.description ? '<div class="lzpp-desc">' + esc(d.description) + "</div>" : "") +
                    "</div>" +
                    '<div class="lzpp-card"><h3>Specifications</h3>' + (specs.length
                        ? '<table class="lzpp-specs">' + specs.map((r) => "<tr><td>" + esc(r.label) + "</td><td>" + esc(r.value) + "</td></tr>").join("") + "</table>"
                        : '<p class="lzpp-empty">No specifications yet.</p>') + "</div>" +
                "</div>" +
            "</div>";
        document.body.appendChild(back);

        // Description photo/text blocks, drawn by the storefront's own renderer.
        const blocks = window.LzBlockEditor && Array.isArray(window.LzBlockEditor.blocks) ? window.LzBlockEditor.blocks : [];
        const mount = back.querySelector(".lzpp-blocks");
        if (blocks.length && window.LzDescBlocks) {
            try { window.LzDescBlocks.render(mount, JSON.parse(JSON.stringify(blocks))); } catch (e) { console.warn("Preview blocks:", e); }
        }
        if (!blocks.length && !d.description) mount.innerHTML = '<p class="lzpp-empty">No description yet.</p>';

        const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
        const onKey = (e) => { if (e.key === "Escape") close(); };
        back.querySelector(".lzpp-close").onclick = close;
        back.addEventListener("click", (e) => {
            if (e.target === back) close();
            const t = e.target.closest(".lzpp-thumbs button");
            if (t) {
                back.querySelector(".lzpp-photo img").src = photos[Number(t.dataset.i)];
                back.querySelectorAll(".lzpp-thumbs button").forEach((b) => b.classList.toggle("on", b === t));
            }
        });
        document.addEventListener("keydown", onKey);
        back.querySelector(".lzpp-close").focus();
    }

    window.LzProductPreview = { open };
})();
