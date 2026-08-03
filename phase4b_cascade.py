#!/usr/bin/env python3
"""
Phase 4b — arrow-triggered cascade in the All Categories panel.

Before: hovering a level-1 row filled the whole panel with level 2 and 3.
After:  the panel opens showing level 1 only. Hovering the ARROW on a
        level-1 row reveals level 2 beside it. Hovering the arrow on a
        level-2 row reveals level 3. Hovering the row text does nothing.

The chevron keeps its size visually but gets a ~40px invisible hit area,
so the trigger is easy to land on without changing the look.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

HTML = 'client/index.html'
CSS = 'client/css/style.css'
JS = 'client/js/categories.js'

failures = []

# ----------------------------------------------------------------- HTML
html = open(HTML).read()

OLD = '''      <div class="ls-mega-panel">
        <div class="ls-mega-rail" id="ls-mega-rail"></div>
        <div class="ls-mega-body" id="ls-mega-body"></div>
      </div>'''

NEW = '''      <div class="ls-mega-panel">
        <div class="ls-mega-rail" id="ls-mega-rail"></div>
        <div class="ls-mega-col" id="ls-mega-l2" hidden></div>
        <div class="ls-mega-col" id="ls-mega-l3" hidden></div>
      </div>'''

if html.count(OLD) != 1:
    failures.append(f'HTML panel: expected 1 match, found {html.count(OLD)}')
else:
    html = html.replace(OLD, NEW)


# ------------------------------------------------------------------- JS
js = open(JS).read()

JS_MARK = '\n\n// ---------- All Categories hover panel (desktop) ----------'
if js.count(JS_MARK) != 1:
    failures.append(f'JS marker: expected 1, found {js.count(JS_MARK)}')
else:
    js = js[:js.index(JS_MARK)]

NEW_FN = '''

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
}'''

js = js.rstrip() + NEW_FN + '\n'


# ------------------------------------------------------------------ CSS
css = open(CSS).read()

CSS_MARK = '''

/* ============================================================
   PHASE 4 — All Categories hover panel.'''

if css.count(CSS_MARK) != 1:
    failures.append(f'CSS marker: expected 1, found {css.count(CSS_MARK)}')
else:
    css = css[:css.index(CSS_MARK)]

NEW_CSS = '''

/* ============================================================
   PHASE 4 — All Categories hover panel. Desktop only: below 901px
   .ls-nav still scrolls horizontally and would clip this, and the
   click-drawer is the better touch interaction anyway.

   The cascade is arrow-driven. Each column appears only when the
   arrow on its parent row is hovered, so moving a cursor down the
   list does not open everything at once.
   ============================================================ */
@media (min-width: 901px) {
    .ls-mega { position: relative; }

    .ls-mega-panel {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 6px;
        display: flex;
        align-items: stretch;
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

    .ls-mega-rail,
    .ls-mega-col {
        flex: 0 0 248px;
        padding: 8px 0;
        max-height: 460px;
        overflow-y: auto;
    }

    .ls-mega-rail { background: #f8f9fb; }
    .ls-mega-col { border-left: 1px solid #eceef2; background: #fff; }
    .ls-mega-col[hidden] { display: none; }

    .ls-mega-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .ls-mega-row.open { background: #fff; box-shadow: inset 3px 0 0 #F5C518; }
    .ls-mega-col .ls-mega-row.open { background: #f8f9fb; }

    .ls-mega-label {
        flex: 1;
        padding: 11px 4px 11px 18px;
        color: #1a1a2e;
        font-size: 14px;
        text-decoration: none;
    }

    .ls-mega-label:hover { color: #b8860b; }

    /* the arrow is the trigger. It stays small, but the padding gives it
       a ~40px hit area so it is not a pixel hunt. */
    .ls-mega-arrow {
        padding: 11px 16px;
        color: #b6bcc8;
        font-size: 16px;
        line-height: 1;
        cursor: default;
    }

    .ls-mega-arrow:hover { color: #1a1a2e; }
    .ls-mega-row.open .ls-mega-arrow { color: #1a1a2e; }
}'''

css = css.rstrip() + NEW_CSS + '\n'


# ----------------------------------------------------------------- write
if failures:
    print('ABORTED — nothing written:\n')
    for f in failures:
        print('  ✗', f)
    sys.exit(1)

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
for p in (HTML, CSS, JS):
    shutil.copy(p, f'{p}.bak_{stamp}')

open(HTML, 'w').write(html)
open(CSS, 'w').write(css)
open(JS, 'w').write(js)

print(f'✓ Patched 3 files. Backups suffixed .bak_{stamp}')
print('  Bump: style.css?v=22 -> ?v=23, categories.js?v=12 -> ?v=13')
