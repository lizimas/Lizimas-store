// Step-by-step Add / Edit Product form (Ryan, Sept 2026).
//
// The form's sections carry data-step="1".."N" (several sections can share a
// step). This adds:
//  * Computer: every step stays on the page, with a steps bar on top
//    ("1. Basic -> 2. Photos -> ...") that jumps to a step and lights up the
//    step being looked at.
//  * Phone: one step per screen - "Step 2 of 7 - Photos", progress dots, and
//    a Back / Continue bar that stays at the bottom. The last step holds the
//    Save / Submit button.
//  * The last step (data-review="1") shows a summary of what was filled in,
//    with anything missing marked, from the form's own summary() callback.
//
//   LzFormSteps.mount(rootEl, {
//       titles: ["Basic", "Photos", ...],      // one per step
//       summary: () => [{ label, value, ok, step }],
//       validate: (step) => "message" | null,   // checked on Continue (phone)
//       scrollParent: element,                  // optional, defaults to window
//       actions: [elements]                     // shown only on the last step (phone)
//   });
//   LzFormSteps.reset(rootEl)   // back to step 1 (when the form is opened)
//   LzFormSteps.refresh(rootEl) // redraw the summary
(function () {
    "use strict";

    const STYLE_ID = "lzfs-style";
    const PHONE = "(max-width: 760px)";
    const CSS = `
.lzfs-bar { position: sticky; top: 0; z-index: 20; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
    padding: 8px 10px; margin: 0 0 16px; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
    box-shadow: 0 2px 6px rgba(16,24,40,.05); }
.lzfs-bar::-webkit-scrollbar { display: none; }
.lzfs-step { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
    padding: 6px 10px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #6b7280; white-space: nowrap; font-family: inherit; }
.lzfs-step:hover { background: #f3f4f6; color: #1a1a2e; }
.lzfs-num { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid #cbd0d8; display: inline-flex;
    align-items: center; justify-content: center; font-size: 12px; }
.lzfs-step.lzfs-done .lzfs-num { background: #e8f5ee; border-color: #16a34a; color: #16a34a; }
.lzfs-step.lzfs-on { color: #1a1a2e; background: #fff8e1; }
.lzfs-step.lzfs-on .lzfs-num { background: #1a1a2e; border-color: #1a1a2e; color: #fff; }
.lzfs-arrow { color: #cbd0d8; font-size: 13px; }
.lzfs-head { display: none; }
.lzfs-nav { display: none; }
.lzfs-review-list { list-style: none; margin: 0; padding: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
.lzfs-review-list li { display: grid !important; grid-template-columns: 34% minmax(0, 1fr) auto; gap: 10px; align-items: baseline;
    padding: 10px 12px; margin: 0; border-top: 1px solid #f0f0f0; font-size: 13.5px; }
.lzfs-review-list li:first-child { border-top: 0; }
.lzfs-review-label { color: #6b7280; }
.lzfs-review-value { color: #111827; font-weight: 600; word-break: break-word; }
.lzfs-review-miss .lzfs-review-value { color: #b42318; }
.lzfs-review-edit { border: 0; background: none; color: #1d4ed8; cursor: pointer; font-size: 12.5px; padding: 0; font-family: inherit; }
.lzfs-review-ok { margin: 10px 0 0; font-size: 13px; color: #166534; }
.lzfs-review-bad { margin: 10px 0 0; font-size: 13px; color: #b42318; }
.lzfs-msg { color: #b42318; font-size: 13px; margin: 0 0 8px; }
@media ${PHONE} {
    .lzfs-bar { display: none; }
    .lzfs-head { display: block; margin: 0 0 12px; }
    .lzfs-head-title { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .lzfs-dots { display: flex; gap: 6px; margin-top: 8px; }
    .lzfs-dot { width: 9px; height: 9px; border-radius: 50%; background: #d1d5db; }
    .lzfs-dot.lzfs-done { background: #16a34a; }
    .lzfs-dot.lzfs-on { background: #1a1a2e; width: 22px; border-radius: 5px; }
    .lzfs-phone .product-form-section.lzfs-off { display: none !important; }
    .lzfs-nav { display: flex; gap: 10px; position: sticky; bottom: 0; z-index: 20; background: #fff;
        padding: 10px 0 12px; margin-top: 14px; border-top: 1px solid #e5e7eb; }
    .lzfs-nav button { flex: 1; padding: 13px; border-radius: 8px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .lzfs-back { background: #fff; color: #1a1a2e; border: 1.5px solid #1a1a2e; }
    .lzfs-next { background: #f4b400; color: #1a1a2e; border: 0; }
    .lzfs-nav.lzfs-last .lzfs-next { display: none; }
    .lzfs-nav.lzfs-first .lzfs-back { display: none; }
}`;

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

    const isPhone = () => window.matchMedia && window.matchMedia(PHONE).matches;

    function sectionsOf(root, step) {
        return Array.from(root.querySelectorAll(":scope > .product-form-section[data-step]"))
            .filter((s) => step === undefined || Number(s.dataset.step) === step);
    }

    function visibleFirst(root, step) {
        return sectionsOf(root, step).find((s) => !s.classList.contains("hidden")) || sectionsOf(root, step)[0];
    }

    function mount(root, opts) {
        if (!root || root._lzfs) return;
        ensureStyle();
        const st = { opts: opts || {}, step: 1, count: 0, visited: new Set([1]) };
        root._lzfs = st;
        st.count = Math.max.apply(null, sectionsOf(root).map((s) => Number(s.dataset.step)));
        const titles = st.opts.titles || [];

        const bar = document.createElement("nav");
        bar.className = "lzfs-bar";
        bar.setAttribute("aria-label", "Steps");
        let html = "";
        for (let i = 1; i <= st.count; i++) {
            html += (i > 1 ? '<span class="lzfs-arrow" aria-hidden="true">&rarr;</span>' : "") +
                '<button type="button" class="lzfs-step" data-go="' + i + '"><span class="lzfs-num">' + i + "</span>" +
                esc(titles[i - 1] || "Step " + i) + "</button>";
        }
        bar.innerHTML = html;

        const head = document.createElement("div");
        head.className = "lzfs-head";
        head.setAttribute("aria-live", "polite");

        const msg = document.createElement("p");
        msg.className = "lzfs-msg";
        msg.hidden = true;

        const nav = document.createElement("div");
        nav.className = "lzfs-nav";
        nav.innerHTML = '<button type="button" class="lzfs-back">&larr; Back</button>' +
            '<button type="button" class="lzfs-next">Continue &rarr;</button>';

        root.parentNode.insertBefore(bar, root);
        root.parentNode.insertBefore(head, root);
        root.parentNode.insertBefore(msg, root);
        root.parentNode.insertBefore(nav, root.nextSibling);
        st.bar = bar; st.head = head; st.nav = nav; st.msg = msg;

        bar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-go]");
            if (b) go(root, Number(b.dataset.go), true);
        });
        nav.querySelector(".lzfs-back").onclick = () => go(root, st.step - 1, true);
        nav.querySelector(".lzfs-next").onclick = () => {
            const problem = st.opts.validate ? st.opts.validate(st.step) : null;
            if (problem) { showMsg(root, problem); return; }
            go(root, st.step + 1, true);
        };
        root.addEventListener("click", (e) => {
            const b = e.target.closest("[data-lzfs-go]");
            if (b) { e.preventDefault(); go(root, Number(b.dataset.lzfsGo), true); }
        });

        // Computer: light up the step in view.
        const spy = () => {
            if (isPhone()) return;
            const top = st.bar.getBoundingClientRect().bottom + 40;
            let cur = 1;
            sectionsOf(root).forEach((sec) => {
                if (sec.classList.contains("hidden")) return;
                if (sec.getBoundingClientRect().top <= top) cur = Number(sec.dataset.step);
            });
            if (cur !== st.step) { st.step = cur; st.visited.add(cur); paint(root); }
        };
        (st.opts.scrollParent || window).addEventListener("scroll", spy, { passive: true });
        document.addEventListener("scroll", spy, { passive: true, capture: true });

        if (window.matchMedia) {
            const mq = window.matchMedia(PHONE);
            const onChange = () => go(root, st.step, false);
            if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
        }
        go(root, 1, false);
    }

    function showMsg(root, text) {
        const st = root._lzfs;
        st.msg.textContent = text || "";
        st.msg.hidden = !text;
        if (text && st.msg.scrollIntoView) st.msg.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function paint(root) {
        const st = root._lzfs;
        const titles = st.opts.titles || [];
        st.bar.querySelectorAll(".lzfs-step").forEach((b) => {
            const i = Number(b.dataset.go);
            b.classList.toggle("lzfs-on", i === st.step);
            b.classList.toggle("lzfs-done", i !== st.step && st.visited.has(i) && i < st.step);
            if (i === st.step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
        });
        let dots = "";
        for (let i = 1; i <= st.count; i++) {
            dots += '<span class="lzfs-dot' + (i === st.step ? " lzfs-on" : (i < st.step ? " lzfs-done" : "")) + '"></span>';
        }
        st.head.innerHTML = '<div class="lzfs-head-title">Step ' + st.step + " of " + st.count + " &ndash; " +
            esc(titles[st.step - 1] || "") + '</div><div class="lzfs-dots">' + dots + "</div>";
        st.nav.classList.toggle("lzfs-first", st.step === 1);
        st.nav.classList.toggle("lzfs-last", st.step === st.count);
    }

    function go(root, step, scroll) {
        const st = root._lzfs;
        if (!st) return;
        step = Math.min(Math.max(1, step), st.count);
        st.step = step;
        st.visited.add(step);
        showMsg(root, "");
        const phone = isPhone();
        root.classList.toggle("lzfs-phone", phone);
        st.nav.classList.toggle("lzfs-phone", phone);
        sectionsOf(root).forEach((sec) => sec.classList.toggle("lzfs-off", Number(sec.dataset.step) !== step));
        // Save / Cancel buttons outside the steps: only on the last step on a phone.
        (st.opts.actions || []).forEach((el) => { if (el) el.style.display = phone && step !== st.count ? "none" : ""; });
        if (step === st.count || !phone) refresh(root);
        paint(root);
        if (!scroll) return;
        if (phone) {
            const top = st.head;
            if (top && top.scrollIntoView) top.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
            const target = visibleFirst(root, step);
            if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    // Summary on the last step: each row links back to its step.
    function refresh(root) {
        const st = root._lzfs;
        if (!st || !st.opts.summary) return;
        const host = root.querySelector('[data-review="1"] .lzfs-review');
        if (!host) return;
        let rows = [];
        try { rows = st.opts.summary() || []; } catch (e) { console.error("Summary error:", e); }
        const missing = rows.filter((r) => r.ok === false);
        host.innerHTML = '<ul class="lzfs-review-list">' + rows.map((r) =>
            '<li class="' + (r.ok === false ? "lzfs-review-miss" : "") + '">' +
                '<span class="lzfs-review-label">' + esc(r.label) + "</span>" +
                '<span class="lzfs-review-value">' + esc(r.value) + "</span>" +
                (r.step ? '<button type="button" class="lzfs-review-edit" data-lzfs-go="' + r.step + '">Edit</button>' : "") +
            "</li>").join("") + "</ul>" +
            (missing.length
                ? '<p class="lzfs-review-bad">Still needed: ' + missing.map((r) => esc(r.label)).join(", ") + ".</p>"
                : '<p class="lzfs-review-ok">&#10003; Everything needed is filled in.</p>');
    }

    // Keep the summary current on a computer, where the last step is always visible.
    let refreshTimer = null;
    document.addEventListener("input", (e) => {
        const root = e.target.closest && e.target.closest(".product-form-sections");
        if (!root || !root._lzfs || isPhone()) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => refresh(root), 300);
    });

    function reset(root) {
        const st = root && root._lzfs;
        if (!st) return;
        st.visited = new Set([1]);
        go(root, 1, false);
    }

    const api = { mount, reset, refresh, go: (root, n) => go(root, n, true) };
    if (typeof window !== "undefined") window.LzFormSteps = api;
})();
