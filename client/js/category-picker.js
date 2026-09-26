// Reusable searchable category picker (Vendor Center style): a
// full-screen modal with a search box up top and a drill-down parent/child
// list below, instead of one long <select> a vendor has to scroll through
// hundreds of options in. Works against the same {id, name, parent_id,
// is_active, display_order} shape category-select.js's
// buildGroupedCategoryOptions() uses - same data, no backend change.
//
// Usage: CategoryPicker.open(categories, currentCategoryId, (category) => { ... })
// The callback receives the chosen leaf category object, or null if the
// picker was closed without a selection.
(function (global) {
    let categories = [];
    let onSelect = null;
    let stack = []; // breadcrumb of category objects drilled into

    function isActive(c) {
        return c.is_active !== false;
    }

    function childrenOf(parentId) {
        return categories
            .filter(c => c.parent_id === parentId && isActive(c))
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    }

    function topLevel() {
        return childrenOf(null).length ? childrenOf(null) : categories
            .filter(c => !c.parent_id && isActive(c))
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    }

    function isLeaf(c) {
        return childrenOf(c.id).length === 0;
    }

    function leaves() {
        return categories.filter(c => isActive(c) && isLeaf(c));
    }

    function pathOf(cat) {
        const parts = [cat.name];
        let cur = cat;
        let guard = 0;
        while (cur.parent_id && guard++ < 10) {
            const parent = categories.find(c => c.id === cur.parent_id);
            if (!parent) break;
            parts.unshift(parent.name);
            cur = parent;
        }
        return parts.join(" › ");
    }

    function esc(s) {
        const d = document.createElement("div");
        d.textContent = String(s == null ? "" : s);
        return d.innerHTML;
    }

    function shell() {
        let modal = document.getElementById("cp-modal");
        if (modal) return modal;

        modal = document.createElement("div");
        modal.id = "cp-modal";
        modal.style.cssText = "display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:10000; align-items:flex-end; justify-content:center;";
        modal.innerHTML = `
            <div style="background:#fff; width:100%; max-width:520px; max-height:88vh; border-radius:16px 16px 0 0; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 -6px 24px rgba(0,0,0,0.25);">
                <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 18px 10px;">
                    <h3 style="margin:0; font-size:18px; color:#1a1a2e;">Categories</h3>
                    <button type="button" id="cp-close" style="background:none; border:none; font-size:22px; line-height:1; cursor:pointer; color:#666; padding:4px;">&times;</button>
                </div>
                <div style="padding:0 18px 12px;">
                    <div style="position:relative;">
                        <input id="cp-search" type="text" placeholder="Search for a category" style="width:100%; padding:11px 40px 11px 14px; border:1px solid #ddd; border-radius:10px; font-size:15px; box-sizing:border-box;">
                        <span style="position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#F5C518;">&#128269;</span>
                    </div>
                </div>
                <div id="cp-crumb" style="padding:0 18px 8px; font-size:14px; color:#1a1a2e; display:flex; align-items:center; gap:8px;"></div>
                <div id="cp-list" style="overflow-y:auto; flex:1; border-top:1px solid #f0f0f0;"></div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener("click", (e) => {
            if (e.target === modal) close(null);
        });
        document.getElementById("cp-close").addEventListener("click", () => close(null));
        document.getElementById("cp-search").addEventListener("input", render);

        document.getElementById("cp-list").addEventListener("click", (e) => {
            const row = e.target.closest(".cp-row");
            if (!row) return;
            const id = row.dataset.id;
            const cat = categories.find(c => String(c.id) === String(id));
            if (!cat) return;
            if (row.dataset.leaf === "true") {
                close(cat);
            } else {
                stack.push(cat);
                document.getElementById("cp-search").value = "";
                render();
            }
        });

        return modal;
    }

    function row(cat, { showPath } = {}) {
        const leaf = isLeaf(cat);
        const label = showPath ? pathOf(cat) : cat.name;
        return `<div class="cp-row" data-id="${cat.id}" data-leaf="${leaf}" style="display:flex; align-items:center; justify-content:space-between; padding:13px 18px; border-bottom:1px solid #f5f5f5; cursor:pointer; font-size:15px; color:#1a1a2e;">
            <span>${esc(label)}</span>
            ${leaf ? "" : '<span style="color:#F5C518; font-size:16px;">&#8250;</span>'}
        </div>`;
    }

    function render() {
        const searchEl = document.getElementById("cp-search");
        const listEl = document.getElementById("cp-list");
        const crumbEl = document.getElementById("cp-crumb");
        const q = (searchEl.value || "").trim().toLowerCase();

        if (q) {
            crumbEl.innerHTML = "";
            const matches = leaves().filter(c => c.name.toLowerCase().includes(q)).slice(0, 80);
            listEl.innerHTML = matches.length
                ? matches.map(c => row(c, { showPath: true })).join("")
                : `<div style="padding:24px 18px; color:#999; font-size:14px; text-align:center;">No categories match "${esc(q)}"</div>`;
            return;
        }

        const items = stack.length ? childrenOf(stack[stack.length - 1].id) : topLevel();
        crumbEl.innerHTML = stack.length
            ? `<button type="button" id="cp-back-btn" style="background:none; border:none; color:#F5C518; font-weight:600; cursor:pointer; font-size:14px; padding:4px 0; display:flex; align-items:center; gap:4px;">&larr; ${esc(stack.map(s => s.name).join(" › "))}</button>`
            : "";
        if (crumbEl.firstElementChild) {
            crumbEl.firstElementChild.addEventListener("click", () => {
                stack.pop();
                render();
            });
        }

        listEl.innerHTML = items.length
            ? items.map(c => row(c)).join("")
            : `<div style="padding:24px 18px; color:#999; font-size:14px; text-align:center;">No sub-categories here.</div>`;
    }

    function close(selected) {
        const modal = document.getElementById("cp-modal");
        if (modal) modal.style.display = "none";
        document.body.style.overflow = "";
        const cb = onSelect;
        onSelect = null;
        if (cb) cb(selected);
    }

    function open(cats, currentId, cb) {
        categories = Array.isArray(cats) ? cats : [];
        onSelect = cb || null;
        stack = [];

        // Land in the branch the current selection lives in rather than
        // dumping the vendor back at the top level every time they reopen
        // an already-categorized product.
        if (currentId != null) {
            const current = categories.find(c => String(c.id) === String(currentId));
            if (current && current.parent_id) {
                const chain = [];
                let cur = categories.find(c => c.id === current.parent_id);
                let guard = 0;
                while (cur && guard++ < 10) {
                    chain.unshift(cur);
                    cur = cur.parent_id ? categories.find(c => c.id === cur.parent_id) : null;
                }
                stack = chain;
            }
        }

        shell();
        const modal = document.getElementById("cp-modal");
        document.getElementById("cp-search").value = "";
        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
        render();
        setTimeout(() => document.getElementById("cp-search").focus(), 50);
    }

    global.CategoryPicker = { open };
})(window);
