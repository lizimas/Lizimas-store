// Colour chooser for the Add / Edit Product forms (Sept 2026).
//
// Every colour in the list shows as a round swatch in its real colour
// (color_catalog.hex). Click to choose / un-choose. Admin and Lizimas staff
// (canManage) also get "+ New colour" (a colour picker + a name) and can
// change a colour's name or code with the pencil. Vendors only choose.
//
//   LzColorSwatches.mount(host, {
//       canManage: true,
//       selected: ["Black", "Beige"],          // names
//       onChange: (selectedNames) => {},
//       api: (url, opts) => Promise<json>      // authorised fetch (canManage)
//   });
//   LzColorSwatches.setSelected(host, names)   // e.g. after loading a product
//   LzColorSwatches.selected(host)             // -> names, in list order
//   LzColorSwatches.hexOf(name)                // -> "#RRGGBB" or null
(function () {
    "use strict";

    const STYLE_ID = "lzcs-style";
    const CSS = `
.lzcs { width: 100%; }
.lzcs-list { display: flex; flex-wrap: wrap; gap: 8px; }
.lzcs-chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px 5px 5px; border: 1.5px solid #e5e7eb;
    border-radius: 999px; background: #fff; cursor: pointer; font-size: 13px; color: #1f2937; font-family: inherit; line-height: 1.2; }
.lzcs-chip:hover { border-color: #9ca3af; }
.lzcs-chip.lzcs-on { border-color: #1a1a2e; background: #f5f6fa; font-weight: 600; box-shadow: 0 0 0 1px #1a1a2e inset; }
.lzcs-dot { width: 22px; height: 22px; border-radius: 50%; flex: 0 0 22px; border: 1px solid rgba(0,0,0,.18); position: relative; }
.lzcs-dot.lzcs-nohex { background: repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 50% / 8px 8px; }
.lzcs-on .lzcs-dot::after { content: "\\2713"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 800; color: var(--lzcs-tick, #fff); }
.lzcs-edit { border: 0; background: none; cursor: pointer; color: #6b7280; font-size: 12px; padding: 0 0 0 2px; }
.lzcs-edit:hover { color: #1a1a2e; }
.lzcs-tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.lzcs-search { padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; min-width: 160px; }
.lzcs-more { border-style: solid !important; border-color: #d1d5db !important; color: #374151 !important; }
.lzcs-add { border: 1.5px dashed #1a1a2e; background: #fff; color: #1a1a2e; border-radius: 999px; padding: 6px 12px; cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: inherit; }
.lzcs-form { display: none; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; padding: 10px; border: 1px solid #e5e7eb;
    border-radius: 10px; background: #fafbfc; }
.lzcs-form.lzcs-open { display: flex; }
.lzcs-form input[type=color] { width: 44px; height: 36px; padding: 0; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; cursor: pointer; }
.lzcs-form input[type=text] { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; width: 90px; }
.lzcs-form input.lzcs-name { width: 160px; }
.lzcs-form button { padding: 8px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
.lzcs-save { background: #1a1a2e; color: #fff; border: 0; font-weight: 600; }
.lzcs-cancel { background: #fff; color: #374151; border: 1px solid #d1d5db; }
.lzcs-msg { font-size: 12.5px; margin-top: 6px; color: #b42318; min-height: 1em; }
.lzcs-note { font-size: 12px; color: #6b7280; margin-top: 8px; }`;

    let catalog = null;          // [{id, name, hex}]
    let loading = null;

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
    const key = (n) => String(n || "").trim().toLowerCase();

    // Light colours get a dark tick so it stays visible.
    function tickColor(hex) {
        if (!hex) return "#1a1a2e";
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? "#1a1a2e" : "#fff";
    }

    function loadCatalog(force) {
        if (catalog && !force) return Promise.resolve(catalog);
        if (loading && !force) return loading;
        loading = fetch("/api/products/catalog/colors")
            .then((r) => r.ok ? r.json() : [])
            .then((rows) => { catalog = Array.isArray(rows) ? rows : []; loading = null; return catalog; })
            .catch(() => { loading = null; catalog = catalog || []; return catalog; });
        return loading;
    }

    function hexOf(name) {
        const c = (catalog || []).find((x) => key(x.name) === key(name));
        return c && c.hex ? c.hex : null;
    }

    function dot(hex) {
        return hex
            ? '<span class="lzcs-dot" style="background:' + esc(hex) + ';--lzcs-tick:' + tickColor(hex) + '"></span>'
            : '<span class="lzcs-dot lzcs-nohex"></span>';
    }

    function draw(host) {
        const st = host._lzcs;
        const filter = key(st.filter || "");
        let list = (catalog || []).filter((c) => !filter || key(c.name).includes(filter) || st.selected.has(key(c.name)));
        // Short list by default: chosen colours plus the first few; the
        // search box or "Show all" reaches the rest.
        const SHORT = 16;
        const hidden = !filter && !st.showAll ? Math.max(0, list.filter((c) => !st.selected.has(key(c.name))).length - SHORT) : 0;
        if (hidden) {
            let n = 0;
            list = list.filter((c) => st.selected.has(key(c.name)) || n++ < SHORT);
        }
        const more = host.querySelector(".lzcs-more");
        if (more) {
            more.hidden = !(hidden || st.showAll) || !!filter;
            more.textContent = st.showAll ? "Show fewer colours" : "Show all colours (" + (catalog || []).length + ")";
        }
        const listEl = host.querySelector(".lzcs-list");
        listEl.innerHTML = list.length ? list.map((c) =>
            '<span class="lzcs-chip' + (st.selected.has(key(c.name)) ? " lzcs-on" : "") + '" role="checkbox" tabindex="0" aria-checked="' +
                (st.selected.has(key(c.name)) ? "true" : "false") + '" data-name="' + esc(c.name) + '" title="' + esc(c.name + (c.hex ? " " + c.hex : "")) + '">' +
                dot(c.hex) + "<span>" + esc(c.name) + "</span>" +
                (st.canManage ? '<button type="button" class="lzcs-edit" data-edit="' + c.id + '" title="Change name or colour" aria-label="Edit ' + esc(c.name) + '">&#9998;</button>' : "") +
            "</span>").join("")
            : '<span class="lzcs-note">No colours match.</span>';
    }

    function mount(host, opts) {
        if (!host) return;
        ensureStyle();
        opts = opts || {};
        host._lzcs = {
            canManage: !!opts.canManage, onChange: opts.onChange || function () {}, api: opts.api,
            selected: new Set((opts.selected || []).map(key)), filter: "", editing: null
        };
        host.innerHTML =
            '<div class="lzcs">' +
                '<div class="lzcs-list" role="group" aria-label="Colours"><span class="lzcs-note">Loading colours...</span></div>' +
                '<div class="lzcs-tools">' +
                    '<input type="search" class="lzcs-search" placeholder="Find a colour">' +
                    '<button type="button" class="lzcs-more lzcs-add" hidden></button>' +
                    (opts.canManage ? '<button type="button" class="lzcs-add">+ New colour</button>' : "") +
                "</div>" +
                (opts.canManage
                    ? '<div class="lzcs-form">' +
                        '<input type="color" class="lzcs-hex" value="#E8DCC4" aria-label="Colour">' +
                        '<input type="text" class="lzcs-code" value="#E8DCC4" maxlength="7" aria-label="Colour code">' +
                        '<input type="text" class="lzcs-name" placeholder="Colour name, e.g. Beige" maxlength="50" aria-label="Colour name">' +
                        '<button type="button" class="lzcs-save">Add colour</button>' +
                        '<button type="button" class="lzcs-cancel">Cancel</button>' +
                      "</div>"
                    : '<div class="lzcs-note">Need a colour that isn\'t in the list? Ask Lizimas Store to add it.</div>') +
                '<div class="lzcs-msg" aria-live="polite"></div>' +
            "</div>";

        const st = host._lzcs;
        const msg = (t) => { host.querySelector(".lzcs-msg").textContent = t || ""; };
        const toggle = (name) => {
            const k = key(name);
            if (st.selected.has(k)) st.selected.delete(k); else st.selected.add(k);
            draw(host);
            st.onChange(selected(host));
        };

        host.querySelector(".lzcs-list").addEventListener("click", (e) => {
            const edit = e.target.closest("[data-edit]");
            if (edit) { e.stopPropagation(); openForm(Number(edit.dataset.edit)); return; }
            const chip = e.target.closest(".lzcs-chip");
            if (chip) toggle(chip.dataset.name);
        });
        host.querySelector(".lzcs-list").addEventListener("keydown", (e) => {
            const chip = e.target.closest(".lzcs-chip");
            if (chip && (e.key === " " || e.key === "Enter")) { e.preventDefault(); toggle(chip.dataset.name); }
        });
        host.querySelector(".lzcs-search").addEventListener("input", (e) => { st.filter = e.target.value; draw(host); });
        host.querySelector(".lzcs-more").addEventListener("click", () => { st.showAll = !st.showAll; draw(host); });

        const form = host.querySelector(".lzcs-form");
        function openForm(id) {
            if (!form) return;
            const c = id ? (catalog || []).find((x) => x.id === id) : null;
            st.editing = c ? c.id : null;
            const hex = (c && c.hex) || "#E8DCC4";
            form.querySelector(".lzcs-hex").value = hex;
            form.querySelector(".lzcs-code").value = hex;
            form.querySelector(".lzcs-name").value = c ? c.name : "";
            form.querySelector(".lzcs-save").textContent = c ? "Save colour" : "Add colour";
            form.classList.add("lzcs-open");
            msg("");
            form.querySelector(".lzcs-name").focus();
        }
        if (form) {
            host.querySelector(".lzcs-add:not(.lzcs-more)").onclick = () => openForm(null);
            form.querySelector(".lzcs-cancel").onclick = () => { form.classList.remove("lzcs-open"); msg(""); };
            form.querySelector(".lzcs-hex").oninput = (e) => { form.querySelector(".lzcs-code").value = e.target.value.toUpperCase(); };
            form.querySelector(".lzcs-code").oninput = (e) => {
                const v = e.target.value.trim();
                if (/^#[0-9A-Fa-f]{6}$/.test(v)) form.querySelector(".lzcs-hex").value = v;
            };
            form.querySelector(".lzcs-save").onclick = async () => {
                const name = form.querySelector(".lzcs-name").value.trim();
                const hex = form.querySelector(".lzcs-code").value.trim();
                if (!name) { msg("Give the colour a name, e.g. Beige."); return; }
                if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) { msg("Pick the colour with the colour picker."); return; }
                try {
                    const editing = st.editing;
                    const old = editing ? (catalog || []).find((x) => x.id === editing) : null;
                    const res = await st.api(editing ? "/api/products/catalog/colors/" + editing : "/api/products/catalog/colors", {
                        method: editing ? "PATCH" : "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, hex })
                    });
                    if (!res || res.error) { msg((res && res.error) || "Could not save the colour."); return; }
                    await loadCatalog(true);
                    if (old && st.selected.has(key(old.name))) { st.selected.delete(key(old.name)); st.selected.add(key(res.name)); }
                    if (!editing) st.selected.add(key(res.name));
                    form.classList.remove("lzcs-open");
                    draw(host);
                    st.onChange(selected(host));
                    msg("");
                } catch (e) {
                    msg(e.message || "Could not save the colour.");
                }
            };
        }
        loadCatalog().then(() => draw(host));
    }

    function setSelected(host, names) {
        if (!host || !host._lzcs) return;
        host._lzcs.selected = new Set((names || []).map(key));
        loadCatalog().then(() => draw(host));
    }

    // Selected names, spelled as in the colour list, in list order.
    function selected(host) {
        if (!host || !host._lzcs) return [];
        const sel = host._lzcs.selected;
        const out = (catalog || []).filter((c) => sel.has(key(c.name))).map((c) => c.name);
        // Names chosen before the list loaded (or no longer in it) stay chosen.
        sel.forEach((k) => { if (!out.some((n) => key(n) === k)) out.push(k); });
        return out;
    }

    window.LzColorSwatches = { mount, setSelected, selected, hexOf, loadCatalog };
})();
