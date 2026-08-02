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

    for (const parent of parents) {
        const children = childrenOf(parent.id);
        if (children.length === 0) continue;

        html += `<optgroup label="${parent.name}">`;
        html += children.map(c => {
            const isSelected = String(c.id) === selected ? " selected" : "";
            return `<option value="${c.id}"${isSelected}>${c.name}</option>`;
        }).join("");
        html += `</optgroup>`;
    }

    // A product still sitting on a parent would otherwise lose its value on save.
    // Surface it so it is visible and can be corrected, but keep it clearly marked.
    const current = categories.find(c => String(c.id) === selected);
    if (current && !current.parent_id) {
        html += `<optgroup label="Needs reassigning">`;
        html += `<option value="${current.id}" selected>${current.name} (top level)</option>`;
        html += `</optgroup>`;
    }

    return html;
}
