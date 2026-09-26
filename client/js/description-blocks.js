// Renders product_description_blocks under the Description heading.
// If a product has no blocks, we leave the plain <p id="pd-description">
// alone and do nothing — full backwards compatibility.
// Also exposed as window.LzDescBlocks.render(mountEl, blocks) so the admin
// panel's read-only product view shows blocks exactly as shoppers see them.
(function () {

    // Cloudinary transform: resize + auto format/quality, skipped for any
    // URL that isn't Cloudinary so external images still render.
    function cld(url, width) {
        if (!url || url.indexOf("/upload/") === -1) return url;
        if (url.indexOf("res.cloudinary.com") === -1) return url;
        return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
    }

    function imageEl(b) {
        let payload = b.payload || {};
        if (typeof payload === "string") {
            try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
        }
        const wrap = document.createElement("div");
        wrap.className = payload.full_width ? "pdb-img pdb-img-full" : "pdb-img";
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

    // Same YouTube/Vimeo URL -> embeddable iframe src logic the editor
    // uses (client/js/description-block-editor.js's lzbeVideoEmbedUrl) -
    // duplicated rather than shared since this file loads standalone on
    // the public product page, with no editor script alongside it.
    function videoEmbedUrl(url) {
        const u = String(url || "").trim();
        let m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/i.exec(u);
        if (m) return `https://www.youtube.com/embed/${m[1]}`;
        m = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(u);
        if (m) return `https://player.vimeo.com/video/${m[1]}`;
        return null;
    }

    function videoEl(b) {
        const wrap = document.createElement("div");
        wrap.className = "pdb-video";
        const embed = videoEmbedUrl(b.image_url);
        if (embed) {
            // 16:9 responsive embed - the aspect-ratio box keeps the layout
            // stable before the iframe itself loads, same idea as imageEl()
            // reserving space via image_width/image_height.
            wrap.style.aspectRatio = "16 / 9";
            const iframe = document.createElement("iframe");
            iframe.src = embed;
            iframe.loading = "lazy";
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            iframe.allowFullscreen = true;
            iframe.style.width = "100%";
            iframe.style.height = "100%";
            iframe.style.border = "0";
            wrap.appendChild(iframe);
        } else {
            const video = document.createElement("video");
            video.src = b.image_url;
            video.controls = true;
            video.style.width = "100%";
            wrap.appendChild(video);
        }
        return wrap;
    }

    function linkEl(b) {
        const a = document.createElement("a");
        a.className = "pdb-link";
        a.href = b.image_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer nofollow";
        a.textContent = pdbDecode(b.body || b.image_url);
        return a;
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
        section.className = payload.full_width ? "pdb-grid-section pdb-grid-full" : "pdb-grid-section";

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

        // Wraps an already-built element in a clickable <a>, in place.
        function wrapInLink(el, url) {
            const a = document.createElement("a");
            a.className = "pdb-grid-link";
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer nofollow";
            el.parentNode.insertBefore(a, el);
            a.appendChild(el);
            return a;
        }

        // Builds a grid item's image/video area. A video (if set) can
        // replace the image, or sit above/below it, per item.video_placement.
        function gridItemMediaEl(item) {
            const wrap = document.createElement("div");
            wrap.className = "pdb-grid-media";
            const embed = item.video_url ? videoEmbedUrl(item.video_url) : null;
            const isDirectVideo = !embed && item.video_url && /\.(mp4|webm|mov)(\?|$)/i.test(item.video_url);
            const hasVideo = !!(embed || isDirectVideo);

            function appendVideo() {
                const vwrap = document.createElement("div");
                vwrap.className = "pdb-grid-video";
                if (embed) {
                    const iframe = document.createElement("iframe");
                    iframe.src = embed;
                    iframe.loading = "lazy";
                    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                    iframe.allowFullscreen = true;
                    iframe.style.width = "100%";
                    iframe.style.height = "100%";
                    iframe.style.border = "0";
                    vwrap.appendChild(iframe);
                } else {
                    const video = document.createElement("video");
                    video.src = item.video_url;
                    video.controls = true;
                    video.style.width = "100%";
                    vwrap.appendChild(video);
                }
                wrap.appendChild(vwrap);
            }

            function appendImage() {
                if (!item.image_url) return;
                wrap.appendChild(
                    imageEl({
                        image_url: item.image_url,
                        image_width: item.image_width,
                        image_height: item.image_height,
                        alt_text: item.alt_text || item.caption || ""
                    })
                );
            }

            if (hasVideo) {
                const placement = item.video_placement || "replace";
                if (placement === "above") { appendVideo(); appendImage(); }
                else if (placement === "below") { appendImage(); appendVideo(); }
                else { appendVideo(); }
            } else {
                appendImage();
            }

            return wrap.childNodes.length ? wrap : null;
        }

        items.forEach((item) => {
            const cell = document.createElement("div");
            cell.className = "pdb-grid-cell";

            const mediaEl = gridItemMediaEl(item);
            if (mediaEl) cell.appendChild(mediaEl);

            let capEl = null;
            if (item.caption) {
                capEl = document.createElement("div");
                capEl.className = "pdb-grid-caption";
                capEl.textContent = pdbDecode(item.caption);
                cell.appendChild(capEl);
            }

            if (item.body) {
                const body = document.createElement("div");
                body.className = "pdb-grid-body";
                body.innerHTML = pdbSanitize(item.body);
                cell.appendChild(body);
            }

            // Optional link: wraps the whole tile, just the media, or just
            // the caption, per the placement chosen in the editor.
            if (item.link_url) {
                const placement = item.link_placement || "whole";
                if (placement === "media" && mediaEl) {
                    wrapInLink(mediaEl, item.link_url);
                } else if (placement === "caption" && capEl) {
                    wrapInLink(capEl, item.link_url);
                } else {
                    const a = document.createElement("a");
                    a.className = "pdb-grid-link pdb-grid-link-whole";
                    a.href = item.link_url;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer nofollow";
                    while (cell.firstChild) a.appendChild(cell.firstChild);
                    cell.appendChild(a);
                }
            }

            grid.appendChild(cell);
        });

        section.appendChild(grid);
        return section;
    }

    function render(blocks, mount) {
        const frag = document.createDocumentFragment();
        blocks.forEach((b) => {
            if (b.type === "image") {
                frag.appendChild(imageEl(b));
                if (b.body && String(b.body).trim()) {
                    const cap = document.createElement("div");
                    cap.className = "pdb-caption";
                    cap.textContent = pdbDecode(b.body);
                    frag.appendChild(cap);
                }
            } else if (b.type === "heading") {
                const h = document.createElement("h3");
                h.className = "pdb-heading";
                h.textContent = pdbDecode(b.body);
                frag.appendChild(h);
            } else if (b.type === "grid") {
                frag.appendChild(gridEl(b));
            } else if (b.type === "video") {
                frag.appendChild(videoEl(b));
                if (b.body && String(b.body).trim()) {
                    const cap = document.createElement("div");
                    cap.className = "pdb-caption";
                    cap.textContent = pdbDecode(b.body);
                    frag.appendChild(cap);
                }
            } else if (b.type === "link") {
                frag.appendChild(linkEl(b));
            } else if (b.type === "table") {
                // Built with client/js/lz-table.js; toHtml escapes every cell.
                if (window.LzTable && b.payload) {
                    const checked = window.LzTable.normalize(b.payload);
                    if (checked.ok) {
                        const wrap = document.createElement("div");
                        wrap.className = "pdb-table-wrap";
                        wrap.innerHTML = window.LzTable.toHtml(checked.model, "pdb-table");
                        frag.appendChild(wrap);
                    }
                }
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
    }

    window.LzDescBlocks = { render: (mountEl, blocks) => render(blocks || [], mountEl) };

    const mount = document.getElementById("pd-desc-blocks");
    if (!mount) return;

    // Canonical URLs are /product/<slug>-<id>; legacy links use ?id=<id>.
    let productId = new URLSearchParams(location.search).get("id");
    if (!productId) {
        const m = location.pathname.match(/-(\d+)\/?$/);
        if (m) productId = m[1];
    }
    if (!productId) return;

    fetch(`/api/products/${encodeURIComponent(productId)}/description-blocks`)
        .then((r) => (r.ok ? r.json() : []))
        .then((blocks) => {
            if (Array.isArray(blocks) && blocks.length) {
                render(blocks, mount);
                // Blocks won — retire the legacy paragraph.
                const legacy = document.getElementById("pd-description");
                if (legacy) legacy.style.display = "none";
            }
        })
        .catch((err) => console.error("description-blocks:", err));
})();
