#!/usr/bin/env python3
"""
Phase 4 — All Categories hover panel (desktop).

Two panes, matching the drawer: level 1 in the rail, level 2 and 3 in the
body. Reuses drawerTree, so no second fetch and one source of truth for
the category structure.

Desktop only. Below 901px the click-drawer stays as-is, since the panel
needs real hover and the drawer is the better touch interaction anyway.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

HTML = 'client/index.html'
CSS = 'client/css/style.css'
JS = 'client/js/categories.js'

failures = []


def guard(text, needle, label):
    n = text.count(needle)
    if n != 1:
        failures.append(f'{label}: expected 1 match, found {n}')
        return False
    return True


# ----------------------------------------------------------------- HTML
html = open(HTML).read()

OLD_BURGER = '''    <button class="ls-nav-all" id="ls-nav-all" type="button">
      <span class="ls-burger"><span></span><span></span><span></span></span>
      <span class="ls-nav-all-label">All Categories</span>
    </button>'''

NEW_BURGER = '''    <div class="ls-mega" id="ls-mega">
      <button class="ls-nav-all" id="ls-nav-all" type="button">
        <span class="ls-burger"><span></span><span></span><span></span></span>
        <span class="ls-nav-all-label">All Categories</span>
      </button>
      <div class="ls-mega-panel">
        <div class="ls-mega-rail" id="ls-mega-rail"></div>
        <div class="ls-mega-body" id="ls-mega-body"></div>
      </div>
    </div>'''

if guard(html, OLD_BURGER, 'HTML burger'):
    html = html.replace(OLD_BURGER, NEW_BURGER)


# ------------------------------------------------------------------- JS
js = open(JS).read()

OLD_CALL = '        if (rail) buildDrawer(rail);'
NEW_CALL = '''        if (rail) buildDrawer(rail);
        buildMegaPanel();'''

if guard(js, OLD_CALL, 'JS buildDrawer call'):
    js = js.replace(OLD_CALL, NEW_CALL)

MEGA_FN = '''

// ---------- All Categories hover panel (desktop) ----------
// Same two panes as the drawer, reading the same drawerTree. The drawer
// keeps its click behaviour; this only adds a hover surface above 901px.

function buildMegaPanel() {
    const rail = document.getElementById("ls-mega-rail");
    const body = document.getElementById("ls-mega-body");
    if (!rail || !body || !drawerTree) return;

    rail.innerHTML = drawerTree.map((p, i) =>
        `<button class="ls-mega-rail-item${i === 0 ? " active" : ""}"
                 type="button" data-i="${i}">
            <span>${p.name}</span>
            <span class="ls-mega-chevron">&#8250;</span>
        </button>`
    ).join("");

    const show = i => {
        rail.querySelectorAll(".ls-mega-rail-item").forEach((b, n) =>
            b.classList.toggle("active", n === i));

        const parent = drawerTree[i];
        if (!parent.children.length) {
            body.innerHTML = '<p class="ls-mega-empty">Nothing here yet.</p>';
            return;
        }

        // Level 2 as a column heading, its level 3 listed beneath it.
        body.innerHTML = parent.children.map(second => {
            const leaves = second.children.length
                ? second.children.map(third =>
                    `<a class="ls-mega-leaf"
                        href="products.html?category=${encodeURIComponent(third.name)}">${third.name}</a>`
                  ).join("")
                : "";

            return `<div class="ls-mega-group">
                <a class="ls-mega-head"
                   href="products.html?category=${encodeURIComponent(second.name)}">${second.name}</a>
                ${leaves}
            </div>`;
        }).join("");

        body.scrollTop = 0;
    };

    // Hover swaps the pane; click still follows through to the category page.
    rail.addEventListener("mouseover", e => {
        const btn = e.target.closest(".ls-mega-rail-item");
        if (btn) show(Number(btn.dataset.i));
    });

    rail.addEventListener("click", e => {
        const btn = e.target.closest(".ls-mega-rail-item");
        if (!btn) return;
        const name = drawerTree[Number(btn.dataset.i)].name;
        window.location.href =
            "products.html?category=" + encodeURIComponent(name);
    });

    show(0);
}'''

js = js.rstrip() + MEGA_FN + '\n'


# ------------------------------------------------------------------ CSS
css = open(CSS).read()

if 'PHASE 4 — All Categories' in css:
    failures.append('CSS: patch already applied')

MEGA_CSS = '''

/* ============================================================
   PHASE 4 — All Categories hover panel. Desktop only: below 901px
   .ls-nav still scrolls horizontally and would clip this, and the
   click-drawer is the better touch interaction regardless.
   ============================================================ */
@media (min-width: 901px) {
    .ls-mega { position: relative; }

    .ls-mega-panel {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 6px;
        display: flex;
        width: 780px;
        max-width: calc(100vw - 40px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
        overflow: hidden;
        z-index: 1200;
        opacity: 0;
        visibility: hidden;
        transform: translateY(6px);
        transition: opacity .16s ease, transform .16s ease, visibility .16s;
    }

    /* bridges the gap so the panel survives the cursor crossing it */
    .ls-mega-panel::before {
        content: "";
        position: absolute;
        top: -8px;
        left: 0;
        right: 0;
        height: 8px;
    }

    .ls-mega:hover .ls-mega-panel,
    .ls-mega:focus-within .ls-mega-panel {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .ls-mega-rail {
        flex: 0 0 210px;
        background: #f8f9fb;
        border-right: 1px solid #e5e7eb;
        padding: 8px 0;
        max-height: 460px;
        overflow-y: auto;
    }

    .ls-mega-rail-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        padding: 11px 16px;
        background: none;
        border: 0;
        font-family: inherit;
        font-size: 14px;
        color: #1a1a2e;
        text-align: left;
        cursor: pointer;
    }

    .ls-mega-rail-item.active {
        background: #fff;
        font-weight: 600;
        box-shadow: inset 3px 0 0 #F5C518;
    }

    .ls-mega-chevron { color: #9ca3af; font-size: 15px; }

    .ls-mega-body {
        flex: 1;
        padding: 16px 20px;
        max-height: 460px;
        overflow-y: auto;
        column-count: 2;
        column-gap: 28px;
    }

    .ls-mega-group {
        break-inside: avoid;
        margin-bottom: 18px;
    }

    .ls-mega-head {
        display: block;
        margin-bottom: 6px;
        color: #1a1a2e;
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
    }

    .ls-mega-head:hover { color: #b8860b; }

    .ls-mega-leaf {
        display: block;
        padding: 4px 0;
        color: #6b7280;
        font-size: 13px;
        text-decoration: none;
    }

    .ls-mega-leaf:hover { color: #1a1a2e; }

    .ls-mega-empty { padding: 20px; color: #9ca3af; font-size: 14px; }
}'''

css = css.rstrip() + MEGA_CSS + '\n'


# ----------------------------------------------------------------- write
if failures:
    print('ABORTED — nothing written:\n')
    for f in failures:
        print('  ✗', f)
    sys.exit(1)

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
for path in (HTML, CSS, JS):
    shutil.copy(path, f'{path}.bak_{stamp}')

open(HTML, 'w').write(html)
open(CSS, 'w').write(css)
open(JS, 'w').write(js)

print(f'✓ Patched 3 files. Backups suffixed .bak_{stamp}')
print('  Bump both cache-busters: style.css?v=20 -> ?v=21')
print('                           categories.js?v=11 -> ?v=12')
