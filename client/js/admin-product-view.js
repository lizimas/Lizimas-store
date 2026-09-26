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
        const grid = imgs.length
            ? `<div class="drag-drop-preview-grid apv-images">${imgs.map((im, i) => `
                <a href="${esc(im.src)}" target="_blank" rel="noopener" class="apv-img" title="Open full size">
                    <img src="${esc(im.src)}" alt="Photo ${i + 1}" loading="lazy">
                    ${i === 0 ? '<span class="apv-img-tag">Main</span>' : ""}
                    ${im.colour ? `<span class="apv-img-colour">${esc(im.colour)}</span>` : ""}
                </a>`).join("")}</div>`
            : '<div class="apv-value apv-empty">No photos uploaded</div>';
        return `<div class="product-form-section">
            <h4>Images</h4>
            <div class="field-row">
                <div>
                    <label style="${LABEL}">Photos <span style="${HINT}">(${imgs.length} uploaded)</span></label>
                    ${grid}
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

    function close() {
        const el = document.getElementById("apv-overlay");
        if (el) el.remove();
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
        const who = p.vendor_id
            ? `<span class="apv-badge" style="background:#EEF2FF; color:#3730A3;">VENDOR</span> ${esc(p.vendor_business_name || p.submitted_by_name || "Vendor")}`
            : `${esc(p.submitted_by_name || "Staff")} (staff)`;
        const when = p.created_at ? new Date(p.created_at).toLocaleString() : "";
        const canDecide = p.status === "pending" && opts.actions !== false;
        const actions = canDecide ? `
            <button type="button" class="apv-btn apv-approve" data-apv="approve">Approve</button>
            <button type="button" class="apv-btn apv-reject" data-apv="reject">Reject</button>` : "";

        overlay.innerHTML = `
            <div class="apv-bar">
                <div class="apv-bar-title">${esc(p.name)} ${statusBadge(p)}</div>
                <div class="apv-bar-actions">${actions}<button type="button" class="apv-close" aria-label="Close">&times;</button></div>
            </div>
            <div class="apv-body">
                <div class="apv-sub">Submitted by ${who}${when ? ` &middot; ${esc(when)}` : ""} &middot; Product ID ${esc(p.id)}${p.lizimas_sku ? ` &middot; Lizimas SKU ${esc(p.lizimas_sku)}` : ""}</div>
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
                ${canDecide ? `<div class="apv-foot">${actions}</div>` : ""}
            </div>`;
        overlay.querySelectorAll(".apv-close").forEach((b) => { b.onclick = close; });
        overlay.querySelectorAll("[data-apv]").forEach((b) => {
            b.onclick = () => {
                const act = b.dataset.apv;
                close();
                if (act === "approve" && typeof approvePendingProduct === "function") approvePendingProduct(p.id);
                if (act === "reject" && typeof rejectPendingProduct === "function") rejectPendingProduct(p.id);
            };
        });

        const blocksHost = document.getElementById("apv-blocks");
        if (blocksHost && d.blocks.length) {
            const mount = document.createElement("div");
            mount.className = "pd-desc-blocks";
            blocksHost.appendChild(mount);
            if (window.LzDescBlocks) window.LzDescBlocks.render(mount, d.blocks);
            else mount.innerHTML = '<div class="apv-value apv-empty">Description blocks could not be displayed.</div>';
        }
    }

    window.openAdminProductView = open;
    window.closeAdminProductView = close;
})();
