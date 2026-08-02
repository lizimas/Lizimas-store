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

// Two promotional slots. Until promo artwork exists they show product images,
// split between the slots so the same product does not appear in both.
async function loadPromoSlots() {
    const tracks = document.querySelectorAll(".ls-promo-track");
    if (tracks.length === 0) return;

    try {
        const response = await fetch("/api/products");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const products = (await response.json()).filter(p => p.image);

        if (products.length === 0) {
            document.querySelector(".ls-promos").style.display = "none";
            return;
        }

        for (let i = products.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [products[i], products[j]] = [products[j], products[i]];
        }

        const half = Math.ceil(products.length / 2);
        const groups = [products.slice(0, half), products.slice(half)];

        tracks.forEach((track, i) => {
            const items = groups[i].length ? groups[i] : products;
            track.innerHTML = items.map(p =>
                `<a class="ls-promo-slide" href="product-detail.html?id=${p.id}">
                    <img src="${p.image}" alt="${(p.name || "").replace(/"/g, "&quot;")}" loading="lazy">
                 </a>`
            ).join("");

            startCarousel(track, items.length);
        });
    } catch (error) {
        console.error("Load promo slots error:", error);
        const promos = document.querySelector(".ls-promos");
        if (promos) promos.style.display = "none";
    }
}

function startCarousel(track, count) {
    const slot = track.closest(".ls-promo");
    const dotsBox = slot.querySelector(".ls-promo-dots");
    let index = 0;

    if (count <= 1) {
        if (dotsBox) dotsBox.style.display = "none";
        return;
    }

    dotsBox.innerHTML = Array.from({ length: count }, (_, i) =>
        `<button class="ls-promo-dot${i === 0 ? " active" : ""}" data-i="${i}"
                 aria-label="Slide ${i + 1}"></button>`
    ).join("");

    const show = i => {
        index = (i + count) % count;
        track.style.transform = `translateX(-${index * 100}%)`;
        dotsBox.querySelectorAll(".ls-promo-dot").forEach((d, n) =>
            d.classList.toggle("active", n === index));
    };

    let timer = setInterval(() => show(index + 1), 5000);

    const restart = () => {
        clearInterval(timer);
        timer = setInterval(() => show(index + 1), 5000);
    };

    dotsBox.addEventListener("click", e => {
        const dot = e.target.closest(".ls-promo-dot");
        if (!dot) return;
        show(Number(dot.dataset.i));
        restart();
    });

    // Pause while the tab is hidden so slides do not race through in the background
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) clearInterval(timer);
        else restart();
    });
}

document.addEventListener("DOMContentLoaded", loadPromoSlots);
