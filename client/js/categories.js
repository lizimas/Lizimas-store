// Homepage category strip and promotional slots.

// Explore Categories: level-2 tiles laid out 2 rows deep, paged sideways.
// Children with no image of their own fall back to the parent's tile image,
// which the API supplies as effective_image.
let explorePages = 0;
let exploreIndex = 0;
let exploreTimer = null;

// Must match the grid-template-columns in the CSS, or the page overflows
// into a third row.
// Escapes text before it goes into innerHTML. Shared by the promo slots
// and the announcement strip, so it lives at module scope.
const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function exploreColumns() {
    return window.matchMedia("(max-width: 900px)").matches ? 4 : 10;
}

async function loadExploreCategories() {
    const track = document.getElementById("ls-explore-track");
    if (!track) return;

    try {
        const response = await fetch("/api/categories");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const all = await response.json();

        const topIds = new Set(all.filter(c => !c.parent_id).map(c => c.id));
        const level2 = all
            .filter(c => topIds.has(c.parent_id))
            .sort((a, b) => (b.product_count || 0) - (a.product_count || 0));

        if (level2.length === 0) {
            document.querySelector(".ls-explore").style.display = "none";
            return;
        }

        renderExplorePages(track, level2);
        window.addEventListener("resize", debounce(() => {
            renderExplorePages(track, level2);
        }, 250));
    } catch (error) {
        console.error("Load explore categories error:", error);
        const section = document.querySelector(".ls-explore");
        if (section) section.style.display = "none";
    }
}

function renderExplorePages(track, items) {
    const perPage = exploreColumns() * 2;
    explorePages = Math.ceil(items.length / perPage);
    exploreIndex = 0;

    const tile = c => {
        const hasLZ = typeof LZImage !== "undefined";
        const src = c.effective_image;
        const img = src
            ? `<img src="${hasLZ ? LZImage.url(src, "tileRaw") : src}"${
                hasLZ ? ` srcset="${LZImage.srcset(src, "tileRaw")}"` : ""
              } alt="${c.name}" width="600" height="600" loading="lazy" decoding="async">`
            : (hasLZ
                ? `<img src="${LZImage.placeholder(c.name, "square")}" alt="${c.name}" width="600" height="600" loading="lazy" decoding="async">`
                : "");
        return `<a class="ls-explore-tile" href="products.html?category=${encodeURIComponent(c.name)}">
            <span class="ls-explore-thumb${src ? "" : " is-empty"}">${img}</span>
            <span class="ls-explore-name">${c.name}</span>
        </a>`;
    };

    let html = "";
    for (let i = 0; i < explorePages; i++) {
        const slice = items.slice(i * perPage, (i + 1) * perPage);
        html += `<div class="ls-explore-page">${slice.map(tile).join("")}</div>`;
    }
    track.innerHTML = html;
    track.style.transform = "translateX(0)";

    setupExploreControls(track);
}

function setupExploreControls(track) {
    const prev = document.getElementById("ls-explore-prev");
    const next = document.getElementById("ls-explore-next");

    const show = i => {
        exploreIndex = (i + explorePages) % explorePages;
        track.style.transform = `translateX(-${exploreIndex * 100}%)`;
    };

    // Arrows only: the category strip stays put unless the customer moves it.
    prev.onclick = () => show(exploreIndex - 1);
    next.onclick = () => show(exploreIndex + 1);

    const arrows = document.querySelector(".ls-explore-arrows");
    if (arrows) arrows.style.display = explorePages > 1 ? "flex" : "none";
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.addEventListener("DOMContentLoaded", loadExploreCategories);

// Homepage category tile grid. Renders from /api/categories (active only).



// Two promotional slots. Until promo artwork exists they show product images,
// split between the slots so the same product does not appear in both.
async function loadPromoSlots() {
    const tracks = document.querySelectorAll(".ls-promo-track");
    if (tracks.length === 0) return;

    let promos = [];
    try {
        const response = await fetch("/api/promotions");
        if (response.ok) promos = await response.json();
    } catch (error) {
        console.error("Load promotions error:", error);
    }

    // Product images stand in for any slot with no promotions yet.
    let fallback = [];
    const needsFallback = [1, 2].some(slot => !promos.some(p => p.slot === slot));

    if (needsFallback) {
        try {
            const response = await fetch("/api/products");
            if (response.ok) {
                fallback = (await response.json()).filter(p => p.image);
                for (let i = fallback.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [fallback[i], fallback[j]] = [fallback[j], fallback[i]];
                }
            }
        } catch (error) {
            console.error("Load fallback products error:", error);
        }
    }

    const half = Math.ceil(fallback.length / 2);
    const fallbackFor = slot => slot === 1 ? fallback.slice(0, half) : fallback.slice(half);

    let anyRendered = false;

    tracks.forEach(track => {
        const slot = Number(track.dataset.track);
        const mine = promos.filter(p => p.slot === slot);

        let slides;
        if (mine.length) {
            slides = mine.map(p => {
                let inner;
                if (p.layout === "text") {
                    const cut = p.image_url
                        ? `<img class="ls-promo-cut" src="${esc(p.image_url)}" alt="" loading="lazy">`
                        : "";
                    const cta = p.cta_label
                        ? `<span class="ls-promo-cta">${esc(p.cta_label)}</span>`
                        : "";
                    const sub = p.subtext
                        ? `<p class="ls-promo-sub">${esc(p.subtext)}</p>`
                        : "";
                    inner =
                        `<div class="ls-promo-copy">
                            <h3 class="ls-promo-head">${esc(p.headline)}</h3>
                            ${sub}${cta}
                         </div>${cut}`;
                } else {
                    inner = `<img src="${esc(p.image_url)}" alt="${esc(p.title || "Promotion")}" loading="lazy">`;
                }
                const cls = p.layout === "text"
                    ? `ls-promo-slide ls-promo-text${p.image_url ? " has-cut" : ""}`
                    : "ls-promo-slide";
                const style = p.layout === "text"
                    ? ` style="background:${esc(p.bg_color || "#ffffff")}"`
                    : "";
                return p.link_url
                    ? `<a class="${cls}" href="${esc(p.link_url)}"${style}>${inner}</a>`
                    : `<span class="${cls}"${style}>${inner}</span>`;
            });
        } else {
            const items = fallbackFor(slot).length ? fallbackFor(slot) : fallback;
            slides = items.map(p =>
                `<a class="ls-promo-slide" href="product-detail.html?id=${p.id}">
                    <img src="${p.image}" alt="${(p.name || "").replace(/"/g, "&quot;")}" loading="lazy">
                 </a>`);
        }

        if (slides.length === 0) {
            track.closest(".ls-promo").style.display = "none";
            return;
        }

        anyRendered = true;
        track.innerHTML = slides.join("");
        startCarousel(track, slides.length);
    });

    if (!anyRendered) {
        const promosSection = document.querySelector(".ls-promos");
        if (promosSection) promosSection.style.display = "none";
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

// ---------------------------------------------------------------------------
// Announcement strip (promotions slot 3).
//
// strip_text rows scroll right to left and carry no link at all: the track has
// pointer-events disabled so a tap on moving copy does nothing.
// strip_link rows are ordinary anchors that never move, which is what makes
// them safe to hit on a phone.
// ---------------------------------------------------------------------------

// Mirrors the server-side allowlist. Anything that is not an https URL, a
// site-relative path, a mailto or a tel is dropped rather than rendered, so a
// bad row shows nothing instead of shipping a live javascript: href.
function stripSafeHref(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    // "//evil.com" is protocol-relative and resolves off-site, so a leading
    // slash alone is not enough to call something internal.
    if (v.startsWith("/") && !v.startsWith("//")) return v;
    if (/^https:\/\/[^\s]+$/i.test(v)) return v;
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return v;
    if (/^tel:\+?[0-9\s-]{6,20}$/i.test(v)) return v;
    return "";
}

// Relative luminance per WCAG, used to pick readable strip text when no
// colour was set. Mirrors promoAutoText in admin.js.
function stripLuminance(hex) {
    const raw = String(hex || "").trim().replace("#", "");
    const full = raw.length === 3
        ? raw.split("").map(c => c + c).join("")
        : raw;
    if (full.length < 6) return 1;

    const channel = value => {
        const c = parseInt(value, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * channel(full.slice(0, 2))
        + 0.7152 * channel(full.slice(2, 4))
        + 0.0722 * channel(full.slice(4, 6));
}

function stripAutoText(bg) {
    return stripLuminance(bg) > 0.45 ? "#c0392b" : "#fff5f5";
}

function isHexColor(value) {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim());
}

async function loadPromoStrip() {
    const strip = document.querySelector(".ls-strip");
    if (!strip) return;

    const track = strip.querySelector(".ls-strip-track");
    const linkBox = strip.querySelector(".ls-strip-links");

    let rows = [];
    try {
        const response = await fetch("/api/promotions");
        if (response.ok) rows = await response.json();
    } catch (error) {
        console.error("Load strip error:", error);
    }

    const mine = rows.filter(p => Number(p.slot) === 3);
    const texts = mine.filter(p => p.layout === "strip_text");
    const tiles = mine.filter(p => p.layout === "strip_link");

    if (!texts.length && !tiles.length) {
        strip.hidden = true;
        return;
    }

    // The bg_color column defaults to #ffffff for every row, so treat that as
    // "not set" and let the stylesheet's light red stand. Anything else the
    // admin pastes wins. Only a literal hex is accepted: the value goes into a
    // style property, which is not somewhere to put unchecked input.
    const painted = texts.find(p => isHexColor(p.bg_color)
        && p.bg_color.toLowerCase() !== "#ffffff");
    const marquee = strip.querySelector(".ls-strip-marquee");

    if (painted && marquee) {
        marquee.style.background = painted.bg_color;
        // text_color is null unless it was set deliberately, in which case the
        // readable colour is worked out from the background instead.
        marquee.style.color = isHexColor(painted.text_color)
            ? painted.text_color
            : stripAutoText(painted.bg_color);
    }

    if (texts.length && track) {
        const items = texts.map(p => {
            const head = p.headline ? `<strong>${esc(p.headline)}</strong>` : "";
            const sub = p.subtext ? `<span>${esc(p.subtext)}</span>` : "";
            return `<span class="ls-strip-item">${head}${sub}</span>`;
        }).join("");

        // Printed twice so the -50% translate wraps without a gap.
        track.innerHTML = items + items;
    } else if (track) {
        track.closest(".ls-strip-marquee").style.display = "none";
    }

    if (tiles.length && linkBox) {
        linkBox.innerHTML = tiles.map(p => {
            const href = stripSafeHref(p.link_url);
            if (!href) return "";

            const label = p.title ? esc(p.title) : "";
            const icon = p.image_url
                ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">`
                : "";
            const cls = label ? "ls-strip-link" : "ls-strip-link icon-only";

            // Anything not site-relative opens in its own tab. noopener cuts
            // the window.opener handle so the opened page cannot navigate this
            // one somewhere else while the customer is looking away.
            const external = !href.startsWith("/");
            const target = external
                ? ' target="_blank" rel="noopener noreferrer"'
                : "";
            const aria = label ? "" : ` aria-label="${esc(p.headline || "Link")}"`;

            return `<a class="${cls}" href="${esc(href)}"${target}${aria}>` +
                   `${icon}${label ? `<span>${label}</span>` : ""}</a>`;
        }).join("");
    } else if (linkBox) {
        linkBox.style.display = "none";
    }

    strip.hidden = false;
}

document.addEventListener("DOMContentLoaded", loadPromoStrip);

// ---------- Category drawer and header parent nav ----------

let drawerTree = null;

async function loadCategoryNav() {
    const rail = document.getElementById("ls-drawer-rail");
    const navParents = document.getElementById("ls-nav-parents");
    if (!rail && !navParents) return;

    try {
        const response = await fetch("/api/categories");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const all = await response.json();

        const byOrder = (a, b) => (a.display_order || 0) - (b.display_order || 0);
        const kidsOf = id => all.filter(c => c.parent_id === id).sort(byOrder);

        drawerTree = all.filter(c => !c.parent_id).sort(byOrder).map(top => ({
            ...top,
            children: kidsOf(top.id).map(second => ({
                ...second,
                children: kidsOf(second.id)
            }))
        }));

        if (navParents) {
            navParents.innerHTML = drawerTree.map((p, i) => {
                const menu = p.children.length
                    ? `<div class="ls-nav-menu">${p.children.map(second => {
                        const leaves = second.children.length
                            ? `<div class="ls-nav-submenu">${second.children.map(third =>
                                `<a href="products.html?category=${encodeURIComponent(third.name)}">${third.name}</a>`
                              ).join("")}</div>`
                            : "";
                        return `<div class="ls-nav-menu-item">
                            <a class="ls-nav-menu-link"
                               href="products.html?category=${encodeURIComponent(second.name)}">
                                <span>${second.name}</span>
                                ${second.children.length ? '<span class="ls-nav-arrow">&#8250;</span>' : ""}
                            </a>
                            ${leaves}
                        </div>`;
                      }).join("")}</div>`
                    : "";

                return `<div class="ls-nav-item">
                    <a class="ls-nav-parent"
                       href="products.html?category=${encodeURIComponent(p.name)}">${p.name}</a>
                    ${menu}
                </div>`;
            }).join("");
        }

        if (rail) buildDrawer(rail);
        buildMegaPanel();
    } catch (error) {
        console.error("Load category nav error:", error);
    }
}

function buildDrawer(rail) {
    const panel = document.getElementById("ls-drawer-panel");

    rail.innerHTML = drawerTree.map((p, i) =>
        `<button class="ls-drawer-parent${i === 0 ? " active" : ""}" data-i="${i}">${p.name}</button>`
    ).join("");

    const showParent = i => {
        rail.querySelectorAll(".ls-drawer-parent").forEach((b, n) =>
            b.classList.toggle("active", n === i));

        const parent = drawerTree[i];
        if (!parent.children.length) {
            panel.innerHTML = `<p class="ls-drawer-empty" style="padding:20px">Nothing here yet.</p>`;
            return;
        }

        panel.innerHTML = parent.children.map(second => {
            const leaves = second.children.length
                ? second.children.map(third =>
                    `<a class="ls-drawer-child"
                        href="products.html?category=${encodeURIComponent(third.name)}">${third.name}</a>`
                  ).join("")
                : `<p class="ls-drawer-empty">Nothing here yet.</p>`;

            return `<div class="ls-drawer-group">
                <button class="ls-drawer-group-head" type="button">
                    <span>${second.name}</span>
                    <span class="ls-drawer-chevron">&#8250;</span>
                </button>
                <div class="ls-drawer-children">${leaves}</div>
            </div>`;
        }).join("");

        panel.scrollTop = 0;
    };

    rail.addEventListener("click", e => {
        const btn = e.target.closest(".ls-drawer-parent");
        if (btn) showParent(Number(btn.dataset.i));
    });

    // One group open at a time, so a long list does not push the rest off-screen
    panel.addEventListener("click", e => {
        const head = e.target.closest(".ls-drawer-group-head");
        if (!head) return;
        const group = head.parentElement;
        const wasOpen = group.classList.contains("open");
        panel.querySelectorAll(".ls-drawer-group").forEach(g => g.classList.remove("open"));
        if (!wasOpen) group.classList.add("open");
    });

    showParent(0);
}

function setupDrawerToggle() {
    const openBtn = document.getElementById("ls-nav-all");
    const drawer = document.getElementById("ls-drawer");
    const backdrop = document.getElementById("ls-drawer-backdrop");
    const closeBtn = document.getElementById("ls-drawer-close");
    if (!openBtn || !drawer) return;

    const setOpen = open => {
        drawer.hidden = !open;
        backdrop.hidden = !open;
        document.body.style.overflow = open ? "hidden" : "";
    };

    openBtn.addEventListener("click", () => setOpen(true));
    // The header burger is the mobile trigger; .ls-nav is hidden below 720px
    // so openBtn is unreachable there. Same drawer, second entry point.
    const topBtn = document.getElementById("ls-burger-top");
    if (topBtn) topBtn.addEventListener("click", () => setOpen(true));
    closeBtn.addEventListener("click", () => setOpen(false));
    backdrop.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") setOpen(false);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadCategoryNav();
    setupDrawerToggle();
});

// ---------- All Categories hover panel (desktop) ----------
// Cascade, not a dump: level 1 shows on opening the panel; each deeper
// level appears only when its parent's arrow is hovered. Hovering the row
// label itself does nothing, so a cursor crossing the list on its way
// somewhere else does not flood the panel.

function buildMegaPanel() {
    const rail = document.getElementById("ls-mega-rail");
    const col2 = document.getElementById("ls-mega-l2");
    const col3 = document.getElementById("ls-mega-l3");
    if (!rail || !col2 || !col3 || !drawerTree) return;

    const href = name =>
        "products.html?category=" + encodeURIComponent(name);

    const row = (item, cls) => {
        const arrow = item.children && item.children.length
            ? '<span class="ls-mega-arrow">&#8250;</span>'
            : "";
        return `<div class="${cls}">
            <a class="ls-mega-label" href="${href(item.name)}">${item.name}</a>
            ${arrow}
        </div>`;
    };

    // level 1
    rail.innerHTML = drawerTree
        .map((p, i) => row(p, "ls-mega-row").replace(
            'class="ls-mega-row"', `class="ls-mega-row" data-i="${i}"`))
        .join("");

    const closeFrom2 = () => {
        col2.hidden = true;
        col3.hidden = true;
        rail.querySelectorAll(".ls-mega-row").forEach(r =>
            r.classList.remove("open"));
    };

    const closeFrom3 = () => {
        col3.hidden = true;
        col2.querySelectorAll(".ls-mega-row").forEach(r =>
            r.classList.remove("open"));
    };

    // arrow on a level-1 row opens level 2
    rail.addEventListener("mouseover", e => {
        const hit = e.target.closest(".ls-mega-arrow");
        if (!hit) return;

        const rowEl = hit.closest(".ls-mega-row");
        const parent = drawerTree[Number(rowEl.dataset.i)];
        if (!parent || !parent.children.length) return;

        rail.querySelectorAll(".ls-mega-row").forEach(r =>
            r.classList.remove("open"));
        rowEl.classList.add("open");

        col2.innerHTML = parent.children
            .map((c, j) => row(c, "ls-mega-row").replace(
                'class="ls-mega-row"', `class="ls-mega-row" data-i="${j}"`))
            .join("");
        col2.dataset.parent = rowEl.dataset.i;
        col2.hidden = false;
        col3.hidden = true;
        col2.scrollTop = 0;
    });

    // arrow on a level-2 row opens level 3
    col2.addEventListener("mouseover", e => {
        const hit = e.target.closest(".ls-mega-arrow");
        if (!hit) return;

        const rowEl = hit.closest(".ls-mega-row");
        const parent = drawerTree[Number(col2.dataset.parent)];
        const second = parent && parent.children[Number(rowEl.dataset.i)];
        if (!second || !second.children.length) return;

        col2.querySelectorAll(".ls-mega-row").forEach(r =>
            r.classList.remove("open"));
        rowEl.classList.add("open");

        col3.innerHTML = second.children
            .map(c => row(c, "ls-mega-row"))
            .join("");
        col3.hidden = false;
        col3.scrollTop = 0;
    });

    // leaving a column collapses everything to its right
    col2.addEventListener("mouseleave", e => {
        if (!e.relatedTarget || !e.relatedTarget.closest(".ls-mega-panel")) return;
        if (!e.relatedTarget.closest("#ls-mega-l3")) closeFrom3();
    });

    document.getElementById("ls-mega").addEventListener("mouseleave", closeFrom2);
}
