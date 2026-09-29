// Admin › Products › Import / Export › "Photos by SKU" (Sept 2026).
// Pick a folder (or files) of photos named by SKU - "YD-8981_1.jpg",
// "YD-8981_2_800x800.jpg", or "YD-8981/1.jpg". Photos are grouped by SKU,
// ordered by their number (the first is the main photo) and sent one product
// at a time to /api/admin/products/photos-by-sku, which only touches
// Lizimas' own products. Uses getToken / API_URL / pdEsc from admin.js.
(function () {
    const MAX_BYTES = 5 * 1024 * 1024;
    const MAX_PER_SKU = 12;
    const PARALLEL = 3;
    let groups = [];      // [{ sku, files:[File], small, big:[names] }]
    let ignored = [];     // [{ name, reason }]
    let busy = false;
    let lastFiles = [];

    const el = (id) => document.getElementById(id);
    const esc = (s) => (typeof pdEsc === "function" ? pdEsc(s) : String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

    // Same rules as parsePhotoName on the server, plus "<SKU>/<n>.jpg".
    function parse(file) {
        const rel = file.webkitRelativePath || file.name;
        const parts = rel.split("/");
        const name = parts.pop();
        const folder = parts.length ? parts[parts.length - 1] : "";
        const base = name.replace(/\.(jpe?g|png|webp)$/i, "").trim();
        if (/^\d{1,3}$/.test(base) && folder) return { sku: folder.trim(), n: Number(base) };
        let m = base.match(/^(.+?)_(\d{1,3})(?:_.*)?$/);
        if (m) return { sku: m[1].trim(), n: Number(m[2]) };
        m = base.match(/^(.+?)\s*\((\d{1,3})\)$/);
        if (m) return { sku: m[1].trim(), n: Number(m[2]) };
        return base ? { sku: base, n: 1 } : null;
    }

    function group(fileList) {
        const skipSmall = el("pbs-skip-small") && el("pbs-skip-small").checked;
        const map = new Map();
        ignored = [];
        Array.from(fileList).forEach((f) => {
            const name = f.webkitRelativePath || f.name;
            if (/(^|\/)\./.test(name)) return; // .DS_Store, ._photo.jpg
            if (!/\.(jpe?g|png|webp)$/i.test(f.name)) { ignored.push({ name, reason: "not a JPG, PNG or WebP file" }); return; }
            if (f.size > MAX_BYTES) { ignored.push({ name, reason: "larger than 5MB" }); return; }
            const small = /_TOO-SMALL/i.test(f.name);
            if (small && skipSmall) { ignored.push({ name, reason: "marked TOO-SMALL (skipped)" }); return; }
            const p = parse(f);
            if (!p) { ignored.push({ name, reason: "no SKU in the file name" }); return; }
            const key = p.sku.toUpperCase();
            if (!map.has(key)) map.set(key, { sku: p.sku, items: [] });
            map.get(key).items.push({ file: f, n: p.n, small });
        });
        groups = Array.from(map.values()).map((g) => {
            g.items.sort((a, b) => a.n - b.n || a.file.name.localeCompare(b.file.name));
            const extra = g.items.slice(MAX_PER_SKU);
            extra.forEach((it) => ignored.push({ name: it.file.name, reason: `more than ${MAX_PER_SKU} photos for ${g.sku}` }));
            const items = g.items.slice(0, MAX_PER_SKU);
            return { sku: g.sku, files: items.map((it) => it.file), small: items.filter((it) => it.small).length };
        }).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    }

    function renderPreview() {
        const out = el("pbs-results");
        const btn = el("pbs-upload-btn");
        const photos = groups.reduce((n, g) => n + g.files.length, 0);
        btn.disabled = !groups.length;
        btn.textContent = groups.length ? `Upload photos for ${groups.length} product${groups.length === 1 ? "" : "s"}` : "Upload photos";
        if (!groups.length && !ignored.length) { out.innerHTML = ""; return; }
        let html = `<p style="margin:0 0 6px;"><b>${photos}</b> photo${photos === 1 ? "" : "s"} for <b>${groups.length}</b> SKU${groups.length === 1 ? "" : "s"}.`
            + (ignored.length ? ` ${ignored.length} file${ignored.length === 1 ? "" : "s"} left out.` : "") + "</p>";
        html += '<div style="max-height:260px; overflow-y:auto; border:1px solid #eee; border-radius:6px;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">';
        html += '<tr style="background:#fafafa; text-align:left;"><th style="padding:6px 8px;">SKU</th><th style="padding:6px 8px;">Photos</th><th style="padding:6px 8px;">Status</th></tr>';
        html += groups.map((g, i) =>
            `<tr style="border-top:1px solid #f2f2f2;"><td style="padding:5px 8px; font-weight:600;">${esc(g.sku)}</td>`
            + `<td style="padding:5px 8px;">${g.files.length}${g.small ? ` <span style="color:#B45309;">(${g.small} small)</span>` : ""}</td>`
            + `<td style="padding:5px 8px; color:#888;" id="pbs-row-${i}">Ready</td></tr>`).join("");
        html += "</table></div>";
        if (ignored.length) {
            html += '<details style="margin-top:8px;"><summary style="cursor:pointer; color:#666;">Files left out</summary><div style="max-height:160px; overflow-y:auto; padding:6px 0;">'
                + ignored.map((x) => `<div>${esc(x.name)} - ${esc(x.reason)}</div>`).join("") + "</div></details>";
        }
        out.innerHTML = html;
    }

    function setRow(i, html, colour) {
        const c = el(`pbs-row-${i}`);
        if (c) { c.innerHTML = html; c.style.color = colour || "#333"; }
    }

    async function sendOne(g, i, mode) {
        setRow(i, "Uploading...", "#666");
        const fd = new FormData();
        fd.append("sku", g.sku);
        fd.append("mode", mode);
        g.files.forEach((f) => fd.append("photos", f, f.name));
        try {
            const r = await fetch(`${API_URL}/api/admin/products/photos-by-sku`, {
                method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { setRow(i, esc(d.message || d.error || "Failed"), "#DC2626"); return "failed"; }
            const bits = [`✓ ${d.added} photo${d.added === 1 ? "" : "s"} on #${d.product_id}`];
            if (d.replaced) bits.push(`${d.replaced} old removed`);
            if (d.skipped && d.skipped.length) bits.push(`${d.skipped.length} skipped`);
            let html = esc(bits.join(" · "));
            const notes = (d.notes || []).concat((d.skipped || []).map((s) => ({ name: s.name, notes: [s.reason] })));
            if (notes.length) {
                html += `<details><summary style="cursor:pointer; color:#B45309;">${notes.length} note${notes.length === 1 ? "" : "s"}</summary>`
                    + notes.map((n) => `<div style="color:#555;">${esc(n.name)}: ${esc(n.notes.join("; "))}</div>`).join("") + "</details>";
            }
            setRow(i, html, "#16A34A");
            return "ok";
        } catch (e) {
            setRow(i, "Could not connect - try again", "#DC2626");
            return "failed";
        }
    }

    async function upload() {
        if (busy || !groups.length) return;
        const mode = el("pbs-mode").value === "add" ? "add" : "replace";
        busy = true;
        const btn = el("pbs-upload-btn");
        btn.disabled = true;
        const progress = el("pbs-progress");
        let done = 0, ok = 0, next = 0;
        const total = groups.length;
        const tick = () => { progress.textContent = `${done} of ${total} done${ok !== done ? ` - ${done - ok} not updated` : ""}`; };
        tick();
        const work = Array.from({ length: Math.min(PARALLEL, total) }, async () => {
            while (next < total) {
                const i = next++;
                if ((await sendOne(groups[i], i, mode)) === "ok") ok++;
                done++; tick();
            }
        });
        await Promise.all(work);
        progress.textContent = `Finished: ${ok} of ${total} products updated${ok < total ? ` - ${total - ok} not updated (reasons in the list)` : ""}.`;
        busy = false;
        btn.disabled = false;
        btn.textContent = "Upload again";
        if (typeof loadProducts === "function") loadProducts();
    }

    function pick(input) {
        if (busy) return;
        lastFiles = Array.from(input.files || []);
        group(lastFiles);
        el("pbs-progress").textContent = "";
        renderPreview();
        input.value = "";
    }

    window.pbsPick = pick;
    window.pbsUpload = upload;
    window.pbsRegroup = () => { if (busy || !lastFiles.length) return; group(lastFiles); el("pbs-progress").textContent = ""; renderPreview(); };
    window.__pbsParse = parse;
})();
