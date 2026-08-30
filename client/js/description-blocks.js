// Renders product_description_blocks under the Description heading.
// If a product has no blocks, we leave the plain <p id="pd-description">
// alone and do nothing — full backwards compatibility.
(function () {
    const mount = document.getElementById("pd-desc-blocks");
    if (!mount) return;

    // Canonical URLs are /product/<slug>-<id>; legacy links use ?id=<id>.
    let productId = new URLSearchParams(location.search).get("id");
    if (!productId) {
        const m = location.pathname.match(/-(\d+)\/?$/);
        if (m) productId = m[1];
    }
    if (!productId) return;

    // Cloudinary transform: resize + auto format/quality, skipped for any
    // URL that isn't Cloudinary so external images still render.
    function cld(url, width) {
        if (!url || url.indexOf("/upload/") === -1) return url;
        if (url.indexOf("res.cloudinary.com") === -1) return url;
        return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
    }

    function imageEl(b) {
        const wrap = document.createElement("div");
        wrap.className = "pdb-img";
        // Reserve the space before load so the page doesn't jump.
        if (b.image_width && b.image_height) {
            wrap.style.aspectRatio = `${b.image_width} / ${b.image_height}`;
        }
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = b.alt_text || "";
        img.src = cld(b.image_url, 800);
        img.srcset = [400, 800, 1200]
            .map((w) => `${cld(b.image_url, w)} ${w}w`)
            .join(", ");
        img.sizes = "(max-width: 700px) 100vw, 700px";
        wrap.appendChild(img);
        return wrap;
    }

    const PDB_TAGS = ["P","BR","STRONG","B","EM","I","U","UL","OL","LI","SPAN"];

    // Bodies are staff-authored HTML, but re-sanitised on the way out too.
    function pdbSanitize(html) {
        const doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
        const out = document.createElement("div");
        (function walk(from, to) {
            from.childNodes.forEach((n) => {
                if (n.nodeType === 3) {
                    to.appendChild(document.createTextNode(n.nodeValue));
                    return;
                }
                if (n.nodeType !== 1) return;
                if (PDB_TAGS.indexOf(n.tagName) === -1) { walk(n, to); return; }
                if (n.tagName === "SPAN" && !n.classList.contains("tick")) { walk(n, to); return; }
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

    // Bodies are stored as HTML, so "&" lives as "&amp;". For plain-text
    // targets (headings, captions) decode entities without allowing markup:
    // parse into a detached node, then read the text straight back out.
    function pdbDecode(s) {
        const d = document.createElement("div");
        d.innerHTML = String(s || "");
        return d.textContent || "";
    }

    // A multi-column feature grid. Per-column items ride in the JSONB
    // payload rather than as sibling rows, so a column's image and its
    // caption can never drift apart during reordering.
    function gridEl(b) {
        let payload = b.payload || {};
        if (typeof payload === "string") {
            try {
                payload = JSON.parse(payload);
            } catch (e) {
                payload = {};
            }
        }

        const items = Array.isArray(payload.items) ? payload.items : [];
        const section = document.createElement("section");
        section.className = "pdb-grid-section";

        if (payload.heading) {
            const h = document.createElement("h3");
            h.className = "pdb-heading";
            h.textContent = payload.heading;
            section.appendChild(h);
        }

        const grid = document.createElement("div");
        grid.className = "pdb-grid";

        const requested = parseInt(payload.columns, 10) || items.length;
        const cols = Math.min(Math.max(requested, 1), 8);
        grid.style.setProperty("--pdb-grid-cols", cols);

        items.forEach((item) => {
            const cell = document.createElement("div");
            cell.className = "pdb-grid-cell";

            if (item.image_url) {
                cell.appendChild(
                    imageEl({
                        image_url: item.image_url,
                        image_width: item.image_width,
                        image_height: item.image_height,
                        alt_text: item.alt_text || item.caption || ""
                    })
                );
            }

            if (item.caption) {
                const cap = document.createElement("div");
                cap.className = "pdb-grid-caption";
                cap.textContent = pdbDecode(item.caption);
                cell.appendChild(cap);
            }

            if (item.body) {
                const body = document.createElement("div");
                body.className = "pdb-grid-body";
                body.innerHTML = pdbSanitize(item.body);
                cell.appendChild(body);
            }

            grid.appendChild(cell);
        });

        section.appendChild(grid);
        return section;
    }

    function render(blocks) {
        const frag = document.createDocumentFragment();
        blocks.forEach((b) => {
            if (b.type === "image") {
                frag.appendChild(imageEl(b));
            } else if (b.type === "heading") {
                const h = document.createElement("h3");
                h.className = "pdb-heading";
                h.textContent = pdbDecode(b.body);
                frag.appendChild(h);
            } else if (b.type === "grid") {
                frag.appendChild(gridEl(b));
            } else if (/<(p|ul|ol|li|br|strong|em|b|i|u)\b/i.test(b.body || "") ||
                       /&(amp|lt|gt|quot|apos|nbsp|#\d+);/i.test(b.body || "")) {
                const d = document.createElement("div");
                d.className = "pdb-text";
                d.innerHTML = pdbSanitize(b.body);
                frag.appendChild(d);
            } else {
                // Legacy plain-text blocks, authored before rich paste existed.
                const p = document.createElement("p");
                p.className = "pdb-text";
                p.textContent = b.body;
                frag.appendChild(p);
            }
        });
        mount.appendChild(frag);

        // Blocks won — retire the legacy paragraph.
        const legacy = document.getElementById("pd-description");
        if (legacy) legacy.style.display = "none";
    }

    fetch(`/api/products/${encodeURIComponent(productId)}/description-blocks`)
        .then((r) => (r.ok ? r.json() : []))
        .then((blocks) => {
            if (Array.isArray(blocks) && blocks.length) render(blocks);
        })
        .catch((err) => console.error("description-blocks:", err));
})();
