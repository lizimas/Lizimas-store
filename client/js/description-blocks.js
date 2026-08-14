// Renders product_description_blocks under the Description heading.
// If a product has no blocks, we leave the plain <p id="pd-description">
// alone and do nothing — full backwards compatibility.
(function () {
    const mount = document.getElementById("pd-desc-blocks");
    if (!mount) return;

    const productId = new URLSearchParams(location.search).get("id");
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

    const PDB_TAGS = ["P","BR","STRONG","B","EM","I","U","UL","OL","LI"];

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
                const el = document.createElement(n.tagName.toLowerCase());
                if (n.tagName === "UL" && n.classList.contains("lzbe-check")) {
                    el.className = "lzbe-check";
                }
                to.appendChild(el);
                walk(n, el);
            });
        })(doc.body.firstChild, out);
        return out.innerHTML;
    }

    function render(blocks) {
        const frag = document.createDocumentFragment();
        blocks.forEach((b) => {
            if (b.type === "image") {
                frag.appendChild(imageEl(b));
            } else if (b.type === "heading") {
                const h = document.createElement("h3");
                h.className = "pdb-heading";
                h.textContent = b.body;
                frag.appendChild(h);
            } else if (/<(p|ul|ol|li|br|strong|em|b|i|u)\b/i.test(b.body || "")) {
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
