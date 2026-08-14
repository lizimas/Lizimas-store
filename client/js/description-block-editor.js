// Reusable description block editor.
// Mount:   LzBlockEditor.mount(containerEl, productId)
// Collect: LzBlockEditor.save(productId)
// Images upload immediately on selection, so dimensions always come from
// Cloudinary rather than being guessed or typed.
(function (global) {
    let blocks = [];   // { type, body, image_url, image_width, image_height, alt_text }
    let host = null;
    let busy = 0;

    let tokenKey = "adminToken";

    function token() {
        return localStorage.getItem(tokenKey) || "";
    }

    function setBusy(delta) {
        busy += delta;
        const btn = document.getElementById("lzbe-save");
        if (btn) btn.disabled = busy > 0;
        const note = document.getElementById("lzbe-busy");
        if (note) note.textContent = busy > 0 ? `Uploading ${busy} image(s)…` : "";
    }

    function move(i, dir) {
        const j = i + dir;
        if (j < 0 || j >= blocks.length) return;
        [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        render();
    }

    function remove(i) {
        blocks.splice(i, 1);
        render();
    }

    function addBlock(type) {
        if (type === "image") {
            document.getElementById("lzbe-file").click();
            return;
        }
        blocks.push({ type, body: "" });
        render();
    }

    async function handleFile(file) {
        if (!file) return;
        // On the Add Product form there is no id yet, so images go to the
        // staging endpoint. Upload still happens immediately, which is what
        // keeps true Cloudinary dimensions on the block.
        const productId = host.dataset.productId;
        const uploadUrl = productId
            ? `/api/products/${productId}/description-blocks/image`
            : "/api/products/description-blocks/image";

        setBusy(1);
        try {
            const prepared = typeof preparePickedFile === "function"
                ? await preparePickedFile(file)
                : { ok: true, file };
            if (!prepared.ok) throw new Error(prepared.reason || "File could not be read");

            const fd = new FormData();
            fd.append("image", prepared.file || file);

            const res = await fetch(uploadUrl, {
                method: "POST",
                headers: { Authorization: `Bearer ${token()}` },
                body: fd
            });
            if (!res.ok) throw new Error("Upload failed");
            const data = await res.json();

            blocks.push({
                type: "image",
                image_url: data.image_url,
                image_width: data.image_width,
                image_height: data.image_height,
                alt_text: ""
            });
            render();
        } catch (err) {
            console.error("block image upload:", err);
            alert("Image upload failed: " + err.message);
        } finally {
            setBusy(-1);
        }
    }

    // ---- Rich paste -------------------------------------------------------
    // Word ships list markers as Wingdings glyphs inside mso-list paragraphs
    // and drops them from the plain-text flavour entirely; Google Docs ships
    // real <ul>/<ol>. Both are normalised to real lists so numbering, bullets,
    // ticks and levels survive the paste.
    const ALLOWED_TAGS = ["P","BR","STRONG","B","EM","I","U","UL","OL","LI","SPAN"];

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function plainToHtml(s) {
        return esc(s).replace(/\r\n|\r|\n/g, "<br>");
    }

    function textOf(html) {
        const d = document.createElement("div");
        d.innerHTML = html || "";
        return (d.textContent || "").replace(/\u00a0/g, " ");
    }

    function sanitizeHtml(html) {
        const doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
        const out = document.createElement("div");
        (function walk(from, to) {
            from.childNodes.forEach((n) => {
                if (n.nodeType === 3) {
                    to.appendChild(document.createTextNode(n.nodeValue));
                    return;
                }
                if (n.nodeType !== 1) return;
                if (ALLOWED_TAGS.indexOf(n.tagName) === -1) {
                    walk(n, to);              // unwrap, keep the words
                    return;
                }
                // Only the tick span survives; every other span is unwrapped.
                if (n.tagName === "SPAN" && !n.classList.contains("tick")) {
                    walk(n, to);
                    return;
                }
                const el = document.createElement(n.tagName.toLowerCase());
                if (n.tagName === "SPAN") el.className = "tick";
                if (n.tagName === "UL" && n.classList.contains("lzbe-check")) {
                    el.className = "lzbe-check";
                }
                to.appendChild(el);
                walk(n, el);
            });
        })(doc.body.firstChild, out);
        return out.innerHTML;
    }

    function isMso(p) {
        return p.tagName === "P" &&
            (/mso-list/i.test(p.getAttribute("style") || "") ||
             !!p.querySelector('span[style*="mso-list"]'));
    }

    function msoInfo(p) {
        const marker = p.querySelector('span[style*="mso-list"]');
        // Word puts the font on an ancestor of the mso-list span, so walk up
        // for it. The glyph itself is the reliable signal: Wingdings maps the
        // tick to u00fc and the ticked box to u00fe.
        let fonts = "";
        let n = marker;
        while (n && n !== p) { fonts += " " + (n.getAttribute("style") || ""); n = n.parentElement; }
        const probe = (p.getAttribute("style") || "") + " " + fonts;
        const lvl = /level(\d+)/i.exec(probe);
        const txt = marker ? (marker.textContent || "").replace(/\u00a0/g, " ").trim() : "";
        let kind = "ul";
        if (/^[\u00fc\u00fe\u2713\u2714]/.test(txt)) kind = "check";
        else if (/^(\d+|[a-zA-Z]|[ivxIVX]+)[.)]/.test(txt)) kind = "ol";
        return { level: lvl ? parseInt(lvl[1], 10) : 1, kind: kind, marker: marker };
    }

    function listOpen(kind) {
        const list = document.createElement(kind === "ol" ? "ol" : "ul");
        if (kind === "check") list.className = "lzbe-check";
        return list;
    }

    function normalizeWordLists(root) {
        const kids = Array.prototype.slice.call(root.children);
        let i = 0;
        while (i < kids.length) {
            if (!isMso(kids[i])) { i++; continue; }

            let j = i;
            const run = [];
            while (j < kids.length && isMso(kids[j])) { run.push(kids[j]); j++; }

            const holder = document.createElement("div");
            const stack = [];
            run.forEach((q) => {
                const info = msoInfo(q);
                if (info.marker) info.marker.remove();
                while (stack.length > info.level) stack.pop();
                while (stack.length < info.level) {
                    const list = listOpen(info.kind);
                    const top = stack[stack.length - 1];
                    (top ? (top.lastElementChild || top) : holder).appendChild(list);
                    stack.push(list);
                }
                const li = document.createElement("li");
                li.innerHTML = q.innerHTML;
                stack[stack.length - 1].appendChild(li);
            });

            while (holder.firstChild) root.insertBefore(holder.firstChild, run[0]);
            run.forEach((q) => q.remove());
            i = j;
        }
    }

    function plainToLists(text) {
        const lines = String(text).replace(/\r\n|\r/g, "\n").split("\n");
        const out = document.createElement("div");
        const stack = [];
        const RE = /^([ \t\u00a0]*)([-*\u2022\u2713\u2714]|\d+[.)]|[a-zA-Z][.)])[ \t]+(.*)$/;

        lines.forEach((raw) => {
            const m = RE.exec(raw);
            if (!m) {
                stack.length = 0;
                const t = raw.trim();
                if (!t) return;
                const p = document.createElement("p");
                p.textContent = t;
                out.appendChild(p);
                return;
            }
            const level = Math.floor(m[1].replace(/\t/g, "  ").length / 2) + 1;
            const tok = m[2];
            const kind = /^[\u2713\u2714]/.test(tok) ? "check"
                : (/^(\d+|[a-zA-Z])[.)]/.test(tok) ? "ol" : "ul");
            while (stack.length > level) stack.pop();
            while (stack.length < level) {
                const list = listOpen(kind);
                const top = stack[stack.length - 1];
                (top ? (top.lastElementChild || top) : out).appendChild(list);
                stack.push(list);
            }
            const li = document.createElement("li");
            li.textContent = m[3];
            stack[stack.length - 1].appendChild(li);
        });
        return out.innerHTML;
    }

    // Ticks are real characters, not a CSS pseudo-element, so they survive
    // the round trip through Postgres and copy back out to Word intact.
    function toggleTicks(i, el) {
        const lists = el.querySelectorAll("ul");
        if (!lists.length) {
            alert("This block has no bulleted list to tick.");
            return;
        }
        const on = !lists[0].classList.contains("lzbe-check");
        lists.forEach((ul) => {
            ul.classList.toggle("lzbe-check", on);
            Array.prototype.forEach.call(ul.children, (li) => {
                if (li.tagName !== "LI") return;
                const first = li.firstElementChild;
                if (first && first.tagName === "SPAN" && first.classList.contains("tick")) {
                    first.remove();
                }
                li.innerHTML = li.innerHTML.replace(/^(?:\s|&nbsp;)*[\u2713\u2714](?:\s|&nbsp;)*/, "");
                if (on) {
                    const s = document.createElement("span");
                    s.className = "tick";
                    s.textContent = "\u2713";
                    li.insertBefore(document.createTextNode(" "), li.firstChild);
                    li.insertBefore(s, li.firstChild);
                }
            });
        });
        blocks[i].body = sanitizeHtml(el.innerHTML);
        el.innerHTML = blocks[i].body;
    }

    function onPaste(e) {
        e.preventDefault();
        const dt = e.clipboardData || window.clipboardData;
        if (!dt) return;
        const html = dt.getData("text/html");
        const plain = dt.getData("text/plain") || "";
        let cleaned = "";
        try {
            if (html) {
                const doc = new DOMParser().parseFromString(html, "text/html");
                normalizeWordLists(doc.body);
                cleaned = sanitizeHtml(doc.body.innerHTML);
            } else {
                cleaned = plainToLists(plain);
            }
        } catch (err) {
            console.error("paste normalise:", err);
        }
        if (!textOf(cleaned).trim()) cleaned = plainToLists(plain);
        document.execCommand("insertHTML", false, cleaned);
    }

    function render() {
        const list = document.getElementById("lzbe-list");
        if (!list) return;
        list.innerHTML = "";

        blocks.forEach((b, i) => {
            const row = document.createElement("div");
            row.className = "lzbe-row";

            const head = document.createElement("div");
            head.className = "lzbe-head";
            head.innerHTML = `<span class="lzbe-type">${b.type}</span>`;

            const ctrl = document.createElement("span");
            ctrl.className = "lzbe-ctrl";
            ctrl.innerHTML =
                `<button type="button" data-a="up" data-i="${i}">↑</button>` +
                `<button type="button" data-a="down" data-i="${i}">↓</button>` +
                `<button type="button" data-a="del" data-i="${i}">✕</button>`;
            head.appendChild(ctrl);
            row.appendChild(head);

            if (b.type === "image") {
                const img = document.createElement("img");
                img.src = b.image_url;
                img.className = "lzbe-thumb";
                row.appendChild(img);

                const alt = document.createElement("input");
                alt.type = "text";
                alt.placeholder = "Alt text (describes the image)";
                alt.value = b.alt_text || "";
                alt.addEventListener("input", (e) => { blocks[i].alt_text = e.target.value; });
                row.appendChild(alt);

                const dim = document.createElement("div");
                dim.className = "lzbe-dim";
                dim.textContent = `${b.image_width} × ${b.image_height}`;
                row.appendChild(dim);
            } else if (b.type === "heading") {
                const ta = document.createElement("textarea");
                ta.rows = 1;
                ta.placeholder = "Section heading";
                ta.value = b.body || "";
                ta.addEventListener("input", (e) => { blocks[i].body = e.target.value; });
                row.appendChild(ta);
            } else {
                const ed = document.createElement("div");
                ed.className = "lzbe-rich";
                ed.contentEditable = "true";
                ed.dataset.ph = "Paragraph text \u2014 paste from Word or Docs and lists, ticks and levels are kept";
                ed.innerHTML = /<[a-z][\s\S]*>/i.test(b.body || "")
                    ? sanitizeHtml(b.body)
                    : plainToHtml(b.body || "");
                ed.addEventListener("paste", onPaste);
                ed.addEventListener("input", () => { blocks[i].body = ed.innerHTML; });
                ed.addEventListener("blur", () => {
                    blocks[i].body = sanitizeHtml(ed.innerHTML);
                    ed.innerHTML = blocks[i].body;
                });
                row.appendChild(ed);

                const tickBar = document.createElement("div");
                tickBar.className = "lzbe-tickbar";
                const tb = document.createElement("button");
                tb.type = "button";
                tb.textContent = "\u2713 Tick list";
                tb.title = "Turn the bullets in this block into ticks";
                tb.addEventListener("click", () => toggleTicks(i, ed));
                tickBar.appendChild(tb);
                row.appendChild(tickBar);
            }

            list.appendChild(row);
        });

        if (!blocks.length) {
            list.innerHTML = '<p class="lzbe-empty">No blocks yet. The plain description will be shown instead.</p>';
        }
    }

    function shell() {
        host.innerHTML = `
            <div class="lzbe">
                <div class="lzbe-bar">
                    <strong>Description blocks</strong>
                    <span>
                        <button type="button" data-add="heading">+ Heading</button>
                        <button type="button" data-add="text">+ Text</button>
                        <button type="button" data-add="image">+ Image</button>
                    </span>
                </div>
                <div id="lzbe-busy" class="lzbe-busy"></div>
                <div id="lzbe-list"></div>
                <input type="file" id="lzbe-file" accept="image/*" hidden>
            </div>`;

        host.querySelectorAll("[data-add]").forEach((b) => {
            b.addEventListener("click", () => addBlock(b.dataset.add));
        });

        document.getElementById("lzbe-file").addEventListener("change", (e) => {
            handleFile(e.target.files[0]);
            e.target.value = "";
        });

        document.getElementById("lzbe-list").addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-a]");
            if (!btn) return;
            const i = parseInt(btn.dataset.i, 10);
            if (btn.dataset.a === "up") move(i, -1);
            else if (btn.dataset.a === "down") move(i, 1);
            else if (btn.dataset.a === "del") remove(i);
        });
    }

    async function mount(container, productId, opts) {
        if (opts && opts.tokenKey) tokenKey = opts.tokenKey;
        host = container;
        host.dataset.productId = productId || "";
        blocks = [];
        shell();

        if (productId) {
            try {
                const res = await fetch(`/api/products/${productId}/description-blocks`);
                if (res.ok) {
                    const rows = await res.json();
                    blocks = rows.map((r) => ({
                        type: r.type,
                        body: r.body,
                        image_url: r.image_url,
                        image_width: r.image_width,
                        image_height: r.image_height,
                        alt_text: r.alt_text
                    }));
                }
            } catch (err) {
                console.error("load blocks:", err);
            }
        }
        render();
    }

    // Validates, then PUTs the whole array. Position comes from array order.
    async function save(productId) {
        const id = productId || (host && host.dataset.productId);
        if (!id) return { ok: false, message: "No product id" };

        for (const [i, b] of blocks.entries()) {
            if (b.type === "text") b.body = sanitizeHtml(b.body || "");
            if (b.type !== "image" && !textOf(b.body).trim()) {
                return { ok: false, message: `Block ${i + 1} (${b.type}) is empty` };
            }
        }

        const res = await fetch(`/api/products/${id}/description-blocks`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token()}`
            },
            body: JSON.stringify({ blocks })
        });

        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            return { ok: false, message: e.message || "Save failed" };
        }
        return { ok: true };
    }

    global.LzBlockEditor = { mount, save, get blocks() { return blocks; } };
})(window);
