// Lizimas table block - model, operations, renderer and editor (Ryan, Sept
// 2026: "insert table" made fully functional, CKEditor/Jumia-style).
//
// Used by the description block editor (admin, staff and vendor product
// upload - client/js/description-block-editor.js) and the storefront
// renderer (client/js/description-blocks.js). The pure model functions are
// also required by the unit tests (test/lzTable.test.js).
//
// Model (stored as the block's payload JSON):
//   {
//     rows: 3, cols: 2,
//     header_row: true,       // first row rendered as <th> (bold)
//     header_col: false,      // first column rendered as <th> (bold)
//     cells: [ { r, c, rs, cs, text }, ... ]   // anchor cells only
//   }
// Every grid position is covered by exactly one anchor; merged cells are
// one anchor with rs/cs > 1. Cell text is plain text ("\n" = line break),
// never HTML, so nothing a seller types can inject markup.

(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LzTable = api;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const MAX_ROWS = 60;
    const MAX_COLS = 12;
    const MAX_TEXT = 1000;

    // ---- Model basics --------------------------------------------------

    function create(rows, cols, opts) {
        rows = clamp(rows, 1, MAX_ROWS);
        cols = clamp(cols, 1, MAX_COLS);
        const cells = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c, rs: 1, cs: 1, text: "" });
        return { rows, cols, header_row: !!(opts && opts.header_row), header_col: !!(opts && opts.header_col), cells };
    }

    function clamp(n, lo, hi) {
        n = Math.floor(Number(n) || 0);
        return Math.max(lo, Math.min(hi, n));
    }

    function clone(m) {
        return { rows: m.rows, cols: m.cols, header_row: !!m.header_row, header_col: !!m.header_col, cells: m.cells.map((x) => ({ ...x })) };
    }

    // grid[r][c] -> anchor index covering that position (or -1)
    function occupancy(m) {
        const grid = [];
        for (let r = 0; r < m.rows; r++) grid.push(new Array(m.cols).fill(-1));
        m.cells.forEach((a, i) => {
            for (let r = a.r; r < a.r + a.rs; r++) for (let c = a.c; c < a.c + a.cs; c++) {
                if (grid[r] && c < m.cols) grid[r][c] = i;
            }
        });
        return grid;
    }

    function anchorAt(m, r, c) {
        if (r < 0 || c < 0 || r >= m.rows || c >= m.cols) return null;
        const i = occupancy(m)[r][c];
        return i >= 0 ? m.cells[i] : null;
    }

    function sortCells(m) {
        m.cells.sort((a, b) => a.r - b.r || a.c - b.c);
        return m;
    }

    // Validates/normalises untrusted input (server side and on load).
    // Returns { ok, model } or { ok:false, error }.
    function normalize(input) {
        if (!input || typeof input !== "object") return { ok: false, error: "Table data is missing." };
        const rows = Math.floor(Number(input.rows));
        const cols = Math.floor(Number(input.cols));
        if (!(rows >= 1 && rows <= MAX_ROWS)) return { ok: false, error: `A table can have 1 to ${MAX_ROWS} rows.` };
        if (!(cols >= 1 && cols <= MAX_COLS)) return { ok: false, error: `A table can have 1 to ${MAX_COLS} columns.` };
        if (!Array.isArray(input.cells) || input.cells.length === 0) return { ok: false, error: "Table has no cells." };
        const cells = [];
        const seen = [];
        for (let r = 0; r < rows; r++) seen.push(new Array(cols).fill(false));
        for (const raw of input.cells) {
            const a = {
                r: Math.floor(Number(raw && raw.r)),
                c: Math.floor(Number(raw && raw.c)),
                rs: Math.floor(Number(raw && raw.rs)) || 1,
                cs: Math.floor(Number(raw && raw.cs)) || 1,
                text: String((raw && raw.text) == null ? "" : raw.text).replace(/\r/g, "").slice(0, MAX_TEXT)
            };
            if (!(a.r >= 0 && a.c >= 0 && a.rs >= 1 && a.cs >= 1 && a.r + a.rs <= rows && a.c + a.cs <= cols)) {
                return { ok: false, error: "Table cell is outside the table." };
            }
            for (let r = a.r; r < a.r + a.rs; r++) for (let c = a.c; c < a.c + a.cs; c++) {
                if (seen[r][c]) return { ok: false, error: "Table cells overlap." };
                seen[r][c] = true;
            }
            cells.push(a);
        }
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if (!seen[r][c]) return { ok: false, error: "Table has a gap - every position needs a cell." };
        }
        return { ok: true, model: sortCells({ rows, cols, header_row: !!input.header_row, header_col: !!input.header_col, cells }) };
    }

    function plainText(m) {
        return sortCells(clone(m)).cells.map((a) => a.text.trim()).filter(Boolean).join(" | ");
    }

    function hasContent(m) {
        return m.cells.some((a) => a.text.trim() !== "");
    }

    // ---- Rows -------------------------------------------------------------

    function insertRow(m, at) {
        if (m.rows >= MAX_ROWS) return m;
        at = clamp(at, 0, m.rows);
        const spanning = new Set();
        m.cells.forEach((a) => {
            if (a.r >= at) a.r += 1;
            else if (a.r + a.rs > at) { a.rs += 1; for (let c = a.c; c < a.c + a.cs; c++) spanning.add(c); }
        });
        for (let c = 0; c < m.cols; c++) if (!spanning.has(c)) m.cells.push({ r: at, c, rs: 1, cs: 1, text: "" });
        m.rows += 1;
        return sortCells(m);
    }

    function deleteRow(m, k) {
        if (m.rows <= 1 || k < 0 || k >= m.rows) return m;
        m.cells = m.cells.filter((a) => !(a.r === k && a.rs === 1));
        m.cells.forEach((a) => {
            if (a.r === k) a.rs -= 1;                    // starts here, spans down: keep, now one shorter
            else if (a.r < k && a.r + a.rs > k) a.rs -= 1; // spans across the deleted row
            else if (a.r > k) a.r -= 1;
        });
        m.rows -= 1;
        return sortCells(m);
    }

    // ---- Columns ----------------------------------------------------------

    function insertCol(m, at) {
        if (m.cols >= MAX_COLS) return m;
        at = clamp(at, 0, m.cols);
        const spanning = new Set();
        m.cells.forEach((a) => {
            if (a.c >= at) a.c += 1;
            else if (a.c + a.cs > at) { a.cs += 1; for (let r = a.r; r < a.r + a.rs; r++) spanning.add(r); }
        });
        for (let r = 0; r < m.rows; r++) if (!spanning.has(r)) m.cells.push({ r, c: at, rs: 1, cs: 1, text: "" });
        m.cols += 1;
        return sortCells(m);
    }

    function deleteCol(m, k) {
        if (m.cols <= 1 || k < 0 || k >= m.cols) return m;
        m.cells = m.cells.filter((a) => !(a.c === k && a.cs === 1));
        m.cells.forEach((a) => {
            if (a.c === k) a.cs -= 1;
            else if (a.c < k && a.c + a.cs > k) a.cs -= 1;
            else if (a.c > k) a.c -= 1;
        });
        m.cols -= 1;
        return sortCells(m);
    }

    // ---- Merge / split ------------------------------------------------------
    // Neighbour must line up exactly (same height for left/right, same width
    // for up/down), as in CKEditor - otherwise the option is disabled.

    function joinText(a, b) {
        return [a.text, b.text].map((t) => t.trim()).filter(Boolean).join("\n");
    }

    function neighbour(m, a, dir) {
        let n = null;
        if (dir === "right") n = anchorAt(m, a.r, a.c + a.cs);
        if (dir === "left") n = anchorAt(m, a.r, a.c - 1);
        if (dir === "down") n = anchorAt(m, a.r + a.rs, a.c);
        if (dir === "up") n = anchorAt(m, a.r - 1, a.c);
        if (!n || n === a) return null;
        if (dir === "right" || dir === "left") return n.r === a.r && n.rs === a.rs ? n : null;
        return n.c === a.c && n.cs === a.cs ? n : null;
    }

    function canMerge(m, a, dir) { return !!neighbour(m, a, dir); }

    // Returns the surviving anchor (top-left one) so the editor can keep focus.
    function merge(m, a, dir) {
        const n = neighbour(m, a, dir);
        if (!n) return a;
        const first = dir === "right" || dir === "down" ? a : n;
        const second = first === a ? n : a;
        if (dir === "right" || dir === "left") first.cs += second.cs;
        else first.rs += second.rs;
        first.text = joinText(first, second);
        m.cells.splice(m.cells.indexOf(second), 1);
        sortCells(m);
        return first;
    }

    // Split into two side-by-side cells. A cell already spanning columns is
    // halved; a single-column cell gets a new column inserted after it, with
    // every other cell in that column widened so the rest of the table is
    // unchanged (CKEditor behaviour).
    function splitVertical(m, a) {
        if (a.cs > 1) {
            const left = Math.ceil(a.cs / 2);
            m.cells.push({ r: a.r, c: a.c + left, rs: a.rs, cs: a.cs - left, text: "" });
            a.cs = left;
            return sortCells(m);
        }
        if (m.cols >= MAX_COLS) return m;
        const at = a.c + 1;
        m.cells.forEach((x) => {
            if (x === a) return;
            if (x.c >= at) x.c += 1;
            else if (x.c + x.cs > a.c) x.cs += 1;
        });
        m.cells.push({ r: a.r, c: at, rs: a.rs, cs: 1, text: "" });
        m.cols += 1;
        return sortCells(m);
    }

    function splitHorizontal(m, a) {
        if (a.rs > 1) {
            const top = Math.ceil(a.rs / 2);
            m.cells.push({ r: a.r + top, c: a.c, rs: a.rs - top, cs: a.cs, text: "" });
            a.rs = top;
            return sortCells(m);
        }
        if (m.rows >= MAX_ROWS) return m;
        const at = a.r + 1;
        m.cells.forEach((x) => {
            if (x === a) return;
            if (x.r >= at) x.r += 1;
            else if (x.r + x.rs > a.r) x.rs += 1;
        });
        m.cells.push({ r: at, c: a.c, rs: 1, cs: a.cs, text: "" });
        m.rows += 1;
        return sortCells(m);
    }

    // Resize to exactly rows x cols, adding/removing at the end.
    function setSize(m, rows, cols) {
        rows = clamp(rows, 1, MAX_ROWS);
        cols = clamp(cols, 1, MAX_COLS);
        while (m.rows < rows) insertRow(m, m.rows);
        while (m.rows > rows) deleteRow(m, m.rows - 1);
        while (m.cols < cols) insertCol(m, m.cols);
        while (m.cols > cols) deleteCol(m, m.cols - 1);
        return m;
    }

    // Would shrinking to rows x cols throw away typed text?
    function wouldLoseText(m, rows, cols) {
        return m.cells.some((a) => a.text.trim() && (a.r >= rows || a.c >= cols));
    }

    // Fill from a spreadsheet paste (tab-separated rows) starting at (r, c),
    // growing the table as needed.
    function pasteGrid(m, r0, c0, text) {
        const lines = String(text).replace(/\r/g, "").split("\n");
        if (lines.length && lines[lines.length - 1] === "") lines.pop();
        const grid = lines.map((l) => l.split("\t"));
        const needRows = Math.min(MAX_ROWS, r0 + grid.length);
        const needCols = Math.min(MAX_COLS, c0 + Math.max(...grid.map((g) => g.length)));
        while (m.rows < needRows) insertRow(m, m.rows);
        while (m.cols < needCols) insertCol(m, m.cols);
        grid.forEach((line, i) => line.forEach((val, j) => {
            const a = anchorAt(m, r0 + i, c0 + j);
            if (a && a.r === r0 + i && a.c === c0 + j) a.text = val.trim().slice(0, MAX_TEXT);
        }));
        return m;
    }

    // ---- Rendering (storefront + preview) ------------------------------------

    function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function toHtml(m, className) {
        const occ = occupancy(m);
        let html = `<table class="${className || "lz-table"}"><tbody>`;
        for (let r = 0; r < m.rows; r++) {
            html += "<tr>";
            for (let c = 0; c < m.cols; c++) {
                const a = m.cells[occ[r][c]];
                if (!a || a.r !== r || a.c !== c) continue;
                const isHead = (m.header_row && a.r === 0) || (m.header_col && a.c === 0);
                const tag = isHead ? "th" : "td";
                const scope = isHead ? (m.header_row && a.r === 0 ? ' scope="col"' : ' scope="row"') : "";
                html += `<${tag}${scope}${a.rs > 1 ? ` rowspan="${a.rs}"` : ""}${a.cs > 1 ? ` colspan="${a.cs}"` : ""}>${escapeHtml(a.text).replace(/\n/g, "<br>")}</${tag}>`;
            }
            html += "</tr>";
        }
        return html + "</tbody></table>";
    }

    // ---- Editor ---------------------------------------------------------------
    // LzTable.edit(container, model, onChange) - renders the editable table
    // plus a floating three-button toolbar (Column / Row / Merge), shown for
    // whichever cell has focus.

    const ICONS = {
        col: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><rect x="9" y="3" width="6" height="18" fill="currentColor" opacity=".35"/></svg>',
        row: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><rect x="3" y="9" width="18" height="6" fill="currentColor" opacity=".35"/></svg>',
        merge: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 3v6M3 9h6"/><rect x="9" y="9" width="12" height="12" fill="currentColor" opacity=".35"/></svg>',
        caret: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
    };

    function edit(container, model, onChange) {
        let m = clone(model);
        let focus = { r: 0, c: 0 };
        let selected = null; // { kind: "row"|"col"|"all", index }
        const root = document.createElement("div");
        root.className = "lzt-editor";
        // Focusable so paste/copy/Delete land here while a whole row,
        // column or the whole table is selected (no cell has the caret then).
        root.tabIndex = -1;
        container.innerHTML = "";
        container.appendChild(root);

        const emit = () => { if (onChange) onChange(clone(m)); };
        const focusedAnchor = () => anchorAt(m, focus.r, focus.c) || m.cells[0];

        function inSelection(a) {
            if (!selected) return false;
            if (selected.kind === "all") return true;
            return selected.kind === "row"
                ? a.r <= selected.index && selected.index < a.r + a.rs
                : a.c <= selected.index && selected.index < a.c + a.cs;
        }
        // Top-left position a paste into the current selection starts from.
        function selectionOrigin() {
            if (!selected || selected.kind === "all") return { r: 0, c: 0 };
            return selected.kind === "row" ? { r: selected.index, c: 0 } : { r: 0, c: selected.index };
        }
        // Selected region as tab-separated text (Excel/Sheets paste format).
        function selectionTsv() {
            const r0 = selected.kind === "row" ? selected.index : 0;
            const r1 = selected.kind === "row" ? selected.index : m.rows - 1;
            const c0 = selected.kind === "col" ? selected.index : 0;
            const c1 = selected.kind === "col" ? selected.index : m.cols - 1;
            const lines = [];
            for (let r = r0; r <= r1; r++) {
                const cols = [];
                for (let c = c0; c <= c1; c++) {
                    const a = anchorAt(m, r, c);
                    cols.push(a && a.r === r && a.c === c ? a.text.replace(/\s*\n\s*/g, " ") : "");
                }
                lines.push(cols.join("\t"));
            }
            return lines.join("\n");
        }
        function select(kind, index) {
            selected = { kind, index };
            closeMenus();
            draw(false);
            root.focus();
        }

        function draw(refocus) {
            const occ = occupancy(m);
            const a0 = focusedAnchor();
            let html = `<div class="lzt-toolbar" role="toolbar" aria-label="Table tools">
                <button type="button" class="lzt-tool" data-menu="col" aria-haspopup="true" title="Column">${ICONS.col}${ICONS.caret}</button>
                <button type="button" class="lzt-tool" data-menu="row" aria-haspopup="true" title="Row">${ICONS.row}${ICONS.caret}</button>
                <button type="button" class="lzt-tool" data-menu="merge" aria-haspopup="true" title="Merge cells">${ICONS.merge}${ICONS.caret}</button>
                <span class="lzt-size" title="Type the number of rows and columns, then Set">
                    <input type="number" class="lzt-num lzt-num-rows" min="1" max="${MAX_ROWS}" value="${m.rows}" aria-label="Rows">
                    <span class="lzt-x">rows &times;</span>
                    <input type="number" class="lzt-num lzt-num-cols" min="1" max="${MAX_COLS}" value="${m.cols}" aria-label="Columns">
                    <span class="lzt-x">cols</span>
                    <button type="button" class="lzt-set">Set</button>
                </span>
            </div>
            <div class="lzt-frame">
            <button type="button" class="lzt-grab${selected && selected.kind === "all" ? " lzt-grab-on" : ""}" title="Select table - then paste to fill it from the first cell, copy it, or press Delete to clear it" aria-label="Select whole table"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 0 5.5 2.5h1.75v4.75H2.5V5.5L0 8l2.5 2.5V8.75h4.75v4.75H5.5L8 16l2.5-2.5H8.75V8.75h4.75v1.75L16 8l-2.5-2.5v1.75H8.75V2.5h1.75z"/></svg></button>
            <div class="lzt-scroll"><table class="lzt-table${selected && selected.kind === "all" ? " lzt-table-all" : ""}"><tbody>`;
            for (let r = 0; r < m.rows; r++) {
                html += "<tr>";
                for (let c = 0; c < m.cols; c++) {
                    const i = occ[r][c];
                    const a = m.cells[i];
                    if (!a || a.r !== r || a.c !== c) continue;
                    const head = (m.header_row && a.r === 0) || (m.header_col && a.c === 0);
                    const sel = inSelection(a);
                    const cls = ["lzt-cell", head ? "lzt-head" : "", sel ? "lzt-selected" : "", a === a0 ? "lzt-focus" : ""].filter(Boolean).join(" ");
                    html += `<td class="${cls}"${a.rs > 1 ? ` rowspan="${a.rs}"` : ""}${a.cs > 1 ? ` colspan="${a.cs}"` : ""}><div class="lzt-in" contenteditable="true" data-r="${a.r}" data-c="${a.c}" spellcheck="true">${escapeHtml(a.text).replace(/\n/g, "<br>")}</div></td>`;
                }
                html += "</tr>";
            }
            html += "</tbody></table></div>";
            // Quick "+" bars: add a column on the right / a row at the bottom.
            html += `<button type="button" class="lzt-add lzt-add-col" data-add="col" title="Add column" aria-label="Add column"${m.cols >= MAX_COLS ? " disabled" : ""}><span>+</span></button>`;
            html += `<button type="button" class="lzt-add lzt-add-row" data-add="row" title="Add row" aria-label="Add row"${m.rows >= MAX_ROWS ? " disabled" : ""}><span>+</span></button>`;
            html += "</div>";
            root.innerHTML = html;
            if (refocus) {
                const el = root.querySelector(`.lzt-in[data-r="${a0.r}"][data-c="${a0.c}"]`);
                if (el) {
                    el.focus();
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    range.collapse(false);
                    const s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(range);
                }
            }
        }

        function readCell(el) {
            // innerText keeps line breaks from <br>/<div>; stored as plain text.
            const a = anchorAt(m, +el.dataset.r, +el.dataset.c);
            if (a) a.text = el.innerText.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").replace(/\n$/, "").slice(0, MAX_TEXT);
        }

        function apply(fn) {
            fn();
            selected = null;
            emit();
            draw(true);
        }

        function menuItems(kind) {
            const a = focusedAnchor();
            if (kind === "col") return [
                { toggle: true, label: "Header column", on: m.header_col, run: () => apply(() => { m.header_col = !m.header_col; }) },
                { label: "Insert column left", run: () => apply(() => { insertCol(m, a.c); focus = { r: a.r, c: a.c + 1 }; }), disabled: m.cols >= MAX_COLS },
                { label: "Insert column right", run: () => apply(() => { insertCol(m, a.c + a.cs); }), disabled: m.cols >= MAX_COLS },
                { label: "Delete column", run: () => apply(() => { deleteCol(m, focus.c); focus = { r: focus.r, c: Math.max(0, Math.min(focus.c, m.cols - 1)) }; }), disabled: m.cols <= 1 },
                { label: "Select column", run: () => select("col", focus.c) }
            ];
            if (kind === "row") return [
                { toggle: true, label: "Header row", on: m.header_row, run: () => apply(() => { m.header_row = !m.header_row; }) },
                { label: "Insert row above", run: () => apply(() => { insertRow(m, a.r); focus = { r: a.r + 1, c: a.c }; }), disabled: m.rows >= MAX_ROWS },
                { label: "Insert row below", run: () => apply(() => { insertRow(m, a.r + a.rs); }), disabled: m.rows >= MAX_ROWS },
                { label: "Delete row", run: () => apply(() => { deleteRow(m, focus.r); focus = { r: Math.max(0, Math.min(focus.r, m.rows - 1)), c: focus.c }; }), disabled: m.rows <= 1 },
                { label: "Select row", run: () => select("row", focus.r) }
            ];
            const mergeItem = (dir, label) => ({
                label, disabled: !canMerge(m, a, dir),
                run: () => apply(() => { const s = merge(m, a, dir); focus = { r: s.r, c: s.c }; })
            });
            return [
                mergeItem("up", "Merge cell up"), mergeItem("right", "Merge cell right"),
                mergeItem("down", "Merge cell down"), mergeItem("left", "Merge cell left"),
                { divider: true },
                { label: "Split cell vertically", run: () => apply(() => splitVertical(m, a)), disabled: a.cs === 1 && m.cols >= MAX_COLS },
                { label: "Split cell horizontally", run: () => apply(() => splitHorizontal(m, a)), disabled: a.rs === 1 && m.rows >= MAX_ROWS }
            ];
        }

        function openMenu(btn, kind) {
            closeMenus();
            const menu = document.createElement("div");
            menu.className = "lzt-menu";
            menu.setAttribute("role", "menu");
            menuItems(kind).forEach((it) => {
                if (it.divider) { const d = document.createElement("div"); d.className = "lzt-divider"; menu.appendChild(d); return; }
                const b = document.createElement("button");
                b.type = "button";
                b.className = "lzt-item" + (it.toggle ? " lzt-item-toggle" : "");
                b.disabled = !!it.disabled;
                b.setAttribute("role", it.toggle ? "menuitemcheckbox" : "menuitem");
                if (it.toggle) b.setAttribute("aria-checked", it.on ? "true" : "false");
                const label = document.createElement("span");
                label.textContent = it.label;
                b.appendChild(label);
                if (it.toggle) {
                    const sw = document.createElement("span");
                    sw.className = "lzt-switch" + (it.on ? " lzt-on" : "");
                    b.appendChild(sw);
                }
                b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cell's focus
                b.addEventListener("click", () => { closeMenus(); it.run(); });
                menu.appendChild(b);
            });
            btn.classList.add("lzt-tool-open");
            btn.parentElement.appendChild(menu);
            menu.style.left = btn.offsetLeft + "px";
            setTimeout(() => document.addEventListener("mousedown", outside), 0);
        }
        function outside(e) { if (!e.target.closest(".lzt-menu") && !e.target.closest(".lzt-tool")) closeMenus(); }
        function closeMenus() {
            root.querySelectorAll(".lzt-menu").forEach((x) => x.remove());
            root.querySelectorAll(".lzt-tool-open").forEach((x) => x.classList.remove("lzt-tool-open"));
            document.removeEventListener("mousedown", outside);
        }

        root.addEventListener("focusin", (e) => {
            const el = e.target.closest(".lzt-in");
            if (!el) return;
            const r = +el.dataset.r, c = +el.dataset.c;
            if (selected) {
                // Clicking into a cell ends a row/column/table selection.
                selected = null;
                root.querySelectorAll(".lzt-selected").forEach((x) => x.classList.remove("lzt-selected"));
                root.querySelectorAll(".lzt-table-all, .lzt-grab-on").forEach((x) => x.classList.remove("lzt-table-all", "lzt-grab-on"));
            }
            if (r !== focus.r || c !== focus.c) {
                focus = { r, c };
                root.querySelectorAll(".lzt-focus").forEach((x) => x.classList.remove("lzt-focus"));
                el.parentElement.classList.add("lzt-focus");
            }
        });
        root.addEventListener("input", (e) => {
            const el = e.target.closest(".lzt-in");
            if (el) { readCell(el); emit(); }
        });
        root.addEventListener("click", (e) => {
            if (e.target.closest(".lzt-grab")) { select("all", 0); return; }
            if (e.target.closest(".lzt-set")) { applySize(); return; }
            const plus = e.target.closest(".lzt-add");
            if (plus) {
                if (plus.dataset.add === "row") apply(() => { insertRow(m, m.rows); focus = { r: m.rows - 1, c: 0 }; });
                else apply(() => { insertCol(m, m.cols); focus = { r: 0, c: m.cols - 1 }; });
                return;
            }
            const btn = e.target.closest(".lzt-tool");
            if (!btn) return;
            if (btn.classList.contains("lzt-tool-open")) { closeMenus(); return; }
            openMenu(btn, btn.dataset.menu);
        });
        root.addEventListener("mousedown", (e) => { if (e.target.closest(".lzt-tool") || e.target.closest(".lzt-grab") || e.target.closest(".lzt-add")) e.preventDefault(); });
        const onCopy = (e, cut) => {
            if (!selected) return;
            e.preventDefault();
            (e.clipboardData || window.clipboardData).setData("text/plain", selectionTsv());
            if (cut) {
                m.cells.forEach((a) => { if (inSelection(a)) a.text = ""; });
                apply(() => {});
            }
        };
        root.addEventListener("copy", (e) => onCopy(e, false));
        root.addEventListener("cut", (e) => onCopy(e, true));
        root.addEventListener("paste", (e) => {
            const text = (e.clipboardData || window.clipboardData).getData("text");
            if (selected) {
                // Paste over a selected table/row/column: clear it, then fill
                // from its first cell (growing the table if the paste is bigger).
                e.preventDefault();
                const o = selectionOrigin();
                apply(() => {
                    m.cells.forEach((a) => { if (inSelection(a)) a.text = ""; });
                    pasteGrid(m, o.r, o.c, text);
                    focus = o;
                });
                return;
            }
            const el = e.target.closest(".lzt-in");
            if (!el) return;
            e.preventDefault();
            if (/\t/.test(text) || /\n./.test(text.trim())) {
                apply(() => pasteGrid(m, +el.dataset.r, +el.dataset.c, text));
            } else {
                document.execCommand("insertText", false, text);
            }
        });
        function applySize() {
            const rows = clamp(root.querySelector(".lzt-num-rows").value, 1, MAX_ROWS);
            const cols = clamp(root.querySelector(".lzt-num-cols").value, 1, MAX_COLS);
            if (rows === m.rows && cols === m.cols) return;
            if (wouldLoseText(m, rows, cols) &&
                !confirm(`Shrinking to ${rows} x ${cols} removes cells that have text in them. Continue?`)) {
                draw(false);
                return;
            }
            apply(() => {
                setSize(m, rows, cols);
                focus = { r: Math.min(focus.r, m.rows - 1), c: Math.min(focus.c, m.cols - 1) };
            });
        }

        root.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && e.target.closest(".lzt-num")) { e.preventDefault(); applySize(); return; }
            // Delete/Backspace on a selected row/column clears its cells.
            if (selected && (e.key === "Delete" || e.key === "Backspace")) {
                e.preventDefault();
                m.cells.forEach((a) => { if (inSelection(a)) a.text = ""; });
                apply(() => {});
                return;
            }
            // Ctrl/Cmd+A: first press selects the cell's text as usual; a
            // second press (or one in an empty cell) selects the whole table.
            if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
                const el = e.target.closest(".lzt-in");
                if (selected || !el) { e.preventDefault(); select("all", 0); return; }
                const sel = window.getSelection();
                const whole = !el.textContent || (sel && sel.toString() === el.innerText);
                if (whole) { e.preventDefault(); select("all", 0); }
                return;
            }
            if (e.key === "Escape") { closeMenus(); if (selected) { selected = null; draw(true); } return; }
            // Tab / Shift+Tab move between cells; Tab in the last cell adds a row.
            if (e.key === "Tab" && e.target.closest(".lzt-in")) {
                e.preventDefault();
                const order = sortCells(clone(m)).cells;
                const cur = order.findIndex((a) => a.r === +e.target.dataset.r && a.c === +e.target.dataset.c);
                let next = cur + (e.shiftKey ? -1 : 1);
                if (next >= order.length) {
                    apply(() => { insertRow(m, m.rows); focus = { r: m.rows - 1, c: 0 }; });
                    return;
                }
                next = Math.max(0, next);
                focus = { r: order[next].r, c: order[next].c };
                selected = null;
                draw(true);
            }
        });

        draw(false);
        return { get model() { return clone(m); }, destroy() { closeMenus(); container.innerHTML = ""; } };
    }

    return {
        MAX_ROWS, MAX_COLS, MAX_TEXT,
        create, clone, normalize, occupancy, anchorAt, plainText, hasContent,
        insertRow, deleteRow, insertCol, deleteCol, setSize, wouldLoseText, canMerge, merge, splitVertical, splitHorizontal, pasteGrid,
        toHtml, escapeHtml, edit
    };
});
