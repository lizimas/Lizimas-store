// Vendor mobile Home - "Welcome to Lizimas Store! Let's take your shop live!"
// shop-setup onboarding (Ryan, Sept 2026 - modelled on Jumia Vendor
// Center's mobile seller onboarding). Loaded after vendor-dashboard.js and
// vendor-mobile.js (see client/vendor/dashboard.html) and reuses their
// globals: vendorAuthorizedFetch, getVendorToken, API_URL, vendorEsc,
// vmStatusCopy, vmRenderHomeKpi.
//
// Five steps, each a tile; tapping a tile shows that step's form in the
// card underneath (same page, no navigation), exactly like Jumia:
//   shop       Shop Information     -> PATCH /api/vendors/me/shop-setup/shop-info
//   company    Company Information  -> PATCH /api/vendors/me/shop-setup/company
//   shipping   Shipping Information -> PATCH /api/vendors/me/shop-setup/shipping
//   payment    Payment Information  -> existing /api/vendors/me/payment-instruments
//   additional Additional Information (Shop Details / Catalog Details tabs)
//                                    -> PATCH /api/vendors/me/shop-setup/additional
// Step status (COMPLETED / PENDING) always comes from the server
// (GET /api/vendors/me/shop-setup), derived from real data - see
// server/utils/vendorShopSetup.js.

const VSS_STEPS = [
    { key: "shop", title: "Shop Information", icon: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/>' },
    { key: "company", title: "Company Information", icon: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/><path d="M10 21v-3h4v3"/>' },
    { key: "shipping", title: "Shipping Information", icon: '<path d="M1 7h13v9H1z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="5.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>' },
    { key: "payment", title: "Payment Information", icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>' },
    { key: "additional", title: "Additional Information", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>' }
];

let vssData = null;          // last GET /me/shop-setup response
let vssActiveStep = null;    // which tile is selected
let vssAdditionalTab = "shop";
let vssPaymentOpen = "momo"; // which accordion section is expanded
let vssPaymentAdding = null; // "momo" | "bank" | null - which inline add form is open

// --- Small helpers ---------------------------------------------------------

function vssV(v) { return vendorEsc(v == null ? "" : v); }

function vssField({ id, label, value, placeholder, required, type, readonly, hint, prefix }) {
    const req = required ? '<span class="vss-req">Required</span>' : "";
    const input = readonly
        ? `<div class="vss-input vss-input-locked">${vssV(value) || "&nbsp;"}</div>`
        : `<input id="${id}" class="vss-input" type="${type || "text"}" value="${vssV(value)}" placeholder="${vssV(placeholder || "")}">`;
    const body = prefix
        ? `<div class="vss-prefix-row"><span class="vss-prefix">${prefix}</span>${input}</div>`
        : input;
    return `<div class="vss-field"><div class="vss-label-row"><label class="vss-label"${readonly ? "" : ` for="${id}"`}>${label}</label>${req}</div>${body}${hint ? `<div class="vss-hint">${hint}</div>` : ""}</div>`;
}

function vssSection(title, subtitle, inner) {
    return `<div class="vss-section"><h3 class="vss-section-title">${title}</h3>${subtitle ? `<p class="vss-section-sub">${subtitle}</p>` : ""}${inner}</div>`;
}

function vssVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}

function vssStatus(id, text, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "vss-status" + (kind ? ` vss-status-${kind}` : "");
    el.textContent = text || "";
}

function vssAddressFields(prefix, values, { requireRegion = true, required = true, disabled = false } = {}) {
    const v = (k) => values ? values[`${prefix}_${k}`] : "";
    const dis = disabled ? " disabled" : "";
    const f = (id, label, val, ph, req) => `<div class="vss-field"><div class="vss-label-row"><label class="vss-label" for="${id}">${label}</label>${req ? '<span class="vss-req">Required</span>' : ""}</div><input id="${id}" class="vss-input" value="${vssV(val)}" placeholder="${ph}"${dis}></div>`;
    return f(`vss-${prefix}-line1`, "Address Line 1", v("address_line1"), "Floor, House /Apartment No., Building etc.", required)
        + f(`vss-${prefix}-line2`, "Address Line 2", v("address_line2"), "Street/Block Number/ Name", false)
        + f(`vss-${prefix}-city`, "City / Town", v("city"), "or District/Province if applicable", required)
        + f(`vss-${prefix}-region`, "State / Region", v("region"), "or Region if applicable", required && requireRegion)
        + `<div class="vss-field"><div class="vss-label-row"><span class="vss-label">Country</span>${required ? '<span class="vss-req">Required</span>' : ""}</div><div class="vss-input vss-input-locked">Uganda</div></div>`
        + f(`vss-${prefix}-postal`, "Pincode / Postal Code", v("postal_code"), "or Postal code", false);
}

function vssReadAddress(prefix) {
    return {
        [`${prefix}_address_line1`]: vssVal(`vss-${prefix}-line1`),
        [`${prefix}_address_line2`]: vssVal(`vss-${prefix}-line2`),
        [`${prefix}_city`]: vssVal(`vss-${prefix}-city`),
        [`${prefix}_region`]: vssVal(`vss-${prefix}-region`),
        [`${prefix}_postal_code`]: vssVal(`vss-${prefix}-postal`)
    };
}

async function vssSave(path, body, statusId, successText) {
    vssStatus(statusId, "Saving...");
    try {
        const result = await vendorAuthorizedFetch(path, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (result.error) { vssStatus(statusId, result.error, "error"); return false; }
        vssStatus(statusId, successText || result.message || "Saved.", "ok");
        await vssRefresh();
        return true;
    } catch (error) {
        console.error("vssSave error:", error);
        vssStatus(statusId, "Could not save. Please check your connection and try again.", "error");
        return false;
    }
}

// --- Load / render ---------------------------------------------------------

// Called by vmLoadHome (vendor-mobile.js).
async function vssLoadHome(el) {
    const data = await vendorAuthorizedFetch("/api/vendors/me/shop-setup");
    if (data.error) { el.innerHTML = `<div class="vm-loading-state">${vendorEsc(data.error)}</div>`; return; }
    vssData = data;

    // Fully set up and approved: Home is the live KPI dashboard again, with
    // the setup tiles kept underneath so details stay editable.
    if (data.all_completed && data.account.status === "approved") {
        let kpiHtml = "";
        try {
            const summary = await vendorAuthorizedFetch("/api/vendors/dashboard-summary");
            if (!summary.error) kpiHtml = vmRenderHomeKpi({ business_name: data.account.business_name }, summary);
        } catch (e) { console.error("dashboard-summary error:", e); }
        el.innerHTML = kpiHtml + `<div id="vss-root"></div>`;
        vssRender({ compact: true });
        return;
    }

    el.innerHTML = `<div id="vss-root"></div>`;
    if (!vssActiveStep) {
        const firstPending = data.steps.find((s) => !s.completed);
        vssActiveStep = firstPending ? firstPending.key : "shop";
    }
    vssRender({ compact: false });
}

async function vssRefresh() {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/shop-setup");
        if (data.error) return;
        vssData = data;
        vssRenderTilesOnly();
    } catch (e) { console.error("vssRefresh error:", e); }
}

function vssStepCompleted(key) {
    const s = vssData && vssData.steps.find((x) => x.key === key);
    return Boolean(s && s.completed);
}

function vssTilesHtml() {
    return VSS_STEPS.map((s) => {
        const done = vssStepCompleted(s.key);
        const active = vssActiveStep === s.key;
        const statusIcon = done
            ? '<span class="vss-dot vss-dot-done"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>'
            : '<span class="vss-dot vss-dot-pending">&bull;&bull;&bull;</span>';
        return `<button type="button" class="vss-tile${active ? " vss-tile-active" : ""}" onclick="vssSelectStep('${s.key}')">
            <span class="vss-tile-top"><span class="vss-tile-title">${s.title}</span><span class="vss-tile-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg></span></span>
            <span class="vss-tile-status">${statusIcon}${done ? "COMPLETED" : "PENDING"}</span>
        </button>`;
    }).join("");
}

function vssRenderTilesOnly() {
    const tiles = document.getElementById("vss-tiles");
    if (tiles) tiles.innerHTML = vssTilesHtml();
    const count = document.getElementById("vss-progress");
    if (count && vssData) count.textContent = `${vssData.completed_count} of ${VSS_STEPS.length} sections completed`;
}

function vssRender({ compact }) {
    const root = document.getElementById("vss-root");
    if (!root || !vssData) return;
    const a = vssData.account;
    const s = vmStatusCopy(a.status);

    let statusNote = "";
    if (a.status === "pending") statusNote = `<div class="vss-banner vss-banner-amber">Your application is awaiting review. Completing every section below speeds up approval.</div>`;
    else if (a.status === "rejected") statusNote = `<div class="vss-banner vss-banner-red">Application rejected${a.rejection_reason ? ": " + vendorEsc(a.rejection_reason) : ". Contact support for details."}</div>`;
    else if (a.status === "suspended") statusNote = `<div class="vss-banner vss-banner-red">Your shop is suspended. Contact support for details.</div>`;

    const intro = compact
        ? `<div class="vss-card"><h2 class="vss-h2">Shop profile</h2><p class="vss-muted">Tap a section to review or update it.</p><div class="vss-tiles" id="vss-tiles">${vssTilesHtml()}</div></div>`
        : `<div class="vss-card">
            <div class="vss-brand"><span class="vss-brand-name"><span class="vm-header-brand-badge" title="Lizimas Vendor" aria-label="Lizimas Vendor">LV</span><span class="vss-brand-text">Lizimas Vendor Center</span></span><span class="vss-status-pill" style="background:${s.bg}; color:${s.color};">${s.text}</span></div>
            <h1 class="vss-h1">Welcome to Lizimas Store!<br>Let's take your shop live!</h1>
            <p class="vss-muted">Complete all the sections below to take your shop live.</p>
            <p class="vss-progress" id="vss-progress">${vssData.completed_count} of ${VSS_STEPS.length} sections completed</p>
            ${statusNote}
            <div class="vss-tiles" id="vss-tiles">${vssTilesHtml()}</div>
        </div>`;

    root.innerHTML = intro
        + `<div class="vss-card" id="vss-form-card"${compact && !vssActiveStep ? ' style="display:none;"' : ""}></div>`
        + (compact ? "" : vssAgreementHtml());
    if (vssActiveStep) vssRenderForm();
}

function vssAgreementHtml() {
    const a = vssData.account;
    const signed = a.policies_accepted_at
        ? `Signed on ${new Date(a.policies_accepted_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}${a.policies_version ? ` (version ${vendorEsc(a.policies_version)})` : ""}`
        : "Not signed yet";
    return `<div class="vss-card"><h2 class="vss-h2">Signed Agreement</h2>
        <a class="vss-link" href="../vendor-policies.html" target="_blank" rel="noopener">Your signed contract with Lizimas Store</a>
        <p class="vss-muted" style="margin-top:6px;">Vendor terms, marketplace policies and prohibited items list</p>
        <p class="vss-muted">${signed}</p>
    </div>`;
}

function vssSelectStep(key) {
    vssActiveStep = key;
    vssPaymentAdding = null;
    const card = document.getElementById("vss-form-card");
    if (card) card.style.display = "";
    vssRenderTilesOnly();
    vssRenderForm();
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function vssRenderForm() {
    const card = document.getElementById("vss-form-card");
    if (!card) return;
    const renderers = {
        shop: vssShopForm,
        company: vssCompanyForm,
        shipping: vssShippingForm,
        payment: vssPaymentForm,
        additional: vssAdditionalForm
    };
    card.innerHTML = (renderers[vssActiveStep] || vssShopForm)();
    if (vssActiveStep === "shipping") { vssApplySameAs("ship"); vssApplySameAs("return"); }
}

// --- Step 1: Shop Information ---------------------------------------------

function vssShopForm() {
    const a = vssData.account;
    const p = vssData.profile || {};
    const phoneLocal = String(a.phone || "").replace(/^\+?256/, "").replace(/^0/, "");
    const typeLabel = a.account_type === "company" ? "Company" : a.account_type === "individual" ? "Individual" : "-";

    const account = vssSection("Account Details", "Your seller account information",
        vssField({ label: "Account Email", value: a.email, readonly: true, required: true })
        + vssField({ label: "Account Phone", value: phoneLocal, readonly: true, required: true, prefix: "+256" })
        + vssField({ label: "Country of Registration", value: a.country, readonly: true })
        + vssField({ label: "Account Type", value: typeLabel, readonly: true, required: true }));

    const shopIdBlock = `<div class="vss-field"><div class="vss-label-row"><span class="vss-label">Shop ID</span></div>
        <div class="vss-input vss-input-locked vss-copy-row"><span>${a.shop_id ? vssV(a.shop_id) : "Assigned at approval"}</span>${a.shop_id ? `<button type="button" class="vss-copy" onclick="vssCopy('${vssV(a.shop_id)}', this)" aria-label="Copy Shop ID"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>` : ""}</div></div>`;
    const shop = vssSection("Shop Details", "Manage your shop on Lizimas Store from below",
        vssField({ label: "Shop Name", value: a.business_name, readonly: true, required: true, hint: "Contact support to change your shop name." })
        + shopIdBlock);

    const comms = vssSection("Communication Details", "Choose the contact preference for communications from Lizimas Store. We'll send communications and contact you on the details below.",
        vssField({ id: "vss-contact-name", label: "Contact Name", value: p.contact_name != null ? p.contact_name : (a.owner_name || ""), placeholder: "Full name", required: true })
        + vssField({ id: "vss-contact-email", label: "Contact Email", type: "email", value: p.contact_email != null ? p.contact_email : (a.email || ""), placeholder: "Email", required: true })
        + vssField({ id: "vss-contact-phone", label: "Contact Phone", type: "tel", value: p.contact_phone != null ? p.contact_phone : (a.phone || ""), placeholder: "07XXXXXXXX", required: true }));

    const care = vssSection("Customer Care Details", "Please provide details of your customer support. These details will be used to address product issues by customers.",
        vssField({ id: "vss-cc-name", label: "Customer Care Name", value: p.cc_name, placeholder: "Contact Person or Representative Name" })
        + vssField({ id: "vss-cc-phone", label: "Customer Care Phone", type: "tel", value: p.cc_phone, placeholder: "Phone", required: true })
        + vssField({ id: "vss-cc-email", label: "Customer Care Email", type: "email", value: p.cc_email, placeholder: "Contact Email", required: true })
        + vssAddressFields("cc", p, { required: false }));

    return account + shop + comms + care + `<div class="vss-actions"><button type="button" class="vss-btn" onclick="vssSaveShop()">Save</button></div><div class="vss-status" id="vss-shop-status"></div>`;
}

function vssCopy(text, btn) {
    const done = () => { btn.classList.add("vss-copied"); setTimeout(() => btn.classList.remove("vss-copied"), 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => {});
}

function vssSaveShop() {
    const addr = vssReadAddress("cc");
    return vssSave("/api/vendors/me/shop-setup/shop-info", {
        contact_name: vssVal("vss-contact-name"),
        contact_email: vssVal("vss-contact-email"),
        contact_phone: vssVal("vss-contact-phone"),
        cc_name: vssVal("vss-cc-name"),
        cc_phone: vssVal("vss-cc-phone"),
        cc_email: vssVal("vss-cc-email"),
        ...addr
    }, "vss-shop-status", "Shop information saved.");
}

// --- Step 2: Company Information ------------------------------------------

function vssCompanyForm() {
    const c = vssData.company;
    const isCompany = vssData.account.account_type === "company";
    const locked = !c.editable;
    const lockedNote = locked
        ? `<div class="vss-banner vss-banner-amber">Your verification is ${vendorEsc(String(c.kyc_status).replace(/_/g, " "))}. You can still fill in anything missing, but details already on file can only be changed by support.</div>`
        : "";
    const taxDoc = (vssData.documents || []).find((d) => d.document_type === "tax_certificate");

    // Shown for every account type (Jumia layout); required for companies.
    const tinUpload = true
        ? `<div class="vss-field"><div class="vss-label-row"><span class="vss-label">Upload Tax Identification Number (TIN)</span>${isCompany ? '<span class="vss-req">Required</span>' : ""}</div>
            <label class="vss-input vss-upload"><span id="vss-tin-file-label">${taxDoc ? vssV(taxDoc.original_filename || "Uploaded") : "Upload .jpg, .jpeg, .png or .pdf"}</span>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" class="vss-hidden" onchange="vssUploadTin(this)">
            </label>${taxDoc && taxDoc.review_status === "rejected" ? `<div class="vss-hint vss-hint-error">Rejected${taxDoc.rejection_reason ? ": " + vssV(taxDoc.rejection_reason) : ""} - please upload a new copy.</div>` : ""}</div>`
        : "";

    const details = vssSection(isCompany ? "Company Details" : "Business Details", "Please provide the following details of your business",
        vssField({ id: "vss-tin", label: "Tax Identification Number (TIN)", value: c.tin_number, placeholder: "or fiscal number", required: isCompany })
        + vssField({ id: "vss-vat", label: "VAT Number", value: c.vat_number, placeholder: "VAT Number", required: isCompany })
        + tinUpload);

    const selected = new Set(c.legal_rep_id_types || []);
    const opts = vssData.id_type_options || [];
    const idSummary = opts.filter((o) => selected.has(o.code)).map((o) => o.label).join(", ");
    const idPicker = `<div class="vss-field"><div class="vss-label-row"><span class="vss-label">Choose ID Type</span><span class="vss-req">Required</span></div>
        <details class="vss-multi" id="vss-idtypes"><summary class="vss-input vss-select"><span data-summary data-placeholder="Choose one or more option">${idSummary ? vssV(idSummary) : '<span class="vss-placeholder">Choose one or more option</span>'}</span></summary>
            <div class="vss-multi-menu">${opts.map((o) => `<label class="vss-multi-opt"><input type="checkbox" value="${o.code}"${selected.has(o.code) ? " checked" : ""} onchange="vssMultiSummary('vss-idtypes')"> ${vssV(o.label)}</label>`).join("")}</div>
        </details><div class="vss-hint">Choose one or more option</div></div>`;

    const rep = vssSection("Legal Representative's Details", "Please provide the following details of the owner / legal representative of your business",
        vssField({ id: "vss-rep-name", label: "Full Name", value: c.legal_rep_full_name, placeholder: "Name as on the ID", required: true, hint: "Please enter your full name in English" })
        + idPicker);

    const addr = vssSection("Legal Representative's Address", "Please provide the registered address of your business",
        vssAddressFields("business", c));

    return lockedNote + details + rep + addr + `<div class="vss-actions"><button type="button" class="vss-btn" onclick="vssSaveCompany()">Submit</button></div><div class="vss-status" id="vss-company-status"></div>`;
}

function vssMultiSummary(detailsId) {
    const d = document.getElementById(detailsId);
    if (!d) return;
    const labels = [...d.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.parentElement.textContent.trim());
    const span = d.querySelector("[data-summary]");
    span.innerHTML = labels.length ? vendorEsc(labels.join(", ")) : `<span class="vss-placeholder">${vendorEsc(span.dataset.placeholder)}</span>`;
}

function vssMultiValues(detailsId) {
    const d = document.getElementById(detailsId);
    return d ? [...d.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value) : [];
}

async function vssUploadTin(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const label = document.getElementById("vss-tin-file-label");
    if (label) label.textContent = "Uploading...";
    const form = new FormData();
    form.append("document_type", "tax_certificate");
    form.append("document", file);
    try {
        const response = await fetch(`${API_URL}/api/vendors/me/kyc/documents`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getVendorToken()}` },
            body: form
        });
        const result = await response.json();
        if (result.error) {
            if (label) label.textContent = "Upload .jpg, .jpeg, .png or .pdf";
            vssStatus("vss-company-status", result.error, "error");
            return;
        }
        if (label) label.textContent = file.name;
        vssStatus("vss-company-status", "TIN document uploaded.", "ok");
        await vssRefresh();
    } catch (error) {
        console.error("vssUploadTin error:", error);
        if (label) label.textContent = "Upload .jpg, .jpeg, .png or .pdf";
        vssStatus("vss-company-status", "Could not upload. Please try again.", "error");
    }
}

function vssSaveCompany() {
    return vssSave("/api/vendors/me/shop-setup/company", {
        tin_number: vssVal("vss-tin"),
        vat_number: vssVal("vss-vat"),
        legal_rep_full_name: vssVal("vss-rep-name"),
        legal_rep_id_types: vssMultiValues("vss-idtypes"),
        ...vssReadAddress("business")
    }, "vss-company-status", "Company information saved.");
}

// --- Step 3: Shipping Information -----------------------------------------

function vssShippingForm() {
    const p = vssData.profile || {};
    const toggle = (prefix, checked) => `<label class="vss-switch"><input type="checkbox" id="vss-${prefix}-same"${checked ? " checked" : ""} onchange="vssApplySameAs('${prefix}')"><span class="vss-switch-track"></span><span class="vss-switch-label">Make it same as your business address</span></label>`;
    const ship = vssSection("Shipping Information", "Please provide the address from where you prefer to ship your products",
        toggle("ship", p.ship_same_as_business) + vssAddressFields("ship", p));
    const ret = vssSection("Return Address", "Please provide the return address",
        toggle("return", p.return_same_as_business) + vssAddressFields("return", p, { required: false }));
    return ship + ret + `<div class="vss-actions"><button type="button" class="vss-btn" onclick="vssSaveShipping()">Save</button></div><div class="vss-status" id="vss-shipping-status"></div>`;
}

// Toggle on: show the business address (from Company Information) in the
// fields and lock them. The server copies the address itself on save, so
// this is display only.
function vssApplySameAs(prefix) {
    const box = document.getElementById(`vss-${prefix}-same`);
    if (!box) return;
    const c = vssData.company || {};
    const p = vssData.profile || {};
    const map = { line1: "address_line1", line2: "address_line2", city: "city", region: "region", postal: "postal_code" };
    for (const [suffix, key] of Object.entries(map)) {
        const input = document.getElementById(`vss-${prefix}-${suffix}`);
        if (!input) continue;
        if (box.checked) {
            if (!input.dataset.own) input.dataset.own = input.value;
            input.value = c[`business_${key}`] || "";
            input.disabled = true;
        } else {
            if (input.disabled) input.value = input.dataset.own != null ? input.dataset.own : (p[`${prefix}_${key}`] || "");
            delete input.dataset.own;
            input.disabled = false;
        }
    }
    if (box.checked && !(c.business_address_line1 && c.business_city)) {
        vssStatus("vss-shipping-status", "Add your business address under Company Information first.", "error");
    }
}

function vssSaveShipping() {
    return vssSave("/api/vendors/me/shop-setup/shipping", {
        ship_same_as_business: document.getElementById("vss-ship-same").checked,
        return_same_as_business: document.getElementById("vss-return-same").checked,
        ...vssReadAddress("ship"),
        ...vssReadAddress("return")
    }, "vss-shipping-status", "Shipping information saved.");
}

// --- Step 4: Payment Information ------------------------------------------
// Same endpoints and rules as the desktop Payment Instruments panel
// (vdLoadPaymentInstruments etc. in vendor-dashboard.js): new instruments
// are name-matched server-side and auto-rejected on mismatch, need an
// evidence document before admin can approve, and only an approved one
// can be made preferred.

const VSS_INSTRUMENT_BADGE = {
    pending: { cls: "vss-badge-amber", label: "Pending review" },
    approved: { cls: "vss-badge-green", label: "Approved" },
    rejected: { cls: "vss-badge-red", label: "Rejected" }
};

function vssPaymentForm() {
    const instruments = vssData.instruments || [];
    const section = (method, label) => {
        const open = vssPaymentOpen === method;
        const list = instruments.filter((i) => i.method === method);
        const rows = list.map(vssInstrumentRow).join("");
        const body = open ? `<div class="vss-acc-body">
            ${list.length ? rows : '<div class="vss-empty">No Payment Instruments Available</div>'}
            ${vssPaymentAdding === method ? vssInstrumentAddForm(method) : `<button type="button" class="vss-add-link" onclick="vssStartAddInstrument('${method}')"><span>+</span> New Payment Instrument</button>`}
        </div>` : "";
        return `<div class="vss-acc"><button type="button" class="vss-acc-head${open ? " vss-acc-open" : ""}" onclick="vssTogglePayment('${method}')"><span class="vss-caret">${open ? "&#9662;" : "&#9656;"}</span>${label}</button>${body}</div>`;
    };
    return vssSection("Preferred payment option", "Select the payment method, if applicable, of your choice, and ensure to provide all required details. We'll review the validity of your documents upon submission.",
        `<div class="vss-country"><span class="vss-flag" aria-hidden="true"><i style="background:#000"></i><i style="background:#fcdc04"></i><i style="background:#d90000"></i><i style="background:#000"></i><i style="background:#fcdc04"></i><i style="background:#d90000"></i></span>Uganda</div>`
        + section("momo", "Mobile Money")
        + section("bank", "Bank Transfer"))
        + `<div class="vss-status" id="vss-payment-status"></div>`;
}

function vssInstrumentRow(i) {
    const badge = VSS_INSTRUMENT_BADGE[i.status] || VSS_INSTRUMENT_BADGE.pending;
    const details = i.method === "bank" ? `${vssV(i.bank_name)} &middot; ${vssV(i.account_number)}` : vssV(i.momo_number);
    const evidence = i.status === "approved" ? "" : `<label class="vss-mini-btn">${i.has_evidence ? "Replace document" : "Upload proof document"}<input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" class="vss-hidden" onchange="vssUploadInstrumentEvidence(${Number(i.id)}, this)"></label>`;
    const preferred = i.is_preferred
        ? '<span class="vss-badge vss-badge-navy">Preferred</span>'
        : (i.status === "approved" ? `<button type="button" class="vss-mini-btn" onclick="vssSetPreferred(${Number(i.id)})">Set as preferred</button>` : "");
    return `<div class="vss-instrument">
        <div class="vss-instrument-top"><span class="vss-instrument-name">${details}</span><span class="vss-badge ${badge.cls}">${badge.label}</span></div>
        <div class="vss-muted">${vssV(i.account_holder_name)}</div>
        ${i.status === "rejected" && i.rejection_reason ? `<div class="vss-hint vss-hint-error">${vssV(i.rejection_reason)}</div>` : ""}
        ${i.status !== "approved" && !i.has_evidence ? `<div class="vss-hint">Upload a ${i.method === "bank" ? "bank certificate / statement" : "Mobile Money statement"} so we can review this account.</div>` : ""}
        <div class="vss-instrument-actions">${evidence}${preferred}</div>
    </div>`;
}

function vssInstrumentAddForm(method) {
    const a = vssData.account;
    const holderHint = a.account_type === "company"
        ? "Must match your registered business name."
        : "Must match the name on your account.";
    const fields = method === "bank"
        ? vssField({ id: "vss-pi-bank", label: "Bank Name", placeholder: "e.g. Stanbic Bank", required: true })
          + vssField({ id: "vss-pi-account", label: "Account Number", placeholder: "Account number", required: true })
        : vssField({ id: "vss-pi-momo", label: "Mobile Money Number", type: "tel", placeholder: "07XXXXXXXX", required: true });
    return `<div class="vss-add-form">
        ${vssField({ id: "vss-pi-holder", label: "Account Holder Name", placeholder: "Name on the account", required: true, hint: holderHint })}
        ${fields}
        <div class="vss-actions vss-actions-split"><button type="button" class="vss-btn vss-btn-outline" onclick="vssCancelAddInstrument()">Cancel</button><button type="button" class="vss-btn" onclick="vssAddInstrument('${method}')">Submit</button></div>
    </div>`;
}

function vssTogglePayment(method) {
    vssPaymentOpen = vssPaymentOpen === method ? null : method;
    vssPaymentAdding = null;
    vssRenderForm();
}

function vssStartAddInstrument(method) { vssPaymentAdding = method; vssRenderForm(); }
function vssCancelAddInstrument() { vssPaymentAdding = null; vssRenderForm(); }

async function vssAfterPaymentChange(message, kind) {
    await vssRefresh();
    vssRenderForm();
    vssStatus("vss-payment-status", message, kind);
}

async function vssAddInstrument(method) {
    const body = {
        method,
        account_holder_name: vssVal("vss-pi-holder"),
        momo_number: method === "momo" ? vssVal("vss-pi-momo") : undefined,
        bank_name: method === "bank" ? vssVal("vss-pi-bank") : undefined,
        account_number: method === "bank" ? vssVal("vss-pi-account") : undefined
    };
    if (!body.account_holder_name || (method === "momo" && !body.momo_number) || (method === "bank" && (!body.bank_name || !body.account_number))) {
        vssStatus("vss-payment-status", "Please fill in all required fields.", "error");
        return;
    }
    vssStatus("vss-payment-status", "Submitting...");
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/payment-instruments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (result.error && !result.message) { vssStatus("vss-payment-status", result.error, "error"); return; }
        vssPaymentAdding = null;
        await vssAfterPaymentChange(
            result.status === "rejected" ? result.message : "Submitted for review. Now upload a proof document for it.",
            result.status === "rejected" ? "error" : "ok"
        );
    } catch (error) {
        console.error("vssAddInstrument error:", error);
        vssStatus("vss-payment-status", "Could not submit. Please try again.", "error");
    }
}

async function vssUploadInstrumentEvidence(id, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    vssStatus("vss-payment-status", "Uploading...");
    const form = new FormData();
    form.append("document", file);
    try {
        const response = await fetch(`${API_URL}/api/vendors/me/payment-instruments/${id}/evidence`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getVendorToken()}` },
            body: form
        });
        const result = await response.json();
        if (result.error) { vssStatus("vss-payment-status", result.error, "error"); return; }
        await vssAfterPaymentChange("Document uploaded.", "ok");
    } catch (error) {
        console.error("vssUploadInstrumentEvidence error:", error);
        vssStatus("vss-payment-status", "Could not upload. Please try again.", "error");
    }
}

async function vssSetPreferred(id) {
    try {
        const result = await vendorAuthorizedFetch("/api/vendors/me/payment-instruments/preferred", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instrument_id: id })
        });
        if (result.error) { vssStatus("vss-payment-status", result.error, "error"); return; }
        await vssAfterPaymentChange("Preferred payment option updated.", "ok");
    } catch (error) {
        console.error("vssSetPreferred error:", error);
        vssStatus("vss-payment-status", "Could not update. Please try again.", "error");
    }
}

// --- Step 5: Additional Information ---------------------------------------

function vssRadio(name, value, yes, no) {
    return `<div class="vss-radios">
        <label class="vss-radio"><input type="radio" name="${name}" value="yes"${value === true ? " checked" : ""}><span></span>${yes}</label>
        <label class="vss-radio"><input type="radio" name="${name}" value="no"${value === false ? " checked" : ""}><span></span>${no}</label>
    </div>`;
}

function vssRadioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value === "yes" : undefined;
}

function vssQuestion(label, control, aside) {
    return `<div class="vss-question"><div class="vss-question-label">${label}${aside ? ` <span class="vss-muted">${aside}</span>` : ""}</div>${control}</div>`;
}

function vssAdditionalForm() {
    const p = vssData.profile || {};
    const tab = (key, label) => `<button type="button" class="vss-tab${vssAdditionalTab === key ? " vss-tab-active" : ""}" onclick="vssSetAdditionalTab('${key}')">${label}</button>`;
    const tabs = `<div class="vss-tabs">${tab("shop", "Shop Details")}${tab("catalog", "Catalog Details")}</div>`;

    if (vssAdditionalTab === "shop") {
        const selected = new Set(p.seller_types || []);
        const opts = vssData.seller_type_options || [];
        const summary = opts.filter((o) => selected.has(o.code)).map((o) => o.label).join(", ");
        const sellerType = `<details class="vss-multi" id="vss-sellertypes"><summary class="vss-input vss-select"><span data-summary data-placeholder="Select all that apply">${summary ? vssV(summary) : '<span class="vss-placeholder">Select all that apply</span>'}</span></summary>
            <div class="vss-multi-menu">${opts.map((o) => `<label class="vss-multi-opt"><input type="checkbox" value="${o.code}"${selected.has(o.code) ? " checked" : ""} onchange="vssMultiSummary('vss-sellertypes')"> ${vssV(o.label)}</label>`).join("")}</div></details>`;
        return tabs
            + vssQuestion("Do you have an existing shop on Lizimas Store?", vssRadio("vss-existing", p.has_existing_shop, "Yes, I have an existing account on Lizimas Store", "No, it's my first time with Lizimas Store"))
            + vssQuestion("What type of Seller are you?", sellerType, "(Select all that apply)")
            + `<div class="vss-actions vss-actions-split"><button type="button" class="vss-btn vss-btn-outline" onclick="vssSaveAdditional('shop', true)">Next</button><button type="button" class="vss-btn" onclick="vssSaveAdditional('shop', false)">Save</button></div><div class="vss-status" id="vss-additional-status"></div>`;
    }

    const cats = vssData.category_options || [];
    const catSelect = `<select id="vss-category" class="vss-input vss-select"><option value="">Your primary product type</option>${cats.map((c) => `<option value="${Number(c.id)}"${Number(p.primary_category_id) === Number(c.id) ? " selected" : ""}>${vssV(c.name)}</option>`).join("")}</select>`;
    const srcSelect = `<select id="vss-sourcing" class="vss-input vss-select"><option value="">How you source your products</option>${(vssData.sourcing_options || []).map((o) => `<option value="${o.code}"${p.sourcing_method === o.code ? " selected" : ""}>${vssV(o.label)}</option>`).join("")}</select>`;
    return tabs
        + vssQuestion("Select Product Category", catSelect)
        + vssQuestion("How do you source your products?", srcSelect)
        + vssQuestion("Do you also sell offline?", vssRadio("vss-offline", p.sells_offline, "Yes, I sell offline", "No, I don't sell offline"))
        + vssQuestion("Do you use other online channels?", vssRadio("vss-channels", p.uses_other_channels, "Yes, I use other online channels", "No, I don't use other online channels"))
        + `<div class="vss-actions"><button type="button" class="vss-btn" onclick="vssSaveAdditional('catalog', false)">Save</button></div><div class="vss-status" id="vss-additional-status"></div>`;
}

function vssSetAdditionalTab(key) { vssAdditionalTab = key; vssRenderForm(); }

async function vssSaveAdditional(tab, goNext) {
    let body;
    if (tab === "shop") {
        body = { has_existing_shop: vssRadioValue("vss-existing"), seller_types: vssMultiValues("vss-sellertypes") };
        if (body.has_existing_shop === undefined) { vssStatus("vss-additional-status", "Tell us whether you have an existing shop.", "error"); return; }
        if (!body.seller_types.length) { vssStatus("vss-additional-status", "Select at least one seller type.", "error"); return; }
    } else {
        body = {
            primary_category_id: vssVal("vss-category"),
            sourcing_method: vssVal("vss-sourcing"),
            sells_offline: vssRadioValue("vss-offline"),
            uses_other_channels: vssRadioValue("vss-channels")
        };
        if (!body.primary_category_id) { vssStatus("vss-additional-status", "Select your primary product category.", "error"); return; }
        if (!body.sourcing_method) { vssStatus("vss-additional-status", "Select how you source your products.", "error"); return; }
        if (body.sells_offline === undefined || body.uses_other_channels === undefined) { vssStatus("vss-additional-status", "Please answer both questions.", "error"); return; }
    }
    const ok = await vssSave("/api/vendors/me/shop-setup/additional", body, "vss-additional-status", "Additional information saved.");
    if (ok && goNext) {
        vssAdditionalTab = "catalog";
        vssRenderForm();
    }
}
