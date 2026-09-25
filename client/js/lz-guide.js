// Searchable guide pages (Ryan, Sept 2026) - admin System Guide and the
// public Seller & Staff Guide share this renderer.
//
// A page defines window.LZ_GUIDE = { sections: [ { id, title, intro?,
//   items: [ { id, title, where?, keywords?, html } ] } ] } and includes
// this file. It renders a table of contents, the sections, and a search box
// that filters items by every word typed (title, keywords, "where" and body
// text), highlights matches and jumps to the first hit. Deep links work:
// page.html#item-id opens with that item highlighted; ?q=word pre-fills the
// search.
(function () {
    "use strict";
    const G = window.LZ_GUIDE;
    if (!G) return;

    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const strip = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent || ""; };
    const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

    const toc = document.getElementById("g-toc");
    const body = document.getElementById("g-body");
    const input = document.getElementById("g-search");
    const count = document.getElementById("g-count");
    const clearBtn = document.getElementById("g-clear");

    // --- render ---------------------------------------------------------------
    const index = [];
    body.innerHTML = G.sections.map((s) => `
        <section class="g-section" id="${esc(s.id)}" data-section>
            <h2 class="g-h2">${esc(s.title)}</h2>
            ${s.intro ? `<p class="g-intro">${s.intro}</p>` : ""}
            ${s.items.map((it) => `
                <article class="g-item" id="${esc(it.id)}" data-item>
                    <h3 class="g-h3"><a href="#${esc(it.id)}" class="g-anchor" aria-label="Link to ${esc(it.title)}">#</a>${esc(it.title)}</h3>
                    ${it.where ? `<p class="g-where"><span>Where:</span> ${it.where}</p>` : ""}
                    <div class="g-text">${it.html}</div>
                </article>`).join("")}
        </section>`).join("");
    toc.innerHTML = G.sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.title)}</a><span class="g-toc-n">${s.items.length}</span></li>`).join("");

    G.sections.forEach((s) => s.items.forEach((it) => {
        const el = document.getElementById(it.id);
        index.push({
            el,
            section: document.getElementById(s.id),
            text: norm([it.title, it.keywords || "", strip(it.where || ""), strip(it.html), s.title].join(" ")),
            title: norm(it.title + " " + (it.keywords || ""))
        });
    }));

    // --- highlight helpers ------------------------------------------------------
    function clearMarks() {
        body.querySelectorAll("mark.g-mark").forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); });
        body.normalize();
    }
    function mark(el, words) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.parentElement && n.parentElement.closest(".g-anchor") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
        nodes.forEach((n) => {
            if (!re.test(n.nodeValue)) return;
            re.lastIndex = 0;
            const frag = document.createDocumentFragment();
            n.nodeValue.split(re).forEach((part, i) => {
                if (i % 2 === 1) { const m = document.createElement("mark"); m.className = "g-mark"; m.textContent = part; frag.appendChild(m); }
                else if (part) frag.appendChild(document.createTextNode(part));
            });
            n.replaceWith(frag);
        });
    }

    // --- search -------------------------------------------------------------------
    let timer = null;
    function run(q, jump) {
        clearMarks();
        const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
        if (!words.length) {
            index.forEach((r) => { r.el.hidden = false; });
            body.querySelectorAll("[data-section]").forEach((s) => { s.hidden = false; });
            document.getElementById("g-noresults").hidden = true;
            count.textContent = "";
            clearBtn.hidden = true;
            return;
        }
        clearBtn.hidden = false;
        const hits = [];
        index.forEach((r) => {
            const ok = words.every((w) => r.text.includes(w));
            r.el.hidden = !ok;
            if (ok) hits.push(r);
        });
        body.querySelectorAll("[data-section]").forEach((s) => { s.hidden = !s.querySelector("[data-item]:not([hidden])"); });
        hits.sort((a, b) => words.filter((w) => b.title.includes(w)).length - words.filter((w) => a.title.includes(w)).length);
        hits.forEach((h) => mark(h.el, words));
        count.textContent = hits.length ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : "";
        document.getElementById("g-noresults").hidden = hits.length > 0;
        if (jump && hits[0]) hits[0].el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(input.value, false), 120); });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); run(input.value, true); }
        if (e.key === "Escape") { input.value = ""; run("", false); }
    });
    clearBtn.addEventListener("click", () => { input.value = ""; run("", false); input.focus(); });
    document.querySelectorAll("[data-g-q]").forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.gQ; run(input.value, true); input.focus(); }));
    document.addEventListener("keydown", (e) => {
        if (e.key === "/" && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
    });

    // --- deep links -----------------------------------------------------------------
    const q = new URLSearchParams(location.search).get("q");
    if (q) { input.value = q; run(q, true); }
    function flashHash() {
        const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (el && el.matches("[data-item]")) { el.classList.remove("g-flash"); void el.offsetWidth; el.classList.add("g-flash"); }
    }
    window.addEventListener("hashchange", flashHash);
    flashHash();
    if (location.hash) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) el.scrollIntoView(); }

    // back to top
    const top = document.getElementById("g-top");
    if (top) {
        window.addEventListener("scroll", () => { top.hidden = window.scrollY < 600; }, { passive: true });
        top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
})();
