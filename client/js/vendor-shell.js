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
    const ITEMS = [
        ["home", "home", "Overview", () => vmShowScreen("home")],
        ["products", "tag", "Listings", () => vmShowScreen("products")],
        ["orders", "bag", "Orders", () => vmShowScreen("orders")],
        ["desk:refunds", "returns", "Returns & Refunds", () => vmOpenDeskTab("refunds")],
        ["wallet", "wallet", "Payouts", () => vmShowScreen("wallet")],
        ["promotions", "promo", "Promotions", () => vmShowScreen("promotions")],
        ["ads", "ads", "Advertise", () => vmShowScreen("ads")],
        ["desk:reports", "chart", "Analytics", () => vmOpenDeskTab("reports")],
        ["desk:reviews", "star", "Reviews", () => vmOpenDeskTab("reviews")],
        ["desk:storefront", "store", "Storefront", () => vmOpenDeskTab("storefront")],
        ["desk:messages", "chat", "Messages", () => vmOpenDeskTab("messages")],
        ["verification", "shield", "Verification", () => vmShowScreen("verification")],
        ["account", "gear", "Settings", () => vmShowScreen("account")],
        ["help", "help", "Help & Support", () => window.open("../seller-guide", "_blank", "noopener")]
    ];
    let current = "home";

    function build() {
        if (document.getElementById("vsh-side")) return;
        const side = document.createElement("aside");
        side.id = "vsh-side";
        side.className = "vsh-side";
        side.setAttribute("aria-label", "Vendor menu");
        side.innerHTML =
            '<div class="vsh-brand"><span class="vsh-logo">LV</span><span>Lizimas <b>Vendor</b></span></div>' +
            '<nav class="vsh-nav">' + ITEMS.map(([key, icon, label]) =>
                `<button type="button" class="vsh-item" data-vsh="${key}">${ico(icon)}<span>${esc(label)}</span><i class="vsh-count" id="vsh-count-${key.replace(":", "-")}" hidden></i></button>`).join("") + "</nav>" +
            '<div class="vsh-comp" id="vsh-comp"></div>';
        document.body.appendChild(side);
        side.addEventListener("click", (e) => {
            const b = e.target.closest("[data-vsh]");
            if (!b) return;
            const item = ITEMS.find(i => i[0] === b.dataset.vsh);
            if (item) { current = item[0] === "help" ? current : item[0]; item[3](); mark(); }
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
        document.querySelectorAll(".vsh-item").forEach(b => b.classList.toggle("on", b.dataset.vsh === current));
        const item = ITEMS.find(i => i[0] === current);
        const t = document.getElementById("vsh-top-title");
        if (t) t.textContent = item ? item[2] : "";
    }

    // Keep the menu in step with whatever opened a screen.
    function hook() {
        const orig = window.vmShowScreen;
        if (typeof orig !== "function" || orig.__vsh) return;
        const wrapped = function (name, opts) {
            const r = orig.apply(this, arguments);
            if (name !== "desk") {
                const direct = ITEMS.find(i => i[0] === name);
                current = direct ? name : (["add-product", "import-products", "consignments", "stock-recommendation"].includes(name) ? "products"
                    : ["settings", "users", "holiday-mode", "channel", "channel-import", "channel-export", "pickers", "commissions-fees"].includes(name) ? "account" : current);
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
                document.getElementById("vsh-avatar").textContent = name.replace(/[^A-Za-z0-9\s]/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "LV";
            }
        } catch (e) { /* keep defaults */ }
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
