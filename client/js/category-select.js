// Builds a grouped <select> of categories: parents as optgroup labels,
// children as the only selectable options. Products live on children only.
// Loaded by admin, staff-product and staff-manager.

function buildGroupedCategoryOptions(categories, selectedId) {
    const parents = categories
        .filter(c => !c.parent_id && c.is_active !== false)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

    const childrenOf = parentId => categories
        .filter(c => c.parent_id === parentId && c.is_active !== false)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

    const selected = selectedId != null ? String(selectedId) : "";
    let html = `<option value="">Choose a category…</option>`;

    // Products go on an end category (one with no sub-categories), at any
    // level: Fashion › Clothing › T-Shirts, but also Home & Living ›
    // Bathroom Accessories, or a top category with nothing under it.
    // (Sept 2026: only third-level ones were listed, so picking a second-level
    // category in the picker left the category blank and the save refused.)
    // Grouped by their path so a name like "Accessories" is unambiguous.
    const groups = [];
    const walk = (cat, path) => {
        const kids = childrenOf(cat.id);
        if (kids.length === 0) {
            const label = path.length ? path.join(" \u203A ") : "Other";
            let g = groups.find(x => x.label === label);
            if (!g) { g = { label, items: [] }; groups.push(g); }
            g.items.push(cat);
            return;
        }
        kids.forEach(k => walk(k, path.concat(cat.name)));
    };
    parents.forEach(p => walk(p, []));
    // Top categories with nothing under them go last, under "Other".
    groups.sort((a, b) => (a.label === "Other") - (b.label === "Other"));
    for (const g of groups) {
        html += `<optgroup label="${g.label}">`;
        html += g.items.map(c => {
            const isSelected = String(c.id) === selected ? " selected" : "";
            return `<option value="${c.id}"${isSelected}>${c.name}</option>`;
        }).join("");
        html += `</optgroup>`;
    }

    // A product still sitting on a parent would otherwise lose its value on save.
    // Surface it so it is visible and can be corrected, but keep it clearly marked.
    const current = categories.find(c => String(c.id) === selected);
    const isLeaf = current && categories.some(c => c.parent_id === current.id) === false;
    if (current && !isLeaf) {
        html += `<optgroup label="Needs reassigning">`;
        html += `<option value="${current.id}" selected>${current.name} (top level)</option>`;
        html += `</optgroup>`;
    }

    return html;
}
