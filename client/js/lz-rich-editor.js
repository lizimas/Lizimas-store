// Rich text editor for the product form (Ryan, Oct 2026): Product
// description, Highlights, What's in the box and Product warranty.
// No outside library. Toolbar: source view, Paragraph / Heading, bold,
// italic, link, bulleted and numbered lists, decrease / increase indent,
// image, block quote, table, video, undo, redo. A picture has its own small
// toolbar (left, centred, side, caption on/off, text alternative) and round
// "insert paragraph before / after" buttons, as do tables and videos.
//
//   const ed = LzRichEditor.mount(hostEl, { placeholder, uploadImage: async (file) => url, minHeight });
//   ed.getHTML() / ed.setHTML(html) / ed.getText() / ed.isEmpty() / ed.focus()
//
// The server rebuilds whatever is sent from an allow-list
// (server/utils/richText.js), so this file is about editing, not safety.
(function () {
    "use strict";
    const STYLE_ID = "lzr-style";
    const I = (d, extra) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra || ""}>${d}</svg>`;
    const ICON = {
        source: I('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="m10 11-2 2 2 2M14 11l2 2-2 2"/>'),
        bold: '<span style="font-weight:800; font-size:18px; font-family:Georgia,serif;">B</span>',
        italic: '<span style="font-style:italic; font-size:18px; font-family:Georgia,serif;">I</span>',
        link: I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
        ul: I('<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M10 7h10M10 17h10"/>'),
        ol: I('<path d="M4 5h1.5v4M4 15h2l-2 3h2M10 7h10M10 17h10"/>', ' stroke-width="1.8"'),
        outdent: I('<path d="M4 6h16M12 12h8M4 18h16M8 9.5 5 12l3 2.5"/>'),
        indent: I('<path d="M4 6h16M12 12h8M4 18h16M5 9.5 8 12l-3 2.5"/>'),
        image: I('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="m4 17 5-5 4 4 2.5-2.5L20 17"/><circle cx="15.5" cy="9.5" r="1.3" fill="currentColor"/>'),
        quote: '<span style="font-size:28px; line-height:14px; font-family:Georgia,serif; font-weight:700; display:inline-block; height:14px;">&ldquo;</span>',
        table: I('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14.5h16M9.5 5v14M15 5v14"/>'),
        media: I('<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/>'),
        undo: I('<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>'),
        redo: I('<path d="m15 7 4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/>'),
        caret: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
        left: I('<rect x="3" y="6" width="9" height="8" rx="1"/><path d="M15 7h6M15 11h6M3 18h18"/>'),
        center: I('<rect x="7" y="8" width="10" height="8" rx="1"/><path d="M3 5h18M3 19h18"/>'),
        side: I('<rect x="12" y="6" width="9" height="8" rx="1"/><path d="M3 7h6M3 11h6M3 18h18"/>'),
        caption: I('<rect x="4" y="5" width="16" height="10" rx="1"/><path d="M7 19h10"/>'),
        alt: I('<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="m4 4 16 16"/>'),
        para: I('<path d="M19 6v6a3 3 0 0 1-3 3H6"/><path d="m9 12-3 3 3 3"/>', ' stroke-width="2.4"'),
        ok: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#15803d" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
        no: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#b91c1c" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    };
    const CSS = `
.lzr { border: 1px solid #cfd3da; border-radius: 6px; background: #fff; position: relative; }
.lzr.lzr-bad { border-color: #dc2626; }
.lzr-bar { position: sticky; top: 0; z-index: 15; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; padding: 6px 8px; background: #fff; border-bottom: 1px solid #dfe2e7; border-radius: 6px 6px 0 0; }
.lzr-btn { min-width: 34px; height: 34px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; gap: 2px; background: none; border: 0; border-radius: 5px; color: #1f2430; cursor: pointer; font-family: inherit; }
.lzr-btn:hover { background: #f1f2f5; } .lzr-btn.lzr-on { background: #fff3cd; color: #7a5900; } .lzr-btn:disabled { color: #c3c7cf; cursor: default; background: none; }
.lzr-sep { width: 1px; height: 24px; background: #d5d8de; margin: 0 5px; }
.lzr .lzr-bar select.lzr-block { display: inline-block !important; width: auto !important; flex: 0 0 auto; height: 34px !important; min-width: 132px; margin: 0 !important; border: 0 !important; background: none; font: 15px sans-serif; font-family: inherit; color: #1f2430; padding: 0 6px !important; cursor: pointer; border-radius: 5px; box-shadow: none !important; }
.lzr .lzr-bar .lzr-btn { width: auto !important; margin: 0 !important; flex: 0 0 auto; }
.lzr .lzr-bar select.lzr-block:hover { background: #f1f2f5; }
.lzr-body { min-height: 96px; padding: 12px 14px; outline: none; font-size: 15px; line-height: 1.6; color: #1f2430; overflow-wrap: anywhere; resize: vertical; overflow: auto; }
.lzr-body:empty::before, .lzr-body.lzr-blank::before { content: attr(data-placeholder); color: #8a8f98; pointer-events: none; position: absolute; left: 14px; right: 14px; }
.lzr-body p { margin: 0 0 8px; } .lzr-body h2 { font-size: 22px; margin: 6px 0 8px; } .lzr-body h3 { font-size: 18px; margin: 6px 0 8px; } .lzr-body h4 { font-size: 16px; margin: 6px 0 8px; }
.lzr-body ul, .lzr-body ol { margin: 0 0 8px; padding-left: 26px; }
.lzr-body blockquote { margin: 0 0 8px; padding: 4px 14px; border-left: 4px solid #d5d8de; color: #4b5563; font-style: italic; }
.lzr-body a { color: #1d4ed8; text-decoration: underline; }
.lzr .lzr-body table { display: table !important; border-collapse: collapse !important; width: 100% !important; margin: 0 0 8px !important; box-shadow: none !important; border-radius: 0 !important; background: none !important; table-layout: auto; }
.lzr .lzr-body thead { display: table-header-group !important; } .lzr .lzr-body tbody { display: table-row-group !important; }
.lzr .lzr-body tr { display: table-row !important; box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; background: none !important; }
.lzr .lzr-body td, .lzr .lzr-body th { display: table-cell !important; border: 1px solid #b8bcc4 !important; padding: 6px 8px !important; min-width: 40px; vertical-align: top; text-align: left !important; width: auto !important; font-size: 14.5px; }
.lzr .lzr-body td::before, .lzr .lzr-body th::before { content: none !important; }
.lzr .lzr-body th { background: #f3f4f6 !important; }
.lzr-body .lzr-in1 { margin-left: 28px; } .lzr-body .lzr-in2 { margin-left: 56px; } .lzr-body .lzr-in3 { margin-left: 84px; } .lzr-body .lzr-in4 { margin-left: 112px; }
.lzr-body figure { margin: 0 0 10px; position: relative; display: block; clear: both; }
.lzr-body figure.lzr-img img { display: block; max-width: 100%; height: auto; }
.lzr-body figure.lzr-center { text-align: center; } .lzr-body figure.lzr-center img { margin: 0 auto; }
.lzr-body figure.lzr-side { float: right; max-width: 45%; margin: 0 0 10px 16px; clear: none; }
.lzr-body figcaption { font-size: 12.5px; color: #555; background: #f6f7f9; padding: 6px 8px; text-align: center; outline: none; min-height: 18px; }
.lzr-body figcaption:empty::before { content: "Enter image caption"; color: #9ca0a8; }
.lzr-body figure.lzr-media iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; display: block; pointer-events: none; }
.lzr-body .lzr-sel { outline: 3px solid #f4b400; outline-offset: 1px; }
.lzr-src { display: block; width: 100%; min-height: 160px; box-sizing: border-box; border: 0; outline: none; padding: 12px 14px; font: 13px ui-monospace, Menlo, monospace; resize: vertical; }
.lzr-pop { position: absolute; z-index: 30; background: #fff; border: 1px solid #cfd3da; border-radius: 6px; box-shadow: 0 4px 14px rgba(16,24,40,.18); padding: 6px; display: flex; align-items: center; gap: 2px; }
.lzr-pop input[type=text], .lzr-pop input[type=url] { height: 34px; width: 250px; max-width: 60vw; border: 1px solid #b8bcc4; border-radius: 5px; padding: 0 9px; font: 14px sans-serif; font-family: inherit; }
.lzr-pop label { font-size: 11px; color: #555; display: block; margin: -2px 0 2px 2px; }
.lzr-grid { display: grid; grid-template-columns: repeat(8, 18px); gap: 3px; padding: 4px; } .lzr-grid i { width: 18px; height: 18px; border: 1px solid #b8bcc4; border-radius: 2px; display: block; cursor: pointer; } .lzr-grid i.on { background: #fff3cd; border-color: #f4b400; }
.lzr-grid-label { font-size: 12px; color: #555; text-align: center; padding: 2px 0 0; }
.lzr-para { position: absolute; z-index: 25; width: 24px; height: 24px; border-radius: 50%; border: 0; background: #1a1a2e; color: #f4b400; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.lzr-para svg { width: 14px; height: 14px; }
.lzr-err { color: #b42318; font-size: 12.5px; margin: 4px 2px 0; }
@media (max-width: 700px) { .lzr .lzr-bar select.lzr-block { min-width: 104px; } .lzr-sep { margin: 0 2px; } .lzr-body figure.lzr-side { float: none; max-width: 100%; margin: 0 0 10px; } }`;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const st = document.createElement("style");
        st.id = STYLE_ID; st.textContent = CSS;
        document.head.appendChild(st);
    }
    const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    // Light clean-up for the editing surface (pasted or source HTML). The
    // server is the real filter.
    const KEEP = new Set(["P", "H2", "H3", "H4", "BR", "STRONG", "B", "EM", "I", "U", "A", "UL", "OL", "LI", "BLOCKQUOTE", "FIGURE", "FIGCAPTION", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "IFRAME"]);
    const KEEP_CLASS = /^(lzr-img|lzr-left|lzr-center|lzr-side|lzr-media|lzr-in[1-4])$/;
    function tidy(html) {
        const doc = new DOMParser().parseFromString("<div>" + String(html || "") + "</div>", "text/html");
        const root = doc.body.firstChild;
        root.querySelectorAll("script,style,noscript,template,svg,math,object,embed,form,input,button,select,textarea,link,meta,title").forEach((n) => n.remove());
        const walk = (node) => {
            Array.from(node.childNodes).forEach((n) => {
                if (n.nodeType === 8) { n.remove(); return; }
                if (n.nodeType !== 1) return;
                walk(n);
                let tag = n.tagName;
                if (tag === "H1" || tag === "DIV") {
                    const r = doc.createElement(tag === "H1" ? "h2" : "p");
                    while (n.firstChild) r.appendChild(n.firstChild);
                    if (n.className) r.className = n.className;
                    n.replaceWith(r); n = r; tag = r.tagName;
                }
                if (!KEEP.has(tag)) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); return; }
                Array.from(n.attributes).forEach((a) => {
                    const name = a.name.toLowerCase(), v = a.value.trim();
                    const ok = (name === "href" && tag === "A" && /^(https?:\/\/|mailto:|tel:)/i.test(v))
                        || (name === "src" && tag === "IMG" && /^https:\/\//i.test(v))
                        || (name === "src" && tag === "IFRAME" && /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]{6,20}$/.test(v))
                        || (name === "alt" && tag === "IMG") || ((name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(v))
                        || (name === "class" && (tag === "P" || tag === "FIGURE"));
                    if (!ok) n.removeAttribute(a.name);
                });
                if (n.className) { n.className = n.className.split(/\s+/).filter((c) => KEEP_CLASS.test(c)).join(" "); if (!n.className) n.removeAttribute("class"); }
                if ((tag === "IMG" || tag === "IFRAME") && !n.getAttribute("src")) n.remove();
                if (tag === "A" && !n.getAttribute("href")) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); }
            });
        };
        walk(root);
        return root.innerHTML;
    }

    function youtubeId(url) {
        const m = String(url || "").trim().match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/i);
        return m ? m[1] : null;
    }

    function mount(host, opts) {
        if (!host) return null;
        if (host._lzr) return host._lzr;
        ensureStyle();
        opts = opts || {};
        const wrap = document.createElement("div");
        wrap.className = "lzr";
        const btn = (cmd, icon, title, extra) => `<button type="button" class="lzr-btn" data-cmd="${cmd}" title="${title}" aria-label="${title}">${icon}${extra || ""}</button>`;
        wrap.innerHTML = `<div class="lzr-bar" role="toolbar" aria-label="Text formatting">
            ${btn("source", ICON.source, "Source")}
            <select class="lzr-block" aria-label="Paragraph or heading"><option value="p">Paragraph</option><option value="h2">Heading 1</option><option value="h3">Heading 2</option><option value="h4">Heading 3</option></select>
            <span class="lzr-sep"></span>
            ${btn("bold", ICON.bold, "Bold")}${btn("italic", ICON.italic, "Italic")}${btn("link", ICON.link, "Link")}
            ${btn("ul", ICON.ul, "Bulleted List")}${btn("ol", ICON.ol, "Numbered List")}
            <span class="lzr-sep"></span>
            ${btn("outdent", ICON.outdent, "Decrease indent")}${btn("indent", ICON.indent, "Increase indent")}
            <span class="lzr-sep"></span>
            ${btn("image", ICON.image, "Insert image")}${btn("quote", ICON.quote, "Block quote")}${btn("table", ICON.table, "Insert table", ICON.caret)}${btn("media", ICON.media, "Insert media", ICON.caret)}
            ${btn("undo", ICON.undo, "Undo")}${btn("redo", ICON.redo, "Redo")}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
        <div class="lzr-body" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${esc(opts.placeholder || "")}"></div>
        <textarea class="lzr-src" hidden aria-label="HTML source" spellcheck="false"></textarea>`;
        host.innerHTML = "";
        host.appendChild(wrap);
        const bar = wrap.querySelector(".lzr-bar"), body = wrap.querySelector(".lzr-body"), srcBox = wrap.querySelector(".lzr-src");
        const fileInput = wrap.querySelector('input[type="file"]'), blockSel = wrap.querySelector(".lzr-block");
        if (opts.minHeight) body.style.minHeight = opts.minHeight + "px";
        try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* older browsers */ }

        const st = { undo: [], redo: [], last: "", sel: null, range: null, source: false, timer: null };
        const blank = () => !body.textContent.trim() && !body.querySelector("img,iframe,table");
        const refreshBlank = () => body.classList.toggle("lzr-blank", blank() && body.innerHTML !== "");
        function snapshot(force) {
            const h = body.innerHTML;
            if (!force && h === st.last) return;
            st.undo.push(st.last); if (st.undo.length > 60) st.undo.shift();
            st.redo = []; st.last = h;
            refreshBlank(); wrap.classList.remove("lzr-bad");
            if (opts.onChange) opts.onChange();
        }
        function restore(h) { clearSel(); body.innerHTML = h; st.last = h; refreshBlank(); if (opts.onChange) opts.onChange(); }
        const saveRange = () => { const s = window.getSelection(); if (s.rangeCount && body.contains(s.anchorNode)) st.range = s.getRangeAt(0).cloneRange(); };
        function useRange() {
            body.focus();
            if (st.range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(st.range); }
        }
        const exec = (cmd, val) => { useRange(); document.execCommand(cmd, false, val); saveRange(); snapshot(); };
        function currentBlock() {
            const s = window.getSelection();
            let n = s.rangeCount && body.contains(s.anchorNode) ? s.anchorNode : null;
            while (n && n !== body) { if (n.nodeType === 1 && /^(P|H2|H3|H4|LI|BLOCKQUOTE|TD|TH|FIGCAPTION)$/.test(n.tagName)) return n; n = n.parentNode; }
            return null;
        }
        function refreshBar() {
            const b = currentBlock();
            let tag = "p", n = b;
            while (n && n !== body) { if (/^H[234]$/.test(n.tagName)) { tag = n.tagName.toLowerCase(); break; } n = n.parentNode; }
            blockSel.value = tag;
            const on = (cmd, yes) => { const el = bar.querySelector('[data-cmd="' + cmd + '"]'); if (el) el.classList.toggle("lzr-on", !!yes); };
            let q = false; n = b; while (n && n !== body) { if (n.tagName === "BLOCKQUOTE") q = true; n = n.parentNode; }
            try { on("bold", document.queryCommandState("bold")); on("italic", document.queryCommandState("italic")); on("ul", document.queryCommandState("insertUnorderedList")); on("ol", document.queryCommandState("insertOrderedList")); } catch (e) { /* not focused */ }
            on("quote", q);
            bar.querySelector('[data-cmd="undo"]').disabled = !st.undo.length;
            bar.querySelector('[data-cmd="redo"]').disabled = !st.redo.length;
        }

        // ---- pop-ups (link, media, table grid, text alternative) ----
        function closePop() { wrap.querySelectorAll(".lzr-pop").forEach((p) => p.remove()); }
        function popAt(anchor, html) {
            closePop();
            const p = document.createElement("div");
            p.className = "lzr-pop"; p.innerHTML = html;
            wrap.appendChild(p);
            const a = anchor.getBoundingClientRect(), w = wrap.getBoundingClientRect();
            p.style.top = (a.bottom - w.top + 6) + "px";
            p.style.left = Math.max(4, Math.min(a.left - w.left, w.width - p.offsetWidth - 4)) + "px";
            return p;
        }
        function askText(anchor, label, value, type, done) {
            const p = popAt(anchor, `<div><label>${esc(label)}</label><input type="${type || "text"}" value="${esc(value || "")}"></div>
                <button type="button" class="lzr-btn" data-ok title="Save" aria-label="Save">${ICON.ok}</button><button type="button" class="lzr-btn" data-no title="Cancel" aria-label="Cancel">${ICON.no}</button>`);
            const input = p.querySelector("input");
            input.focus(); input.select();
            const finish = (ok) => { const v = input.value.trim(); closePop(); if (ok) done(v); };
            p.querySelector("[data-ok]").onclick = () => finish(true);
            p.querySelector("[data-no]").onclick = () => finish(false);
            input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.stopPropagation(); finish(false); } };
        }

        // ---- selected picture / table / video ----
        function clearSel() {
            if (st.sel) st.sel.classList.remove("lzr-sel");
            st.sel = null;
            wrap.querySelectorAll(".lzr-para, .lzr-figbar").forEach((n) => n.remove());
        }
        function place(el, target, where) {
            const t = target.getBoundingClientRect(), w = wrap.getBoundingClientRect();
            if (where === "before") { el.style.top = (t.top - w.top - 12) + "px"; el.style.left = (t.left - w.left + 26) + "px"; }
            else if (where === "after") { el.style.top = (t.bottom - w.top - 12) + "px"; el.style.left = (t.right - w.left - 60) + "px"; }
            else { el.style.top = Math.max(bar.offsetHeight + 4, t.top - w.top - 48) + "px"; el.style.left = Math.max(4, t.left - w.left + t.width / 2 - el.offsetWidth / 2) + "px"; }
        }
        function newPara(target, before) {
            const p = document.createElement("p");
            p.innerHTML = "<br>";
            target.parentNode.insertBefore(p, before ? target : target.nextSibling);
            clearSel();
            const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
            body.focus(); saveRange(); snapshot();
        }
        function selectBlock(target) {
            clearSel(); closePop();
            st.sel = target; target.classList.add("lzr-sel");
            [["before", "Insert paragraph before block"], ["after", "Insert paragraph after block"]].forEach(([where, title]) => {
                const b = document.createElement("button");
                b.type = "button"; b.className = "lzr-para"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = ICON.para;
                b.onmousedown = (e) => e.preventDefault();
                b.onclick = () => newPara(target, where === "before");
                wrap.appendChild(b); place(b, target, where);
            });
            const isImg = target.classList.contains("lzr-img");
            const fb = document.createElement("div");
            fb.className = "lzr-pop lzr-figbar";
            const fbtn = (act, icon, title, on) => `<button type="button" class="lzr-btn${on ? " lzr-on" : ""}" data-fig="${act}" title="${title}" aria-label="${title}">${icon}</button>`;
            fb.innerHTML = isImg
                ? fbtn("left", ICON.left, "Left aligned image", target.classList.contains("lzr-left")) + fbtn("center", ICON.center, "Centered image", target.classList.contains("lzr-center")) + fbtn("side", ICON.side, "Side image", target.classList.contains("lzr-side"))
                    + '<span class="lzr-sep"></span>' + fbtn("caption", ICON.caption, target.querySelector("figcaption") ? "Toggle caption off" : "Toggle caption on", !!target.querySelector("figcaption")) + fbtn("alt", ICON.alt, "Change image text alternative")
                    + '<span class="lzr-sep"></span>' + fbtn("remove", ICON.no, "Remove image")
                : (target.tagName === "TABLE" ? fbtn("row", '<span style="font-size:12.5px; font-weight:600;">+ Row</span>', "Add a row") + fbtn("col", '<span style="font-size:12.5px; font-weight:600;">+ Column</span>', "Add a column") + fbtn("delrow", '<span style="font-size:12.5px;">&minus; Row</span>', "Remove the last row") + fbtn("delcol", '<span style="font-size:12.5px;">&minus; Column</span>', "Remove the last column") + '<span class="lzr-sep"></span>' : "")
                    + fbtn("remove", ICON.no, target.tagName === "TABLE" ? "Remove table" : "Remove video");
            fb.onmousedown = (e) => { if (!e.target.closest("input")) e.preventDefault(); };
            fb.onclick = (e) => {
                const b = e.target.closest("[data-fig]");
                if (!b) return;
                const act = b.dataset.fig;
                if (["left", "center", "side"].includes(act)) { target.classList.remove("lzr-left", "lzr-center", "lzr-side"); target.classList.add("lzr-" + act); }
                else if (act === "caption") {
                    const c = target.querySelector("figcaption");
                    if (c) c.remove(); else { const n = document.createElement("figcaption"); target.appendChild(n); }
                } else if (act === "alt") {
                    const img = target.querySelector("img");
                    askText(b, "Text alternative", img.getAttribute("alt") || "", "text", (v) => { img.setAttribute("alt", v); snapshot(); selectBlock(target); });
                    return;
                } else if (act === "remove") { target.remove(); clearSel(); snapshot(); return; }
                else if (act === "row") { const rows = target.rows, cols = rows[0] ? rows[0].cells.length : 1; const tr = target.insertRow(-1); for (let i = 0; i < cols; i++) tr.insertCell(-1).innerHTML = "<br>"; }
                else if (act === "col") { Array.from(target.rows).forEach((r, i) => { const c = document.createElement(i === 0 && r.cells[0] && r.cells[0].tagName === "TH" ? "th" : "td"); c.innerHTML = "<br>"; r.appendChild(c); }); }
                else if (act === "delrow") { if (target.rows.length > 1) target.deleteRow(-1); }
                else if (act === "delcol") { Array.from(target.rows).forEach((r) => { if (r.cells.length > 1) r.deleteCell(-1); }); }
                snapshot(); selectBlock(target);
            };
            wrap.appendChild(fb); place(fb, target, "bar");
        }

        function insertBlock(node) {
            useRange();
            const b = currentBlock();
            let anchor = b;
            while (anchor && anchor.parentNode !== body) anchor = anchor.parentNode;
            if (anchor) anchor.parentNode.insertBefore(node, anchor.nextSibling); else body.appendChild(node);
            if (anchor && anchor.tagName === "P" && !anchor.textContent.trim() && !anchor.querySelector("img")) anchor.remove();
            if (!node.nextSibling) { const p = document.createElement("p"); p.innerHTML = "<br>"; body.appendChild(p); }
            snapshot();
        }
        function insertImage(url, alt) {
            const f = document.createElement("figure");
            f.className = "lzr-img lzr-center";
            f.innerHTML = `<img src="${esc(url)}" alt="${esc(alt || "")}">`;
            insertBlock(f); selectBlock(f);
        }
        function insertTable(rows, cols) {
            const t = document.createElement("table");
            let h = "<tbody>";
            for (let r = 0; r < rows; r++) { h += "<tr>"; for (let c = 0; c < cols; c++) h += "<td><br></td>"; h += "</tr>"; }
            t.innerHTML = h + "</tbody>";
            insertBlock(t);
            const r = document.createRange(); r.setStart(t.rows[0].cells[0], 0); r.collapse(true);
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); saveRange();
        }
        function indent(dir) {
            const b = currentBlock();
            if (b && b.tagName === "LI") { exec(dir > 0 ? "indent" : "outdent"); return; }
            let p = b; while (p && p.parentNode !== body) p = p.parentNode;
            if (!p || !/^(P|H2|H3|H4)$/.test(p.tagName)) return;
            const m = (p.className.match(/lzr-in([1-4])/) || [0, 0])[1];
            const next = Math.max(0, Math.min(4, Number(m) + dir));
            p.classList.remove("lzr-in1", "lzr-in2", "lzr-in3", "lzr-in4");
            if (next) p.classList.add("lzr-in" + next);
            if (!p.className) p.removeAttribute("class");
            snapshot();
        }
        function toggleQuote() {
            const b = currentBlock();
            let q = b; while (q && q !== body && q.tagName !== "BLOCKQUOTE") q = q.parentNode;
            if (q && q !== body) { while (q.firstChild) q.parentNode.insertBefore(q.firstChild, q); q.remove(); snapshot(); return; }
            let top = b; while (top && top.parentNode !== body) top = top.parentNode;
            if (!top) { exec("formatBlock", "blockquote"); return; }
            const bq = document.createElement("blockquote");
            top.parentNode.insertBefore(bq, top); bq.appendChild(top);
            snapshot();
        }
        function setSource(on) {
            st.source = on;
            clearSel(); closePop();
            if (on) { srcBox.value = body.innerHTML.replace(/ class="lzr-sel"| lzr-sel/g, ""); }
            else { body.innerHTML = tidy(srcBox.value); snapshot(true); }
            body.hidden = on; srcBox.hidden = !on;
            bar.querySelectorAll(".lzr-btn, .lzr-block").forEach((el) => { if (el.dataset.cmd !== "source") el.disabled = on; });
            bar.querySelector('[data-cmd="source"]').classList.toggle("lzr-on", on);
            if (!on) refreshBar();
        }

        bar.addEventListener("mousedown", (e) => { if (e.target.closest(".lzr-btn")) e.preventDefault(); });
        bar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-cmd]");
            if (!b || b.disabled) return;
            const cmd = b.dataset.cmd;
            if (cmd !== "source" && st.source) return;
            clearSel();
            clearTimeout(st.timer); snapshot();      // anything just typed is recorded before the command runs
            if (cmd === "source") return setSource(!st.source);
            if (cmd === "bold" || cmd === "italic") return exec(cmd);
            if (cmd === "ul") return exec("insertUnorderedList");
            if (cmd === "ol") return exec("insertOrderedList");
            if (cmd === "indent") return indent(1);
            if (cmd === "outdent") return indent(-1);
            if (cmd === "quote") return toggleQuote();
            if (cmd === "undo") { if (st.undo.length) { st.redo.push(st.last); restore(st.undo.pop()); refreshBar(); } return; }
            if (cmd === "redo") { if (st.redo.length) { st.undo.push(st.last); restore(st.redo.pop()); refreshBar(); } return; }
            if (cmd === "link") {
                saveRange();
                let a = st.range ? st.range.startContainer : null;
                while (a && a !== body && a.tagName !== "A") a = a.parentNode;
                const existing = a && a !== body ? a : null;
                return askText(b, "Link URL", existing ? existing.getAttribute("href") : "https://", "url", (v) => {
                    if (!v || v === "https://") { if (existing) { while (existing.firstChild) existing.parentNode.insertBefore(existing.firstChild, existing); existing.remove(); snapshot(); } return; }
                    if (!/^(https?:\/\/|mailto:|tel:)/i.test(v)) v = "https://" + v;
                    if (existing) { existing.setAttribute("href", v); snapshot(); return; }
                    useRange();
                    if (window.getSelection().isCollapsed) document.execCommand("insertHTML", false, '<a href="' + esc(v) + '">' + esc(v) + "</a>");
                    else document.execCommand("createLink", false, v);
                    snapshot();
                });
            }
            if (cmd === "image") { saveRange(); fileInput.value = ""; fileInput.click(); return; }
            if (cmd === "table") {
                saveRange();
                const p = popAt(b, '<div><div class="lzr-grid">' + Array.from({ length: 48 }, (_, i) => `<i data-r="${Math.floor(i / 8) + 1}" data-c="${(i % 8) + 1}"></i>`).join("") + '</div><div class="lzr-grid-label">Choose the size</div></div>');
                const cells = p.querySelectorAll("i"), label = p.querySelector(".lzr-grid-label");
                p.onmouseover = (ev) => { const c = ev.target.closest("i"); if (!c) return; cells.forEach((x) => x.classList.toggle("on", Number(x.dataset.r) <= Number(c.dataset.r) && Number(x.dataset.c) <= Number(c.dataset.c))); label.textContent = c.dataset.r + " × " + c.dataset.c; };
                p.onmousedown = (ev) => ev.preventDefault();
                p.onclick = (ev) => { const c = ev.target.closest("i"); if (!c) return; closePop(); insertTable(Number(c.dataset.r), Number(c.dataset.c)); };
                return;
            }
            if (cmd === "media") {
                saveRange();
                return askText(b, "Media URL (YouTube link)", "", "url", (v) => {
                    const id = youtubeId(v);
                    if (!id) { api.setError("Paste a YouTube link, for example https://youtu.be/..."); return; }
                    const f = document.createElement("figure");
                    f.className = "lzr-media";
                    f.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '" loading="lazy" allowfullscreen></iframe>';
                    insertBlock(f);
                });
            }
        });
        blockSel.addEventListener("change", () => { exec("formatBlock", blockSel.value); refreshBar(); });
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            if (!opts.uploadImage) { api.setError("Pictures can't be added here."); return; }
            if (file.size > 5 * 1024 * 1024) { api.setError("That picture is larger than 5MB."); return; }
            api.setError("Uploading the picture...", true);
            try { const url = await opts.uploadImage(file); api.setError(""); if (url) insertImage(url, ""); }
            catch (e) { api.setError((e && e.message) || "The picture could not be uploaded."); }
        });

        body.addEventListener("input", () => { clearTimeout(st.timer); st.timer = setTimeout(() => { snapshot(); refreshBar(); }, 350); refreshBlank(); });
        body.addEventListener("keyup", () => { saveRange(); refreshBar(); });
        body.addEventListener("mouseup", () => { saveRange(); refreshBar(); });
        body.addEventListener("blur", () => { clearTimeout(st.timer); snapshot(); });
        body.addEventListener("click", (e) => {
            const fig = e.target.closest("figure.lzr-img, figure.lzr-media");
            const tbl = !fig && e.target.closest("table");
            if (fig && body.contains(fig)) { if (!e.target.closest("figcaption")) e.preventDefault(); selectBlock(fig); }
            else if (tbl && body.contains(tbl)) selectBlock(tbl);
            else clearSel();
            closePop();
        });
        body.addEventListener("keydown", (e) => {
            if (st.sel && (e.key === "Backspace" || e.key === "Delete") && !(e.target.closest && window.getSelection().anchorNode && st.sel.contains(window.getSelection().anchorNode) && st.sel.tagName === "TABLE")
                && !(window.getSelection().anchorNode && window.getSelection().anchorNode.parentNode && window.getSelection().anchorNode.parentNode.closest && window.getSelection().anchorNode.parentNode.closest("figcaption"))) {
                if (st.sel.tagName !== "TABLE") { e.preventDefault(); st.sel.remove(); clearSel(); snapshot(); }
            }
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); bar.querySelector('[data-cmd="undo"]').click(); }
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); bar.querySelector('[data-cmd="redo"]').click(); }
            if (e.key === "Tab" && currentBlock() && currentBlock().tagName === "LI") { e.preventDefault(); exec(e.shiftKey ? "outdent" : "indent"); }
        });
        body.addEventListener("paste", (e) => {
            const cd = e.clipboardData;
            if (!cd) return;
            const html = cd.getData("text/html"), text = cd.getData("text/plain");
            e.preventDefault();
            const clean = html ? tidy(html).replace(/<img\b[^>]*>/gi, "") : esc(text).replace(/\r?\n\r?\n/g, "</p><p>").replace(/\r?\n/g, "<br>");
            document.execCommand("insertHTML", false, clean);
            snapshot();
        });
        document.addEventListener("mousedown", (e) => { if (!wrap.contains(e.target)) { clearSel(); closePop(); } });

        const errEl = document.createElement("div");
        errEl.className = "lzr-err"; errEl.hidden = true; errEl.setAttribute("role", "status");
        host.appendChild(errEl);

        const api = {
            getHTML() {
                if (st.source) setSource(false);
                clearTimeout(st.timer);
                const c = body.cloneNode(true);
                c.querySelectorAll(".lzr-sel").forEach((n) => n.classList.remove("lzr-sel"));
                c.querySelectorAll("figcaption").forEach((n) => { if (!n.textContent.trim()) n.remove(); });
                return blank() ? "" : c.innerHTML.trim();
            },
            setHTML(html) { clearSel(); closePop(); if (st.source) { st.source = false; body.hidden = false; srcBox.hidden = true; bar.querySelectorAll(".lzr-btn, .lzr-block").forEach((el) => { el.disabled = false; }); bar.querySelector('[data-cmd="source"]').classList.remove("lzr-on"); }
                body.innerHTML = tidy(html || ""); st.undo = []; st.redo = []; st.last = body.innerHTML; refreshBlank(); refreshBar(); api.setError(""); wrap.classList.remove("lzr-bad"); },
            setText(text) { const t = String(text || "").trim(); api.setHTML(t ? t.split(/\r?\n\r?\n+/).map((p) => "<p>" + esc(p).replace(/\r?\n/g, "<br>") + "</p>").join("") : ""); },
            getText() { return (st.source ? tidy(srcBox.value).replace(/<[^>]+>/g, " ") : body.innerText || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim(); },
            isEmpty() { if (st.source) setSource(false); return blank(); },
            focus() { body.focus(); },
            setError(msg, info) { errEl.textContent = msg || ""; errEl.hidden = !msg; errEl.style.color = info ? "#555" : ""; wrap.classList.toggle("lzr-bad", !!msg && !info); },
            el: wrap
        };
        host._lzr = api;
        st.last = body.innerHTML;
        refreshBar();
        return api;
    }

    window.LzRichEditor = { mount, tidy };
})();
