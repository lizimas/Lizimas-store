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
        const productId = host.dataset.productId;
        if (!productId) {
            alert("Save the product first, then add description images.");
            return;
        }

        setBusy(1);
        try {
            const prepared = typeof preparePickedFile === "function"
                ? await preparePickedFile(file)
                : { ok: true, file };
            if (!prepared.ok) throw new Error(prepared.reason || "File could not be read");

            const fd = new FormData();
            fd.append("image", prepared.file || file);

            const res = await fetch(`/api/products/${productId}/description-blocks/image`, {
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
            } else {
                const ta = document.createElement("textarea");
                ta.rows = b.type === "heading" ? 1 : 4;
                ta.placeholder = b.type === "heading" ? "Section heading" : "Paragraph text";
                ta.value = b.body || "";
                ta.addEventListener("input", (e) => { blocks[i].body = e.target.value; });
                row.appendChild(ta);
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
            if (b.type !== "image" && !(b.body || "").trim()) {
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
