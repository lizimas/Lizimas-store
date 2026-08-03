#!/usr/bin/env python3
"""
Phase 3 — unclip the grandparent dropdowns.

.ls-nav has overflow-x: auto. CSS forces the other axis to auto as well,
so the nav row scroll-clips its own dropdown panels. Help escapes this
because it sits in .ls-header-top, which has no overflow set.

Fix: above 900px the row fits anyway, so scrolling buys nothing there —
turn overflow visible. Below 900px keep the scroll, since the grandparent
list genuinely overflows and the touch drawer is the path into it.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

CSS = 'client/css/style.css'

ANCHOR = '.ls-nav::-webkit-scrollbar { display: none; }'

ADDITION = '''.ls-nav::-webkit-scrollbar { display: none; }

/* ------------------------------------------------------------------
   PHASE 3 — overflow-x: auto above makes overflow-y auto too, which
   clips the dropdown panels inside .ls-nav. At desktop widths the row
   fits without scrolling, so the scroll container is pure cost: drop
   it and let the menus escape.
   ------------------------------------------------------------------ */
@media (min-width: 901px) {
    .ls-nav { overflow-x: visible; overflow-y: visible; }
}'''

css = open(CSS).read()

n = css.count(ANCHOR)
if n != 1:
    print(f'ABORTED — anchor matched {n} times, expected 1. Nothing written.')
    sys.exit(1)

if 'PHASE 3 — overflow-x' in css:
    print('ABORTED — patch already applied. Nothing written.')
    sys.exit(1)

css = css.replace(ANCHOR, ADDITION)

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy(CSS, f'{CSS}.bak_{stamp}')
open(CSS, 'w').write(css)

print(f'✓ Patched. Backup: {CSS}.bak_{stamp}')
print('  Bump the cache-buster: ?v=19 -> ?v=20')
