// Settings on a computer (Ryan, Oct 2026), in the Vendor Center layout:
// a "Settings > Users" trail, the Seller Settings list (Users, Applications,
// Holiday Mode, Shop Activation, Manage Pickers) and the Platform Settings
// list, then the chosen section underneath - Users, Applications and Pickers
// as tables with their Create button on the title line.
// Phones keep the list screens they already have. Nothing here changes what
// the sections do; it moves one shared block into whichever settings screen
// is open and adds the table headings.
(function () {
    "use strict";
    const DESK = "(min-width: 1024px)";
    const isDesk = () => window.matchMedia && window.matchMedia(DESK).matches && document.body.classList.contains("vsh-on");
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const SELLER = [["users", "Users"], ["channel", "Applications"], ["holiday-mode", "Holiday Mode"], ["shop-activation", "Shop Activation"], ["pickers", "Manage Pickers"]];
    // Screens that belong to Settings, and the section each one sits under.
    const FAMILY = { settings: "shop-activation", users: "users", "users-create": "users", "users-edit": "users", channel: "channel", "channel-create": "channel",
        "channel-export": "channel", "channel-import": "channel", "holiday-mode": "holiday-mode", pickers: "pickers", "pickers-create": "pickers", "pickers-edit": "pickers",
        "commissions-fees": "commissions-fees" };
    const TITLES = Object.assign({ "commissions-fees": "Commissions and Fees" }, Object.fromEntries(SELLER));
    const chev = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
    const state = { sellerOpen: true, platformOpen: false };
    let nav = null;

    function build() {
        nav = document.createElement("div");
        nav.id = "vst-nav";
        nav.className = "vst-nav";
        nav.innerHTML = `<div class="vst-trail">Settings <span aria-hidden="true">&gt;</span> <strong id="vst-trail-now"></strong></div>
            <section class="vst-acc" data-acc="seller"><button type="button" class="vst-acc-head" data-toggle="seller"><span>Seller Settings</span>${chev}</button>
                <div class="vst-acc-body">${SELLER.map(([k, l]) => `<button type="button" class="vst-link" data-go="${k}">${esc(l)}</button>`).join("")}</div></section>
            <section class="vst-acc" data-acc="platform"><button type="button" class="vst-acc-head" data-toggle="platform"><span>Platform Settings</span>${chev}</button>
                <div class="vst-acc-body"><div class="vst-plain">Currency <span>UGX &mdash; Uganda Shilling</span></div>
                    <button type="button" class="vst-link" data-go="commissions-fees">Commissions and Fees</button>
                    <a class="vst-link" href="../seller-guide" target="_blank" rel="noopener">Seller Guide (how everything works)</a></div></section>`;
        nav.addEventListener("click", (e) => {
            const t = e.target.closest("[data-toggle]");
            if (t) { state[t.dataset.toggle + "Open"] = !state[t.dataset.toggle + "Open"]; paint(); return; }
            const g = e.target.closest("[data-go]");
            if (!g) return;
            if (g.dataset.go === "shop-activation") window.vmShowScreen("settings", { vstStay: true });
            else window.vmShowScreen(g.dataset.go);
        });
    }
    function paint(section) {
        if (!nav) return;
        if (section) nav.dataset.section = section;
        const now = nav.dataset.section;
        nav.querySelector('[data-acc="seller"]').classList.toggle("open", state.sellerOpen);
        nav.querySelector('[data-acc="platform"]').classList.toggle("open", state.platformOpen);
        nav.querySelectorAll("[data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === now));
        nav.querySelector("#vst-trail-now").textContent = TITLES[now] || "";
    }
    // Puts the shared block at the top of the settings screen that just opened.
    function place(name) {
        const screen = document.getElementById("vm-screen-" + name);
        if (!screen) return;
        if (!nav) build();
        screen.classList.add("vst-fam");
        const header = screen.querySelector(":scope > .vm-header");
        if (nav.parentElement !== screen || nav.previousElementSibling !== header) {
            if (header) header.insertAdjacentElement("afterend", nav); else screen.insertBefore(nav, screen.firstChild);
        }
        if (FAMILY[name] === "commissions-fees") state.platformOpen = true;
        paint(FAMILY[name]);
        if (name === "pickers") pickersTitle(screen);
    }

    // ---- table headings (the rows are the cards the screens already draw) ----
    const HEADS = {
        "vm-users-list": ["Name", "Email", "Shop(s)", "Enable to receive order report", "Actions"],
        "vm-channel-applications-list": ["Name", "Application Type", "Client ID", "Redirect URI", "Status", "Created At", "Actions"]
    };
    function heading(host) {
        const cols = HEADS[host.id];
        if (!cols || host.querySelector(":scope > .vst-thead")) return;
        if (!host.querySelector(".vc-user-card, .vc-app-card")) return;
        const h = document.createElement("div");
        h.className = "vst-thead";
        h.innerHTML = cols.map((c) => `<span>${esc(c)}</span>`).join("");
        host.insertBefore(h, host.firstChild);
    }
    function watch(id) {
        const host = document.getElementById(id);
        if (!host || host._vst) return;
        host._vst = true;
        host.classList.add("vst-table");
        new MutationObserver(() => heading(host)).observe(host, { childList: true });
        heading(host);
    }

    // ---- Manage Pickers as a table ----
    function pickersTitle(screen) {
        if (screen.querySelector(".vst-titlebar")) return;
        const bar = document.createElement("div");
        bar.className = "vst-titlebar";
        bar.innerHTML = '<h2 class="vc-page-title vc-page-title-grey">Manage Pickers</h2><button type="button" class="vc-btn vc-btn-gold vc-btn-caps" onclick="vmShowPickerCreate()">Create Pickers <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>';
        nav.insertAdjacentElement("afterend", bar);
    }
    function pickersTable(pickers) {
        const host = document.getElementById("vm-pickers-list");
        if (!host) return;
        host.classList.add("vst-table", "vst-pickers");
        const head = '<div class="vst-thead"><span>Phone</span><span>Name</span><span>ID number</span><span>Status</span><span>Country</span><span>Actions</span></div>';
        const rows = (pickers || []).map((p) => `<div class="vst-row">
            <span>${esc(p.phone || "-")}</span><span>${esc(p.full_name || "-")}</span><span>${esc(p.id_number || "-")}</span>
            <span><i class="vst-dot ${p.is_active ? "on" : ""}"></i>${p.is_active ? "Active" : "Disabled"}</span><span>Uganda</span>
            <span><button type="button" class="vc-text-btn" onclick="vmShowPickerEdit(${Number(p.id)})">Edit</button></span></div>`).join("");
        const n = (pickers || []).length;
        host.innerHTML = head + (rows || '<p class="vst-none">You have no pickers created!</p>') +
            `<div class="vst-foot">${n ? "1 &ndash; " + n + " of " + n : "0 of 0"}</div>`;
    }

    function hook() {
        const orig = window.vmShowScreen;
        if (typeof orig !== "function" || orig.__vst) return;
        const wrapped = function (name, opts) {
            // On a computer, Settings opens on Users (as the first section); Shop Activation is its own section.
            if (name === "settings" && isDesk() && !(opts && (opts.vstStay || opts.isBack))) return wrapped.call(this, "users", opts);
            const r = orig.apply(this, arguments);
            if (FAMILY[name] && isDesk()) place(name);
            return r;
        };
        wrapped.__vst = true;
        Object.keys(orig).forEach((k) => { wrapped[k] = orig[k]; });
        window.vmShowScreen = wrapped;

        const origPickers = window.vmRenderPickersList;
        if (typeof origPickers === "function" && !origPickers.__vst) {
            const p = function (pickers) { const r = origPickers.apply(this, arguments); if (isDesk()) pickersTable(pickers); return r; };
            p.__vst = true;
            window.vmRenderPickersList = p;
        }
    }
    function start() {
        hook();
        watch("vm-users-list"); watch("vm-channel-applications-list");
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0)); else setTimeout(start, 0);
})();
