// Vendor Center home page (Ryan, Oct 2026), in the layout of the Vendor
// Center the store is modelled on, in Lizimas colours:
//   greeting  ->  Yours to do  ->  Business metrics (7 / 30 / 90 days)
//   ->  Seller score  |  Learn how to do  ->  Recent orders
// Data: GET /api/vendors/dashboard-summary (passed in), GET
// /api/vendors/me/business-metrics?days=N and GET /api/vendors/me/campaigns.
//
//   VendorHome.render(account, summary, setup)  -> HTML (called by vendor-shop-setup.js)
//   VendorHome.afterRender()                    loads the metrics and campaigns
(function () {
    "use strict";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ugx = (n) => Number(n || 0).toLocaleString() + " UGX";
    const svg = (d, s, extra) => `<svg viewBox="0 0 24 24" width="${s || 22}" height="${s || 22}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ""}>${d}</svg>`;
    const state = { days: 7 };

    // Small pictures for the cards (drawn here, no image files).
    const ART = {
        hero: `<svg class="vh-hero-art" viewBox="0 0 360 150" aria-hidden="true">
            <defs><linearGradient id="vhg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4b400" stop-opacity=".55"/><stop offset="1" stop-color="#f4b400" stop-opacity="0"/></linearGradient></defs>
            <circle cx="300" cy="28" r="60" fill="#f4b400" opacity=".10"/><circle cx="60" cy="140" r="46" fill="#fff" opacity=".05"/>
            <path d="M20 120 70 92 112 104 160 62 206 78 256 34 330 52 330 150 20 150Z" fill="url(#vhg1)"/>
            <path d="M20 120 70 92 112 104 160 62 206 78 256 34 330 52" fill="none" stroke="#f4b400" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <g fill="#fff"><circle cx="70" cy="92" r="4.5"/><circle cx="160" cy="62" r="4.5"/><circle cx="256" cy="34" r="5.5"/></g>
            <g transform="translate(232 0)" opacity=".95"><rect x="0" y="0" width="64" height="22" rx="11" fill="#f4b400"/><path d="m12 14 6-6 5 4 8-7" stroke="#1a1a2e" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="38" y="8" width="18" height="6" rx="3" fill="#1a1a2e" opacity=".75"/></g>
        </svg>`,
        campaign: `<svg viewBox="0 0 96 72" aria-hidden="true"><rect x="8" y="14" width="80" height="46" rx="8" fill="#fff6d6"/><path d="M30 44V30l26-10v34l-26-10Z" fill="#f4b400"/><rect x="22" y="31" width="9" height="12" rx="2" fill="#1a1a2e"/><path d="M62 30c4 2 4 12 0 14M67 25c8 5 8 19 0 24" stroke="#1a1a2e" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="78" cy="16" r="5" fill="#1a1a2e"/><circle cx="16" cy="58" r="3.5" fill="#f4b400"/></svg>`,
        box: `<svg viewBox="0 0 96 72" aria-hidden="true"><rect x="8" y="14" width="80" height="46" rx="8" fill="#eef1ff"/><path d="M48 16 24 27v22l24 11 24-11V27L48 16Z" fill="#1a1a2e"/><path d="m24 27 24 11 24-11M48 38v22" stroke="#f4b400" stroke-width="2.4" fill="none" stroke-linejoin="round"/><circle cx="76" cy="18" r="9" fill="#f4b400"/><path d="M76 13.5v9M71.5 18h9" stroke="#1a1a2e" stroke-width="2.4" stroke-linecap="round"/></svg>`,
        ship: `<svg viewBox="0 0 96 72" aria-hidden="true"><rect x="8" y="14" width="80" height="46" rx="8" fill="#e9f8ef"/><rect x="18" y="26" width="36" height="22" rx="3" fill="#1a1a2e"/><path d="M54 32h14l8 9v7H54V32Z" fill="#f4b400"/><circle cx="30" cy="50" r="5.5" fill="#fff" stroke="#1a1a2e" stroke-width="2.4"/><circle cx="66" cy="50" r="5.5" fill="#fff" stroke="#1a1a2e" stroke-width="2.4"/></svg>`,
        setup: `<svg viewBox="0 0 96 72" aria-hidden="true"><rect x="8" y="14" width="80" height="46" rx="8" fill="#fff6d6"/><path d="M24 34 28 22h40l4 12M24 34v20h48V34" fill="#fff" stroke="#1a1a2e" stroke-width="2.4" stroke-linejoin="round"/><path d="M24 34c0 3 2.6 5 6 5s6-2 6-5c0 3 2.6 5 6 5s6-2 6-5c0 3 2.6 5 6 5s6-2 6-5c0 3 2.6 5 6 5s6-2 6-5" fill="#f4b400" stroke="#1a1a2e" stroke-width="2.4" stroke-linejoin="round"/><rect x="42" y="42" width="12" height="12" fill="#1a1a2e"/></svg>`
    };
    const LEARN = [
        { title: "Create new product", text: "How to add a product, its photos, variations and specifications", action: "SEE TUTORIAL", href: "../seller-guide", icon: '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4ZM4 7l8 4 8-4M12 11v10"/>' },
        { title: "Raise a claim", text: "Contact the support team if you have an issue with an order, a return or a payout", action: "REQUEST HERE", go: "vmOpenDeskTab('messages')", icon: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M12 8v3.5M12 13.6h.01"/>' },
        { title: "Fulfilment by Lizimas", text: "Send stock to the Lizimas warehouse and let us store, pack and deliver it", action: "SEE TUTORIAL", go: "vmShowScreen('consignments')", icon: '<rect x="2.5" y="8" width="11" height="8" rx="1"/><path d="M13.5 10.5H18l3 3V16h-7.5"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>' },
        { title: "Improve your rating", text: "All there is to know about the seller score and how to raise it", action: "SEE TUTORIAL", href: "../vendor-policies#seller-score", icon: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.6-5 2.6 1-5.6-4.1-3.9 5.6-.8L12 3.8Z"/>' }
    ];

    function todoCard(art, title, text, button, onclick, id) {
        return `<section class="vh-todo"${id ? ` id="${id}"` : ""}>
            <div class="vh-todo-top"><div><h3>${title}</h3><p>${esc(text)}</p></div><span class="vh-todo-art">${art}</span></div>
            <button type="button" class="vh-todo-btn" onclick="${onclick}">${esc(button)}</button></section>`;
    }
    function stars(score) {
        const five = score == null ? 0 : Math.round(score / 20 * 2) / 2;
        let out = "";
        for (let i = 1; i <= 5; i++) {
            const fill = five >= i ? 100 : five >= i - 0.5 ? 50 : 0;
            out += `<span class="vh-star"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9L12 2.6Z" fill="#d9dce2"/></svg>` +
                (fill ? `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" style="clip-path:inset(0 ${100 - fill}% 0 0)"><path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9L12 2.6Z" fill="#f4b400"/></svg>` : "") + "</span>";
        }
        return { html: out, value: score == null ? "-" : five.toFixed(1) };
    }
    // One line of the seller score: name, the figure, a bar and the grade.
    function scoreRow(name, hint, figure, percent, grade) {
        const tone = grade === "Excellent" || grade === "Good" ? "ok" : grade === "Fair" ? "mid" : grade === "Poor" ? "bad" : "new";
        return `<div class="vh-score-row"><span class="vh-score-name">${esc(name)} <i title="${esc(hint)}" aria-label="${esc(hint)}">${svg('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>', 17)}</i></span>
            <span class="vh-score-fig">${esc(figure)}</span>
            <span class="vh-bar"><b class="vh-bar-${tone}" style="width:${percent == null ? 0 : Math.max(4, Math.min(100, percent))}%"></b></span>
            <span class="vh-score-grade vh-g-${tone}">${esc(grade === "New" ? "-" : grade)}</span></div>`;
    }

    function render(account, summary, setup) {
        account = account || {}; summary = summary || {};
        const o = summary.orders || {}, p = summary.products || {}, h = summary.home || {};
        const sc = summary.sellerScore || {}, d = sc.details || {}, perf = sc.performance || {};
        const shop = account.business_name || "your shop";
        const st = stars(sc.score);
        const todo = [];
        if (setup && !setup.all_completed) {
            const done = (setup.steps || []).filter((s) => s.completed).length, total = (setup.steps || []).length || 5;
            todo.push(todoCard(ART.setup, `Finish your shop setup (${done} of ${total})`, "Complete every section so your shop can go live", "CONTINUE SETUP", "document.getElementById('vss-root').scrollIntoView({behavior:'smooth',block:'start'})"));
        }
        todo.push(todoCard(ART.campaign, 'New campaigns (<span id="vh-campaigns">0</span>)', "Grow your sales by joining the next Lizimas Store campaign", "SEE CAMPAIGNS", "vmShowScreen('promo-campaigns')"));
        todo.push(todoCard(ART.box, `Available products (${Number((h.listings && h.listings.active) != null ? h.listings.active : (p.total || 0)).toLocaleString()})`, "List products to start selling on Lizimas Store", "CREATE PRODUCTS", "vmShowScreen('add-product')"));
        if (Number(o.pendingHandover) > 0) todo.push(todoCard(ART.ship, `Orders to ship (${Number(o.pendingHandover).toLocaleString()})`, "Pack these orders and hand them over on time to keep your score up", "OPEN ORDERS", "vmShowScreen('orders')"));

        const recent = h.recent_orders || [];
        const statusName = { delivered: "Delivered", shipped: "Shipped", paid: "Processing", processing: "Processing", pending: "Pending", cancelled: "Cancelled" };
        return `<div class="vh">
            <header class="vh-hero">
                <div class="vh-hero-text">
                    <span class="vh-chip">${esc(account.status === "approved" ? "Shop approved" : account.status === "pending" ? "Pending review" : String(account.status || "Vendor Center"))}${account.shop_id ? " &middot; " + esc(account.shop_id) : ""}</span>
                    <h1><strong>Hey there,</strong> here is a r&eacute;sum&eacute; of where <strong>${esc(shop)}</strong> is at</h1>
                    <div class="vh-hero-btns"><button type="button" class="vh-btn-gold" onclick="vmShowScreen('add-product')">+ Add a product</button><button type="button" class="vh-btn-line" onclick="vmShowScreen('orders')">View orders</button></div>
                </div>${ART.hero}
            </header>

            <h2 class="vh-h">Yours to do</h2>
            <div class="vh-todos vh-todos-${Math.min(todo.length, 4)}">${todo.join("")}</div>

            <div class="vh-cols">
                <div class="vh-main">
                    <div class="vh-h-row"><h2 class="vh-h">Business metrics</h2>
                        <div class="vh-pills" role="group" aria-label="Period">${[7, 30, 90].map((n) => `<button type="button" class="vh-pill${n === state.days ? " on" : ""}" data-vh-days="${n}">${n} Days</button>`).join("")}</div></div>
                    <div class="vh-metrics" id="vh-metrics">
                        ${["Revenue", "Items Sold", "Assortment Live"].map((t) => `<div class="vh-metric"><span>${t}</span><strong>&hellip;</strong><em>&nbsp;</em></div>`).join("")}
                    </div>
                    <div class="vh-chart" id="vh-chart" aria-label="Revenue per day"></div>

                    <section class="vh-card vh-score">
                        <div class="vh-score-head"><div><h3>Seller score</h3><p>${svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 15)} Last refreshed &ndash; ${new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</p></div>
                            <div class="vh-score-total"><b>${st.value}</b><span class="vh-stars">${st.html}</span></div></div>
                        ${scoreRow("Vendor Cancellation Rate", "Orders you cancelled or that were cancelled because they were not shipped in time", d.cancellationRate == null ? "-" : d.cancellationRate + "%", d.cancellationRate == null ? null : 100 - d.cancellationRate, perf.cancellation || "New")}
                        ${scoreRow("Quality Return Rate", "Items rejected at the quality check or returned by customers for quality reasons", d.qualityReturnRate == null ? "-" : d.qualityReturnRate + "%", d.qualityReturnRate == null ? null : 100 - d.qualityReturnRate, perf.quality || "New")}
                        ${scoreRow("Average Customer Rating", "The average number of stars customers gave your products", sc.averageRating == null ? "-" : sc.averageRating + " / 5", d.ratingScore, perf.rating || "New")}
                        ${scoreRow("Shipping Speed", "How long you take to pack an order and hand it over", d.avgShippingHours == null ? "-" : (d.avgShippingHours >= 48 ? Math.round(d.avgShippingHours / 24 * 10) / 10 + " days" : d.avgShippingHours + " hrs"), d.shippingScore, perf.shipping || "New")}
                    </section>
                </div>
                <aside class="vh-side">
                    <h2 class="vh-h">Learn how to do</h2>
                    <div class="vh-learn">${LEARN.map((l) => `<section class="vh-learn-card"><span class="vh-learn-ico">${svg(l.icon, 24)}</span><h3>${esc(l.title)}</h3><p>${esc(l.text)}</p>
                        ${l.href ? `<a class="vh-learn-btn" href="${l.href}" target="_blank" rel="noopener">${l.action}</a>` : `<button type="button" class="vh-learn-btn" onclick="${l.go}">${l.action}</button>`}</section>`).join("")}</div>
                </aside>
            </div>

            <section class="vh-card vh-orders">
                <div class="vh-card-head"><h3>Recent orders</h3><button type="button" class="vh-link" onclick="vmShowScreen('orders')">View all orders</button></div>
                ${recent.length ? `<div class="vh-table-wrap"><table class="vh-table"><thead><tr><th>Order</th><th>Item</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${recent.map((r) => `<tr>
                    <td><a href="javascript:void(0)" onclick="vmShowScreen('orders')">#ORD-${esc(r.id)}</a></td><td>${esc(r.first_item || "")}${r.items > 1 ? ` <span class="vh-muted">+${r.items - 1}</span>` : ""}</td>
                    <td class="vh-nowrap">${new Date(r.created_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</td><td class="vh-nowrap">${ugx(r.amount)}</td>
                    <td><span class="vh-status vh-s-${esc(r.status)}">${esc(statusName[r.status] || String(r.status || "-").replace(/_/g, " "))}</span></td></tr>`).join("")}</tbody></table></div>`
                    : '<p class="vh-empty">No orders yet. Share your shop link to get your first sale.</p>'}
            </section>
        </div>`;
    }

    function trend(pct, fresh) {
        if (pct == null) return `<em class="vh-flat">${svg('<path d="M4 12h15M14 7l5 5-5 5"/>', 18)} ${fresh ? "New" : "0%"}</em>`;
        const up = pct >= 0;
        return `<em class="${up ? "vh-up" : "vh-down"}">${svg(up ? '<path d="M5 17 17 6M9 6h8v8"/>' : '<path d="M5 7l12 11M9 18h8v-8"/>', 18)} ${Math.abs(pct)}%</em>`;
    }
    // Daily revenue as a soft area chart (inline SVG, no library).
    function chart(daily, days) {
        const byDay = new Map((daily || []).map((r) => [String(r.day).slice(0, 10), Number(r.revenue) || 0]));
        const pts = [];
        for (let i = days - 1; i >= 0; i--) { const dt = new Date(Date.now() - i * 864e5); const k = dt.toISOString().slice(0, 10); pts.push({ k, v: byDay.get(k) || 0, dt }); }
        // Days are stored in the shop's time zone; fall back to the raw rows when the keys don't line up.
        if (!pts.some((x) => x.v) && daily && daily.length) { pts.length = 0; daily.forEach((r) => pts.push({ k: String(r.day).slice(0, 10), v: Number(r.revenue) || 0, dt: new Date(r.day) })); }
        const max = Math.max.apply(null, pts.map((x) => x.v).concat([1]));
        const W = 640, H = 120, pad = 6, n = Math.max(pts.length - 1, 1);
        const xy = pts.map((x, i) => [pad + i * (W - pad * 2) / n, H - 16 - (x.v / max) * (H - 30)]);
        if (!pts.some((x) => x.v)) return '<p class="vh-empty">No sales in this period yet.</p>';
        const line = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
        const label = (x) => x.dt.toLocaleDateString([], { day: "numeric", month: "short" });
        return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Revenue per day over the last ${days} days">
            <defs><linearGradient id="vhArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4b400" stop-opacity=".38"/><stop offset="1" stop-color="#f4b400" stop-opacity="0"/></linearGradient></defs>
            <path d="${line} L${xy[xy.length - 1][0].toFixed(1)} ${H - 16} L${xy[0][0].toFixed(1)} ${H - 16}Z" fill="url(#vhArea)"/>
            <path d="${line}" fill="none" stroke="#1a1a2e" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
        </svg><div class="vh-chart-x"><span>${label(pts[0])}</span><span>Revenue per day &middot; highest ${ugx(max)}</span><span>${label(pts[pts.length - 1])}</span></div>`;
    }

    async function loadMetrics() {
        const host = document.getElementById("vh-metrics"), ch = document.getElementById("vh-chart");
        if (!host) return;
        try {
            const m = await vendorAuthorizedFetch(`/api/vendors/me/business-metrics?days=${state.days}`);
            if (!m || m.error) throw new Error((m && m.error) || "no data");
            host.innerHTML =
                `<div class="vh-metric"><span>Revenue</span><strong>${ugx(m.revenue)}</strong>${trend(m.revenue_change, m.revenue > 0)}</div>` +
                `<div class="vh-metric"><span>Items Sold</span><strong>${Number(m.items_sold || 0).toLocaleString()}</strong>${trend(m.items_change, m.items_sold > 0)}</div>` +
                `<div class="vh-metric"><span>Assortment Live</span><strong>${Number(m.live || 0).toLocaleString()}<small> of ${Number(m.total_products || 0).toLocaleString()}</small></strong>${trend(m.live_change, false)}</div>`;
            if (ch) ch.innerHTML = chart(m.daily, m.days);
            // Order limit notice: at the limit the products are hidden from the store.
            const ol = m.order_limit, old = document.getElementById("vh-limit");
            if (old) old.remove();
            if (ol && ol.limit > 0 && ol.pending >= ol.limit - 1) {
                const box = document.createElement("div");
                box.id = "vh-limit"; box.className = "vh-limit" + (ol.hit ? " vh-limit-hit" : "");
                box.innerHTML = ol.hit
                    ? `<strong>Your products are hidden from the store.</strong> You have ${ol.pending} paid orders waiting to be handed over and the limit is ${ol.limit}. Hand over at least one order and your products come back by themselves. <button type="button" onclick="vmShowScreen('orders')">Open orders</button>`
                    : `<strong>You are one order away from the order limit.</strong> ${ol.pending} paid orders are waiting to be handed over; at ${ol.limit} your products are hidden from the store until you hand one over. <button type="button" onclick="vmShowScreen('orders')">Open orders</button>`;
                const hero = document.querySelector(".vh-hero");
                if (hero) hero.insertAdjacentElement("afterend", box);
            }
        } catch (e) {
            host.querySelectorAll("strong").forEach((s) => { s.textContent = "-"; });
            if (ch) ch.innerHTML = "";
        }
    }
    async function loadCampaigns() {
        const el = document.getElementById("vh-campaigns");
        if (!el) return;
        try {
            const d = await vendorAuthorizedFetch("/api/vendors/me/campaigns");
            const now = Date.now();
            const open = ((d && d.campaigns) || []).filter((c) => !c.joined && !c.my_status && (!c.ends_at || new Date(c.ends_at).getTime() > now) && !/ended|closed|cancel/i.test(String(c.status || "")));
            el.textContent = open.length;
        } catch (e) { /* the card still opens the campaigns */ }
    }
    function afterRender() {
        const root = document.querySelector(".vh");
        if (!root) return;
        root.addEventListener("click", (e) => {
            const b = e.target.closest("[data-vh-days]");
            if (!b) return;
            state.days = Number(b.dataset.vhDays);
            root.querySelectorAll(".vh-pill").forEach((x) => x.classList.toggle("on", x === b));
            loadMetrics();
        });
        loadMetrics(); loadCampaigns();
    }

    window.VendorHome = { render, afterRender };
})();
