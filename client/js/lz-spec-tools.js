// Specifications helpers shared by every product form (admin, staff
// product + manager, vendor desktop + mobile) - Ryan, Sept 2026.
//
// Two alternatives that both end in "Add to Specifications", which appends
// Label/Value rows to the form's own spec list:
//   1. Paste from Excel - a text box. Understands tab-separated rows,
//      "Label: Value", "Label   Value" (2+ spaces), AND the common
//      copy-from-a-web-page shape where each label and value land on their
//      own line (Os / iOS / Nfc / NFC with reader mode ...), which it pairs
//      up alternately.
//   2. Insert Table - the Jumia-style table (client/js/lz-table.js): pick a
//      size, type or paste into it, use the Column / Row / Merge tools, then
//      Add to Specifications. First column = label, remaining columns =
//      value; the header row (when switched on) is treated as column titles
//      and skipped.
//
// Markup: <div class="lz-spec-tools" data-add="addSpecRow" data-table-id="admin-specs-table-wrap"></div>
// data-add names the page's existing global addXxxSpecRow(label, value).
// data-table-id keeps the id the page's reset code already clears.

(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LzSpecTools = api;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const SEP_RE = /\t|^[^:]+:\s*\S|^.+?\s{2,}\S/;

    function splitLine(line) {
        if (line.includes("\t")) {
            const parts = line.split("\t").map((p) => p.trim());
            return { label: parts[0] || "", value: parts.slice(1).filter(Boolean).join(" ") };
        }
        let m = line.match(/^([^:]+):\s*(.+)$/);
        if (m) return { label: m[1].trim(), value: m[2].trim() };
        m = line.match(/^(.+?)\s{2,}(.+)$/);
        if (m) return { label: m[1].trim(), value: m[2].trim() };
        return { label: line.trim(), value: "" };
    }

    // Text box -> [{label, value}]
    function parseSpecText(text) {
        const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
        if (!lines.length) return [];
        const anyTab = lines.some((l) => l.includes("\t"));
        const allSeparated = lines.every((l) => SEP_RE.test(l.trim()));
        if (anyTab || allSeparated) return lines.map(splitLine).filter((s) => s.label);
        // No separators anywhere: one label line, then its value line.
        const out = [];
        for (let i = 0; i < lines.length; i += 2) {
            out.push({ label: lines[i].trim(), value: (lines[i + 1] || "").trim() });
        }
        return out;
    }

    // LzTable model -> [{label, value}]
    function tableToSpecs(model) {
        const T = (typeof LzTable !== "undefined" && LzTable) || require("./lz-table.js");
        const checked = T.normalize(model);
        if (!checked.ok) return [];
        const m = checked.model;
        const occ = T.occupancy(m);
        const out = [];
        for (let r = m.header_row ? 1 : 0; r < m.rows; r++) {
            const labelCell = m.cells[occ[r][0]];
            const label = labelCell ? labelCell.text.replace(/\s*\n\s*/g, " ").trim() : "";
            const seen = new Set([occ[r][0]]);
            const values = [];
            for (let c = 1; c < m.cols; c++) {
                const i = occ[r][c];
                if (seen.has(i)) continue;
                seen.add(i);
                const a = m.cells[i];
                // A value merged down across rows is used once, on its first row.
                if (a.r !== r) continue;
                const t = a.text.replace(/\s*\n\s*/g, " ").trim();
                if (t) values.push(t);
            }
            if (label) out.push({ label, value: values.join(" ") });
        }
        return out;
    }

    function mount(host) {
        if (!host || host.dataset.lzMounted) return;
        host.dataset.lzMounted = "1";
        const addName = host.dataset.add;
        const tableId = host.dataset.tableId || "";
        const add = (label, value) => {
            const fn = window[addName];
            if (typeof fn === "function") fn(label, value);
        };
        const status = (msg) => { const s = host.querySelector(".lzs-status"); if (s) { s.textContent = msg; setTimeout(() => { if (s.textContent === msg) s.textContent = ""; }, 4000); } };

        host.innerHTML = `
            <div class="lzs-block">
                <div class="lzs-title">Paste from Excel</div>
                <p class="lzs-hint">Paste rows below &mdash; one spec per line with a tab or colon between label and value, or label and value on alternate lines. Then click Add to Specifications.</p>
                <textarea class="lzs-text" rows="6" spellcheck="false" aria-label="Paste specifications"></textarea>
                <div class="lzs-actions">
                    <button type="button" class="lzs-btn lzs-btn-primary" data-act="add-text">Add to Specifications</button>
                    <button type="button" class="lzs-btn" data-act="clear-text">Clear</button>
                </div>
            </div>
            <div class="lzs-or"><span>or</span></div>
            <div class="lzs-block">
                <div class="lzs-title">Insert Table</div>
                <p class="lzs-hint">Pick a table size, type or paste into it, use the table tools (header row/column, insert, delete, merge, split), then Add to Specifications. First column = label, other columns = value.</p>
                <div class="lzs-picker-wrap">
                    <button type="button" class="lzs-btn lzs-btn-navy" data-act="picker" aria-haspopup="true">&#9638; Insert Table</button>
                    <div class="lzs-picker" hidden>
                        <div class="lzs-grid"></div>
                        <div class="lzs-grid-label">Select size</div>
                    </div>
                </div>
                <div class="lzs-table"${tableId ? ` id="${tableId}"` : ""}></div>
            </div>
            <div class="lzs-status" role="status"></div>`;

        const ta = host.querySelector(".lzs-text");
        const tableHost = host.querySelector(".lzs-table");
        const picker = host.querySelector(".lzs-picker");
        const grid = host.querySelector(".lzs-grid");
        const gridLabel = host.querySelector(".lzs-grid-label");
        let editor = null;

        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "lzs-grid-cell";
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.setAttribute("aria-label", `${c + 1} x ${r + 1} table`);
            grid.appendChild(cell);
        }
        const highlight = (r, c) => {
            grid.querySelectorAll(".lzs-grid-cell").forEach((x) => x.classList.toggle("lzs-on", +x.dataset.r <= r && +x.dataset.c <= c));
            gridLabel.textContent = `${c + 1} x ${r + 1}`;
        };
        grid.addEventListener("mouseover", (e) => { const x = e.target.closest(".lzs-grid-cell"); if (x) highlight(+x.dataset.r, +x.dataset.c); });
        grid.addEventListener("focusin", (e) => { const x = e.target.closest(".lzs-grid-cell"); if (x) highlight(+x.dataset.r, +x.dataset.c); });
        grid.addEventListener("click", (e) => {
            const x = e.target.closest(".lzs-grid-cell");
            if (!x) return;
            picker.hidden = true;
            const model = LzTable.create(+x.dataset.r + 1, +x.dataset.c + 1);
            editor = LzTable.edit(tableHost, model);
            const actions = document.createElement("div");
            actions.className = "lzs-actions";
            actions.innerHTML = `<button type="button" class="lzs-btn lzs-btn-primary" data-act="add-table">Add to Specifications</button><button type="button" class="lzs-btn" data-act="clear-table">Clear table</button>`;
            tableHost.appendChild(actions);
            const first = tableHost.querySelector(".lzt-in");
            if (first) first.focus();
        });
        document.addEventListener("click", (e) => { if (!picker.hidden && !e.target.closest(".lzs-picker-wrap")) picker.hidden = true; });

        host.addEventListener("click", (e) => {
            const b = e.target.closest("[data-act]");
            if (!b) return;
            const act = b.dataset.act;
            if (act === "picker") { picker.hidden = !picker.hidden; return; }
            if (act === "clear-text") { ta.value = ""; return; }
            if (act === "clear-table") { tableHost.innerHTML = ""; editor = null; return; }
            if (act === "add-text") {
                const specs = parseSpecText(ta.value);
                if (!specs.length) { status("Paste some rows first."); return; }
                specs.forEach((s) => add(s.label, s.value));
                ta.value = "";
                status(`${specs.length} specification${specs.length === 1 ? "" : "s"} added.`);
                return;
            }
            if (act === "add-table") {
                // editor.model is gone if the page's own reset cleared the
                // table host - nothing to add then.
                if (!editor || !tableHost.querySelector(".lzt-editor")) return;
                const specs = tableToSpecs(editor.model);
                if (!specs.length) { status("Type a label in the first column of at least one row."); return; }
                specs.forEach((s) => add(s.label, s.value));
                tableHost.innerHTML = "";
                editor = null;
                status(`${specs.length} specification${specs.length === 1 ? "" : "s"} added.`);
            }
        });
    }

    function mountAll() {
        if (typeof document === "undefined") return;
        document.querySelectorAll(".lz-spec-tools").forEach(mount);
    }
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
        else mountAll();
    }

    return { parseSpecText, tableToSpecs, mount, mountAll };
});
