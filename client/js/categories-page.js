// All Categories overview page (categories.html).
// Groups every category by its top-level parent and renders each parent
// as its own section with a "VIEW ALL" link, matching the section pattern
// used for product listings on products.html.

async function loadCategoriesPage() {
    const container = document.getElementById("categories-page-container");
    if (!container) return;

    try {
        const response = await fetch("/api/categories");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const all = await response.json();

        const byOrder = (a, b) => (a.display_order || 0) - (b.display_order || 0);

        const parents = all
            .filter(c => !c.parent_id)
            .sort(byOrder);

        const childrenOf = id => all
            .filter(c => c.parent_id === id)
            .sort(byOrder);

        const sections = parents
            .map(parent => ({ parent, children: childrenOf(parent.id) }))
            .filter(s => s.children.length > 0);

        if (sections.length === 0) {
            container.innerHTML = `<p class="no-products-message">No categories yet.</p>`;
            return;
        }

        const safe = typeof esc === "function" ? esc : (s => String(s == null ? "" : s));
        const hasLZ = typeof LZImage !== "undefined";

        const tile = c => {
            const src = c.effective_image;
            const img = src
                ? `<img src="${hasLZ ? LZImage.url(src, "tileRaw") : src}"${
                    hasLZ ? ` srcset="${LZImage.srcset(src, "tileRaw")}"` : ""
                  } alt="${safe(c.name)}" width="300" height="300" loading="lazy" decoding="async">`
                : (hasLZ
                    ? `<img src="${LZImage.placeholder(c.name, "square")}" alt="${safe(c.name)}" width="300" height="300" loading="lazy" decoding="async">`
                    : "");
            return `<a class="cat-page-tile" href="products.html?category=${encodeURIComponent(c.name)}">
                <span class="cat-page-thumb${src ? "" : " is-empty"}">${img}</span>
                <span class="cat-page-name">${safe(c.name)}</span>
            </a>`;
        };

        container.innerHTML = sections.map(({ parent, children }) => `
            <section class="cat-page-section">
                <div class="cat-page-section-head">
                    <h2 class="cat-page-section-title">${safe(parent.name)}</h2>
                    <a class="cat-page-viewall" href="products.html?category=${encodeURIComponent(parent.name)}">
                        VIEW ALL ${safe(parent.name).toUpperCase()} &#8594;
                    </a>
                </div>
                <div class="cat-page-grid">
                    ${children.map(tile).join("")}
                </div>
            </section>
        `).join("");

    } catch (error) {
        console.error("Load categories page error:", error);
        container.innerHTML = `<p class="no-products-message">Couldn't load categories. Please try again.</p>`;
    }
}

document.addEventListener("DOMContentLoaded", loadCategoriesPage);
