// Vendor Compliance (admin), redesigned Oct 2026 (Ryan's design):
// a clean table - Business / Owner / Status / Compliance / Payouts / ⋮ -
// with search, Status and Compliance filters, Export and pages of 10.
// Each row's ⋮ menu holds every action; clicking a row opens a drawer on
// the right with the vendor's compliance documents, quick actions, their
// products (restrict / lift) and the activity history.
//
// Data: GET /api/admin/vendors (vendorComplianceCache in admin.js), which
// now carries `compliance`, `required_documents` and `documents_needed`
// (see complianceSummary in server/utils/vendorCompliance.js).
// Every action still goes through the same endpoints as before and is
// recorded in vendor_compliance_actions, which the vendor sees as a notice.
(function () {
    "use strict";

    const PAGE_SIZE = 10;
    const state = { q: "", status: "", compliance: "", page: 1, drawerId: null };

    const esc = (s) => String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const STATUS = {
        approved: ["Approved", "vc-b-green"], pending: ["Pending", "vc-b-grey"], suspended: ["Suspended", "vc-b-red"],
        rejected: ["Rejected", "vc-b-red"]
    };
    const COMPLIANCE = {
        compliant: ["Compliant", "vc-b-green"], documents_pending: ["Documents Pending", "vc-b-orange"],
        under_review: ["Under Review", "vc-b-blue"], restricted: ["Restricted", "vc-b-red"]
    };
    const DOC_STATUS = {
        missing: ["Missing", "vc-b-red"], submitted: ["Submitted", "vc-b-blue"],
        approved: ["Approved", "vc-b-green"], rejected: ["Rejected", "vc-b-orange"]
    };
    const AVATAR_COLOURS = ["#f472b6", "#8b5cf6", "#2563eb", "#0f766e", "#ea580c", "#1a1a2e", "#ca8a04", "#db2777"];

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
        id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4M14.5 10h3.5M14.5 13.5h3.5"/>',
        shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z"/>',
        bank: '<path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3.5 20h17"/>',
        file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
        eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
        upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
        dots: '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
        download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'
    };
    const svg = (name, size) => '<svg class="vc-ico" viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
        '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
    const badge = (map, key) => {
        const m = map[key] || [String(key || "-"), "vc-b-grey"];
        return '<span class="vc-badge ' + m[1] + '">' + esc(m[0]) + "</span>";
    };
    const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
    const avatar = (v, big) => {
        let h = 0;
        for (const ch of String(v.business_name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return '<span class="vc-avatar' + (big ? " vc-avatar-big" : "") + '" style="background:' + AVATAR_COLOURS[h % AVATAR_COLOURS.length] + '">' +
            esc(initials(v.business_name)) + "</span>";
    };
    const docIcon = (type) => ({ national_id: "id", work_permit: "id", form_20: "user", tax_certificate: "shield",
        vat_certificate: "shield", bank_certificate: "bank", momo_statement: "bank" }[type] || "file");
    const vendors = () => (typeof vendorComplianceCache !== "undefined" && Array.isArray(vendorComplianceCache)) ? vendorComplianceCache : [];
    const byId = (id) => vendors().find(v => v.id === id);

    // ---------- table ----------
    function filtered() {
        const q = state.q.trim().toLowerCase();
        return vendors().filter(v => {
            if (state.status && v.status !== state.status) return false;
            if (state.compliance && v.compliance !== state.compliance) return false;
            if (!q) return true;
            return [v.business_name, v.shop_id, v.owner_name, v.owner_email, v.phone]
                .some(x => String(x || "").toLowerCase().includes(q));
        });
    }

    function ensureShell(container) {
        if (container.dataset.vcShell) return;
        container.dataset.vcShell = "1";
        container.innerHTML =
            '<div class="vc-toolbar">' +
                '<label class="vc-search">' + svg("search") +
                    '<input type="search" id="vc-q" placeholder="Search vendors, Shop ID, owner, email..." autocomplete="off"></label>' +
                '<select id="vc-status" class="vc-select" aria-label="Status">' +
                    '<option value="">Status: All</option><option value="approved">Approved</option><option value="pending">Pending</option>' +
                    '<option value="suspended">Suspended</option><option value="rejected">Rejected</option></select>' +
                '<select id="vc-compliance" class="vc-select" aria-label="Compliance">' +
                    '<option value="">Compliance: All</option><option value="compliant">Compliant</option>' +
                    '<option value="documents_pending">Documents Pending</option><option value="under_review">Under Review</option>' +
                    '<option value="restricted">Restricted</option></select>' +
                '<button type="button" class="vc-btn-outline" id="vc-export">' + svg("download", 16) + " Export</button>" +
            "</div>" +
            '<div class="vc-table-wrap" id="vc-table"></div>' +
            '<div class="vc-foot" id="vc-foot"></div>';
        const q = container.querySelector("#vc-q");
        q.addEventListener("input", () => { state.q = q.value; state.page = 1; renderTable(); });
        container.querySelector("#vc-status").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; renderTable(); });
        container.querySelector("#vc-compliance").addEventListener("change", (e) => { state.compliance = e.target.value; state.page = 1; renderTable(); });
        container.querySelector("#vc-export").addEventListener("click", exportCsv);
        container.addEventListener("click", onTableClick);
    }

    function renderTable() {
        const box = document.getElementById("vc-table");
        const foot = document.getElementById("vc-foot");
        if (!box) return;
        const list = filtered();
        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        state.page = Math.min(state.page, pages);
        const start = (state.page - 1) * PAGE_SIZE;
        const rows = list.slice(start, start + PAGE_SIZE);

        if (!vendors().length) {
            box.innerHTML = '<p class="no-data">No vendors yet.</p>';
        } else if (!rows.length) {
            box.innerHTML = '<p class="no-data">No vendors match these filters.</p>';
        } else {
            box.innerHTML =
                '<table class="vc-table"><thead><tr><th>Business</th><th>Owner</th><th>Status</th><th>Compliance</th><th>Payouts</th>' +
                '<th class="vc-th-actions">Actions</th></tr></thead><tbody>' +
                rows.map(v =>
                    '<tr class="vc-row" data-vc-open="' + v.id + '" tabindex="0">' +
                        '<td data-label="Business"><div class="vc-biz">' + avatar(v) + "<div>" +
                            '<div class="vc-name">' + esc(v.business_name) + "</div>" +
                            '<div class="vc-sub">' + (v.shop_id ? esc(v.shop_id) : "No Shop ID yet") + "</div></div></div></td>" +
                        '<td data-label="Owner"><div class="vc-name vc-name-sm">' + esc(v.owner_name) + '</div><div class="vc-sub">' + esc(v.owner_email) + "</div></td>" +
                        '<td data-label="Status">' + badge(STATUS, v.status) + "</td>" +
                        '<td data-label="Compliance">' + badge(COMPLIANCE, v.compliance) + "</td>" +
                        '<td data-label="Payouts">' + (v.payout_frozen ? '<span class="vc-badge vc-b-red">Frozen</span>' : '<span class="vc-badge vc-b-green">Active</span>') + "</td>" +
                        '<td class="vc-td-actions"><button type="button" class="vc-dots" data-vc-menu="' + v.id + '" aria-label="Actions for ' +
                            esc(v.business_name) + '" aria-haspopup="menu">' + svg("dots", 20) + "</button></td>" +
                    "</tr>").join("") +
                "</tbody></table>";
        }

        if (foot) {
            const from = list.length ? start + 1 : 0;
            const to = Math.min(start + PAGE_SIZE, list.length);
            let pager = "";
            if (pages > 1) {
                pager = '<div class="vc-pager"><button type="button" data-vc-page="' + (state.page - 1) + '"' + (state.page === 1 ? " disabled" : "") + ' aria-label="Previous page">&larr;</button>';
                for (let i = 1; i <= pages; i++) pager += '<button type="button" data-vc-page="' + i + '" class="' + (i === state.page ? "on" : "") + '">' + i + "</button>";
                pager += '<button type="button" data-vc-page="' + (state.page + 1) + '"' + (state.page === pages ? " disabled" : "") + ' aria-label="Next page">&rarr;</button></div>';
            }
            foot.innerHTML = '<span>Showing ' + from + "&ndash;" + to + " of " + list.length + " vendor" + (list.length === 1 ? "" : "s") + "</span>" + pager;
        }
    }

    function onTableClick(e) {
        const menuBtn = e.target.closest("[data-vc-menu]");
        if (menuBtn) { e.stopPropagation(); openMenu(Number(menuBtn.dataset.vcMenu), menuBtn); return; }
        const pageBtn = e.target.closest("[data-vc-page]");
        if (pageBtn) { state.page = Number(pageBtn.dataset.vcPage); renderTable(); return; }
        const row = e.target.closest("[data-vc-open]");
        if (row) openDrawer(Number(row.dataset.vcOpen));
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches && e.target.matches(".vc-row")) openDrawer(Number(e.target.dataset.vcOpen));
        if (e.key === "Escape") { if (closeMenu()) return; if (document.querySelector(".vc-modal-back")) return; closeDrawer(); }
    });

    // ---------- ⋮ menu ----------
    function menuItems(v) {
        const items = [
            ["vendor-center", "store", "View Vendor Center"],
            ["products", "box", "View Products"],
            ["history", "clock", "View History"],
            "-",
            ["request-docs", "docplus", "Send Required Documents", "vc-mi-primary", !(v.documents_needed || []).length ? "Nothing missing" : ""],
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
                svg(it[1], 20) + "<span>" + esc(it[2]) + (it[4] ? '<small>' + esc(it[4]) + "</small>" : "") + "</span></button>").join("");
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

    // ---------- reason / confirm box (replaces the old browser prompts) ----------
    function ask(opts) {
        return new Promise((resolve) => {
            const back = document.createElement("div");
            back.className = "vc-modal-back";
            back.innerHTML =
                '<div class="vc-modal" role="dialog" aria-modal="true" aria-labelledby="vc-modal-title">' +
                    '<h3 id="vc-modal-title">' + esc(opts.title) + "</h3>" +
                    (opts.html ? '<div class="vc-modal-body">' + opts.html + "</div>" : "") +
                    (opts.label ? '<label class="vc-modal-label">' + esc(opts.label) + (opts.optional ? " <em>(optional)</em>" : "") +
                        '<textarea rows="3" id="vc-modal-text" placeholder="' + esc(opts.placeholder || "") + '"></textarea></label>' : "") +
                    '<p class="vc-modal-err" id="vc-modal-err" hidden></p>' +
                    '<div class="vc-modal-actions"><button type="button" class="vc-btn-outline" data-x="cancel">Cancel</button>' +
                        '<button type="button" class="vc-btn ' + (opts.danger ? "vc-btn-red" : "") + '" data-x="ok">' + esc(opts.ok || "Confirm") + "</button></div>" +
                "</div>";
            document.body.appendChild(back);
            const text = back.querySelector("#vc-modal-text");
            const done = (val) => { back.remove(); document.removeEventListener("keydown", key, true); resolve(val); };
            const ok = () => {
                const val = text ? text.value.trim() : "";
                if (text && !opts.optional && !val) {
                    const err = back.querySelector("#vc-modal-err");
                    err.textContent = "Please write a reason - the vendor will see it.";
                    err.hidden = false;
                    text.focus();
                    return;
                }
                done(val || (text ? "" : true));
            };
            const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
            document.addEventListener("keydown", key, true);
            back.addEventListener("click", (e) => {
                if (e.target === back || e.target.dataset.x === "cancel") done(null);
                if (e.target.dataset.x === "ok") ok();
            });
            (text || back.querySelector('[data-x="ok"]')).focus();
        });
    }

    function toast(msg, bad) {
        const t = document.createElement("div");
        t.className = "vc-toast" + (bad ? " vc-toast-bad" : "");
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3500);
    }

    async function call(method, path, body) {
        const res = await fetch(API_URL + path, {
            method,
            headers: Object.assign({ "Authorization": "Bearer " + getToken() }, body ? { "Content-Type": "application/json" } : {}),
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
        return data;
    }

    async function refresh() {
        await loadVendorCompliancePanel();
        if (state.drawerId) renderDrawer();
    }

    // ---------- actions ----------
    async function runAction(act, id) {
        const v = byId(id);
        if (!v) return;
        const name = v.business_name;
        try {
            if (act === "vendor-center") return viewVendorCenterDetails(id);
            if (act === "products") return openDrawer(id, "products");
            if (act === "history") return openDrawer(id, "history");

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
            } else if (act === "warn") {
                const reason = await ask({ title: "Warn " + name, label: "Reason for this warning (shown to the vendor)", ok: "Send warning" });
                if (!reason) return;
                await call("POST", "/api/admin/vendors/" + id + "/warn", { reason });
                toast("Warning sent to " + name + ".");
            } else if (act === "suspend") {
                const reason = await ask({ title: "Suspend " + name + "?", html: "<p>Their shop page stops working and their products are hidden immediately.</p>",
                    label: "Reason (shown to the vendor)", ok: "Suspend vendor", danger: true });
                if (!reason) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/suspend", { reason });
                toast(name + " is suspended.");
            } else if (act === "reinstate") {
                if (!(await ask({ title: "Reinstate " + name + "?", html: "<p>Their shop and products come back on the store.</p>", ok: "Reinstate" }))) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/reinstate");
                toast(name + " is reinstated.");
            } else if (act === "freeze") {
                const reason = await ask({ title: "Freeze payouts for " + name + "?", html: "<p>They can't request new payouts until you unfreeze them.</p>",
                    label: "Reason (shown to the vendor)", ok: "Freeze payouts", danger: true });
                if (!reason) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/freeze-payouts", { reason });
                toast("Payouts frozen for " + name + ".");
            } else if (act === "unfreeze") {
                if (!(await ask({ title: "Unfreeze payouts for " + name + "?", ok: "Unfreeze payouts" }))) return;
                await call("PATCH", "/api/admin/vendors/" + id + "/unfreeze-payouts");
                toast("Payouts unfrozen for " + name + ".");
            } else if (act === "assign-shop-id") {
                await call("PATCH", "/api/admin/vendors/" + id + "/regenerate-shop-id");
                toast("Shop ID assigned.");
            }
            await refresh();
        } catch (err) {
            console.error("Vendor compliance action:", err);
            toast(err.message || "Something went wrong.", true);
        }
    }

    // ---------- drawer ----------
    function openDrawer(id, focus) {
        state.drawerId = id;
        state.drawerFocus = focus || null;
        state.historyAll = false;
        let back = document.getElementById("vc-drawer-back");
        if (!back) {
            back = document.createElement("div");
            back.id = "vc-drawer-back";
            back.className = "vc-drawer-back";
            back.innerHTML = '<aside class="vc-drawer" role="dialog" aria-modal="true" aria-label="Vendor compliance details"><div id="vc-drawer-body"></div></aside>';
            document.body.appendChild(back);
            back.addEventListener("click", (e) => {
                if (e.target === back || e.target.closest("[data-vc-close]")) return closeDrawer();
                const b = e.target.closest("[data-vc-act]");
                if (b) return runAction(b.dataset.vcAct, state.drawerId);
                const d = e.target.closest("[data-vc-doc]");
                if (d) return docAction(d.dataset.vcDoc, d.dataset.type);
                const r = e.target.closest("[data-vc-restrict]");
                if (r) return productAction(r.dataset.vcRestrict, Number(r.dataset.id));
                if (e.target.closest("[data-vc-history-all]")) { state.historyAll = true; renderHistory(); }
            });
        }
        document.body.classList.add("vc-drawer-open");
        back.classList.add("open");
        renderDrawer();
    }
    function closeDrawer() {
        const back = document.getElementById("vc-drawer-back");
        if (!back || !back.classList.contains("open")) return;
        back.classList.remove("open");
        document.body.classList.remove("vc-drawer-open");
        state.drawerId = null;
    }

    function renderDrawer() {
        const v = byId(state.drawerId);
        const body = document.getElementById("vc-drawer-body");
        if (!v || !body) return;
        const docs = v.required_documents || [];
        const ok = v.compliance === "compliant";
        body.innerHTML =
            '<div class="vc-dr-head">' + avatar(v, true) +
                '<div class="vc-dr-title"><h3>' + esc(v.business_name) + (ok ? ' <span class="vc-ok" title="Compliant">' + svg("check", 22) + "</span>" : "") + "</h3>" +
                    '<div class="vc-sub">' + (v.shop_id ? "Shop ID: " + esc(v.shop_id)
                        : (v.status === "approved" ? 'No Shop ID yet &middot; <button type="button" class="vc-link" data-vc-act="assign-shop-id">Assign one</button>' : "No Shop ID yet")) + "</div>" +
                    '<div class="vc-sub">' + esc(v.owner_name) + " &middot; " + esc(v.owner_email) + (v.phone ? " &middot; " + esc(v.phone) : "") + "</div>" +
                "</div>" +
                '<button type="button" class="vc-x" data-vc-close aria-label="Close">&times;</button>' +
            "</div>" +
            '<div class="vc-dr-badges">' + badge(STATUS, v.status) + badge(COMPLIANCE, v.compliance) +
                (v.payout_frozen ? '<span class="vc-badge vc-b-red">Payouts frozen</span>' : '<span class="vc-badge vc-b-green">Payouts active</span>') +
                (v.restricted_products ? '<span class="vc-badge vc-b-red">' + v.restricted_products + " restricted product" + (v.restricted_products === 1 ? "" : "s") + "</span>" : "") +
            "</div>" +

            '<section class="vc-sec"><h4>Compliance Documents</h4><p class="vc-sec-sub">Required for a ' +
                (v.account_type === "company" ? "registered company" : "individual seller") + ". Missing ones can be requested from the vendor.</p>" +
                '<div class="vc-docs">' + (docs.length ? docs.map(d => {
                    let btn;
                    if (d.status === "missing") btn = '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-doc="request" data-type="' + esc(d.type) + '">' + svg("upload", 16) + " Request</button>";
                    else if (d.status === "rejected") btn = '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-doc="request" data-type="' + esc(d.type) + '">' + svg("upload", 16) + " Request again</button>";
                    else if (d.status === "submitted") btn = '<button type="button" class="vc-btn-outline vc-btn-sm" data-vc-doc="review" data-type="' + esc(d.type) + '">' + svg("eye", 16) + " Review</button>";
                    else btn = '<button type="button" class="vc-btn-soft vc-btn-sm" data-vc-doc="view" data-type="' + esc(d.type) + '">' + svg("eye", 16) + " View</button>";
                    return '<div class="vc-doc"><span class="vc-doc-ico vc-doc-' + d.status + '">' + svg(docIcon(d.type), 20) + "</span>" +
                        '<div class="vc-doc-name">' + esc(d.label) + "</div>" + badge(DOC_STATUS, d.status) + btn + "</div>";
                }).join("") : '<p class="no-data">No documents required.</p>') + "</div>" +
            "</section>" +

            '<section class="vc-sec"><h4>Quick Actions</h4><div class="vc-quick">' +
                quick("request-docs", "mail", "Send Required Documents", (v.documents_needed || []).length ? "Ask for missing documents" : "Nothing missing", "vc-q-blue", !(v.documents_needed || []).length) +
                quick("warn", "warn", "Warn Vendor", "Send a warning notice", "vc-q-amber") +
                (v.status === "suspended" ? quick("reinstate", "user", "Reinstate", "Bring the shop back", "vc-q-green")
                    : quick("suspend", "ban", "Suspend", "Temporarily suspend vendor", "vc-q-red")) +
                (v.payout_frozen ? quick("unfreeze", "unfreeze", "Unfreeze Payouts", "Allow payout requests", "vc-q-green")
                    : quick("freeze", "freeze", "Freeze Payouts", "Stop new payout requests", "vc-q-purple")) +
            "</div></section>" +

            '<section class="vc-sec" id="vc-sec-products"><h4>Products</h4><p class="vc-sec-sub">Restrict a product to hide it from the store; the vendor sees it as Unauthorized.</p>' +
                '<div id="vc-products">Loading...</div></section>' +

            '<section class="vc-sec" id="vc-sec-history"><h4>Activity History</h4><p class="vc-sec-sub">Every action on this vendor, newest first.</p>' +
                '<div id="vc-history">Loading...</div></section>';
        loadProducts(v.id);
        loadHistory(v.id);
        if (state.drawerFocus) {
            const target = document.getElementById("vc-sec-" + state.drawerFocus);
            if (target) setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
            state.drawerFocus = null;
        }
    }
    function quick(act, icon, title, sub, cls, disabled) {
        return '<button type="button" class="vc-qa ' + cls + '" data-vc-act="' + act + '"' + (disabled ? " disabled" : "") + ">" +
            svg(icon, 26) + "<strong>" + esc(title) + "</strong><small>" + esc(sub) + "</small></button>";
    }

    async function docAction(kind, type) {
        const id = state.drawerId;
        if (kind === "request") return runAction("request-docs", id);
        if (kind === "review") return openVendorKycReviewModal(id);
        if (kind === "view") return viewVendorKycDocument(id, type);
    }

    async function loadProducts(id) {
        const box = document.getElementById("vc-products");
        if (!box) return;
        try {
            const products = await authorizedFetch("/api/admin/vendors/" + id + "/products");
            if (state.drawerId !== id) return;
            if (!Array.isArray(products) || !products.length) { box.innerHTML = '<p class="no-data">No products yet.</p>'; return; }
            box.innerHTML = '<div class="vc-prods">' + products.map(p =>
                '<div class="vc-prod"><div class="vc-prod-main"><div class="vc-name vc-name-sm">' + esc(p.name) + "</div>" +
                    '<div class="vc-sub">Seller SKU: ' + esc(p.sku || "-") + " &middot; Lizimas SKU: " + esc(p.lizimas_sku || "-") +
                    (p.admin_restricted && p.restricted_reason ? " &middot; " + esc(p.restricted_reason) : "") + "</div></div>" +
                    (p.admin_restricted ? '<span class="vc-badge vc-b-red">Restricted</span>' : badge(STATUS, p.status)) +
                    (p.admin_restricted
                        ? '<button type="button" class="vc-btn-soft vc-btn-sm" data-vc-restrict="lift" data-id="' + p.id + '">Lift</button>'
                        : '<button type="button" class="vc-btn-outline vc-btn-sm vc-btn-danger" data-vc-restrict="restrict" data-id="' + p.id + '">Restrict</button>') +
                "</div>").join("") + "</div>";
        } catch (err) {
            box.innerHTML = '<p class="no-data">Could not load products.</p>';
        }
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
                if (!(await ask({ title: "Lift this product's restriction?", ok: "Lift restriction" }))) return;
                await call("PATCH", "/api/admin/products/" + productId + "/unrestrict");
                toast("Restriction lifted.");
            }
            await refresh();
        } catch (err) {
            toast(err.message || "Something went wrong.", true);
        }
    }

    const ACTION_LABEL = {
        warn: "Warning sent", suspend: "Vendor suspended", reinstate: "Vendor reinstated",
        restrict_product: "Product restricted", unrestrict_product: "Product restriction lifted",
        freeze_payout: "Payouts frozen", unfreeze_payout: "Payouts unfrozen", request_documents: "Documents requested"
    };
    const ACTION_TONE = {
        warn: "amber", suspend: "red", reinstate: "green", restrict_product: "red", unrestrict_product: "green",
        freeze_payout: "purple", unfreeze_payout: "green", request_documents: "blue"
    };
    const ACTION_ICON = {
        warn: "warn", suspend: "ban", reinstate: "user", restrict_product: "box", unrestrict_product: "box",
        freeze_payout: "freeze", unfreeze_payout: "unfreeze", request_documents: "mail"
    };
    let historyRows = [];

    async function loadHistory(id) {
        const box = document.getElementById("vc-history");
        if (!box) return;
        try {
            const rows = await authorizedFetch("/api/admin/vendors/" + id + "/compliance-history");
            if (state.drawerId !== id) return;
            historyRows = Array.isArray(rows) ? rows.slice() : [];
            const v = byId(id);
            if (v && v.submitted_at) historyRows.push({ action_type: "_onboarded", created_at: v.submitted_at, reason: "Vendor application submitted" });
            renderHistory();
        } catch (err) {
            box.innerHTML = '<p class="no-data">Could not load the history.</p>';
        }
    }
    function renderHistory() {
        const box = document.getElementById("vc-history");
        if (!box) return;
        if (!historyRows.length) { box.innerHTML = '<p class="no-data">No actions recorded yet.</p>'; return; }
        const shown = state.historyAll ? historyRows : historyRows.slice(0, 5);
        box.innerHTML = '<ol class="vc-timeline">' + shown.map(r => {
            const t = r.action_type;
            const tone = t === "_onboarded" ? "violet" : (ACTION_TONE[t] || "grey");
            const title = t === "_onboarded" ? "Vendor onboarded" : (ACTION_LABEL[t] || t);
            const when = r.created_at ? new Date(r.created_at).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
            const who = t === "_onboarded" ? "Vendor" : (r.admin_name || "Admin");
            return '<li class="vc-ev"><span class="vc-ev-dot vc-t-' + tone + '">' + svg(t === "_onboarded" ? "user" : (ACTION_ICON[t] || "clock"), 16) + "</span>" +
                '<div class="vc-ev-main"><div class="vc-ev-title">' + esc(title) + (r.product_name ? " &middot; " + esc(r.product_name) : "") + "</div>" +
                    '<div class="vc-sub">' + esc(r.reason || "") + "</div></div>" +
                '<div class="vc-ev-side"><div class="vc-sub">' + esc(when) + '</div><span class="vc-badge vc-b-grey">' + esc(who) + "</span></div></li>";
        }).join("") + "</ol>" +
        (!state.historyAll && historyRows.length > 5
            ? '<button type="button" class="vc-btn-outline vc-btn-block" data-vc-history-all>View full activity history (' + historyRows.length + ") &rarr;</button>" : "");
    }

    // ---------- export ----------
    function exportCsv() {
        const list = filtered();
        const cell = (x) => '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"';
        const head = ["Business", "Shop ID", "Owner", "Email", "Phone", "Status", "Compliance", "Payouts", "Documents needed", "Restricted products"];
        const lines = [head.map(cell).join(",")].concat(list.map(v => [
            v.business_name, v.shop_id, v.owner_name, v.owner_email, v.phone, v.status,
            (COMPLIANCE[v.compliance] || [v.compliance])[0], v.payout_frozen ? "Frozen" : "Active",
            (v.required_documents || []).filter(d => d.status === "missing" || d.status === "rejected").map(d => d.label).join("; "),
            v.restricted_products || 0
        ].map(cell).join(",")));
        const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vendor-compliance-" + new Date().toISOString().slice(0, 10) + ".csv";
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
    };
    window.LzVendorCompliance = { openDrawer, closeDrawer, runAction, filtered };
})();
