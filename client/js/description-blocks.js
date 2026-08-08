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
            } else {
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
