// Vendor Center layout on computers (Oct 2026, Ryan's design, Lizimas
// colours): a left menu (Overview, Listings, Orders, Payouts, Promotions,
// Analytics, Messages, Verification, Settings, Help & Support) with the
// Compliance Status card at the bottom, and a top bar with the
// notifications bell and the shop name. Phones keep the bottom menu.
// Every menu item opens the existing screen (vmShowScreen / vmOpenDeskTab).
(function () {
    "use strict";
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const I = {
        home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/>',
        tag: '<path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L3 3v6.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.82 0l4.6-4.6a2 2 0 0 0 0-2.58Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
        bag: '<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
        wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12.5h2M3 9.5h18"/>',
        promo: '<path d="M4 13V9l12-5v14L4 13Z"/><path d="M7 13.5V19h3v-4.5M19 9.5v3"/>',
        chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
        chat: '<path d="M4 5h16v11H9l-5 4V5Z"/>',
        shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
        bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
        menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
        chev: '<path d="m6 9 6 6 6-6"/>',
        ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.7"/>',
        returns: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
        ads: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 9a3 3 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11"/>',
        star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5 2.6 1-5.6-4.1-3.9 5.6-.8L12 3.8Z"/>',
        store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5"/>'
    };
    const ico = (n, s) => `<svg viewBox="0 0 24 24" width="${s || 22}" height="${s || 22}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
    // Menu in the Vendor Center order: Orders, Products (with its own list),
    // Stock Recommendation, Promotions, Advertise, Account Statements, then
    // the Lizimas extras. The account block at the bottom holds feedback,
    // Settings, Profile and Logout. The logo opens the home page.
    I.list = '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8 9h.01M8 12h.01M8 15h.01M11 9h5M11 12h5M11 15h5"/>';
    I.bulb = '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>';
    I.sheet = '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M8 16v-3M12 16V9M16 16v-5"/>';
    I.out = '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>';
    I.user = '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>';
    I.smile = '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5h.01M15 9.5h.01"/>';
    I.percent = '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>';
    const ITEMS = [
        ["home", "home", "Overview", () => vmShowScreen("home"), "hidden"],
        ["orders", "bag", "Orders", () => vmShowScreen("orders")],
        ["products", "list", "Manage Products", () => vmShowScreen("products"), "sub"],
        ["add-product", "list", "Add Products", () => vmShowScreen("add-product"), "sub"],
        ["consignments", "list", "Fulfilment by Lizimas", () => vmShowScreen("consignments"), "sub"],
        ["import-products", "list", "Import Products", () => vmShowScreen("import-products"), "sub"],
        ["stock-recommendation", "bulb", "Stock Recommendation", () => vmShowScreen("stock-recommendation")],
        ["promotions", "tag", "Promotions", () => vmShowScreen("promotions")],
        ["ads", "ads", "Advertise your Products", () => vmShowScreen("ads")],
        ["wallet", "sheet", "Account Statements", () => vmShowScreen("wallet")],
        ["desk:refunds", "returns", "Returns & Refunds", () => vmOpenDeskTab("refunds")],
        ["desk:reports", "chart", "Analytics", () => vmOpenDeskTab("reports")],
        ["desk:reviews", "star", "Reviews", () => vmOpenDeskTab("reviews")],
        ["desk:messages", "chat", "Messages", () => vmOpenDeskTab("messages")],
        // account block
        ["feedback", "smile", "Give us your feedback!", () => vmOpenDeskTab("messages"), "acct"],
        ["verification", "shield", "Verification", () => vmShowScreen("verification"), "acct"],
        ["commissions-fees", "percent", "Commissions & Fees", () => vmShowScreen("commissions-fees"), "acct"],
        ["settings", "gear", "Settings", () => vmShowScreen("settings"), "acct"],
        ["account", "user", "Profile", () => vmShowScreen("account"), "acct"],
        ["help", "help", "Help & Support", () => window.open("../seller-guide", "_blank", "noopener"), "acct"],
        ["logout", "out", "Logout", () => { if (typeof vendorLogout === "function") vendorLogout(); }, "acct"]
    ];
    const SUBS = ITEMS.filter(i => i[4] === "sub").map(i => i[0]);
    let current = "home";
    const item = ([key, icon, label], cls, withIcon) =>
        `<button type="button" class="vsh-item${cls ? " " + cls : ""}" data-vsh="${key}">${withIcon ? ico(icon) : ""}<span>${esc(label)}</span><i class="vsh-count" id="vsh-count-${key.replace(":", "-")}" hidden></i></button>`;

    function build() {
        if (document.getElementById("vsh-side")) return;
        const side = document.createElement("aside");
        side.id = "vsh-side";
        side.className = "vsh-side";
        side.setAttribute("aria-label", "Vendor menu");
        const main = ITEMS.filter(i => !i[4]);
        const before = main.slice(0, 1), after = main.slice(1);
        side.innerHTML =
            '<button type="button" class="vsh-brand" data-vsh="home" title="Go to the home page" aria-label="Lizimas Vendor - go to the home page"><span class="vsh-logo">LV</span><span>Lizimas <b>Vendor</b></span></button>' +
            '<nav class="vsh-nav">' + before.map(i => item(i, "", true)).join("") +
                `<button type="button" class="vsh-item vsh-group" id="vsh-products-group" aria-expanded="false">${ico("list")}<span>Products</span>${ico("chev", 18)}</button>` +
                '<div class="vsh-subs" id="vsh-products-subs" hidden>' + ITEMS.filter(i => i[4] === "sub").map(i => item(i, "vsh-sub", false)).join("") + "</div>" +
                after.map(i => item(i, "", true)).join("") + "</nav>" +
            '<div class="vsh-foot">' +
                '<div class="vsh-comp" id="vsh-comp"></div>' +
                `<button type="button" class="vsh-shop-btn" data-shop>${ico("store", 20)}<span>My Storefront</span></button>` +
                `<button type="button" class="vsh-acct" id="vsh-acct" aria-expanded="false"><span class="vsh-avatar vsh-avatar-sm" id="vsh-acct-avatar">LV</span><span class="vsh-acct-text"><b id="vsh-acct-name">Your shop</b><small id="vsh-acct-mail"></small></span>${ico("chev", 18)}</button>` +
                '<div class="vsh-acct-menu" id="vsh-acct-menu" hidden>' + ITEMS.filter(i => i[4] === "acct").map(i => item(i, "vsh-acct-item", false)).join("") + "</div>" +
            "</div>";
        document.body.appendChild(side);
        const openGroup = (on) => { const g = document.getElementById("vsh-products-group"), box = document.getElementById("vsh-products-subs"); box.hidden = !on; g.setAttribute("aria-expanded", on ? "true" : "false"); g.classList.toggle("open", on); };
        const openAcct = (on) => { const g = document.getElementById("vsh-acct"), box = document.getElementById("vsh-acct-menu"); box.hidden = !on; g.setAttribute("aria-expanded", on ? "true" : "false"); g.classList.toggle("open", on); if (on) box.scrollIntoView({ block: "nearest" }); };
        side._openGroup = openGroup;
        side.addEventListener("click", (e) => {
            if (e.target.closest("#vsh-products-group")) { openGroup(document.getElementById("vsh-products-subs").hidden); return; }
            if (e.target.closest("#vsh-acct")) { openAcct(document.getElementById("vsh-acct-menu").hidden); return; }
            if (e.target.closest("[data-shop]")) { current = "desk:storefront"; vmOpenDeskTab("storefront"); mark(); return; }
            const b = e.target.closest("[data-vsh]");
            if (!b) return;
            const it = ITEMS.find(i => i[0] === b.dataset.vsh);
            if (it) { if (!["help", "logout"].includes(it[0])) current = it[0] === "feedback" ? "desk:messages" : it[0]; it[3](); mark(); }
        });

        const top = document.createElement("header");
        top.id = "vsh-top";
        top.className = "vsh-top";
        top.innerHTML =
            `<button type="button" class="vsh-icon-btn" id="vsh-collapse" aria-label="Show or hide the menu">${ico("menu")}</button>` +
            '<div class="vsh-top-title" id="vsh-top-title"></div>' +
            `<div class="vsh-top-right"><button type="button" class="vsh-icon-btn vsh-bell" id="vsh-bell" aria-label="Notifications">${ico("bell")}<i id="vsh-bell-n" hidden></i></button>` +
            '<span class="vsh-sep"></span>' +
            `<button type="button" class="vsh-me" id="vsh-me"><span class="vsh-avatar" id="vsh-avatar">LV</span><span class="vsh-me-text"><b id="vsh-me-name">Your shop</b><small>Vendor Account</small></span>${ico("chev", 18)}</button></div>`;
        document.body.appendChild(top);
        top.querySelector("#vsh-collapse").onclick = () => document.body.classList.toggle("vsh-collapsed");
        top.querySelector("#vsh-me").onclick = () => { current = "account"; vmShowScreen("account"); mark(); };
        top.querySelector("#vsh-bell").onclick = (e) => { e.stopPropagation(); toggleNotifs(); };
        document.addEventListener("click", (e) => { if (!e.target.closest("#vsh-notifs")) closeNotifs(); });
        document.body.classList.add("vsh-on");
    }

    function mark() {
        document.querySelectorAll(".vsh-item[data-vsh]").forEach(b => b.classList.toggle("on", b.dataset.vsh === current));
        const shop = document.querySelector(".vsh-shop-btn"); if (shop) shop.classList.toggle("on", current === "desk:storefront");
        const side = document.getElementById("vsh-side");
        if (side && side._openGroup && SUBS.includes(current)) side._openGroup(true);
        const g = document.getElementById("vsh-products-group"); if (g) g.classList.toggle("has-on", SUBS.includes(current));
        const it = ITEMS.find(i => i[0] === current);
        const t = document.getElementById("vsh-top-title");
        if (t) t.textContent = current === "desk:storefront" ? "My Storefront" : it ? it[2] : "";
    }

    // Keep the menu in step with whatever opened a screen.
    function hook() {
        const orig = window.vmShowScreen;
        if (typeof orig !== "function" || orig.__vsh) return;
        const wrapped = function (name, opts) {
            const r = orig.apply(this, arguments);
            if (name !== "desk") {
                const direct = ITEMS.find(i => i[0] === name);
                current = direct ? name
                    : ["consignments-create", "pickers", "pickers-create", "pickers-edit"].includes(name) ? "consignments"
                    : ["promo-campaigns", "promotions-propose", "promo-monitoring"].includes(name) ? "promotions"
                    : ["ads-create"].includes(name) ? "ads"
                    : ["statement-detail"].includes(name) ? "wallet"
                    : ["users", "users-create", "users-edit", "holiday-mode", "channel", "channel-create", "channel-import", "channel-export"].includes(name) ? "settings" : current;
                mark();
            }
            return r;
        };
        wrapped.__vsh = true;
        window.vmShowScreen = wrapped;
        const origDesk = window.vmOpenDeskTab;
        if (typeof origDesk === "function" && !origDesk.__vsh) {
            const d = function (tab) {
                const r = origDesk.apply(this, arguments);
                current = "desk:" + tab;
                mark();
                return r;
            };
            d.__vsh = true;
            window.vmOpenDeskTab = d;
        }
    }

    async function fill() {
        try {
            const me = await vendorAuthorizedFetch("/api/vendors/me");
            if (me && !me.error) {
                const name = me.business_name || "Your shop";
                document.getElementById("vsh-me-name").textContent = name;
                const an = document.getElementById("vsh-acct-name"), am = document.getElementById("vsh-acct-mail"), av = document.getElementById("vsh-acct-avatar");
                if (an) an.textContent = name;
                if (am) am.textContent = me.email || me.contact_email || "";
                if (av) av.textContent = name.replace(/[^A-Za-z0-9\s]/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "LV";
                document.getElementById("vsh-avatar").textContent = name.replace(/[^A-Za-z0-9\s]/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "LV";
            }
        } catch (e) { /* keep defaults */ }
        try {
            const am = document.getElementById("vsh-acct-mail");
            if (am && !am.textContent) { const su = await vendorAuthorizedFetch("/api/vendors/me/shop-setup"); if (su && su.account && su.account.email) am.textContent = su.account.email; }
        } catch (e) { /* the name alone is fine */ }
        refreshCompliance();
        refreshBell();
    }

    async function refreshCompliance() {
        const box = document.getElementById("vsh-comp");
        if (!box || !window.LzVendorComplianceUi) return;
        let k;
        try { k = await vendorAuthorizedFetch("/api/vendors/me/kyc"); } catch (e) { return; }
        if (!k || k.error) return;
        const s = window.LzVendorComplianceUi.summary(k);
        const badge = document.getElementById("vsh-count-verification");
        if (badge) { const n = s.missing + s.redo; badge.textContent = n; badge.hidden = !n; badge.classList.toggle("red", !!s.held); }
        box.hidden = !!s.verified;      // nothing to chase once verified
        box.innerHTML = s.verified
            ? `<div class="vsh-comp-head">${ico("shield", 20)} Compliance</div><div class="vsh-comp-big vsh-green">Fully Verified</div>
               <div class="vsh-comp-sub">${s.approved}/${s.total} requirements completed</div><div class="vsh-bar"><span style="width:100%" class="vsh-bar-green"></span></div>
               <div class="vsh-comp-ok">${ico("ok", 16)} Your account is fully verified</div>`
            : `<div class="vsh-comp-head">${ico("shield", 20)} Compliance Status</div>
               <div class="vsh-comp-sub">${s.held ? "Upload the requested documents to lift the hold." : "Complete all required documents to activate your account."}</div>
               <div class="vsh-comp-box"><div class="vsh-comp-row"><b>${s.submitted} of ${s.total} submitted</b><span>${s.pct}%</span></div>
               <div class="vsh-bar"><span style="width:${s.pct}%"></span></div>
               <div class="vsh-comp-row vsh-small"><span class="vsh-green">${s.submitted} submitted</span><span class="vsh-red">${s.missing + s.redo} missing</span></div></div>
               <button type="button" class="vsh-comp-btn" onclick="vmShowScreen('verification')">Upload documents</button>`;
    }

    async function refreshBell() {
        try {
            const d = await vendorAuthorizedFetch("/api/vendors/notifications/unread-count");
            const n = document.getElementById("vsh-bell-n");
            if (n) { n.textContent = d.unread > 99 ? "99+" : String(d.unread || 0); n.hidden = !(d.unread > 0); }
        } catch (e) { /* ignore */ }
    }
    function closeNotifs() { const p = document.getElementById("vsh-notifs"); if (p) p.remove(); }
    async function toggleNotifs() {
        if (document.getElementById("vsh-notifs")) return closeNotifs();
        const p = document.createElement("div");
        p.id = "vsh-notifs";
        p.className = "vsh-notifs";
        p.innerHTML = '<div class="vsh-notifs-head"><b>Notifications</b><button type="button" id="vsh-read-all">Mark all read</button></div><div class="vsh-notifs-list">Loading...</div>';
        document.body.appendChild(p);
        p.querySelector("#vsh-read-all").onclick = async () => {
            await vendorAuthorizedFetch("/api/vendors/notifications/read-all", { method: "PATCH" }).catch(() => {});
            refreshBell(); closeNotifs();
        };
        try {
            const rows = await vendorAuthorizedFetch("/api/vendors/notifications");
            const list = p.querySelector(".vsh-notifs-list");
            if (!Array.isArray(rows) || !rows.length) { list.innerHTML = '<p class="vsh-empty">No notifications yet.</p>'; return; }
            list.innerHTML = rows.slice(0, 12).map(n => `<button type="button" class="vsh-n${n.read_at ? "" : " unread"}" data-id="${n.id}">
                <b>${esc(n.title)}</b><span>${esc(n.message)}</span><small>${new Date(n.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></button>`).join("");
            list.addEventListener("click", async (e) => {
                const b = e.target.closest(".vsh-n");
                if (!b) return;
                await vendorAuthorizedFetch(`/api/vendors/notifications/${b.dataset.id}/read`, { method: "PATCH" }).catch(() => {});
                b.classList.remove("unread");
                refreshBell();
            });
        } catch (e) {
            p.querySelector(".vsh-notifs-list").innerHTML = '<p class="vsh-empty">Could not load notifications.</p>';
        }
    }

    // The "Lizimas Vendor" badge at the top of the phone screens opens the home page too.
    document.addEventListener("click", (e) => {
        const brand = e.target.closest && e.target.closest(".vm-header-brand");
        if (brand && typeof vmShowScreen === "function") { current = "home"; vmShowScreen("home"); mark(); }
    });

    function start() {
        build();
        hook();
        mark();
        fill();
        setInterval(refreshBell, 120000);
    }
    window.LzVendorShell = { refreshCompliance, refreshBell };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0));
    else setTimeout(start, 0);
})();
