#!/usr/bin/env python3
"""
Phase 2 — Lizimas Store header restructure.

  - Search moves up into .ls-header-top
  - All Categories moves down into .ls-nav
  - .ls-nav-row is deleted (saves ~54px)
  - Four conflicting 720px media blocks collapse into one
  - Help and Account become hover menus

Every edit is guarded: each target must appear EXACTLY once or the
script aborts having written nothing. Run from ~/lizimas-store.
"""

import re
import sys
import shutil
from datetime import datetime

HTML = 'client/index.html'
CSS = 'client/css/style.css'

failures = []


def guard(haystack, needle, label):
    """Abort unless needle appears exactly once."""
    n = haystack.count(needle)
    if n != 1:
        failures.append(f'{label}: expected 1 match, found {n}')
        return False
    return True


# ----------------------------------------------------------------- HTML
html = open(HTML).read()

# --- 1. replace the nav-row + nav block with the new two-row structure
old_navblock = re.findall(
    r'  <div class="ls-nav-row">.*?</nav>', html, re.S)

if len(old_navblock) != 1:
    failures.append(f'HTML navblock: expected 1 match, found {len(old_navblock)}')
else:
    old_navblock = old_navblock[0]

    # lift the search form out of it verbatim, so we keep your exact markup
    search_form = re.findall(r'    <form class="ls-search".*?</form>',
                             old_navblock, re.S)
    if len(search_form) != 1:
        failures.append('HTML search form: not found inside nav-row')
    else:
        search_form = search_form[0]

        new_navblock = '''  <nav class="ls-nav" id="ls-nav">
    <button class="ls-nav-all" id="ls-nav-all" type="button">
      <span class="ls-burger"><span></span><span></span><span></span></span>
      <span class="ls-nav-all-label">All Categories</span>
    </button>
    <div class="ls-nav-parents" id="ls-nav-parents"></div>
  </nav>'''

        html = html.replace(old_navblock, new_navblock)

        # --- 2. rebuild the actions area: search + Help + Account + Cart
        old_actions = re.findall(
            r'    <div class="ls-header-actions">.*?\n    </div>', html, re.S)

        if len(old_actions) != 1:
            failures.append(
                f'HTML actions: expected 1 match, found {len(old_actions)}')
        else:
            # re-indent the lifted form from 4 spaces to 4 (already correct)
            new_actions = search_form + '''

    <div class="ls-header-actions">

      <div class="ls-menu">
        <button class="ls-menu-trigger" type="button" aria-haspopup="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M9.2 9.3a2.9 2.9 0 015.6 1c0 1.9-2.8 2.2-2.8 4" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="17.6" r="1.2" fill="currentColor"/>
          </svg>
          <span class="ls-action-label">Help</span>
        </button>
        <div class="ls-menu-panel">
          <a class="ls-menu-item" href="help.html">Help Center</a>
          <a class="ls-menu-item" href="help.html#ordering">Place an order</a>
          <a class="ls-menu-item" href="help.html#payments">Payment options</a>
          <a class="ls-menu-item" href="help.html#delivery">Delivery &amp; tracking</a>
          <a class="ls-menu-item" href="help.html#returns">Returns &amp; refunds</a>
          <div class="ls-menu-sep"></div>
          <a class="ls-menu-item ls-menu-item-accent"
             href="https://wa.me/256792363104" target="_blank" rel="noopener">Live chat</a>
        </div>
      </div>

      <div class="ls-menu">
        <a class="ls-menu-trigger" href="login.html" aria-haspopup="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="ls-action-label">Account</span>
        </a>
        <div class="ls-menu-panel">
          <a class="ls-menu-item" href="login.html">My account</a>
          <a class="ls-menu-item" href="orders.html">Orders</a>
        </div>
      </div>

      <a href="cart.html" class="ls-action" title="Cart">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 4h2.2l2.6 12h9.6l2.2-8H7" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="10" cy="20" r="1.6" fill="currentColor"/>
          <circle cx="17" cy="20" r="1.6" fill="currentColor"/>
        </svg>
        <span class="ls-cart-count" id="cart-count">0</span>
      </a>
    </div>'''

            html = html.replace(old_actions[0], new_actions)


# ------------------------------------------------------------------ CSS
css = open(CSS).read()

DEAD = [
    ('''@media (max-width: 720px) {
    .ls-header-top { flex-wrap: wrap; gap: 12px; }
    .ls-search { order: 3; flex-basis: 100%; }
    .ls-action-label { display: none; }
    .ls-wordmark { font-size: 18px; }
}''', 'CSS media block 1'),

    ('''/* Burger sits inline with the search bar */
.ls-header-top .ls-nav-all { height: 44px; }

@media (max-width: 720px) {
    .ls-nav-all-label { display: none; }
    .ls-header-top .ls-nav-all { padding: 0 13px; }
    .ls-search { order: 0; flex-basis: auto; }
    .ls-header-top { flex-wrap: wrap; }
    .ls-brand { flex-basis: 100%; }
}''', 'CSS media block 2'),

    ('''/* Burger and search share the second row */
.ls-nav-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 18px 10px;
    max-width: 1400px;
    margin: 0 auto;
}

.ls-nav-row .ls-nav-all { height: 44px; }''', 'CSS nav-row rules'),

    ('''/* The v5 mobile overrides assumed search sat in the top row; it no longer does.
   Brand left, account and cart right, on one line at every width. */
@media (max-width: 720px) {
    .ls-header-top { flex-wrap: nowrap; }
    .ls-brand { flex-basis: auto; margin-right: auto; }
    .ls-search { order: 0; flex-basis: auto; }
}''', 'CSS media block 3'),
]

for needle, label in DEAD:
    if guard(css, needle, label):
        css = css.replace(needle, '')

ANCHOR = '/* Push account and cart to the far right at every width */\n.ls-header-top .ls-header-actions { margin-left: auto; }'

NEW_CSS = '''/* ============================================================
   PHASE 2 — two-row header. Replaces the four conflicting
   720px blocks that accumulated across v5/v6 revisions.
   Target height: 114px desktop (68 + 46).
   ============================================================ */

.ls-header-top .ls-header-actions { margin-left: auto; }

/* All Categories now lives in the nav row */
.ls-nav .ls-nav-all { margin-right: 8px; }

/* --- Help / Account hover menus --- */
.ls-menu { position: relative; }

.ls-menu-trigger {
    display: flex;
    align-items: center;
    gap: 7px;
    background: none;
    border: 0;
    padding: 4px 2px;
    color: #fff;
    text-decoration: none;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
}

.ls-menu-trigger svg { width: 26px; height: 26px; }

.ls-menu-panel {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 10px;
    min-width: 220px;
    padding: 6px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
    z-index: 1200;
    opacity: 0;
    visibility: hidden;
    transform: translateY(6px);
    transition: opacity .16s ease, transform .16s ease, visibility .16s;
}

/* bridges the gap so the menu survives the cursor travelling down */
.ls-menu-panel::before {
    content: "";
    position: absolute;
    top: -10px;
    left: 0;
    right: 0;
    height: 10px;
}

.ls-menu:hover .ls-menu-panel,
.ls-menu:focus-within .ls-menu-panel {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}

.ls-menu-item {
    display: block;
    padding: 10px 12px;
    color: #1a1a2e;
    text-decoration: none;
    font-size: 14px;
    border-radius: 6px;
}

.ls-menu-item:hover { background: #f3f4f6; }
.ls-menu-item-accent { color: #0a8f3c; font-weight: 600; }

.ls-menu-sep {
    height: 1px;
    margin: 6px 8px;
    background: #e5e7eb;
}

/* --- one consolidated mobile block --- */
@media (max-width: 720px) {
    .ls-header-top {
        flex-wrap: wrap;
        gap: 10px;
        padding: 10px 14px;
    }
    .ls-brand { flex-basis: auto; margin-right: auto; }
    .ls-wordmark { font-size: 18px; }
    .ls-action-label { display: none; }
    .ls-search { order: 3; flex-basis: 100%; }
    .ls-nav-all-label { display: none; }
    .ls-menu-panel { right: -8px; }
}'''

if guard(css, ANCHOR, 'CSS anchor'):
    css = css.replace(ANCHOR, NEW_CSS)

# tidy the blank runs left by the deletions
css = re.sub(r'\n{4,}', '\n\n\n', css)


# ----------------------------------------------------------------- write
if failures:
    print('ABORTED — nothing written:\n')
    for f in failures:
        print('  ✗', f)
    sys.exit(1)

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy(HTML, f'{HTML}.bak_{stamp}')
shutil.copy(CSS, f'{CSS}.bak_{stamp}')

open(HTML, 'w').write(html)
open(CSS, 'w').write(css)

print(f'✓ Patched. Backups saved with suffix .bak_{stamp}')
print('  Now bump the stylesheet cache-buster: css/style.css?v=18 -> ?v=19')
