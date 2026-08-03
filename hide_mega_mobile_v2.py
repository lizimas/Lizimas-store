#!/usr/bin/env python3
"""
Hide the cascade panel below 901px.

All the Phase 4 panel CSS lives inside @media (min-width: 901px). Below
that the markup is still in the DOM and still opens on tap, but with no
background, no columns and no borders — so it renders as raw text spilling
down the page behind the drawer.

The drawer is the intended touch interaction and works correctly, so the
panel simply should not exist at those widths.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

CSS = 'client/css/style.css'

MARK = 'PHASE 4 — All Categories hover panel.'

ADDITION = '''

/* ------------------------------------------------------------------
   Touch widths: the panel above is desktop-only, so nothing styles it
   here. Keep it out of the layout entirely — the drawer is the touch
   interaction and it handles all three levels already.
   ------------------------------------------------------------------ */
@media (max-width: 900px) {
    .ls-mega-panel { display: none !important; }
}'''

css = open(CSS).read()

if css.count(MARK) != 1:
    print(f'ABORTED — Phase 4 marker found {css.count(MARK)} times, expected 1.')
    sys.exit(1)

if 'Touch widths: the panel above is desktop-only' in css:
    print('ABORTED — already applied. Nothing written.')
    sys.exit(1)

css = css.rstrip() + ADDITION + '\n'

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy(CSS, f'{CSS}.bak_{stamp}')
open(CSS, 'w').write(css)

print(f'✓ Patched. Backup: {CSS}.bak_{stamp}')
print('  Bump: style.css?v=23 -> ?v=24')
