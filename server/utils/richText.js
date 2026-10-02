// Rich text from the product form's editor (client/js/lz-rich-editor.js):
// the Product description and Highlights. What the browser sends is never
// trusted - it is taken apart and rebuilt here from an allow-list, so only
// these tags and attributes can ever reach the product page:
//   p h2 h3 h4 br strong b em i u a ul ol li blockquote
//   ul.lzr-cards (photo cards: li > h4, p, figure)
//   figure figcaption img  table thead tbody tr th td  iframe (YouTube only)
// Every attribute value is checked, then re-written with its quotes
// escaped; every piece of text is escaped. Anything else is dropped.

const ALLOWED = {
    p: ["class"], h2: [], h3: [], h4: [], br: [], strong: [], b: [], em: [], i: [], u: [],
    a: ["href"], ul: ["class"], ol: [], li: [], blockquote: [],
    figure: ["class"], figcaption: [], img: ["src", "alt"],
    table: [], thead: [], tbody: [], tr: [], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"],
    iframe: ["src"]
};
const VOID = new Set(["br", "img"]);
const CLASSES = new Set(["lzr-cards", "lzr-show", "lzr-img", "lzr-left", "lzr-center", "lzr-side", "lzr-media", "lzr-in1", "lzr-in2", "lzr-in3", "lzr-in4"]);
const YOUTUBE = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{6,20}$/;
const MAX_HTML = 60000;

const escText = (s) => String(s).replace(/&(?!(?:amp|lt|gt|quot|nbsp|#39|#\d{1,6}|#x[0-9a-f]{1,6});)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function decode(s) {
    return String(s).replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => String.fromCodePoint(parseInt(h, 16) || 32))
        .replace(/&#(\d{1,7});/g, (m, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff) || 32))
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function cleanAttr(tag, name, raw) {
    const v = decode(raw).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (name === "href") return /^(https?:\/\/|mailto:|tel:)[^\s"'<>`]+$/i.test(v) && v.length <= 600 ? v : null;
    if (name === "src" && tag === "img") return /^https:\/\/[^\s"'<>`]+$/i.test(v) && v.length <= 600 ? v : null;
    if (name === "src" && tag === "iframe") return YOUTUBE.test(v) ? v : null;
    if (name === "alt") return v.slice(0, 200);
    if (name === "class") { const k = v.split(/\s+/).filter((c) => CLASSES.has(c)); return k.length ? k.join(" ") : null; }
    if (name === "colspan" || name === "rowspan") return /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 20 ? v : null;
    return null;
}

// -> sanitised HTML ("" when there is nothing left).
function sanitizeRichText(input) {
    let src = String(input == null ? "" : input).slice(0, MAX_HTML * 2);
    // Whole elements whose content must never survive as text.
    src = src.replace(/<(script|style|noscript|template|svg|math|object|embed|textarea|title|head)\b[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\s*\/?>|<[^<>]*>?/g;
    const out = [];
    const stack = [];
    let last = 0, m;
    const text = (t) => { if (t) out.push(escText(t)); };
    while ((m = re.exec(src))) {
        text(src.slice(last, m.index));
        last = re.lastIndex;
        if (!m[2]) continue;                        // "<" that is not a real tag: dropped
        let tag = m[2].toLowerCase();
        if (tag === "h1") tag = "h2";               // the page already has its own h1
        if (tag === "div") tag = "p";
        if (!ALLOWED[tag]) continue;                // unknown tag: dropped, its text is kept
        if (m[1]) {                                 // closing tag
            const at = stack.lastIndexOf(tag);
            if (at === -1) continue;
            while (stack.length > at) out.push("</" + stack.pop() + ">");
            continue;
        }
        const attrs = [];
        const seen = new Set();
        const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
        let a;
        while ((a = ar.exec(m[3] || ""))) {
            const name = a[1].toLowerCase();
            if (!ALLOWED[tag].includes(name) || seen.has(name)) continue;
            const v = cleanAttr(tag, name, a[2] != null ? a[2] : a[3] != null ? a[3] : a[4]);
            if (v == null) continue;
            seen.add(name);
            attrs.push(name + '="' + escAttr(v) + '"');
        }
        if (tag === "img" && !seen.has("src")) continue;
        if (tag === "iframe") {
            if (!seen.has("src")) continue;
            out.push("<iframe " + attrs.join(" ") + ' loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>');
            continue;
        }
        if (tag === "a") { if (!seen.has("href")) continue; attrs.push('target="_blank"', 'rel="noopener nofollow"'); }
        if (tag === "img") attrs.push('loading="lazy"');
        out.push("<" + tag + (attrs.length ? " " + attrs.join(" ") : "") + ">");
        if (!VOID.has(tag)) stack.push(tag);
    }
    text(src.slice(last));
    while (stack.length) out.push("</" + stack.pop() + ">");
    let html = out.join("").replace(/<\/iframe><\/iframe>/g, "</iframe>").trim();
    if (html.length > MAX_HTML) return { ok: false, error: "This text is too long. Shorten it or use fewer pictures." };
    // Nothing visible left (only empty paragraphs / breaks)?
    if (!/<img\b|<iframe\b/.test(html) && !toPlainText(html)) html = "";
    return { ok: true, html };
}

// Plain text of sanitised HTML - kept in products.description for search,
// the Google feed and page descriptions. List items become "- " lines.
function toPlainText(html) {
    return decode(String(html || "")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/(p|h2|h3|h4|blockquote|tr|figure|figcaption|ul|ol|table)>|<br\b[^>]*>/gi, "\n")
        .replace(/<\/t[dh]>/gi, " ")
        .replace(/<[^>]*>/g, ""))
        .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const RICH_FIELDS = ["description_html", "highlights_html", "box_contents_html", "warranty_html"];
const CONDITIONS = ["new", "pre_used", "refurbished"];

// Reads the rich text and extra detail fields of the product form.
// -> { ok, sent, columns: { column: value }, descriptionText } | { ok: false, error }
// `sent` is false when the form has none of these fields (older forms) -
// then nothing is changed.
function readProductDetails(body) {
    const b = body || {};
    const columns = {};
    let descriptionText;
    for (const f of RICH_FIELDS) {
        if (b[f] === undefined) continue;
        const r = sanitizeRichText(b[f]);
        if (!r.ok) return { ok: false, error: r.error };
        columns[f] = r.html || null;
        if (f === "description_html") descriptionText = toPlainText(r.html);
    }
    if (b.model !== undefined) columns.model = String(b.model || "").trim().slice(0, 120) || null;
    if (b.production_country !== undefined) columns.production_country = String(b.production_country || "").trim().slice(0, 80) || null;
    if (b.item_condition !== undefined) {
        const c = String(b.item_condition || "").trim().toLowerCase();
        if (c && !CONDITIONS.includes(c)) return { ok: false, error: "Condition must be New, Pre-Used or Refurbished." };
        columns.item_condition = c || null;
    }
    return { ok: true, sent: Object.keys(columns).length > 0, columns, descriptionText };
}

// Writes those columns for one product. db: pool or client.
async function saveProductDetails(db, productId, columns) {
    const names = Object.keys(columns || {});
    if (!names.length) return;
    await db.query(`UPDATE products SET ${names.map((n, i) => `${n} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [productId].concat(names.map((n) => columns[n])));
}

module.exports = { sanitizeRichText, toPlainText, readProductDetails, saveProductDetails };
