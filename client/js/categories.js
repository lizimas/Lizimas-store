// Homepage category tile grid. Renders from /api/categories (active only).

async function loadCategoryTiles() {
    const grid = document.getElementById("category-grid");
    if (!grid) return;

    try {
        const response = await fetch("/api/categories");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const categories = await response.json();

        if (!categories.length) {
            grid.innerHTML = "";
            return;
        }

        grid.innerHTML = categories.map(c => {
            const href = `products.html?category=${encodeURIComponent(c.name)}`;
            const img = c.image_url
                ? `<img src="${c.image_url}" alt="${c.name}" loading="lazy" width="400" height="180">`
                : `<div class="category-card-placeholder">${c.name.charAt(0)}</div>`;

            return `<a class="category-card" href="${href}">
                ${img}
                <h3>${c.name}</h3>
            </a>`;
        }).join("");
    } catch (error) {
        console.error("Load category tiles error:", error);
        grid.innerHTML = `<p class="category-grid-loading">Categories unavailable right now.</p>`;
    }
}

document.addEventListener("DOMContentLoaded", loadCategoryTiles);
