// Vendors (admin) - Oct 2026 redesign (Ryan's designs):
//
//  1. Vendors list: tabs (All / Pending Review / On Hold / Restricted /
//     Active / Suspended), search, Export, pages of 10. Columns: Vendor /
//     Store, Owner, Status, Compliance, Documents (3/5 bar), Joined,
//     Actions (View, Review Documents, ⋮ menu).
//  2. Vendor Profile page (opens over the admin): header with Message
//     Vendor / Hold / Suspend, and tabs Overview, Documents, Orders,
//     Products, Payouts, Activity Log.
//  3. Documents tab = Document Review: every required document with its
//     file, upload date, automatic checks (incl. the name check), View and
//     Approve / Reject, plus "Approve All & Activate Store" and
//     "Reject & Request Resubmission".
//  4. Hold for documents (migration 145): the vendor's products are hidden,
//     the shop is unavailable, payouts and product changes are blocked until
//     the chosen documents are approved - then the hold lifts by itself.
//
// Data: GET /api/admin/vendors (vendorComplianceCache in admin.js), plus per
// vendor /kyc (documents), /profile (numbers, orders, payouts), /products
// and /compliance-history. Every action is recorded in
// vendor_compliance_actions and shown to the vendor as a notice.
(function () {
    "use strict";

    const PAGE_SIZE = 10;
    const state = { q: "", tab: "all", page: 1, profileId: null, profileTab: "overview", data: {} };

    const esc = (s) => String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const ugx = (n) => "UGX " + Math.round(Number(n) || 0).toLocaleString();
    const fmtDate = (d, withTime) => {
        if (!d) return "-";
        const t = new Date(d);
        if (isNaN(t)) return "-";
        return t.toLocaleString([], withTime
            ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
            : { day: "numeric", month: "short", year: "numeric" });
    };

    const STATUS = {
        approved: ["Approved", "vc-b-green"], pending: ["Pending", "vc-b-grey"], suspended: ["Suspended", "vc-b-red"],
        rejected: ["Rejected", "vc-b-red"]
    };
    const COMPLIANCE = {
        compliant: ["Fully Verified", "vc-b-green"], documents_pending: ["Incomplete", "vc-b-orange"],
        under_review: ["Under Review", "vc-b-blue"], restricted: ["Restricted", "vc-b-red"], on_hold: ["On Hold", "vc-b-red"]
    };
    const DOC_STATUS = {
        missing: ["Missing", "vc-b-red"], submitted: ["Submitted", "vc-b-blue"],
        approved: ["Approved", "vc-b-green"], rejected: ["Re-upload needed", "vc-b-orange"]
    };
    const KYC_LABEL = {
        not_started: "Not started", submitted: "Submitted", under_review: "Under Review", action_required: "Action required",
        verified: "Verified", rejected: "Rejected", suspended: "Suspended"
    };
    const DOC_LABELS = {
        national_id: "Identity Document (National ID, Passport or Driving Licence)",
        business_registration: "Business Registration", bank_certificate: "Bank Certificate",
        tax_certificate: "Tax Certificate (TIN)", vat_certificate: "VAT Certificate", momo_statement: "Mobile Money Statement",
        certificate_of_incorporation: "Certificate of Incorporation", form_20: "Form 20 (Particulars of Directors)", work_permit: "Work Permit"
    };
    const AVATAR_COLOURS = ["#f4b400", "#1a1a2e", "#2563eb", "#0f766e", "#ea580c", "#7c3aed", "#ca8a04", "#db2777"];

    const ICON = {
        store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5M10 20v-5h4v5"/>',
        box: '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4ZM4 7l8 4 8-4M12 11v10"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        docplus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M14 3v5h5M14 3l5 5v3"/><circle cx="17" cy="17" r="4"/><path d="M17 15v4M15 17h4"/>',
        warn: '<path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
        ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
        freeze: '<rect x="3" y="5" width="16" height="12" rx="2"/><path d="M3 9h16"/><circle cx="18" cy="17" r="4"/><path d="m15.2 19.8 5.6-5.6"/>',
        user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
        unfreeze: '<rect x="3" y="5" width="16" height="12" rx="2"/><path d="M3 9h16M8 13h3"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
        check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.7"/>',
        tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4M14.5 10h3.5M14.5 13.5h3.5"/>',
        shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z"/>',
        bank: '<path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3.5 20h17"/>',
        file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
        image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3.5 18 5.5-5.5 4 4 3-3 4.5 4.5"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
        upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
        dots: '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
        download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
        back: '<path d="m15 18-6-6 6-6"/>',
        lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
        unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
        chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
        money: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.6 5.8 4.4 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.6-3-1.6M12 6.3v1.5M12 16.5V18"/>',
        bag: '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
        star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5 2.6 1-5.6-4.1-3.9 5.6-.8L12 3.8Z"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>',
        chev: '<path d="m6 9 6 6 6-6"/>'
    };
    const svg = (name, size) => '<svg class="vc-ico" viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
        '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || "") + "</svg>";
    const badge = (map, key, dot) => {
        const m = map[key] || [String(key || "-").replace(/_/g, " "), "vc-b-grey"];
        return '<span class="vc-badge ' + m[1] + '">' + (dot ? '<i class="vc-dot"></i>' : "") + esc(m[0]) + "</span>";
    };
    const initials = (name) => String(name || "?").replace(/[^A-Za-z0-9\s]/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
    const avatar = (v, size) => {
        let h = 0;
        for (const ch of String(v.business_name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        const bg = AVATAR_COLOURS[h % AVATAR_COLOURS.length];
        return '<span class="vc-avatar' + (size ? " vc-avatar-" + size : "") + '" style="background:' + bg + ";color:" + (bg === "#f4b400" || bg === "#ca8a04" ? "#1a1a2e" : "#fff") + '">' +
            esc(initials(v.business_name)) + "</span>";
    };
    const docIcon = (type) => ({ national_id: "id", work_permit: "id", form_20: "user", tax_certificate: "shield",
        vat_certificate: "shield", bank_certificate: "bank", momo_statement: "bank" }[type] || "file");
    const vendors = () => (typeof vendorComplianceCache !== "undefined" && Array.isArray(vendorComplianceCache)) ? vendorComplianceCache : [];
    const byId = (id) => vendors().find(v => v.id === id);
    const docsProgress = (v) => {
        const docs = v.required_documents || [];
        return { done: docs.filter(d => d.status === "approved").length, sent: docs.filter(d => d.status !== "missing").length, total: docs.length };
    };

    // ---------- list ----------
    const TABS = [
        ["all", "All"], ["review", "Pending Review"], ["hold", "On Hold"], ["restricted", "Restricted"],
        ["active", "Active"], ["suspended", "Suspended"]
    ];
    function inTab(v, tab) {
        switch (tab) {
            case "review": return v.status === "pending" || v.compliance === "under_review";
            case "hold": return !!v.documents_hold;
            case "restricted": return v.compliance === "restricted" && v.status !== "suspended";
            case "active": return v.status === "approved" && !v.documents_hold && v.compliance !== "restricted";
            case "suspended": return v.status === "suspended";
            default: return true;
        }
    }
    function filtered() {
        const q = state.q.trim().toLowerCase();
        return vendors().filter(v => inTab(v, state.tab)).filter(v => !q ||
            [v.business_name, v.shop_id, v.owner_name, v.owner_email, v.phone].some(x => String(x || "").toLowerCase().includes(q)));
    }

    function ensureShell(container) {
        if (container.dataset.vcShell === "2") return;
        container.dataset.vcShell = "2";
        container.innerHTML =
            '<div class="vc-toolbar">' +
                '<div class="vc-tabs" role="tablist" id="vc-tabs"></div>' +
                '<button type="button" class="vc-btn vc-btn-gold" id="vc-export">' + svg("download", 16) + " Export</button>" +
            "</div>" +
            '<label class="vc-search">' + svg("search") +
                '<input type="search" id="vc-q" placeholder="Search vendors, Shop ID, owner, email, phone..." autocomplete="off"></label>' +
            '<div class="vc-table-wrap" id="vc-table"></div>' +
            '<div class="vc-foot" id="vc-foot"></div>';
        const q = container.querySelector("#vc-q");
        q.addEventListener("input", () => { state.q = q.value; state.page = 1; renderTable(); });
        container.querySelector("#vc-export").addEventListener("click", exportCsv);
        container.addEventListener("click", onTableClick);
    }

    function renderTabs() {
        const box = document.getElementById("vc-tabs");
        if (!box) return;
        box.innerHTML = TABS.map(([k, label]) => {
            const n = vendors().filter(v => inTab(v, k)).length;
            return '<button type="button" role="tab" class="vc-tab' + (state.tab === k ? " on" : "") + '" data-vc-tab="' + k + '" aria-selected="' + (state.tab === k) + '">' +
                esc(label) + (k !== "all" && n ? ' <span class="vc-tab-n">' + n + "</span>" : "") + "</button>";
        }).join("");
    }

    function renderTable() {
        renderTabs();
        const box = document.getElementById("vc-table");
        const foot = document.getElementById("vc-foot");
        if (!box) return;
        const list = filtered();
        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        state.page = Math.min(state.page, pages);
        const start = (state.page - 1) * PAGE_SIZE;
        const rows = list.slice(start, start + PAGE_SIZE);

        if (!vendors().length) box.innerHTML = '<p class="no-data">No vendors yet.</p>';
        else if (!rows.length) box.innerHTML = '<p class="no-data">No vendors here.</p>';
        else {
            box.innerHTML =
                '<table class="vc-table"><thead><tr><th>Vendor / Store</th><th>Owner</th><th>Status</th><th>Compliance</th>' +
                "<th>Documents</th><th>Joined</th><th class=\"vc-th-actions\">Actions</th></tr></thead><tbody>" +
                rows.map(v => {
                    const p = docsProgress(v);
                    const pct = p.total ? Math.round(p.done / p.total * 100) : 100;
                    const tone = v.compliance === "compliant" ? "green" : (v.compliance === "restricted" || v.compliance === "on_hold") ? "red"
                        : v.compliance === "under_review" ? "blue" : "orange";
                    return '<tr class="vc-row" data-vc-open="' + v.id + '" tabindex="0">' +
                        '<td data-label="Vendor"><div class="vc-biz">' + avatar(v) + "<div>" +
                            '<div class="vc-name">' + esc(v.business_name) + "</div>" +
                            '<div class="vc-sub">' + (v.shop_id ? esc(v.shop_id) : "No Shop ID yet") + "</div></div></div></td>" +
                        '<td data-label="Owner"><div class="vc-name vc-name-sm">' + esc(v.owner_name) + '</div><div class="vc-sub">' + esc(v.owner_email) + "</div></td>" +
                        '<td data-label="Status">' + badge(STATUS, v.status) + (v.payout_frozen ? '<div class="vc-mini-red">Payouts frozen</div>' : "") + "</td>" +
                        '<td data-label="Compliance">' + badge(COMPLIANCE, v.compliance, true) + "</td>" +
                        '<td data-label="Documents"><div class="vc-prog"><strong>' + p.done + "/" + p.total + "</strong>" +
                            '<span class="vc-bar"><span class="vc-bar-' + tone + '" style="width:' + pct + '%"></span></span></div>' +
                            (p.sent > p.done ? '<div class="vc-sub">' + (p.sent - p.done) + " waiting review</div>" : "") + "</td>" +
                        '<td data-label="Joined" class="vc-sub vc-nowrap">' + fmtDate(v.submitted_at) + "</td>" +
                        '<td class="vc-td-actions"><div class="vc-row-btns">' +
                            '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-view="' + v.id + '">' + svg("eye", 15) + " View</button>" +
                            '<button type="button" class="vc-btn-outline vc-btn-sm vc-hide-sm" data-vc-docs="' + v.id + '">' + svg("file", 15) + " Review Documents</button>" +
                            '<button type="button" class="vc-dots" data-vc-menu="' + v.id + '" aria-label="More actions for ' + esc(v.business_name) + '" aria-haspopup="menu">' + svg("dots", 20) + "</button>" +
                        "</div></td></tr>";
                }).join("") + "</tbody></table>";
        }
        if (foot) {
            const from = list.length ? start + 1 : 0, to = Math.min(start + PAGE_SIZE, list.length);
            let pager = "";
            if (pages > 1) {
                pager = '<div class="vc-pager"><button type="button" data-vc-page="' + (state.page - 1) + '"' + (state.page === 1 ? " disabled" : "") + ' aria-label="Previous page">&larr;</button>';
                for (let i = 1; i <= pages; i++) pager += '<button type="button" data-vc-page="' + i + '" class="' + (i === state.page ? "on" : "") + '">' + i + "</button>";
                pager += '<button type="button" data-vc-page="' + (state.page + 1) + '"' + (state.page === pages ? " disabled" : "") + ' aria-label="Next page">&rarr;</button></div>';
            }
            foot.innerHTML = "<span>Showing " + from + "&ndash;" + to + " of " + list.length + " vendor" + (list.length === 1 ? "" : "s") + "</span>" + pager;
        }
    }

    function onTableClick(e) {
        const t = e.target;
        const tab = t.closest("[data-vc-tab]");
        if (tab) { state.tab = tab.dataset.vcTab; state.page = 1; renderTable(); return; }
        const menuBtn = t.closest("[data-vc-menu]");
        if (menuBtn) { e.stopPropagation(); openMenu(Number(menuBtn.dataset.vcMenu), menuBtn); return; }
        const pageBtn = t.closest("[data-vc-page]");
        if (pageBtn) { state.page = Number(pageBtn.dataset.vcPage); renderTable(); return; }
        const docs = t.closest("[data-vc-docs]");
        if (docs) { e.stopPropagation(); openProfile(Number(docs.dataset.vcDocs), "documents"); return; }
        const view = t.closest("[data-vc-view]");
        if (view) { e.stopPropagation(); openProfile(Number(view.dataset.vcView), "overview"); return; }
        const row = t.closest("[data-vc-open]");
        if (row) openProfile(Number(row.dataset.vcOpen), "overview");
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches && e.target.matches(".vc-row")) openProfile(Number(e.target.dataset.vcOpen), "overview");
        if (e.key === "Escape") {
            if (closeMenu()) return;
            if (document.querySelector(".vc-modal-back")) return;
            closeProfile();
        }
    });

    // ---------- ⋮ menu ----------
    function menuItems(v) {
        const items = [
            ["vendor-center", "store", "View Vendor Center"],
            ["products", "box", "View Products"],
            ["history", "clock", "View History"],
            "-",
            ["request-docs", "docplus", "Send Required Documents", "vc-mi-primary", !(v.documents_needed || []).length ? "Nothing missing" : ""],
            v.documents_hold ? ["release", "unlock", "Release Hold", "vc-mi-green"] : ["hold", "lock", "Hold for Documents", "vc-mi-red"],
            ["warn", "warn", "Warn Vendor", "vc-mi-amber"]
        ];
        if (v.status !== "suspended") items.push(["suspend", "ban", "Suspend Vendor", "vc-mi-red"]);
        if (!v.payout_frozen) items.push(["freeze", "freeze", "Freeze Payouts", "vc-mi-purple"]);
        const extra = [];
        if (v.status === "suspended") extra.push(["reinstate", "user", "Reinstate Vendor", "vc-mi-green"]);
        if (v.payout_frozen) extra.push(["unfreeze", "unfreeze", "Unfreeze Payouts", "vc-mi-green"]);
        if (extra.length) items.push("-", ...extra);
        return items;
    }
    function openMenu(id, anchor) {
        const v = byId(id);
        if (!v) return;
        const wasOpen = document.querySelector('.vc-menu[data-for="' + id + '"]');
        closeMenu();
        if (wasOpen) return;
        const menu = document.createElement("div");
        menu.className = "vc-menu";
        menu.dataset.for = id;
        menu.setAttribute("role", "menu");
        menu.innerHTML = menuItems(v).map(it => it === "-" ? '<div class="vc-menu-sep" role="separator"></div>' :
            '<button type="button" role="menuitem" class="vc-mi ' + (it[3] || "") + '" data-vc-act="' + it[0] + '"' + (it[4] ? " disabled" : "") + ">" +
                svg(it[1], 20) + "<span>" + esc(it[2]) + (it[4] ? "<small>" + esc(it[4]) + "</small>" : "") + "</span></button>").join("");
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        let top = r.bottom + 6, left = r.right - mw;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
        if (left < 8) left = 8;
        menu.style.top = top + "px";
        menu.style.left = left + "px";
        menu.addEventListener("click", (e) => {
            const b = e.target.closest("[data-vc-act]");
            if (!b || b.disabled) return;
            closeMenu();
            runAction(b.dataset.vcAct, id);
        });
        const first = menu.querySelector(".vc-mi:not([disabled])");
        if (first) first.focus();
    }
    function closeMenu() {
        const m = document.querySelector(".vc-menu");
        if (m) { m.remove(); return true; }
        return false;
    }
    document.addEventListener("click", (e) => { if (!e.target.closest(".vc-menu") && !e.target.closest("[data-vc-menu]")) closeMenu(); });
    window.addEventListener("scroll", () => closeMenu(), true);
    window.addEventListener("resize", () => closeMenu());

    // ---------- dialogs ----------
    function ask(opts) {
        return new Promise((resolve) => {
            const back = document.createElement("div");
            back.className = "vc-modal-back";
            back.innerHTML =
                '<div class="vc-modal' + (opts.wide ? " vc-modal-wide" : "") + '" role="dialog" aria-modal="true" aria-labelledby="vc-modal-title">' +
                    '<h3 id="vc-modal-title">' + esc(opts.title) + "</h3>" +
                    (opts.html ? '<div class="vc-modal-body">' + opts.html + "</div>" : "") +
                    (opts.label ? '<label class="vc-modal-label">' + esc(opts.label) + (opts.optional ? " <em>(optional)</em>" : "") +
                        '<textarea rows="3" id="vc-modal-text" placeholder="' + esc(opts.placeholder || "") + '">' + esc(opts.value || "") + "</textarea></label>" : "") +
                    '<p class="vc-modal-err" id="vc-modal-err" hidden></p>' +
                    '<div class="vc-modal-actions"><button type="button" class="vc-btn-outline" data-x="cancel">Cancel</button>' +
                        '<button type="button" class="vc-btn ' + (opts.danger ? "vc-btn-red" : opts.green ? "vc-btn-green" : "") + '" data-x="ok">' + esc(opts.ok || "Confirm") + "</button></div>" +
                "</div>";
            document.body.appendChild(back);
            const text = back.querySelector("#vc-modal-text");
            const err = back.querySelector("#vc-modal-err");
            const done = (val) => { back.remove(); document.removeEventListener("keydown", key, true); resolve(val); };
            const fail = (msg) => { err.textContent = msg; err.hidden = false; };
            const ok = () => {
                const val = text ? text.value.trim() : "";
                if (text && !opts.optional && !val) { fail("Please write a reason - the vendor will see it."); text.focus(); return; }
                let extra = null;
                if (opts.collect) {
                    extra = opts.collect(back);
                    if (extra && extra.error) { fail(extra.error); return; }
                }
                done(opts.collect ? { text: val, extra } : (val || (text ? "" : true)));
            };
            const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
            document.addEventListener("keydown", key, true);
            back.addEventListener("click", (e) => {
                if (e.target === back || e.target.dataset.x === "cancel") done(null);
                if (e.target.dataset.x === "ok") ok();
                const preset = e.target.closest("[data-preset]");
                if (preset && text) { text.value = preset.dataset.preset; text.focus(); }
            });
            if (opts.onOpen) opts.onOpen(back);
            (text || back.querySelector('[data-x="ok"]')).focus();
        });
    }
    function toast(msg, bad) {
        const t = document.createElement("div");
        t.className = "vc-toast" + (bad ? " vc-toast-bad" : "");
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    }
    async function call(method, path, body) {
        const res = await fetch(API_URL + path, {
            method,
            headers: Object.assign({ "Authorization": "Bearer " + getToken() }, body ? { "Content-Type": "application/json" } : {}),
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || ("Request failed (" + res.status + ")"));
        return data;
    }
    async function refresh() {
        await loadVendorCompliancePanel();
        if (state.profileId) await loadProfile(state.profileId, true);
    }

    const NAME_PRESET = "The name on this document doesn't match the name on your Lizimas account. Please upload the proper document showing your registered name.";
    const presetButtons = () => '<div class="vc-presets">' +
        '<button type="button" class="vc-chip" data-preset="' + esc(NAME_PRESET) + '">Names don\'t match</button>' +
        '<button type="button" class="vc-chip" data-preset="The document is unclear or cut off. Please upload a clear photo or scan showing the whole document.">Unclear / cut off</button>' +
        '<button type="button" class="vc-chip" data-preset="This document has expired. Please upload a valid, current document.">Expired</button>' +
        '<button type="button" class="vc-chip" data-preset="This is not the document we asked for. Please upload the correct document.">Wrong document</button></div>';

    // ---------- actions ----------
    async function runAction(act, id) {
        const v = byId(id);
        if (!v) return;
        const name = v.business_name;
        try {
            if (act === "vendor-center") return viewVendorCenterDetails(id);
            if (act === "products") return openProfile(id, "products");
            if (act === "history") return openProfile(id, "activity");
            if (act === "documents") return openProfile(id, "documents");

            if (act === "request-docs") {
                const needed = (v.required_documents || []).filter(d => d.status === "missing" || d.status === "rejected");
                if (!needed.length) return toast(name + " has no missing or rejected documents.");
                const note = await ask({
                    title: "Send required documents request",
                    html: "<p>" + esc(name) + " will get a notice asking them to upload:</p><ul class=\"vc-need\">" +
                        needed.map(d => "<li>" + svg(docIcon(d.type), 16) + esc(d.label) + " " + badge(DOC_STATUS, d.status) + "</li>").join("") + "</ul>",
                    label: "Message to add", optional: true, placeholder: "e.g. Please upload within 7 days.", ok: "Send request"
                });
                if (note === null) return;
                await call("POST", "/api/admin/vendors/" + id + "/request-documents", { note: note === true ? "" : note });
                toast("Document request sent to " + name + ".");
            } else if (act === "hold") {
                const r = await holdDialog(v);
                if (!r) return;
                await call("POST", "/api/admin/vendors/" + id + "/hold", { documents: r.extra.documents, note: r.text });
                toast(name + " is on hold until the documents are approved.");
            } else if (act === "release") {
                if (!(await ask({ title: "Release the hold on " + name + "?", html: "<p>Their shop, products and payouts come back now, even if the documents aren't approved yet. (The hold also lifts by itself once they are.)</p>", ok: "Release hold", green: true }))) return;
                await call("POST", "/api/admin/vendors/" + id + "/release-hold", {});
                toast("Hold released for " + name + ".");
            } else if (act === "warn") {
                const reason = await ask({ title: "Warn " + name, label: "Reason for this warning (shown to the vendor)", ok: "Send warning" });
                if (!reason) return;
                await call("POST", "/api/admin/vendors/" + id + "/warn", { reason });
                toast("Warning sent to " + name + ".");
            } else if (act === "suspend") {
                const reason = await ask({ title: "Suspend " + name + "?", html: "<p>Their shop page closes and their products are hidden from the store immediately. To ask for documents instead, use <strong>Hold for Documents</strong>.</p>",
                    label: "Reason (shown to the vendor)", ok: "Suspend vendor", danger: true });
                if (!reason) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/suspend", { reason });
                toast(name + " is suspended.");
            } else if (act === "reinstate") {
                if (!(await ask({ title: "Reinstate " + name + "?", html: "<p>Their shop and products come back on the store.</p>", ok: "Reinstate", green: true }))) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/reinstate");
                toast(name + " is reinstated.");
            } else if (act === "freeze") {
                const reason = await ask({ title: "Freeze payouts for " + name + "?", html: "<p>They can't request new payouts until you unfreeze them.</p>",
                    label: "Reason (shown to the vendor)", ok: "Freeze payouts", danger: true });
                if (!reason) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/freeze-payouts", { reason });
                toast("Payouts frozen for " + name + ".");
            } else if (act === "unfreeze") {
                if (!(await ask({ title: "Unfreeze payouts for " + name + "?", ok: "Unfreeze payouts", green: true }))) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/unfreeze-payouts");
                toast("Payouts unfrozen for " + name + ".");
            } else if (act === "assign-shop-id") {
                await call("PATCH", "/api/admin/vendors/" + id + "/regenerate-shop-id");
                toast("Shop ID assigned.");
            } else if (act === "message") {
                return messageVendor(v);
            }
            await refresh();
        } catch (err) {
            console.error("Vendor action:", err);
            toast(err.message || "Something went wrong.", true);
        }
    }

    function holdDialog(v) {
        const req = (v.required_documents || []).map(d => d.type);
        const all = Object.keys(DOC_LABELS);
        const pre = new Set((v.required_documents || []).filter(d => d.status !== "approved").map(d => d.type));
        if (!pre.size) req.forEach(t => pre.add(t));
        const row = (t) => '<label class="vc-check"><input type="checkbox" value="' + t + '"' + (pre.has(t) ? " checked" : "") + "> " +
            esc(DOC_LABELS[t]) + (req.includes(t) ? "" : ' <em>(extra)</em>') + "</label>";
        return ask({
            title: "Hold " + v.business_name + " for documents",
            wide: true,
            html: '<p>Until the documents you tick are uploaded <strong>and approved</strong>:</p>' +
                '<ul class="vc-bullets"><li>their products are hidden and their shop page shows as unavailable</li>' +
                "<li>they can't add or edit products, and payouts are blocked</li>" +
                "<li>orders already placed carry on as normal</li>" +
                "<li>they can still sign in and upload - the hold lifts by itself once everything is approved</li></ul>" +
                '<div class="vc-checks">' + req.map(row).join("") +
                '<details class="vc-more"><summary>Other documents</summary>' + all.filter(t => !req.includes(t)).map(row).join("") + "</details></div>" +
                '<p class="vc-small">An already-approved document you tick is set back to "re-upload needed".</p>',
            label: "Message to the vendor", optional: true, placeholder: "e.g. The name on your ID doesn't match your account.",
            ok: "Put on hold", danger: true,
            collect: (back) => {
                const documents = [...back.querySelectorAll(".vc-checks input:checked")].map(i => i.value);
                return documents.length ? { documents } : { error: "Tick at least one document." };
            }
        });
    }

    function messageVendor(v) {
        let phone = String(v.phone || "").replace(/[^0-9+]/g, "");
        if (phone.startsWith("+")) phone = phone.slice(1);
        else if (phone.startsWith("0")) phone = "256" + phone.slice(1);
        const text = "Hello " + (v.owner_name || v.business_name) + ", this is Lizimas Store about your shop " + v.business_name + (v.shop_id ? " (" + v.shop_id + ")" : "") + ".";
        if (phone.length >= 9) window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(text), "_blank", "noopener");
        else if (v.owner_email) window.location.href = "mailto:" + v.owner_email + "?subject=" + encodeURIComponent("Lizimas Store - " + v.business_name) + "&body=" + encodeURIComponent(text);
        else toast("This vendor has no phone number or email on file.", true);
    }

    // ---------- profile page ----------
    const PTABS = [["overview", "Overview"], ["documents", "Documents"], ["orders", "Orders"], ["products", "Products"], ["payouts", "Payouts"], ["activity", "Activity Log"]];

    function openProfile(id, tab) {
        if (!byId(id)) return;
        state.profileId = id;
        state.profileTab = tab || "overview";
        state.data = {};
        let page = document.getElementById("vc-profile");
        if (!page) {
            page = document.createElement("div");
            page.id = "vc-profile";
            page.className = "vc-profile";
            page.setAttribute("role", "dialog");
            page.setAttribute("aria-modal", "true");
            page.setAttribute("aria-label", "Vendor profile");
            document.body.appendChild(page);
            page.addEventListener("click", onProfileClick);
            page.addEventListener("change", (e) => {
                if (e.target.matches("[data-vc-docsel]")) renderBulkBar();
            });
        }
        document.body.classList.add("vc-profile-open");
        page.hidden = false;
        page.scrollTop = 0;
        renderProfile();
        loadProfile(id);
    }
    function closeProfile() {
        const page = document.getElementById("vc-profile");
        if (!page || page.hidden) return;
        page.hidden = true;
        document.body.classList.remove("vc-profile-open");
        state.profileId = null;
    }

    async function loadProfile(id, silent) {
        const get = (p) => authorizedFetch(p).catch(e => ({ __error: e.message }));
        const [kyc, profile, history, products] = await Promise.all([
            get("/api/admin/vendors/" + id + "/kyc"),
            get("/api/admin/vendors/" + id + "/profile"),
            get("/api/admin/vendors/" + id + "/compliance-history"),
            get("/api/admin/vendors/" + id + "/products")
        ]);
        if (state.profileId !== id) return;
        state.data = { kyc, profile, history: Array.isArray(history) ? history : [], products: Array.isArray(products) ? products : [] };
        renderProfile();
        if (!silent && state.profileTab !== "overview") {
            const t = document.querySelector(".vc-ptabs");
            if (t) t.scrollIntoView({ block: "start" });
        }
    }

    function renderProfile() {
        const page = document.getElementById("vc-profile");
        const v = byId(state.profileId);
        if (!page || !v) return;
        const p = docsProgress(v);
        const phone = v.phone ? esc(v.phone) : "No phone";
        page.innerHTML =
            '<div class="vc-p-inner">' +
                '<button type="button" class="vc-back" data-vc-close>' + svg("back", 18) + " Back to Vendors</button>" +
                (v.documents_hold ? holdBanner(v) : "") +
                '<header class="vc-p-head">' + avatar(v, "xl") +
                    '<div class="vc-p-id"><h2>' + esc(v.business_name) + " " + badge(COMPLIANCE, v.compliance, true) + "</h2>" +
                        '<div class="vc-p-meta">' +
                            "<span>" + svg("user", 15) + esc(v.owner_name) + "</span>" +
                            "<span>" + svg("mail", 15) + esc(v.owner_email) + "</span>" +
                            "<span>" + svg("chat", 15) + phone + "</span>" +
                            "<span>" + svg("store", 15) + (v.shop_id ? "Shop ID: " + esc(v.shop_id)
                                : 'No Shop ID' + (v.status === "approved" ? ' &middot; <button type="button" class="vc-link" data-vc-act="assign-shop-id">Assign</button>' : "")) + "</span>" +
                            "<span>" + svg("clock", 15) + "Joined: " + fmtDate(v.submitted_at) + "</span>" +
                            "<span>" + badge(STATUS, v.status) + (v.payout_frozen ? ' <span class="vc-badge vc-b-red">Payouts frozen</span>' : "") + "</span>" +
                        "</div></div>" +
                    '<div class="vc-p-actions">' +
                        '<button type="button" class="vc-btn" data-vc-act="message">' + svg("chat", 16) + " Message Vendor</button>" +
                        (v.documents_hold
                            ? '<button type="button" class="vc-btn-outline" data-vc-act="release">' + svg("unlock", 16) + " Release Hold</button>"
                            : '<button type="button" class="vc-btn-outline vc-btn-danger" data-vc-act="hold">' + svg("lock", 16) + " Hold for Documents</button>") +
                        (v.status === "suspended"
                            ? '<button type="button" class="vc-btn-outline" data-vc-act="reinstate">' + svg("user", 16) + " Reinstate</button>"
                            : '<button type="button" class="vc-btn-outline vc-btn-danger" data-vc-act="suspend">' + svg("ban", 16) + " Suspend Account</button>") +
                        '<button type="button" class="vc-dots vc-dots-box" data-vc-pmenu aria-label="More actions" aria-haspopup="menu">' + svg("dots", 20) + "</button>" +
                    "</div>" +
                "</header>" +
                '<nav class="vc-ptabs" role="tablist">' + PTABS.map(([k, label]) =>
                    '<button type="button" role="tab" class="vc-ptab' + (state.profileTab === k ? " on" : "") + '" data-vc-ptab="' + k + '">' + esc(label) +
                    (k === "documents" && p.total ? ' <span class="vc-tab-n">' + p.done + "/" + p.total + "</span>" : "") + "</button>").join("") + "</nav>" +
                '<div class="vc-p-body" id="vc-p-body">' + renderTab(v) + "</div>" +
            "</div>";
        if (state.profileTab === "documents") renderBulkBar();
    }

    function holdBanner(v) {
        const docs = (v.hold_documents || []).map(t => DOC_LABELS[t] || t).join(", ");
        return '<div class="vc-alert vc-alert-red">' + svg("lock", 22) + "<div><strong>On hold for documents</strong>" +
            "<p>Products hidden, shop unavailable, payouts and product changes blocked until these are approved: " + esc(docs) +
            ". Since " + fmtDate(v.hold_started_at) + ".</p></div></div>";
    }

    const loading = '<div class="vc-card"><p class="no-data">Loading...</p></div>';
    function renderTab(v) {
        const d = state.data;
        switch (state.profileTab) {
            case "documents": return d.kyc ? tabDocuments(v, d.kyc) : loading;
            case "orders": return d.profile ? tabOrders(d.profile) : loading;
            case "products": return d.products ? tabProducts(d.products) : loading;
            case "payouts": return d.profile ? tabPayouts(v, d.profile) : loading;
            case "activity": return d.history ? tabActivity(d.history, v, true) : loading;
            default: return tabOverview(v, d);
        }
    }

    // Overview
    function tabOverview(v, d) {
        const p = docsProgress(v);
        const all = p.total && p.done === p.total;
        const m = d.profile && d.profile.metrics ? d.profile.metrics : null;
        const s = m && m.sales ? m.sales : {};
        const change = (now, prev) => {
            now = Number(now) || 0; prev = Number(prev) || 0;
            if (!prev) return now ? '<span class="vc-up">New this month</span>' : '<span class="vc-sub">No change</span>';
            const pc = Math.round((now - prev) / prev * 100);
            return '<span class="' + (pc >= 0 ? "vc-up" : "vc-down") + '">' + (pc >= 0 ? "&uarr; " : "&darr; ") + Math.abs(pc) + "%</span> vs previous 30 days";
        };
        const rating = m && m.rating && m.rating.reviews ? m.rating : null;
        const metric = (icon, tone, label, value, sub) => '<div class="vc-metric"><span class="vc-m-ico vc-t-' + tone + '">' + svg(icon, 20) + "</span>" +
            '<div><div class="vc-sub">' + label + '</div><div class="vc-m-val">' + value + '</div><div class="vc-m-sub">' + sub + "</div></div></div>";
        const docs = v.required_documents || [];
        return '<div class="vc-grid2">' +
            '<section class="vc-card"><h3>Compliance Status</h3>' +
                '<div class="vc-score">' + (all ? '<span class="vc-score-ico vc-t-green">' + svg("check", 34) + "</span>" : '<span class="vc-score-ico vc-t-amber">' + svg("warn", 30) + "</span>") +
                    '<div><div class="vc-score-num ' + (all ? "vc-green" : "vc-amber") + '">' + p.done + "/" + p.total + " <span>" + (all ? "Fully Verified" : esc((COMPLIANCE[v.compliance] || ["Incomplete"])[0])) + "</span></div>" +
                    '<div class="vc-sub">' + (all ? "All compliance requirements have been met." : (p.total - p.done) + " requirement" + (p.total - p.done === 1 ? "" : "s") + " still open.") + "</div></div></div>" +
                '<ul class="vc-checklist">' + docs.map(x => '<li><span class="vc-cl-ico vc-cl-' + x.status + '">' + svg(x.status === "approved" ? "check" : x.status === "missing" ? "x" : "clock", 18) + "</span>" +
                    "<span>" + esc(x.label) + "</span>" + badge(DOC_STATUS, x.status) + "</li>").join("") + "</ul>" +
            "</section>" +
            '<section class="vc-card"><div class="vc-card-head"><h3>Recent Activity</h3><button type="button" class="vc-link" data-vc-ptab="activity">View all activity</button></div>' +
                (d.history ? tabActivity(d.history, v, false) : '<p class="no-data">Loading...</p>') + "</section>" +
            '<section class="vc-card"><h3>Key Metrics</h3><div class="vc-metrics">' +
                metric("money", "green", "Total sales", m ? ugx(s.total_sales) : "-", m ? change(s.sales_30, s.sales_prev_30) : "") +
                metric("bag", "blue", "Orders", m ? Number(s.orders || 0).toLocaleString() : "-", m ? change(s.orders_30, s.orders_prev_30) : "") +
                metric("box", "violet", "Active listings", m && m.listings ? m.listings.active : "-", m && m.listings ? "of " + m.listings.total + " products" : "") +
                metric("star", "amber", "Rating", rating ? rating.avg_rating + " out of 5" : "No reviews", rating ? "Based on " + rating.reviews + " review" + (rating.reviews === 1 ? "" : "s") : "") +
            "</div></section>" +
            '<section class="vc-card"><div class="vc-card-head"><h3>Documents</h3><button type="button" class="vc-link" data-vc-ptab="documents">Review documents</button></div>' +
                '<table class="vc-mini"><thead><tr><th>Document</th><th>Status</th><th></th></tr></thead><tbody>' +
                docs.map(x => "<tr><td>" + svg(docIcon(x.type), 16) + " " + esc(x.label) + "</td><td>" + badge(DOC_STATUS, x.status) + "</td><td>" +
                    (x.status !== "missing" ? '<button type="button" class="vc-btn-outline vc-btn-xs" data-vc-docview="' + esc(x.type) + '">' + svg("eye", 14) + " View</button>" : "") + "</td></tr>").join("") +
                "</tbody></table></section>" +
        "</div>";
    }

    // Documents (Document Review)
    function tabDocuments(v, kyc) {
        if (kyc.__error) return '<div class="vc-card"><p class="no-data">Could not load the documents: ' + esc(kyc.__error) + "</p></div>";
        const docs = new Map((kyc.documents || []).map(d => [d.document_type, d]));
        const required = (v.required_documents || []).map(d => d.type);
        const extra = [...docs.keys()].filter(t => !required.includes(t));
        const rows = required.concat(extra).map(t => docRow(t, docs.get(t), required.includes(t)));
        const pending = (kyc.documents || []).filter(d => d.review_status === "pending").length;
        return '<section class="vc-card vc-review-head">' +
                '<div class="vc-biz">' + avatar(v, "lg") + '<div><div class="vc-name">' + esc(v.owner_name) + " &ndash; " + esc(v.business_name) + "</div>" +
                    '<div class="vc-sub">' + esc(v.owner_email) + " &middot; " + (v.shop_id ? "Shop ID " + esc(v.shop_id) + " &middot; " : "") + "Applied on " + fmtDate(v.submitted_at) + "</div>" +
                    '<div class="vc-sub">' + (v.account_type === "company" ? "Registered company" : "Individual seller") + "</div></div></div>" +
                '<div class="vc-review-status"><div class="vc-sub">Review Status</div>' + badge({ verified: ["Verified", "vc-b-green"], under_review: ["Under Review", "vc-b-blue"],
                    submitted: ["Submitted", "vc-b-blue"], action_required: ["Action required", "vc-b-orange"], rejected: ["Rejected", "vc-b-red"], not_started: ["Not started", "vc-b-grey"],
                    suspended: ["Suspended", "vc-b-red"] }, kyc.kyc_status, true) + "</div>" +
            "</section>" +
            "<h3 class=\"vc-h3\">Submitted Documents (" + (kyc.documents || []).length + ")" + (pending ? ' <span class="vc-badge vc-b-blue">' + pending + " to review</span>" : "") + "</h3>" +
            '<div class="vc-docrows">' + rows.join("") + "</div>" +
            '<div class="vc-bulk" id="vc-bulk"></div>' +
            '<div class="vc-review-actions">' +
                '<button type="button" class="vc-btn vc-btn-green vc-btn-lg" data-vc-bulk="approve">' + svg("check", 20) + " Approve All &amp; Activate Store</button>" +
                '<button type="button" class="vc-btn-outline vc-btn-lg vc-btn-danger" data-vc-bulk="reject">' + svg("x", 20) + " Reject &amp; Request Resubmission</button>" +
            "</div>";
    }

    function nameCheckPill(doc) {
        const ac = doc && doc.auto_checks ? (typeof doc.auto_checks === "string" ? safeJson(doc.auto_checks) : doc.auto_checks) : null;
        const nc = ac && ac.name_check;
        if (!nc) return '<span class="vc-pill vc-pill-grey" title="Uploaded before name checks started">Check names</span>';
        if (nc.result === "match") return '<span class="vc-pill vc-pill-green">' + svg("tick", 14) + " Name matches</span>";
        if (nc.result === "partial") return '<span class="vc-pill vc-pill-amber" title="Found: ' + esc((nc.found || []).join(" ")) + " &middot; Not found: " + esc((nc.missing || []).join(" ")) + '">' + svg("warn", 14) + " Name partly found</span>";
        if (nc.result === "mismatch") return '<span class="vc-pill vc-pill-red">' + svg("x", 14) + " Name mismatch</span>";
        if (nc.result === "unread") return '<span class="vc-pill vc-pill-grey">Name not readable - check</span>';
        return '<span class="vc-pill vc-pill-grey" title="PDF or text not read in the browser">Check names</span>';
    }
    function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

    function docRow(type, doc, required) {
        const label = DOC_LABELS[type] || type;
        if (!doc) {
            return '<div class="vc-docrow vc-docrow-missing"><span class="vc-filetype vc-ft-missing">' + svg(docIcon(type), 22) + "</span>" +
                '<div class="vc-docrow-main"><div class="vc-name vc-name-sm">' + esc(label) + '</div><div class="vc-sub">Not uploaded yet</div></div>' +
                '<div class="vc-docrow-when"></div>' + badge(DOC_STATUS, "missing") +
                '<div class="vc-docrow-btns"><button type="button" class="vc-btn-outline vc-btn-sm" data-vc-act="request-docs">' + svg("upload", 15) + " Request</button></div></div>";
        }
        const isPdf = /pdf/i.test(doc.resource_type === "raw" ? "pdf" : "") || /\.pdf$/i.test(doc.original_filename || "");
        const st = doc.review_status;
        const statusBadge = st === "accepted" ? '<span class="vc-badge vc-b-green">' + svg("tick", 13) + " Approved</span>"
            : st === "rejected" ? '<span class="vc-badge vc-b-red">Rejected</span>'
            : st === "action_required" ? '<span class="vc-badge vc-b-orange">Re-upload asked</span>'
            : '<span class="vc-badge vc-b-blue">Waiting review</span>';
        const reason = doc.rejection_reason || doc.action_required_reason;
        const idInfo = type === "national_id" && (doc.id_kind || doc.id_number)
            ? '<div class="vc-sub">' + esc((doc.id_kind || "").replace(/_/g, " ")) + (doc.id_number ? " &middot; No. " + esc(doc.id_number) : "") + (doc.id_expires_on ? " &middot; expires " + esc(doc.id_expires_on) : "") + "</div>" : "";
        return '<div class="vc-docrow">' +
            (st === "pending" ? '<input type="checkbox" class="vc-docsel" data-vc-docsel value="' + esc(type) + '" aria-label="Select ' + esc(label) + '">' : '<span class="vc-docsel-ph"></span>') +
            '<span class="vc-filetype ' + (isPdf ? "vc-ft-pdf" : "vc-ft-img") + '">' + (isPdf ? "<b>PDF</b>" : svg("image", 22)) + "</span>" +
            '<div class="vc-docrow-main"><div class="vc-name vc-name-sm">' + esc(label) + (required ? "" : ' <em class="vc-sub">(extra)</em>') + "</div>" +
                '<div class="vc-sub">' + esc(doc.original_filename || "") + "</div>" + idInfo +
                (reason ? '<div class="vc-reason">' + esc(reason) + "</div>" : "") + "</div>" +
            '<div class="vc-docrow-when"><div class="vc-sub">Uploaded on</div><div>' + fmtDate(doc.uploaded_at, true) + "</div></div>" +
            '<div class="vc-docrow-checks">' + statusBadge + nameCheckPill(doc) + "</div>" +
            '<div class="vc-docrow-btns">' +
                '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-docview="' + esc(type) + '">' + svg("eye", 15) + " View</button>" +
                '<div class="vc-dd"><button type="button" class="vc-btn-outline vc-btn-sm" data-vc-dd="' + esc(type) + '" aria-haspopup="menu">Approve / Reject ' + svg("chev", 14) + "</button></div>" +
            "</div></div>";
    }

    function renderBulkBar() {
        const bar = document.getElementById("vc-bulk");
        if (!bar) return;
        const sel = [...document.querySelectorAll("[data-vc-docsel]:checked")].map(i => i.value);
        bar.innerHTML = sel.length ? "<span>" + sel.length + " selected</span>" +
            '<button type="button" class="vc-btn vc-btn-green vc-btn-sm" data-vc-bulk="approve-sel">Approve selected</button>' +
            '<button type="button" class="vc-btn-outline vc-btn-sm vc-btn-danger" data-vc-bulk="reject-sel">Ask to re-upload selected</button>' : "";
        bar.hidden = !sel.length;
    }

    function openDocMenu(type, anchor) {
        closeMenu();
        const menu = document.createElement("div");
        menu.className = "vc-menu";
        menu.setAttribute("role", "menu");
        menu.innerHTML =
            '<button type="button" role="menuitem" class="vc-mi vc-mi-green" data-d="approve">' + svg("check", 20) + "<span>Approve</span></button>" +
            '<button type="button" role="menuitem" class="vc-mi vc-mi-red" data-d="name">' + svg("user", 20) + "<span>Reject - names don't match<small>Asks for the proper document</small></span></button>" +
            '<button type="button" role="menuitem" class="vc-mi vc-mi-amber" data-d="reupload">' + svg("upload", 20) + "<span>Ask to re-upload<small>Write the reason</small></span></button>" +
            '<button type="button" role="menuitem" class="vc-mi vc-mi-red" data-d="reject">' + svg("x", 20) + "<span>Reject<small>Final - for fake or invalid documents</small></span></button>" +
            '<button type="button" role="menuitem" class="vc-mi" data-d="history">' + svg("file", 20) + "<span>Earlier versions<small>Documents this one replaced</small></span></button>";
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        let top = r.bottom + 6, left = r.right - menu.offsetWidth;
        if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
        menu.style.top = top + "px";
        menu.style.left = Math.max(8, left) + "px";
        menu.addEventListener("click", (e) => {
            const b = e.target.closest("[data-d]");
            if (!b) return;
            closeMenu();
            if (b.dataset.d === "history") return showDocVersions(type);
            reviewDoc(type, b.dataset.d);
        });
    }

    // Earlier uploads of a document (kept when the vendor uploads again).
    async function showDocVersions(type) {
        const id = state.profileId;
        const label = DOC_LABELS[type] || type;
        let versions = [];
        try {
            const r = await call("GET", "/api/admin/vendors/" + id + "/kyc/documents/versions?document_type=" + encodeURIComponent(type));
            versions = (r && r.versions) || [];
        } catch (e) { toast("Could not load the earlier versions.", true); return; }
        const when = (v) => v ? new Date(v).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "-";
        const status = { approved: "Approved", rejected: "Rejected", action_required: "Asked to re-upload", pending: "Not reviewed" };
        const html = versions.length
            ? '<div style="display:grid; gap:8px;">' + versions.map((v) =>
                '<div style="display:flex; gap:10px; align-items:center; justify-content:space-between; border:1px solid #e6e8ee; border-radius:10px; padding:10px 12px;">' +
                    '<div style="min-width:0;"><strong>Uploaded ' + esc(when(v.uploaded_at)) + "</strong>" +
                        '<div style="font-size:12.5px; color:#667085; word-break:break-word;">' + esc(status[v.review_status] || v.review_status || "-") +
                            (v.review_reason ? " - " + esc(v.review_reason) : "") + " &middot; replaced " + esc(when(v.replaced_at)) +
                            (v.original_filename ? " &middot; " + esc(v.original_filename) : "") + "</div></div>" +
                    '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-version="' + Number(v.id) + '">View</button></div>').join("") + "</div>"
            : "<p>No earlier versions. The document on file is the only one this vendor has uploaded.</p>";
        await ask({ title: label + " - earlier versions", html: html, ok: "Close", wide: true, onOpen: (back) => {
            back.addEventListener("click", async (e) => {
                const b = e.target.closest("[data-vc-version]");
                if (!b) return;
                try {
                    const r = await call("GET", "/api/admin/vendors/" + id + "/kyc/documents/versions/" + b.dataset.vcVersion + "/url");
                    if (r && r.url) window.open(r.url, "_blank", "noopener");
                } catch (err) { toast("Could not open that version.", true); }
            });
        } });
    }

    // One document: approve / ask to re-upload / reject.
    async function reviewDoc(type, how, opts) {
        const id = state.profileId;
        const label = DOC_LABELS[type] || type;
        opts = opts || {};
        try {
            if (how === "approve") {
                let confirmed = false;
                if (type === "national_id" && !opts.confirmed) {
                    const ok = await idChecksDialog();
                    if (!ok) return false;
                    confirmed = true;
                }
                const r = await call("PATCH", "/api/admin/vendors/" + id + "/kyc/documents/" + encodeURIComponent(type) + "/review",
                    { decision: "accepted", checks_confirmed: confirmed || !!opts.confirmed });
                if (!opts.quiet) toast(label + " approved." + (r.hold_released ? " The hold is lifted - the shop is live again." : ""));
                if (r.hold_released) opts.released = true;
            } else {
                let reason = opts.reason;
                if (!reason) {
                    reason = await ask({
                        title: (how === "reject" ? "Reject " : "Ask to re-upload: ") + label,
                        html: (how === "reject" ? "<p>Use this for fake or invalid documents. The vendor is told it was rejected.</p>" : "<p>The vendor is asked to upload this document again.</p>") + presetButtons(),
                        label: "Reason (shown to the vendor)", value: how === "name" ? NAME_PRESET : "",
                        ok: how === "reject" ? "Reject document" : "Send to vendor", danger: true
                    });
                    if (!reason) return false;
                }
                await call("PATCH", "/api/admin/vendors/" + id + "/kyc/documents/" + encodeURIComponent(type) + "/review",
                    { decision: how === "reject" ? "rejected" : "action_required", reason });
                if (!opts.quiet) toast(label + (how === "reject" ? " rejected." : " - vendor asked to upload again."));
            }
            if (!opts.quiet) await refresh();
            return true;
        } catch (err) {
            toast(label + ": " + (err.message || "Something went wrong."), true);
            return false;
        }
    }

    function idChecksDialog() {
        const items = ["It is a National ID, Passport or Driving Licence", "The name and details match the vendor's account",
            "All four corners are visible", "No glare covers the details", "No signs of editing"];
        return ask({
            title: "Confirm the identity document checks",
            html: '<p>These can\'t be checked automatically - look at the document first (View).</p><div class="vc-checks">' +
                items.map(t => '<label class="vc-check"><input type="checkbox"> ' + esc(t) + "</label>").join("") + "</div>",
            ok: "Approve", green: true,
            collect: (back) => [...back.querySelectorAll(".vc-checks input")].every(i => i.checked) ? {} : { error: "Tick every check before approving." }
        });
    }

    async function bulk(kind) {
        const v = byId(state.profileId);
        const kyc = state.data.kyc || {};
        const docs = kyc.documents || [];
        const selected = [...document.querySelectorAll("[data-vc-docsel]:checked")].map(i => i.value);
        if (kind === "approve" || kind === "approve-sel") {
            const todo = (kind === "approve" ? docs.filter(d => d.review_status === "pending").map(d => d.document_type) : selected);
            const missing = (v.required_documents || []).filter(d => d.status === "missing" || d.status === "rejected");
            const willActivate = kind === "approve";
            const ok = await ask({
                title: willActivate ? "Approve all & activate store?" : "Approve " + todo.length + " document" + (todo.length === 1 ? "" : "s") + "?",
                html: (todo.length ? "<p>Approves: " + todo.map(t => esc(DOC_LABELS[t] || t)).join(", ") + ".</p>" : "<p>No documents are waiting for review.</p>") +
                    (willActivate ? "<p>Then: " + (v.status === "pending" ? "approves the vendor and opens their shop, " : "") + "marks their verification as complete" +
                        (v.documents_hold ? ", and lifts the hold" : "") + ".</p>" : "") +
                    (willActivate && missing.length ? '<p class="vc-warn-text">Still missing: ' + missing.map(d => esc(d.label)).join(", ") + ". The shop can't be fully verified until these are uploaded.</p>" : ""),
                ok: willActivate ? "Approve all" : "Approve", green: true
            });
            if (!ok) return;
            let confirmedId = false;
            if (todo.includes("national_id")) {
                if (!(await idChecksDialog())) return;
                confirmedId = true;
            }
            let failed = 0, released = false;
            for (const t of todo) {
                const o = { quiet: true, confirmed: t === "national_id" ? confirmedId : false };
                if (!(await reviewDoc(t, "approve", o))) failed++;
                if (o.released) released = true;
            }
            if (willActivate && !failed) {
                try {
                    if (v.status === "pending") await call("PATCH", "/api/admin/vendors/" + v.id + "/approve");
                    const latest = await authorizedFetch("/api/admin/vendors/" + v.id + "/kyc");
                    const allOk = (v.required_documents || []).every(d => (latest.documents || []).some(x => x.document_type === d.type && x.review_status === "accepted"));
                    if (allOk && latest.kyc_status !== "verified" && latest.kyc_status !== "not_started") {
                        await call("PATCH", "/api/admin/vendors/" + v.id + "/kyc/review", { kyc_status: "verified", note: "All documents approved (Approve All)." });
                    }
                } catch (err) {
                    toast("Documents approved, but: " + err.message, true);
                }
            }
            toast(failed ? failed + " document(s) could not be approved - see the messages." : (released ? "Approved - the hold is lifted and the shop is live." : "Approved."), !!failed);
            await refresh();
        } else {
            const pool = kind === "reject-sel" ? selected : docs.filter(d => d.review_status !== "accepted").map(d => d.document_type);
            const missing = (v.required_documents || []).filter(d => d.status === "missing").map(d => d.type);
            const choices = [...new Set(pool.concat(kind === "reject-sel" ? [] : docs.filter(d => d.review_status === "accepted").map(d => d.document_type)))];
            const r = await ask({
                title: "Reject & request resubmission",
                wide: true,
                html: "<p>Tick the documents the vendor must upload again. They get a notice with your reason" + (missing.length ? ", plus a reminder for the missing ones" : "") + ".</p>" +
                    '<div class="vc-checks">' + (choices.length ? choices.map(t => '<label class="vc-check"><input type="checkbox" value="' + esc(t) + '"' + (pool.includes(t) ? " checked" : "") + "> " + esc(DOC_LABELS[t] || t) + "</label>").join("") : '<p class="vc-sub">No uploaded documents.</p>') + "</div>" +
                    presetButtons(),
                label: "Reason (shown to the vendor)", ok: "Send to vendor", danger: true,
                collect: (back) => {
                    const list = [...back.querySelectorAll(".vc-checks input:checked")].map(i => i.value);
                    return list.length || missing.length ? { list } : { error: "Tick at least one document." };
                }
            });
            if (!r) return;
            let failed = 0;
            for (const t of r.extra.list) if (!(await reviewDoc(t, "reupload", { quiet: true, reason: r.text }))) failed++;
            if (missing.length) await call("POST", "/api/admin/vendors/" + v.id + "/request-documents", { note: r.text }).catch(() => {});
            toast(failed ? failed + " document(s) could not be updated." : "Sent - the vendor has been asked to upload again.", !!failed);
            await refresh();
        }
    }

    // Orders / Products / Payouts / Activity
    function tabOrders(profile) {
        if (profile.__error) return '<div class="vc-card"><p class="no-data">' + esc(profile.__error) + "</p></div>";
        const rows = profile.orders || [];
        if (!rows.length) return '<div class="vc-card"><p class="no-data">No orders for this vendor yet.</p></div>';
        return '<section class="vc-card"><h3>Recent Orders</h3><div class="vc-scroll"><table class="vc-mini"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
            rows.map(o => "<tr><td><strong>#" + esc(o.id) + "</strong></td><td>" + esc(o.customer_name || "-") + '</td><td class="vc-nowrap">' + fmtDate(o.created_at, true) + "</td><td>" +
                esc(o.items) + " &middot; " + esc(o.first_item || "") + '</td><td class="vc-nowrap">' + ugx(o.amount) + "</td><td>" + orderBadge(o.status) + "</td></tr>").join("") +
            "</tbody></table></div><p class=\"vc-small\">Amounts are this vendor's items only.</p></section>";
    }
    function orderBadge(s) {
        const m = { delivered: "vc-b-green", paid: "vc-b-blue", shipped: "vc-b-blue", processing: "vc-b-blue", cancelled: "vc-b-red", pending: "vc-b-grey" };
        return '<span class="vc-badge ' + (m[s] || "vc-b-grey") + '"><i class="vc-dot"></i>' + esc(String(s || "-").replace(/_/g, " ")) + "</span>";
    }
    function tabProducts(products) {
        if (!products.length) return '<div class="vc-card"><p class="no-data">No products yet.</p></div>';
        return '<section class="vc-card"><h3>Products (' + products.length + ')</h3><p class="vc-sec-sub">Restrict a product to hide it from the store; the vendor sees it as Unauthorized.</p><div class="vc-prods">' +
            products.map(p => '<div class="vc-prod"><div class="vc-prod-main"><div class="vc-name vc-name-sm">' + esc(p.name) + "</div>" +
                '<div class="vc-sub">Seller SKU: ' + esc(p.sku || "-") + " &middot; Lizimas SKU: " + esc(p.lizimas_sku || "-") +
                (p.admin_restricted && p.restricted_reason ? " &middot; " + esc(p.restricted_reason) : "") + "</div></div>" +
                (p.admin_restricted ? '<span class="vc-badge vc-b-red">Restricted</span>' : badge(STATUS, p.status)) +
                (p.admin_restricted
                    ? '<button type="button" class="vc-btn-soft vc-btn-sm" data-vc-restrict="lift" data-id="' + p.id + '">Lift</button>'
                    : '<button type="button" class="vc-btn-outline vc-btn-sm vc-btn-danger" data-vc-restrict="restrict" data-id="' + p.id + '">Restrict</button>') +
            "</div>").join("") + "</div></section>";
    }
    function tabPayouts(v, profile) {
        const rows = profile.payouts || [];
        const state2 = v.payout_frozen ? '<span class="vc-badge vc-b-red">Payouts frozen</span>' : v.documents_hold ? '<span class="vc-badge vc-b-red">Blocked while on hold</span>' : '<span class="vc-badge vc-b-green">Payouts active</span>';
        return '<section class="vc-card"><div class="vc-card-head"><h3>Payouts</h3><div>' + state2 + " " +
            (v.payout_frozen ? '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-act="unfreeze">Unfreeze</button>' : '<button type="button" class="vc-btn-outline vc-btn-sm vc-btn-danger" data-vc-act="freeze">Freeze</button>') + "</div></div>" +
            (rows.length ? '<div class="vc-scroll"><table class="vc-mini"><thead><tr><th>Requested</th><th>Amount</th><th>Status</th><th>Paid</th><th>Reference</th></tr></thead><tbody>' +
                rows.map(p => '<tr><td class="vc-nowrap">' + fmtDate(p.requested_at, true) + '</td><td class="vc-nowrap">' + ugx(p.amount) + "</td><td>" +
                    badge({ paid: ["Paid", "vc-b-green"], requested: ["Requested", "vc-b-blue"], rejected: ["Rejected", "vc-b-red"] }, p.status) + '</td><td class="vc-nowrap">' + fmtDate(p.paid_at) + "</td><td>" + esc(p.reference || "-") + "</td></tr>").join("") +
                "</tbody></table></div>" : '<p class="no-data">No payout requests yet.</p>') + "</section>";
    }

    const ACTION_LABEL = {
        warn: "Warning sent", suspend: "Vendor suspended", reinstate: "Vendor reinstated",
        restrict_product: "Product restricted", unrestrict_product: "Product restriction lifted",
        freeze_payout: "Payouts frozen", unfreeze_payout: "Payouts unfrozen", request_documents: "Documents requested",
        hold_documents: "Put on hold for documents", release_hold: "Hold lifted"
    };
    const ACTION_TONE = {
        warn: "amber", suspend: "red", reinstate: "green", restrict_product: "red", unrestrict_product: "green",
        freeze_payout: "violet", unfreeze_payout: "green", request_documents: "blue", hold_documents: "red", release_hold: "green"
    };
    const ACTION_ICON = {
        warn: "warn", suspend: "ban", reinstate: "user", restrict_product: "box", unrestrict_product: "box",
        freeze_payout: "freeze", unfreeze_payout: "unfreeze", request_documents: "mail", hold_documents: "lock", release_hold: "unlock"
    };
    function activityRows(history, v) {
        const rows = (history || []).map(r => ({ ...r, kind: "action" }));
        const kyc = state.data.kyc;
        if (kyc && Array.isArray(kyc.audit_log)) {
            kyc.audit_log.forEach(a => rows.push({ kind: "kyc", created_at: a.created_at, action_type: "_kyc",
                reason: a.note || ("Verification " + (KYC_LABEL[a.from_status] || a.from_status) + " → " + (KYC_LABEL[a.to_status] || a.to_status)),
                admin_name: a.changed_by_name || "Vendor" }));
        }
        if (v && v.submitted_at) rows.push({ kind: "onboard", action_type: "_onboarded", created_at: v.submitted_at, reason: "Vendor application submitted", admin_name: "Vendor" });
        return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    function tabActivity(history, v, full) {
        const rows = activityRows(history, v);
        if (!rows.length) return '<p class="no-data">No activity recorded yet.</p>';
        const shown = full ? rows : rows.slice(0, 5);
        const list = '<ol class="vc-timeline">' + shown.map(r => {
            const t = r.action_type;
            const tone = t === "_onboarded" ? "violet" : t === "_kyc" ? "blue" : (ACTION_TONE[t] || "grey");
            const icon = t === "_onboarded" ? "user" : t === "_kyc" ? "file" : (ACTION_ICON[t] || "clock");
            const title = t === "_onboarded" ? "Vendor onboarded" : t === "_kyc" ? "Document / verification update" : (ACTION_LABEL[t] || t);
            return '<li class="vc-ev"><span class="vc-ev-dot vc-t-' + tone + '">' + svg(icon, 16) + "</span>" +
                '<div class="vc-ev-main"><div class="vc-ev-title">' + esc(title) + (r.product_name ? " &middot; " + esc(r.product_name) : "") + "</div>" +
                '<div class="vc-sub">' + esc(r.reason || "") + "</div></div>" +
                '<div class="vc-ev-side"><div class="vc-sub vc-nowrap">' + fmtDate(r.created_at, true) + '</div><span class="vc-badge vc-b-grey">' + esc(r.admin_name || "Admin") + "</span></div></li>";
        }).join("") + "</ol>";
        return full ? '<section class="vc-card"><h3>Activity Log</h3>' + list + "</section>" : list;
    }

    async function productAction(kind, productId) {
        try {
            if (kind === "restrict") {
                const reason = await ask({ title: "Restrict this product?", html: "<p>It is hidden from the store until you lift the restriction.</p>",
                    label: "Reason (shown to the vendor)", ok: "Restrict product", danger: true });
                if (!reason) return;
                await call("PATCH", "/api/admin/products/" + productId + "/restrict", { reason });
                toast("Product restricted.");
            } else {
                if (!(await ask({ title: "Lift this product's restriction?", ok: "Lift restriction", green: true }))) return;
                await call("PATCH", "/api/admin/products/" + productId + "/unrestrict");
                toast("Restriction lifted.");
            }
            await refresh();
        } catch (err) {
            toast(err.message || "Something went wrong.", true);
        }
    }

    function onProfileClick(e) {
        const t = e.target;
        if (t.closest("[data-vc-close]")) return closeProfile();
        const tab = t.closest("[data-vc-ptab]");
        if (tab) { state.profileTab = tab.dataset.vcPtab; renderProfile(); return; }
        const act = t.closest("[data-vc-act]");
        if (act) return runAction(act.dataset.vcAct, state.profileId);
        const pm = t.closest("[data-vc-pmenu]");
        if (pm) { e.stopPropagation(); return openMenu(state.profileId, pm); }
        const view = t.closest("[data-vc-docview]");
        if (view) return viewVendorKycDocument(state.profileId, view.dataset.vcDocview);
        const dd = t.closest("[data-vc-dd]");
        if (dd) { e.stopPropagation(); return openDocMenu(dd.dataset.vcDd, dd); }
        const b = t.closest("[data-vc-bulk]");
        if (b) return bulk(b.dataset.vcBulk);
        const r = t.closest("[data-vc-restrict]");
        if (r) return productAction(r.dataset.vcRestrict, Number(r.dataset.id));
    }

    // ---------- export ----------
    function exportCsv() {
        const list = filtered();
        const cell = (x) => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"';
        const head = ["Business", "Shop ID", "Owner", "Email", "Phone", "Status", "Compliance", "Documents approved", "On hold", "Payouts", "Joined", "Documents needed", "Restricted products"];
        const lines = [head.map(cell).join(",")].concat(list.map(v => {
            const p = docsProgress(v);
            return [v.business_name, v.shop_id, v.owner_name, v.owner_email, v.phone, v.status,
                (COMPLIANCE[v.compliance] || [v.compliance])[0], p.done + "/" + p.total, v.documents_hold ? "Yes" : "No",
                v.payout_frozen ? "Frozen" : "Active", v.submitted_at ? String(v.submitted_at).slice(0, 10) : "",
                (v.required_documents || []).filter(d => d.status === "missing" || d.status === "rejected").map(d => d.label).join("; "),
                v.restricted_products || 0].map(cell).join(",");
        }));
        const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vendors-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // admin.js's loadVendorCompliancePanel() calls this after every fetch.
    window.renderVendorCompliancePanel = function () {
        const container = document.getElementById("vendor-compliance-list");
        if (!container) return;
        ensureShell(container);
        renderTable();
        if (state.profileId && byId(state.profileId)) renderProfile();
    };
    window.LzVendorCompliance = { openProfile, closeProfile, runAction, filtered, inTab };
})();
