// Read-only product view for the admin panel (Ryan, Sept 2026).
//
// Opens a submitted product exactly the way the submitter filled in the
// product form - same sections, same labels, same order - with every value
// shown but nothing editable: name, SKU, category, description, description
// blocks, payout and customer price, stock, packed weight and size, brand,
// warranty, GTIN, MPN, all photos, specifications, colours, sizes, each
// variant's stock and price, and the authenticity confirmation.
// Data: GET /api/admin/products/:id/full (productController.getProductFullView).
(function () {
    "use strict";

    const esc = (v) => String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
    const ugx = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString();
    const num = (n) => has(n) ? String(Number(n)) : "";

    const LABEL = "font-size:13px; font-weight:600; color:#333;";
    const HINT = "font-weight:400; color:#888;";

    function field(label, value, opts) {
        opts = opts || {};
        const shown = has(value)
            ? `<div class="apv-value${opts.multiline ? " apv-multiline" : ""}">${esc(value)}</div>`
            : `<div class="apv-value apv-empty">${esc(opts.empty || "Not provided")}</div>`;
        return `<div${opts.flex ? ' style="flex:1; min-width:0;"' : ""}>
            <label style="${LABEL}">${label}</label>
            ${shown}
        </div>`;
    }

    function statusBadge(p) {
        const map = {
            pending: ["Awaiting approval", "#FEF3C7", "#92400E"],
            approved: ["Approved", "#DCFCE7", "#166534"],
            rejected: ["Rejected", "#FEE2E2", "#991B1B"]
        };
        const s = map[p.status] || [p.status || "-", "#E5E7EB", "#374151"];
        return `<span class="apv-badge" style="background:${s[1]}; color:${s[2]};">${esc(s[0])}</span>`;
    }

    function basicSection(d) {
        const p = d.product;
        return `<div class="product-form-section">
            <h4>Basic Information</h4>
            <div class="field-row">
                ${field("Product Name", p.name)}
                ${field(`SKU <span style="${HINT}">(seller's own stock code, optional)</span>`, p.sku)}
                ${field("Category", d.category_path.join(" › "), { empty: "No category chosen" })}
                ${field("Description", p.description, { multiline: true, empty: "No description provided" })}
            </div>
            <div style="margin-top:14px;">
                <label style="${LABEL} display:block; margin-bottom:4px;">Rich Content <span style="${HINT}">(description blocks shown below the description on the product page)</span></label>
                <div id="apv-blocks" class="apv-blocks-frame">${d.blocks.length ? "" : '<div class="apv-value apv-empty">No description blocks added</div>'}</div>
            </div>
        </div>`;
    }

    function pricingSection(d) {
        const p = d.product;
        const isVendor = !!p.vendor_id;
        const rate = has(p.commission_rate_applied) ? Math.round(Number(p.commission_rate_applied) * 1000) / 10 : null;
        const variantStock = p.variant_stock_enabled === true;
        const firstRow = isVendor
            ? `${field(`Your Payout (UGX) <span style="${HINT}">(what the seller earns per unit)</span>`, has(p.vendor_desired_payout) ? Number(p.vendor_desired_payout).toLocaleString() : "", { flex: true })}
               ${field("Stock", has(p.stock) ? String(p.stock) : "", { flex: true })}`
            : `${field("Price (UGX)", has(p.price) ? Number(p.price).toLocaleString() : "", { flex: true })}
               ${field("Stock", has(p.stock) ? String(p.stock) : "", { flex: true })}`;
        const preview = isVendor && has(p.price) ? `<div class="apv-pricing">
                <div style="font-size:15px; font-weight:700;">Customer pays: ${ugx(p.price)}</div>
                <div style="margin-top:4px; color:#555;">Seller receives: ${has(p.vendor_desired_payout) ? ugx(p.vendor_desired_payout) : "-"}${rate !== null ? ` &middot; commission ${rate}%` : ""}${Number(p.fixed_fee_applied) > 0 ? ` + fixed fee ${ugx(p.fixed_fee_applied)}` : ""}</div>
            </div>` : "";
        const packVal = (v) => has(v) ? `<div class="apv-value">${esc(num(v))}</div>` : `<div class="apv-value apv-empty">-</div>`;
        return `<div class="product-form-section">
            <h4>Pricing &amp; Inventory</h4>
            <div class="field-row">
                <div style="display:flex; gap:12px;">${firstRow}</div>
                ${variantStock ? '<p class="apv-note">Variant stock is on: the storefront uses each variant\'s own quantity (see Variants below).</p>' : ""}
                ${preview}
                <div>
                    <div class="lz-pack">
                        <div class="lz-pack-title">Packed weight &amp; size</div>
                        <div class="lz-pack-grid">
                            <label class="lz-pack-field"><span>Weight (kg) *</span>${packVal(p.weight_kg)}</label>
                            <label class="lz-pack-field"><span>Length (cm)</span>${packVal(p.length_cm)}</label>
                            <label class="lz-pack-field"><span>Width (cm)</span>${packVal(p.width_cm)}</label>
                            <label class="lz-pack-field"><span>Height (cm)</span>${packVal(p.height_cm)}</label>
                        </div>
                        ${has(p.package_size) ? `<p class="lz-pack-note">Delivery size worked out from these: <strong>${esc(p.package_size)}</strong></p>` : ""}
                    </div>
                </div>
                <div style="display:flex; gap:12px;">
                    ${field(`Brand <span style="${HINT}">(if applicable)</span>`, p.brand, { flex: true })}
                    ${field("Warranty (months)", has(p.warranty_months) ? String(p.warranty_months) : "", { flex: true, empty: "None" })}
                </div>
                <div style="display:flex; gap:12px;">
                    ${field(`GTIN <span style="${HINT}">(barcode, optional)</span>`, p.gtin, { flex: true })}
                    ${field(`MPN <span style="${HINT}">(manufacturer part no., optional)</span>`, p.mpn, { flex: true })}
                </div>
            </div>
        </div>`;
    }

    function imagesSection(d) {
        const p = d.product;
        const colourName = {};
        d.colors.forEach((c) => { colourName[c.id] = c.name; });
        let imgs = d.images.map((im) => ({ src: im.image_path, colour: colourName[im.color_id] }));
        if (!imgs.length) imgs = [p.image, p.card_image, p.hover_image].filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i).map((src) => ({ src }));
        d._photos = imgs.map((im, i) => ({ type: "image", src: im.src, label: `Photo ${i + 1}${i === 0 ? " (main)" : ""}${im.colour ? " - " + im.colour : ""}` }));
        const grid = imgs.length
            ? `<div class="drag-drop-preview-grid apv-images">${imgs.map((im, i) => `
                <button type="button" class="apv-img" data-apv-open="${i}" title="View photo ${i + 1}">
                    <img src="${esc(im.src)}" alt="Photo ${i + 1}" loading="lazy">
                    ${i === 0 ? '<span class="apv-img-tag">Main</span>' : ""}
                    ${im.colour ? `<span class="apv-img-colour">${esc(im.colour)}</span>` : ""}
                </button>`).join("")}</div>`
            : '<div class="apv-value apv-empty">No photos uploaded</div>';
        return `<div class="product-form-section">
            <h4>Images</h4>
            <div class="field-row">
                <div>
                    <label style="${LABEL}">Photos <span style="${HINT}">(${imgs.length} uploaded &middot; click a photo to view, download or share it)</span></label>
                    ${grid}
                    ${imgs.length ? '<div class="apv-media-actions"><button type="button" class="apv-btn apv-plain" data-apv-dlall>Download all photos</button></div>' : ""}
                </div>
            </div>
        </div>`;
    }

    function specsSection(d) {
        const rows = d.specs.filter((s) => has(s.label) || has(s.value));
        return `<div class="product-form-section">
            <h4>Specifications</h4>
            ${rows.length ? `<div class="apv-specs">${rows.map((s) => `
                <div class="apv-spec-row">
                    <div class="apv-value">${esc(s.label)}</div>
                    <div class="apv-value">${esc(s.value)}</div>
                </div>`).join("")}</div>` : '<div class="apv-value apv-empty">No specifications added</div>'}
        </div>`;
    }

    function variantsSection(d) {
        const p = d.product;
        if (!d.colors.length && !d.sizes.length && !d.variants.length) {
            return `<div class="product-form-section"><h4>Variants</h4><div class="apv-value apv-empty">No colours or sizes - this product is sold as a single item</div></div>`;
        }
        const colourName = {}; d.colors.forEach((c) => { colourName[c.id] = c.name; });
        const sizeName = {}; d.sizes.forEach((s) => { sizeName[s.id] = s.name; });
        const isVendor = !!p.vendor_id;
        const table = d.variants.length ? `<div class="apv-table-wrap"><table class="apv-table">
            <thead><tr><th>Colour</th><th>Size</th>${d.variants.some((v) => v.variant_name && v.color_id == null && v.size_id == null) ? "<th>Option</th>" : ""}<th>Stock</th>${isVendor ? "<th>Seller payout</th>" : ""}<th>Customer price</th></tr></thead>
            <tbody>${d.variants.map((v) => {
                const own = has(v.vendor_payout) || (has(v.price) && Number(v.price) !== Number(p.price));
                return `<tr>
                    <td>${esc(colourName[v.color_id] || "-")}</td>
                    <td>${esc(sizeName[v.size_id] || "-")}</td>
                    ${d.variants.some((x) => x.variant_name && x.color_id == null && x.size_id == null) ? `<td>${esc(v.color_id == null && v.size_id == null ? v.variant_name : "-")}</td>` : ""}
                    <td>${esc(v.stock)}</td>
                    ${isVendor ? `<td>${has(v.vendor_payout) ? ugx(v.vendor_payout) : '<span class="apv-muted">Same as product</span>'}</td>` : ""}
                    <td>${has(v.price) ? ugx(v.price) : "-"}${own ? ' <span class="apv-own">own price</span>' : ""}</td>
                </tr>`;
            }).join("")}</tbody></table></div>` : '<div class="apv-value apv-empty">Colours/sizes saved but no variant rows generated yet</div>';
        return `<div class="product-form-section">
            <h4>Variants <span style="${HINT} font-size:12px;">(colours/sizes with their own stock counts)</span></h4>
            <div class="field-row">
                <div style="display:flex; gap:12px;">
                    ${field(`Colours <span style="${HINT}">(comma-separated)</span>`, d.colors.map((c) => c.name).join(", "), { flex: true, empty: "None" })}
                    ${field(`Sizes <span style="${HINT}">(comma-separated)</span>`, d.sizes.map((s) => s.name).join(", "), { flex: true, empty: "None" })}
                </div>
                <p class="apv-note">Mode: <strong style="color:${p.variant_stock_enabled ? "#166534" : "#B45309"};">${p.variant_stock_enabled ? "Variant stock active" : "Simple stock (the Stock field above)"}</strong></p>
                ${table}
            </div>
        </div>`;
    }

    function authenticity(d) {
        if (!d.product.vendor_id) return "";
        return `<label class="apv-auth">
            <input type="checkbox" checked disabled>
            <span>The seller confirmed this product is authentic, accurately described, and that they can provide invoices/supplier documentation if Lizimas Store requests proof of authenticity (required to submit).</span>
        </label>`;
    }

    function footer(d) {
        const p = d.product;
        if (p.vendor_id) {
            return `<div class="apv-edit-row">
                <button type="button" class="apv-btn apv-save" disabled title="Vendor products are view-only for admin">Save changes</button>
                <span class="apv-muted">Vendor products are view-only - admin can approve, reject or restrict them, but only the vendor can change them.</span>
            </div>`;
        }
        return `<div class="apv-edit-row">
            <button type="button" class="apv-btn apv-edit" data-apv-edit>Edit product</button>
            <span class="apv-muted">Staff product - you can edit and save it.</span>
        </div>`;
    }


    // --- Product Approval layout (Sept 2026) -------------------------------
    function descriptionSection(d) {
        const p = d.product;
        return `<section class="pr-sec" id="pr-description">
            <h4>4. Description</h4>
            ${field("Description", p.description, { multiline: true, empty: "No description provided" })}
            <div style="margin-top:14px;">
                <label style="${LABEL} display:block; margin-bottom:4px;">Rich content <span style="${HINT}">(blocks shown below the description on the product page)</span></label>
                <div id="apv-blocks" class="apv-blocks-frame">${d.blocks.length ? "" : '<div class="apv-value apv-empty">No description blocks added</div>'}</div>
            </div>
        </section>`;
    }

    function specsReview(d) {
        const p = d.product;
        const attrs = [["Brand", p.brand], ["Material", p.material], ["Colour", p.color], ["Model", p.model], ["Origin", p.origin],
            ["Product weight", has(p.product_weight_kg) ? num(p.product_weight_kg) + " kg" : ""],
            ["Warranty", has(p.warranty_months) ? p.warranty_months + " months" : ""], ["GTIN / barcode", p.gtin], ["MPN", p.mpn]]
            .filter(([, v]) => has(v));
        const rows = attrs.map(([k, v]) => ({ label: k, value: v })).concat(d.specs.filter((x) => has(x.label) || has(x.value)));
        const missing = ["Material", "Colour"].filter((k) => !attrs.some(([a]) => a === k) && !d.specs.some((x) => String(x.label).toLowerCase() === k.toLowerCase()));
        return `<section class="pr-sec" id="pr-specs">
            <h4>5. Specifications</h4>
            ${rows.length ? `<div class="apv-specs">${rows.map((x) => `
                <div class="apv-spec-row"><div class="apv-value">${esc(x.label)}</div><div class="apv-value">${esc(x.value)}</div></div>`).join("")}</div>`
                : '<div class="apv-value apv-empty">No specifications added</div>'}
            ${missing.length ? `<p class="apv-note" style="margin-top:8px;">Not filled in: ${esc(missing.join(", "))}</p>` : ""}
        </section>`;
    }

    function stockSection(d) {
        const p = d.product;
        const packVal = (v) => has(v) ? `<div class="apv-value">${esc(num(v))}</div>` : `<div class="apv-value apv-empty">-</div>`;
        const v = variantsSection(d).replace('<div class="product-form-section">', "<div>").replace(/<h4>Variants[\s\S]*?<\/h4>/, "");
        return `<section class="pr-sec" id="pr-stock">
            <h4>6. Stock &amp; variants</h4>
            <div style="display:flex; gap:12px; flex-wrap:wrap;">
                ${field("Quantity available", has(p.stock) ? String(p.stock) : "", { flex: true })}
                ${field("Fulfilment", p.fulfillment_type ? String(p.fulfillment_type).replace(/_/g, " ") : "", { flex: true })}
            </div>
            <div class="lz-pack" style="margin-top:12px;">
                <div class="lz-pack-title">Packed weight &amp; size</div>
                <div class="lz-pack-grid">
                    <label class="lz-pack-field"><span>Weight (kg)</span>${packVal(p.weight_kg)}</label>
                    <label class="lz-pack-field"><span>Length (cm)</span>${packVal(p.length_cm)}</label>
                    <label class="lz-pack-field"><span>Width (cm)</span>${packVal(p.width_cm)}</label>
                    <label class="lz-pack-field"><span>Height (cm)</span>${packVal(p.height_cm)}</label>
                </div>
                ${has(p.package_size) ? `<p class="lz-pack-note">Delivery size: <strong>${esc(p.package_size)}</strong></p>` : ""}
            </div>
            <div style="margin-top:12px;">${v}</div>
        </section>`;
    }

    // --- Photo viewer ------------------------------------------------------
    function cloudinaryAttachment(url) {
        return /res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace("/upload/", "/upload/fl_attachment/") : null;
    }
    function fileName(item, i, productName) {
        const base = String(productName || "product").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "product";
        const ext = (String(item.src).split("?")[0].match(/\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i) || [, item.type === "video" ? "mp4" : "jpg"])[1];
        return `${base}-${item.type === "video" ? "video" : "photo"}-${i + 1}.${ext}`;
    }
    async function downloadItem(item, i, productName) {
        const name = fileName(item, i, productName);
        const direct = cloudinaryAttachment(item.src);
        try {
            if (direct) {
                const a = document.createElement("a"); a.href = direct; a.download = name; a.rel = "noopener";
                document.body.appendChild(a); a.click(); a.remove(); return;
            }
            const r = await fetch(item.src, { mode: "cors" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement("a"); a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (e) {
            window.open(item.src, "_blank", "noopener");
        }
    }
    async function shareItem(item, title, note) {
        try {
            if (navigator.share) { await navigator.share({ title, text: title, url: item.src }); return; }
        } catch (e) { if (e && e.name === "AbortError") return; }
        try { await navigator.clipboard.writeText(item.src); note("Link copied - paste it wherever you need it."); }
        catch (e) { window.prompt("Copy this link:", item.src); }
    }

    function openViewer(items, start, productName) {
        if (!items.length) return;
        let i = Math.max(0, Math.min(items.length - 1, start));
        const v = document.createElement("div");
        v.className = "apv-viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", "Photo viewer");
        v.innerHTML = `
            <div class="apv-viewer-top">
                <span class="apv-viewer-count"></span>
                <div class="apv-viewer-actions">
                    <button type="button" class="apv-btn apv-plain" data-v="download">Download</button>
                    <button type="button" class="apv-btn apv-plain" data-v="share">Share</button>
                    <button type="button" class="apv-close" data-v="close" aria-label="Close viewer">&times;</button>
                </div>
            </div>
            <div class="apv-viewer-stage">
                <button type="button" class="apv-nav apv-prev" data-v="prev" aria-label="Previous">&#8249;</button>
                <div class="apv-viewer-media"></div>
                <button type="button" class="apv-nav apv-next" data-v="next" aria-label="Next">&#8250;</button>
            </div>
            <div class="apv-viewer-caption"></div>
            <div class="apv-viewer-note" aria-live="polite"></div>`;
        document.body.appendChild(v);
        const media = v.querySelector(".apv-viewer-media");
        const note = (t) => { const n = v.querySelector(".apv-viewer-note"); n.textContent = t; setTimeout(() => { n.textContent = ""; }, 3000); };
        function show() {
            const it = items[i];
            media.innerHTML = it.type === "video"
                ? `<video src="${esc(it.src)}" controls playsinline></video>`
                : `<img src="${esc(it.src)}" alt="${esc(it.label)}">`;
            v.querySelector(".apv-viewer-count").textContent = `${i + 1} / ${items.length}`;
            v.querySelector(".apv-viewer-caption").textContent = it.label || "";
            v.querySelector(".apv-prev").disabled = items.length < 2;
            v.querySelector(".apv-next").disabled = items.length < 2;
        }
        const go = (step) => { i = (i + step + items.length) % items.length; show(); };
        const shut = () => { v.remove(); document.removeEventListener("keydown", key, true); };
        function key(e) {
            if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
            else if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
            else if (e.key === "Escape") { shut(); e.stopPropagation(); e.preventDefault(); }
        }
        document.addEventListener("keydown", key, true);
        v.addEventListener("click", (e) => {
            const b = e.target.closest("[data-v]");
            if (!b) { if (e.target === v || e.target.classList.contains("apv-viewer-stage")) shut(); return; }
            const a = b.dataset.v;
            if (a === "next") go(1); else if (a === "prev") go(-1); else if (a === "close") shut();
            else if (a === "download") downloadItem(items[i], i, productName);
            else if (a === "share") shareItem(items[i], `${productName} - ${items[i].label}`, note);
        });
        let x0 = null;
        v.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        v.addEventListener("touchend", (e) => {
            if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        });
        show();
        v.querySelector('[data-v="next"]').focus();
    }

    function close() {
        const el = document.getElementById("apv-overlay");
        if (el) el.remove();
        document.querySelectorAll(".apv-viewer").forEach((x) => x.remove());
        document.body.classList.remove("apv-open");
        document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    async function open(id, opts) {
        opts = opts || {};
        close();
        const overlay = document.createElement("div");
        overlay.id = "apv-overlay";
        overlay.className = "apv-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.innerHTML = `<div class="apv-bar"><div class="apv-bar-title">Loading product&hellip;</div><button type="button" class="apv-close" aria-label="Close">&times;</button></div><div class="apv-body"><div class="apv-loading">Loading&hellip;</div></div>`;
        document.body.appendChild(overlay);
        document.body.classList.add("apv-open");
        overlay.querySelector(".apv-close").onclick = close;
        document.addEventListener("keydown", onKey);

        let d;
        try {
            d = await authorizedFetch(`/api/admin/products/${encodeURIComponent(id)}/full`);
        } catch (e) { d = { error: "Could not connect to server." }; }
        if (!document.getElementById("apv-overlay")) return;
        if (!d || d.error || !d.product) {
            overlay.querySelector(".apv-body").innerHTML = `<div class="apv-loading">${esc((d && d.error) || "Could not load this product.")}</div>`;
            return;
        }
        const p = d.product;
        let r = null, m = null;
        if (window.LzReview) {
            try { [r, m] = await Promise.all([authorizedFetch(`/api/admin/product-reviews/${encodeURIComponent(id)}`), window.LzReview.meta()]); }
            catch (e) { r = null; }
            if (r && r.error) r = null;
            if (!document.getElementById("apv-overlay")) return;
        }
        const reopen = (anchor) => open(id, Object.assign({}, opts, { anchor }));

        if (r && m) {
            r._created = p.created_at;
            const L = window.LzReview;
            const nav = [["pr-overview", "Overview"], ["pr-images", "Images"], ["pr-pricing", "Pricing"], ["pr-description", "Description"],
                ["pr-specs", "Specs"], ["pr-stock", "Stock"], ["pr-seller", "Seller"], ["pr-compliance", "Checks"], ["pr-notes", "Notes"],
                ["pr-history", "History"], ["pr-decide", "Decision"]];
            overlay.innerHTML = `
                <div class="apv-bar">
                    <div class="apv-bar-title"><span class="pr-bar-label">Product Approval</span> ${L.badge(p.status, r.status_label)}</div>
                    <div class="apv-bar-actions"><a href="#pr-decide" class="pr-btn pr-gold pr-jump">Decide</a><button type="button" class="apv-close" aria-label="Close">&times;</button></div>
                </div>
                <nav class="pr-nav" aria-label="Review sections">${nav.map(([a, t]) => `<a href="#${a}">${t}</a>`).join("")}</nav>
                <div class="apv-body pr-body">
                    <div class="pr-layout">
                        <div class="pr-main">
                            ${L.overview(d, r, m)}
                            <section class="pr-sec" id="pr-images">${imagesSection(d).replace('<div class="product-form-section">', "<div>").replace("<h4>Images</h4>", "<h4>2. Product images</h4>")}</section>
                            ${L.pricing(d, r)}
                            ${descriptionSection(d)}
                            ${specsReview(d)}
                            ${stockSection(d)}
                            ${L.seller(r)}
                            ${L.compliance(d, r, m)}
                            ${authenticity(d)}
                            <section class="pr-sec">${footer(d)}</section>
                        </div>
                        <aside class="pr-side">
                            ${L.decision(d, r, m)}
                            ${L.notes(r)}
                            ${L.history(r, m)}
                        </aside>
                    </div>
                </div>`;
            overlay.querySelectorAll(".apv-close").forEach((b) => { b.onclick = close; });
            overlay.querySelectorAll(".pr-nav a, .pr-jump").forEach((a) => {
                a.onclick = (e) => { e.preventDefault(); const t = overlay.querySelector(a.getAttribute("href")); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); };
            });
            L.wire(overlay, d, r, m, reopen);
        } else {
            const who = p.vendor_id
                ? `<span class="apv-badge" style="background:#EEF2FF; color:#3730A3;">VENDOR</span> ${esc(p.vendor_business_name || p.submitted_by_name || "Vendor")}`
                : `${esc(p.submitted_by_name || "Staff")} (staff)`;
            const whenTxt = p.created_at ? new Date(p.created_at).toLocaleString() : "";
            overlay.innerHTML = `
                <div class="apv-bar">
                    <div class="apv-bar-title">${esc(p.name)} ${statusBadge(p)}</div>
                    <div class="apv-bar-actions"><button type="button" class="apv-close" aria-label="Close">&times;</button></div>
                </div>
                <div class="apv-body">
                    <div class="apv-sub">Submitted by ${who}${whenTxt ? ` &middot; ${esc(whenTxt)}` : ""} &middot; Product ID ${esc(p.id)}${p.lizimas_sku ? ` &middot; Lizimas SKU ${esc(p.lizimas_sku)}` : ""}</div>
                    <div class="apv-readonly-note">View only &mdash; this is the product exactly as it was submitted. Nothing here can be edited.</div>
                    <div class="panel apv-panel">
                        <div class="product-form-sections">
                            ${basicSection(d)}
                            ${pricingSection(d)}
                            ${imagesSection(d)}
                            ${specsSection(d)}
                        </div>
                        ${authenticity(d)}
                    </div>
                    <div class="panel apv-panel">${variantsSection(d)}</div>
                    ${p.rejection_reason ? `<div class="panel apv-panel"><h4 style="margin-top:0;">Rejection reason</h4><div class="apv-value apv-multiline">${esc(p.rejection_reason)}</div></div>` : ""}
                    <div class="panel apv-panel">${footer(d)}</div>
                </div>`;
            overlay.querySelectorAll(".apv-close").forEach((b) => { b.onclick = close; });
        }

        // Photo viewer: product photos, then any photos/videos in the description blocks.
        const blockMedia = [];
        const isEmbed = (u) => /youtube\.com|youtu\.be|vimeo\.com/i.test(u || "");
        d.blocks.forEach((b) => {
            if (b.type === "image" && b.image_url) blockMedia.push({ type: "image", src: b.image_url, label: "Description photo" });
            if (b.type === "video" && b.image_url && !isEmbed(b.image_url)) blockMedia.push({ type: "video", src: b.image_url, label: "Description video" });
            if (b.type === "grid") {
                let pl = b.payload; if (typeof pl === "string") { try { pl = JSON.parse(pl); } catch (e) { pl = {}; } }
                ((pl && pl.items) || []).forEach((it) => {
                    if (it.image_url) blockMedia.push({ type: "image", src: it.image_url, label: "Description photo" });
                    if (it.video_url && !isEmbed(it.video_url)) blockMedia.push({ type: "video", src: it.video_url, label: "Description video" });
                });
            }
        });
        const media = (d._photos || []).concat(blockMedia);
        overlay.querySelectorAll("[data-apv-open]").forEach((b) => {
            b.onclick = () => openViewer(media, Number(b.dataset.apvOpen), p.name);
        });
        const dlAll = overlay.querySelector("[data-apv-dlall]");
        if (dlAll) dlAll.onclick = async () => {
            dlAll.disabled = true;
            for (let k = 0; k < (d._photos || []).length; k++) { await downloadItem(d._photos[k], k, p.name); await new Promise((r) => setTimeout(r, 600)); }
            dlAll.disabled = false;
        };
        const editBtn = overlay.querySelector("[data-apv-edit]");
        if (editBtn) editBtn.onclick = () => {
            close();
            if (typeof adminProducts !== "undefined" && !adminProducts.find((x) => x.id === p.id)) adminProducts.push(p);
            const tab = document.querySelector('.tab-btn[data-tab="products"]');
            if (tab) tab.click();
            if (typeof editProduct === "function") editProduct(p.id);
            const form = document.getElementById("product-form-container");
            if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "start" });
        };
        const blocksHost = document.getElementById("apv-blocks");
        if (blocksHost && d.blocks.length) {
            const mount = document.createElement("div");
            mount.className = "pd-desc-blocks";
            blocksHost.appendChild(mount);
            if (window.LzDescBlocks) window.LzDescBlocks.render(mount, d.blocks);
            else mount.innerHTML = '<div class="apv-value apv-empty">Description blocks could not be displayed.</div>';
        }
        if (opts.anchor) { const t = document.getElementById(opts.anchor); if (t) t.scrollIntoView({ block: "start" }); }
    }

    window.openAdminProductView = open;
    window.openAdminMediaViewer = openViewer;
    window.closeAdminProductView = close;
})();
