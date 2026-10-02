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
        cards: I('<rect x="2.5" y="6" width="8" height="12" rx="1.2"/><rect x="13.5" y="6" width="8" height="12" rx="1.2"/><path d="M4.5 15h4M15.5 15h4"/>'),
        para: I('<path d="M19 6v6a3 3 0 0 1-3 3H6"/><path d="m9 12-3 3 3 3"/>', ' stroke-width="2.4"'),
        ok: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#15803d" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
        no: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#b91c1c" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    };
    const CSS = `
.lzr { position: relative; background: transparent; font-family: inherit; }
.lzr-bar { position: sticky; top: 0; z-index: 15; display: flex; align-items: center; flex-wrap: wrap; gap: 1px; min-height: 40px; padding: 3px 8px; background: #fff; border: 1px solid #ccced1; border-radius: 4px 4px 0 0; box-sizing: border-box; }
.lzr .lzr-bar .lzr-btn { width: auto !important; min-width: 32px !important; height: 32px !important; min-height: 0 !important; margin: 0 !important; padding: 0 6px !important; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 1px; background: none !important; border: 0 !important; border-radius: 3px !important; box-shadow: none !important; color: #333; cursor: pointer; font-family: inherit; line-height: 1; }
.lzr .lzr-btn svg { width: 19px; height: 19px; }
.lzr .lzr-bar .lzr-btn:hover { background: #f0f0f0 !important; } .lzr .lzr-bar .lzr-btn.lzr-on { background: #f0f7ff !important; color: #2977ff; } .lzr .lzr-bar .lzr-btn:disabled { color: #b9bcc2; cursor: default; background: none !important; }
.lzr-sep { width: 1px; height: 22px; background: #ccced1; margin: 0 6px; flex: 0 0 auto; }
.lzr .lzr-bar select.lzr-block { display: inline-block !important; width: auto !important; flex: 0 0 auto; height: 32px !important; min-height: 0 !important; min-width: 138px; margin: 0 2px 0 0 !important; border: 0 !important; background-color: transparent; font-size: 14px !important; font-family: inherit; color: #333; padding: 0 6px !important; cursor: pointer; border-radius: 3px !important; box-shadow: none !important; }
.lzr .lzr-bar select.lzr-block:hover { background-color: #f0f0f0; }
.lzr-body { min-height: 95px; margin-top: 2px; padding: 9px 10px; outline: none; font-size: 13.5px; line-height: 1.6; color: #222; overflow-wrap: anywhere; resize: vertical; overflow: auto; background: #fff; border: 1px solid #ccced1; border-radius: 0 0 4px 4px; box-sizing: border-box; }
.lzr-body:focus { border-color: #2977ff; box-shadow: inset 0 0 0 1px rgba(41,119,255,.25); }
.lzr.lzr-bad .lzr-bar, .lzr.lzr-bad .lzr-body, .lzr.lzr-bad .lzr-src { border-color: #e53935; }
.lzr-body:empty::before, .lzr-body.lzr-blank::before { content: attr(data-placeholder); color: #8a8f98; pointer-events: none; position: absolute; left: 11px; right: 11px; }
.lzr-body p { margin: 0 0 8px; } .lzr-body h2 { font-size: 21px; margin: 6px 0 8px; } .lzr-body h3 { font-size: 17.5px; margin: 6px 0 8px; } .lzr-body h4 { font-size: 15.5px; margin: 6px 0 8px; }
.lzr-body ul, .lzr-body ol { margin: 0 0 8px; padding-left: 26px; }
.lzr-body blockquote { margin: 0 0 8px; padding: 4px 14px; border-left: 5px solid #ccced1; color: #4b5563; font-style: italic; }
.lzr-body a { color: #1d4ed8; text-decoration: underline; }
.lzr .lzr-body table { display: table !important; border-collapse: collapse !important; width: 100% !important; margin: 0 0 8px !important; box-shadow: none !important; border-radius: 0 !important; background: none !important; table-layout: auto; }
.lzr .lzr-body thead { display: table-header-group !important; } .lzr .lzr-body tbody { display: table-row-group !important; }
.lzr .lzr-body tr { display: table-row !important; box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; background: none !important; }
.lzr .lzr-body td, .lzr .lzr-body th { display: table-cell !important; border: 1px solid #bfbfbf !important; padding: 6px 8px !important; min-width: 40px; vertical-align: top; text-align: left !important; width: auto !important; font-size: 13.5px; }
.lzr .lzr-body td::before, .lzr .lzr-body th::before { content: none !important; }
.lzr .lzr-body th { background: #f3f4f6 !important; }
.lzr-body .lzr-in1 { margin-left: 28px; } .lzr-body .lzr-in2 { margin-left: 56px; } .lzr-body .lzr-in3 { margin-left: 84px; } .lzr-body .lzr-in4 { margin-left: 112px; }
.lzr-body figure { margin: 6px 0 12px; position: relative; display: block; clear: both; outline: 3px solid transparent; outline-offset: 0; transition: outline-color .12s; }
.lzr-body figure:hover, .lzr .lzr-body table:hover { outline: 3px solid #ffc83d; }
.lzr-body figure.lzr-img img { display: block; max-width: 100%; height: auto; }
.lzr-body figure.lzr-left { width: -moz-fit-content; width: fit-content; max-width: 100%; }
.lzr-body figure.lzr-center { text-align: center; } .lzr-body figure.lzr-center img { margin: 0 auto; }
.lzr-body figure.lzr-side { float: right; max-width: 50%; margin: 6px 0 12px 18px; clear: none; }
.lzr-body figcaption { font-size: 12px; color: #333; background: #f7f7f7; padding: 7px 8px; text-align: center; outline: none; min-height: 18px; }
.lzr-body figcaption:empty::before { content: "Enter image caption"; color: #9ca0a8; }
.lzr-body figcaption:focus { background: #fff; box-shadow: inset 0 0 0 1px #2977ff; }
.lzr-body figure.lzr-media iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; display: block; pointer-events: none; }
.lzr .lzr-body .lzr-sel, .lzr .lzr-body .lzr-sel:hover { outline: 3px solid #2977ff; }
.lzr-src { width: 100%; min-height: 150px; margin-top: 2px; box-sizing: border-box; border: 1px solid #ccced1; border-radius: 0 0 4px 4px; outline: none; padding: 10px 12px; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #1f2430; background: #fbfbfc; resize: vertical; white-space: pre-wrap; tab-size: 2; }
.lzr .lzr-src[hidden], .lzr .lzr-body[hidden] { display: none !important; }
.lzr .lzr-src:not([hidden]) { display: block !important; }
.lzr-srcnote { font-size: 11.5px; color: #6b7280; margin: 4px 2px 0; }
.lzr-pop { position: absolute; z-index: 30; background: #fff; border: 1px solid #ccced1; border-radius: 4px; box-shadow: 0 3px 10px rgba(0,0,0,.16); padding: 4px; display: flex; align-items: center; gap: 1px; }
.lzr .lzr-pop .lzr-btn { width: auto !important; min-width: 32px !important; height: 32px !important; min-height: 0 !important; margin: 0 !important; padding: 0 6px !important; display: inline-flex; align-items: center; justify-content: center; background: none !important; border: 0 !important; border-radius: 3px !important; box-shadow: none !important; color: #333; cursor: pointer; }
.lzr .lzr-pop .lzr-btn:hover { background: #f0f0f0 !important; } .lzr .lzr-pop .lzr-btn.lzr-on { background: #f0f7ff !important; color: #2977ff; }
.lzr-figbar::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 10px; height: 10px; margin-left: -5px; background: #fff; border-right: 1px solid #ccced1; border-bottom: 1px solid #ccced1; transform: rotate(45deg); }
.lzr-figbar.lzr-under::after { bottom: auto; top: -6px; transform: rotate(225deg); }
.lzr-pop input[type=text], .lzr-pop input[type=url] { height: 34px !important; width: 250px !important; max-width: 60vw; border: 1px solid #b8bcc4 !important; border-radius: 4px !important; padding: 0 9px !important; font-size: 13.5px !important; font-family: inherit; margin: 0 !important; }
.lzr-pop label { font-size: 11px; color: #555; display: block; margin: -2px 0 2px 2px; }
.lzr-grid { display: grid; grid-template-columns: repeat(10, 14px); gap: 2px; padding: 6px; } .lzr-grid i { width: 14px; height: 14px; border: 1px solid #bfbfbf; display: block; cursor: pointer; box-sizing: border-box; } .lzr-grid i.on { background: #e1eeff; border-color: #2977ff; }
.lzr-grid-label { font-size: 12px; color: #333; text-align: center; padding: 0 0 4px; }
.lzr .lzr-para { position: absolute; z-index: 25; width: 20px !important; height: 20px !important; min-width: 0 !important; min-height: 0 !important; box-sizing: border-box; border-radius: 50% !important; border: 0 !important; background: #3779eb !important; color: #fff !important; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0 !important; margin: 0 !important; box-shadow: 0 0 0 2px #fff; line-height: 1; }
.lzr .lzr-para:hover { background: #2563d8 !important; }
.lzr .lzr-para svg { width: 12px; height: 12px; }
.lzr-tip { position: absolute; z-index: 40; background: #333; color: #fff; font-size: 11.5px; padding: 4px 8px; border-radius: 3px; white-space: nowrap; pointer-events: none; }
.lzr-body ul.lzr-cards { list-style: none; display: flex; gap: 10px; overflow-x: auto; margin: 6px 0 12px; padding: 8px; background: #f7f8fa; outline: 3px solid transparent; transition: outline-color .12s; cursor: pointer; }
.lzr-body ul.lzr-cards:hover { outline: 3px solid #ffc83d; }
.lzr-body ul.lzr-cards > li { flex: 0 0 190px; background: #fff; border: 1px solid #e2e4e8; border-radius: 8px; padding: 9px; margin: 0; }
.lzr-body ul.lzr-cards h4 { font-size: 13.5px; margin: 0 0 4px; } .lzr-body ul.lzr-cards p { font-size: 12px; margin: 0 0 6px; color: #4b5563; }
.lzr-body ul.lzr-cards figure { margin: 0; outline: 0 !important; } .lzr-body ul.lzr-cards img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }
.lzr-body ul.lzr-cards.lzr-show { display: block; background: #0b0b12; padding: 14px; }
.lzr-body ul.lzr-cards.lzr-show > li { background: none; border: 0; text-align: center; display: flex; flex-direction: column; padding: 10px 0 16px; }
.lzr-body ul.lzr-cards.lzr-show h4 { color: #fff; font-size: 18px; order: 0; } .lzr-body ul.lzr-cards.lzr-show p { color: #d1d5db; order: 2; }
.lzr-body ul.lzr-cards.lzr-show figure { display: contents; } .lzr-body ul.lzr-cards.lzr-show figcaption { order: 1; background: none; color: #fff; font-weight: 700; font-size: 13.5px; }
.lzr-body ul.lzr-cards.lzr-show img { order: 3; aspect-ratio: auto; max-width: 420px; margin: 0 auto; }
.lzr-cdlg-lay { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.lzr-cdlg .lzr-cdlg-lay button { flex: 1 1 200px; width: auto !important; min-height: 0 !important; height: auto !important; margin: 0 !important; text-align: left; padding: 8px 11px !important; border: 1.5px solid #ccced1 !important; border-radius: 7px !important; background: #fff !important; color: #333 !important; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 700; line-height: 1.35; }
.lzr-cdlg .lzr-cdlg-lay button small { display: block; font-weight: 400; font-size: 11.5px; color: #555; }
.lzr-cdlg .lzr-cdlg-lay button.on { border-color: #f4b400 !important; background: #fffaeb !important; }
.lzr-cdlg { position: fixed; inset: 0; z-index: 100000; background: rgba(15,18,30,.55); display: flex; align-items: center; justify-content: center; padding: 14px; font-family: inherit; }
.lzr-cdlg-box { background: #fff; border-radius: 10px; width: 100%; max-width: 680px; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 18px 50px rgba(0,0,0,.3); }
.lzr-cdlg-head { padding: 14px 18px 10px; border-bottom: 1px solid #e5e7eb; } .lzr-cdlg-head b { font-size: 16px; color: #1a1a2e; } .lzr-cdlg-head div { font-size: 12.5px; color: #555; margin-top: 3px; line-height: 1.45; }
.lzr-cdlg-list { padding: 12px 18px; overflow-y: auto; flex: 1 1 auto; }
.lzr-cdlg-row { display: flex; gap: 12px; padding: 10px; border: 1px solid #e2e4e8; border-radius: 8px; margin-bottom: 10px; background: #fafbfc; }
.lzr-cdlg-row img { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; flex: 0 0 auto; background: #eee; }
.lzr-cdlg-f { flex: 1 1 auto; min-width: 0; display: grid; gap: 6px; }
.lzr-cdlg-f label { font-size: 11px; color: #555; display: block; margin: 0 0 2px; font-weight: 600; }
.lzr-cdlg .lzr-cdlg-f input, .lzr-cdlg .lzr-cdlg-f textarea { width: 100% !important; box-sizing: border-box; border: 1px solid #b8bcc4 !important; border-radius: 4px !important; padding: 7px 9px !important; font-size: 13.5px !important; font-family: inherit; margin: 0 !important; background: #fff; min-height: 0 !important; }
.lzr-cdlg .lzr-cdlg-f input { height: 34px !important; } .lzr-cdlg .lzr-cdlg-f textarea { height: 54px !important; resize: vertical; }
.lzr-cdlg-side { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
.lzr-cdlg .lzr-cdlg-side button { width: 30px !important; height: 30px !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important; border: 1px solid #ccced1 !important; background: #fff !important; border-radius: 4px !important; cursor: pointer; font-size: 14px; color: #333; }
.lzr-cdlg .lzr-cdlg-side button:disabled { opacity: .35; cursor: default; } .lzr-cdlg .lzr-cdlg-side button[data-a=del] { color: #b91c1c; }
.lzr-cdlg-empty { text-align: center; color: #6b7280; font-size: 13px; padding: 22px 0; }
.lzr-cdlg-msg { font-size: 12.5px; color: #555; padding: 0 18px 6px; min-height: 16px; } .lzr-cdlg-msg.bad { color: #e53935; }
.lzr-cdlg-foot { display: flex; gap: 8px; align-items: center; padding: 10px 18px 14px; border-top: 1px solid #e5e7eb; flex-wrap: wrap; }
.lzr-cdlg .lzr-cdlg-foot button { width: auto !important; height: 38px !important; min-height: 0 !important; margin: 0 !important; padding: 0 16px !important; border-radius: 6px !important; font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.lzr-cdlg .lzr-cdlg-foot [data-a=add] { background: #fff !important; border: 1px solid #1a1a2e !important; color: #1a1a2e !important; margin-right: auto !important; }
.lzr-cdlg .lzr-cdlg-foot [data-a=cancel] { background: #fff !important; border: 1px solid #ccced1 !important; color: #333 !important; }
.lzr-cdlg .lzr-cdlg-foot [data-a=save] { background: #1a1a2e !important; border: 1px solid #1a1a2e !important; color: #f4b400 !important; }
@media (max-width: 560px) { .lzr-cdlg-row { flex-wrap: wrap; } .lzr-cdlg-row img { width: 72px; height: 72px; } .lzr-cdlg-side { flex-direction: row; width: 100%; justify-content: flex-end; } }
.lzr-err { color: #e53935; font-size: 11.5px; margin: 4px 10px 0; }
@media (max-width: 700px) { .lzr .lzr-bar select.lzr-block { min-width: 104px; } .lzr-sep { margin: 0 2px; } .lzr-body figure.lzr-side { float: none; max-width: 100%; margin: 6px 0 12px; } }`;

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
    const KEEP_CLASS = /^(lzr-cards|lzr-show|lzr-img|lzr-left|lzr-center|lzr-side|lzr-media|lzr-in[1-4])$/;
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
                        || (name === "class" && (tag === "P" || tag === "FIGURE" || tag === "UL"));
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
            ${btn("source", ICON.source, "Source (show or hide the HTML)")}
            <select class="lzr-block" aria-label="Paragraph or heading"><option value="p">Paragraph</option><option value="h2">Heading 1</option><option value="h3">Heading 2</option><option value="h4">Heading 3</option></select>
            <span class="lzr-sep"></span>
            ${btn("bold", ICON.bold, "Bold")}${btn("italic", ICON.italic, "Italic")}${btn("link", ICON.link, "Link")}
            ${btn("ul", ICON.ul, "Bulleted List")}${btn("ol", ICON.ol, "Numbered List")}
            <span class="lzr-sep"></span>
            ${btn("outdent", ICON.outdent, "Decrease indent")}${btn("indent", ICON.indent, "Increase indent")}
            <span class="lzr-sep"></span>
            ${btn("image", ICON.image, "Insert image")}${btn("cards", ICON.cards, "Photo cards (photos with a heading and a few words, side by side)")}${btn("quote", ICON.quote, "Block quote")}${btn("table", ICON.table, "Insert table", ICON.caret)}${btn("media", ICON.media, "Insert media", ICON.caret)}
            ${btn("undo", ICON.undo, "Undo")}${btn("redo", ICON.redo, "Redo")}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
        </div>
        <div class="lzr-body" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${esc(opts.placeholder || "")}"></div>
        <textarea class="lzr-src" hidden aria-label="HTML source" spellcheck="false" placeholder="HTML view - type or paste HTML here, then press the first button again to go back to the normal view."></textarea>`;
        host.innerHTML = "";
        host.appendChild(wrap);
        const bar = wrap.querySelector(".lzr-bar"), body = wrap.querySelector(".lzr-body"), srcBox = wrap.querySelector(".lzr-src");
        const fileInput = wrap.querySelector('input[type="file"]'), blockSel = wrap.querySelector(".lzr-block");
        if (opts.minHeight) body.style.minHeight = opts.minHeight + "px";
        try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* older browsers */ }

        const errEl = document.createElement("div");
        errEl.className = "lzr-err"; errEl.hidden = true; errEl.setAttribute("role", "status");
        host.appendChild(errEl);
        const st = { undo: [], redo: [], last: "", sel: null, range: null, source: false, timer: null };
        const blank = () => !body.textContent.trim() && !body.querySelector("img,iframe,table");
        const lockCards = () => body.querySelectorAll("ul.lzr-cards").forEach((u) => u.setAttribute("contenteditable", "false"));
        const refreshBlank = () => body.classList.toggle("lzr-blank", blank() && body.innerHTML !== "");
        function snapshot(force) {
            const h = body.innerHTML;
            if (!force && h === st.last) return;
            st.undo.push(st.last); if (st.undo.length > 60) st.undo.shift();
            st.redo = []; st.last = h;
            refreshBlank(); if (wrap.classList.contains("lzr-bad") && !blank()) { wrap.classList.remove("lzr-bad"); errEl.textContent = ""; errEl.hidden = true; }
            if (opts.onChange) opts.onChange();
        }
        function restore(h) { clearSel(); body.innerHTML = h; lockCards(); st.last = h; refreshBlank(); if (opts.onChange) opts.onChange(); }
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
        function closePop() { wrap.querySelectorAll(".lzr-pop:not(.lzr-figbar)").forEach((p) => p.remove()); }
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
            wrap.querySelectorAll(".lzr-para, .lzr-figbar, .lzr-tip").forEach((n) => n.remove());
        }
        // "before" sits on the top edge at the left, "after" on the bottom edge at the right.
        function place(el, target, where) {
            const t = target.getBoundingClientRect(), w = wrap.getBoundingClientRect();
            if (where === "before") { el.style.top = (t.top - w.top - 10) + "px"; el.style.left = (t.left - w.left + 36) + "px"; }
            else if (where === "after") { el.style.top = (t.bottom - w.top - 10) + "px"; el.style.left = (t.right - w.left - 56) + "px"; }
            else {
                const above = t.top - w.top - el.offsetHeight - 12, floor = bar.offsetHeight + 6;
                const under = above < floor && t.height < 140;
                el.classList.toggle("lzr-under", under);
                el.style.top = (under ? t.bottom - w.top + 12 : Math.max(floor, above)) + "px";
                el.style.left = Math.max(4, Math.min(t.left - w.left + t.width / 2 - el.offsetWidth / 2, w.width - el.offsetWidth - 4)) + "px";
            }
        }
        function tip(anchor, text) {
            wrap.querySelectorAll(".lzr-tip").forEach((n) => n.remove());
            if (!text) return;
            const el = document.createElement("div");
            el.className = "lzr-tip"; el.textContent = text;
            wrap.appendChild(el);
            const a = anchor.getBoundingClientRect(), w = wrap.getBoundingClientRect();
            el.style.top = (a.bottom - w.top + 8) + "px";
            el.style.left = Math.max(4, Math.min(a.left - w.left - 8, w.width - el.offsetWidth - 4)) + "px";
        }
        // The round "insert paragraph" buttons. A block that is only pointed at
        // shows one (before in its upper half, after in its lower half); a
        // selected block shows both.
        function paraButtons(target, which) {
            wrap.querySelectorAll(".lzr-para").forEach((n) => n.remove());
            which.forEach((where) => {
                const title = where === "before" ? "Insert paragraph before block" : "Insert paragraph after block";
                const b = document.createElement("button");
                b.type = "button"; b.className = "lzr-para"; b.setAttribute("aria-label", title); b.innerHTML = ICON.para;
                b.onmousedown = (e) => e.preventDefault();
                b.onmouseenter = () => tip(b, title);
                b.onmouseleave = () => tip(b, "");
                b.onclick = () => newPara(target, where === "before");
                wrap.appendChild(b); place(b, target, where);
            });
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
            paraButtons(target, ["before", "after"]);
            const isImg = target.classList.contains("lzr-img");
            const fb = document.createElement("div");
            fb.className = "lzr-pop lzr-figbar";
            const fbtn = (act, icon, title, on) => `<button type="button" class="lzr-btn${on ? " lzr-on" : ""}" data-fig="${act}" title="${title}" aria-label="${title}">${icon}</button>`;
            const isCards = target.classList.contains("lzr-cards");
            fb.innerHTML = isCards ? fbtn("editcards", '<span style="font-size:12.5px; font-weight:600;">Edit photo cards</span>', "Edit photo cards") + '<span class="lzr-sep"></span>' + fbtn("remove", ICON.no, "Remove photo cards") : isImg
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
                if (act === "editcards") { clearSel(); openCards(target); return; }
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

        // ---- photo cards: photos side by side, each with a heading, a short
        // description and a few words under the photo. Shoppers swipe through
        // them. Kept as <ul class="lzr-cards"><li><h4><p><figure>...; edited in
        // a small window, never typed into directly. ----
        const MAX_CARDS = 12;
        function readCards(ul) {
            return Array.from(ul.children).filter((li) => li.tagName === "LI" && li.querySelector("img")).map((li) => ({
                src: li.querySelector("img").getAttribute("src"),
                heading: (li.querySelector("h4") || {}).textContent || "",
                text: (li.querySelector("p") || {}).textContent || "",
                caption: (li.querySelector("figcaption") || {}).textContent || ""
            }));
        }
        function cardsInner(cards) {
            return cards.map((c) => "<li>" + (c.heading.trim() ? "<h4>" + esc(c.heading.trim()) + "</h4>" : "") + (c.text.trim() ? "<p>" + esc(c.text.trim()) + "</p>" : "")
                + '<figure class="lzr-img"><img src="' + esc(c.src) + '" alt="' + esc(c.heading.trim() || c.caption.trim()) + '">' + (c.caption.trim() ? "<figcaption>" + esc(c.caption.trim()) + "</figcaption>" : "") + "</figure></li>").join("");
        }
        function openCards(ul) {
            closePop();
            const cards = ul ? readCards(ul) : [];
            let show = !!(ul && ul.classList.contains("lzr-show"));
            const dlg = document.createElement("div");
            dlg.className = "lzr-cdlg";
            dlg.innerHTML = `<div class="lzr-cdlg-box" role="dialog" aria-modal="true" aria-label="Photo cards">
                <div class="lzr-cdlg-head"><b>Photo cards</b><div>Add 3 or more photos. Give each one a heading, a short description and a few words under the photo. Then choose how shoppers see them.</div>
                <div class="lzr-cdlg-lay"><button type="button" data-lay="swipe">Swipe cards<small>Side by side, shoppers swipe through them</small></button><button type="button" data-lay="show">Feature showcase<small>Dark full-width sections with a "Top features" summary</small></button></div></div>
                <div class="lzr-cdlg-list"></div><div class="lzr-cdlg-msg" role="status"></div>
                <div class="lzr-cdlg-foot"><button type="button" data-a="add">+ Add photos</button><button type="button" data-a="cancel">Cancel</button><button type="button" data-a="save">Save</button>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></div></div>`;
            const list = dlg.querySelector(".lzr-cdlg-list"), msg = dlg.querySelector(".lzr-cdlg-msg"), pick = dlg.querySelector('input[type="file"]');
            const say = (t, bad) => { msg.textContent = t || ""; msg.classList.toggle("bad", !!bad); };
            const drawLay = () => dlg.querySelectorAll("[data-lay]").forEach((b) => b.classList.toggle("on", (b.dataset.lay === "show") === show));
            const draw = () => {
                list.innerHTML = cards.length ? cards.map((c, i) => `<div class="lzr-cdlg-row" data-i="${i}"><img src="${esc(c.src)}" alt="">
                    <div class="lzr-cdlg-f"><div><label>Heading</label><input type="text" data-k="heading" maxlength="60" value="${esc(c.heading)}" placeholder="e.g. Long battery life"></div>
                    <div><label>Short description</label><textarea data-k="text" maxlength="220" placeholder="One or two sentences about this">${esc(c.text)}</textarea></div>
                    <div><label>A few words (under the photo; in a showcase, the summary line)</label><input type="text" data-k="caption" maxlength="90" value="${esc(c.caption)}" placeholder="e.g. Charges fully in 45 minutes"></div></div>
                    <div class="lzr-cdlg-side"><button type="button" data-a="up" title="Move earlier" aria-label="Move earlier"${i === 0 ? " disabled" : ""}>&#8593;</button><button type="button" data-a="down" title="Move later" aria-label="Move later"${i === cards.length - 1 ? " disabled" : ""}>&#8595;</button><button type="button" data-a="del" title="Remove this photo" aria-label="Remove this photo">&#10005;</button></div></div>`).join("")
                    : '<div class="lzr-cdlg-empty">No photos yet. Press "Add photos" and choose 3 or more.</div>';
            };
            const close = () => { dlg.remove(); document.removeEventListener("keydown", onKey, true); };
            const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
            list.addEventListener("input", (e) => { const row = e.target.closest(".lzr-cdlg-row"), k = e.target.dataset.k; if (row && k) cards[Number(row.dataset.i)][k] = e.target.value; });
            dlg.addEventListener("click", async (e) => {
                const lay = e.target.closest("[data-lay]");
                if (lay) { show = lay.dataset.lay === "show"; drawLay(); return; }
                const b = e.target.closest("[data-a]");
                if (!b) return;
                const a = b.dataset.a, row = b.closest(".lzr-cdlg-row"), i = row ? Number(row.dataset.i) : -1;
                if (a === "cancel") return close();
                if (a === "add") { if (cards.length >= MAX_CARDS) return say("That is the most photos one set can hold (" + MAX_CARDS + ").", true); pick.value = ""; pick.click(); return; }
                if (a === "up" && i > 0) { cards.splice(i - 1, 0, cards.splice(i, 1)[0]); draw(); }
                if (a === "down" && i < cards.length - 1) { cards.splice(i + 1, 0, cards.splice(i, 1)[0]); draw(); }
                if (a === "del") { cards.splice(i, 1); draw(); }
                if (a === "save") {
                    if (!cards.length) { if (ul) { ul.remove(); snapshot(); } return close(); }
                    if (cards.length < 2) return say("Add at least 2 photos, 3 or more looks best.", true);
                    let node = ul;
                    if (!node) node = document.createElement("ul");
                    node.className = show ? "lzr-cards lzr-show" : "lzr-cards";
                    node.innerHTML = cardsInner(cards);
                    node.setAttribute("contenteditable", "false");
                    close();
                    if (ul) snapshot(); else insertBlock(node);
                }
            });
            pick.addEventListener("change", async () => {
                const files = Array.from(pick.files || []);
                if (!files.length) return;
                if (!opts.uploadImage) return say("Pictures can't be added here.", true);
                const problems = [];
                let n = 0;
                for (const file of files) {
                    if (cards.length >= MAX_CARDS) { problems.push("only " + MAX_CARDS + " photos fit in one set"); break; }
                    if (file.size > 5 * 1024 * 1024) { problems.push(file.name + " is larger than 5MB"); continue; }
                    say("Uploading photo " + (++n) + " of " + files.length + "...");
                    try { const url = await opts.uploadImage(file); if (url) { cards.push({ src: url, heading: "", text: "", caption: "" }); draw(); } }
                    catch (err) { problems.push(file.name + ": " + ((err && err.message) || "could not be uploaded")); }
                }
                say(problems.length ? problems.join(". ") + "." : "", problems.length > 0);
                list.scrollTop = list.scrollHeight;
            });
            document.addEventListener("keydown", onKey, true);
            document.body.appendChild(dlg);
            draw(); drawLay();
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
        // after: the picture just added before this one (when several are picked together).
        function insertImage(url, alt, after) {
            const f = document.createElement("figure");
            f.className = "lzr-img lzr-center";
            f.innerHTML = `<img src="${esc(url)}" alt="${esc(alt || "")}">`;
            if (after && after.parentNode === body) { body.insertBefore(f, after.nextSibling); snapshot(); }
            else insertBlock(f);
            if (!after) selectBlock(f);
            return f;
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
            if (on) { srcBox.value = blank() ? "" : body.innerHTML.replace(/ class="lzr-sel"| lzr-sel| contenteditable="false"/g, "").replace(/<\/(p|h2|h3|h4|ul|ol|li|blockquote|figure|table|thead|tbody|tr)>(?=<)/g, "</$1>\n").replace(/<(ul|ol|tbody|thead|tr|table)>(?=<)/g, "<$1>\n"); }
            else { body.innerHTML = tidy(srcBox.value); lockCards(); snapshot(true); }
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
            if (cmd === "cards") { saveRange(); openCards(null); return; }
            if (cmd === "table") {
                saveRange();
                const p = popAt(b, '<div><div class="lzr-grid-label">Choose the size</div><div class="lzr-grid">' + Array.from({ length: 100 }, (_, i) => `<i data-r="${Math.floor(i / 10) + 1}" data-c="${(i % 10) + 1}"></i>`).join("") + '</div></div>');
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
        // Several pictures can be chosen at once; they go in one after the other, in the order picked.
        fileInput.addEventListener("change", async () => {
            const files = Array.from(fileInput.files || []);
            if (!files.length) return;
            if (!opts.uploadImage) { api.setError("Pictures can't be added here."); return; }
            const problems = [];
            let last = null, done = 0;
            for (const file of files) {
                if (file.size > 5 * 1024 * 1024) { problems.push(file.name + " is larger than 5MB"); continue; }
                api.setError("Uploading picture " + (done + 1) + " of " + files.length + "...", true);
                try { const url = await opts.uploadImage(file); if (url) { last = insertImage(url, "", last); done++; } }
                catch (e) { problems.push(file.name + ": " + ((e && e.message) || "could not be uploaded")); }
            }
            api.setError(problems.length ? problems.join(". ") + "." : "");
            if (last) selectBlock(last);
        });

        body.addEventListener("input", () => { clearTimeout(st.timer); st.timer = setTimeout(() => { snapshot(); refreshBar(); }, 350); refreshBlank(); });
        body.addEventListener("keyup", () => { saveRange(); refreshBar(); });
        body.addEventListener("mouseup", () => { saveRange(); refreshBar(); });
        // Typing always starts inside a paragraph.
        body.addEventListener("focus", () => {
            if (body.innerHTML.trim() !== "") return;
            body.innerHTML = "<p><br></p>"; st.last = body.innerHTML; refreshBlank();
            const r = document.createRange(); r.setStart(body.firstChild, 0); r.collapse(true);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        });
        body.addEventListener("blur", () => { clearTimeout(st.timer); snapshot(); });
        body.addEventListener("dblclick", (e) => { const c = e.target.closest("ul.lzr-cards"); if (c && body.contains(c)) { e.preventDefault(); clearSel(); openCards(c); } });
        body.addEventListener("click", (e) => {
            const cards = e.target.closest("ul.lzr-cards");
            const fig = !cards && e.target.closest("figure.lzr-img, figure.lzr-media");
            const tbl = !cards && !fig && e.target.closest("table");
            if (cards && body.contains(cards)) { e.preventDefault(); selectBlock(cards); }
            else if (fig && body.contains(fig)) { if (!e.target.closest("figcaption")) e.preventDefault(); selectBlock(fig); }
            else if (tbl && body.contains(tbl)) selectBlock(tbl);
            else clearSel();
            closePop();
        });
        body.addEventListener("mousemove", (e) => {
            if (st.sel) return;
            const blk = e.target.closest && (e.target.closest("ul.lzr-cards") || e.target.closest("figure.lzr-img, figure.lzr-media") || e.target.closest("table"));
            if (!blk || !body.contains(blk)) { if (!e.target.closest || !e.target.closest(".lzr-para")) { st.hover = null; wrap.querySelectorAll(".lzr-para, .lzr-tip").forEach((n) => n.remove()); } return; }
            const r = blk.getBoundingClientRect(), where = e.clientY < r.top + r.height / 2 ? "before" : "after";
            if (st.hover === blk && st.hoverWhere === where) return;
            st.hover = blk; st.hoverWhere = where;
            paraButtons(blk, [where]);
        });
        wrap.addEventListener("mouseleave", () => { if (!st.sel) { st.hover = null; wrap.querySelectorAll(".lzr-para, .lzr-tip").forEach((n) => n.remove()); } });
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


        const api = {
            getHTML() {
                if (st.source) setSource(false);
                clearTimeout(st.timer);
                const c = body.cloneNode(true);
                c.querySelectorAll(".lzr-sel").forEach((n) => { n.classList.remove("lzr-sel"); if (!n.className) n.removeAttribute("class"); });
                c.querySelectorAll("ul.lzr-cards").forEach((n) => { n.removeAttribute("contenteditable"); n.removeAttribute("style"); });
                c.querySelectorAll("figcaption").forEach((n) => { if (!n.textContent.trim()) n.remove(); });
                return blank() ? "" : c.innerHTML.trim();
            },
            setHTML(html) { clearSel(); closePop(); if (st.source) { st.source = false; body.hidden = false; srcBox.hidden = true; bar.querySelectorAll(".lzr-btn, .lzr-block").forEach((el) => { el.disabled = false; }); bar.querySelector('[data-cmd="source"]').classList.remove("lzr-on"); }
                body.innerHTML = tidy(html || ""); lockCards(); st.undo = []; st.redo = []; st.last = body.innerHTML; refreshBlank(); refreshBar(); api.setError(""); wrap.classList.remove("lzr-bad"); },
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
