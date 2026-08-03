#!/usr/bin/env python3
"""
Checkout retheme — orange to the homepage navy/gold palette.

Scope is deliberately narrow: only .checkout-* and .cart-checkout-btn
rules. The other oranges in style.css (#E65C00, #FF5C39, #C0392B) belong
to login/register/other pages and are left alone for a later pass.

Choices worth knowing:
  - Primary button is navy, not gold. Gold on white is low contrast, and
    "Place order" is the highest-stakes control on the site.
  - Secure badge goes green (#0a8f3c, already used elsewhere in this
    stylesheet) rather than a brand colour. Green reads as safety.
  - The logo badge takes gold with navy ink, matching .ls-mark in the header.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

CSS = 'client/css/style.css'

NAVY = '#1a1a2e'
GOLD = '#F5C518'
GREEN = '#0a8f3c'

EDITS = [
    # logo badge: orange square -> gold, matching the header mark
    ('''.checkout-logo-badge {
    width: 40px;
    height: 40px;
    background: #FF6600;''',
     f'''.checkout-logo-badge {{
    width: 40px;
    height: 40px;
    background: {GOLD};''',
     'logo badge'),

    # secure badge -> green, which reads as safety rather than brand
    ('''    font-size: 12px;
    color: #FF6600;
    font-weight: 600;
    white-space: nowrap;''',
     f'''    font-size: 12px;
    color: {GREEN};
    font-weight: 600;
    white-space: nowrap;''',
     'secure badge'),

    # progress: pending step
    ('    background: #FFF3E9;', '    background: #f1f2f6;', 'progress circle idle'),

    # progress: active step
    ('''.progress-step.active .progress-circle {
    background: #FF6600;
}''',
     f'''.progress-step.active .progress-circle {{
    background: {NAVY};
}}''',
     'progress circle active'),

    # progress: labels
    ('''.progress-step.completed .progress-label {
    color: #FF6600;''',
     f'''.progress-step.completed .progress-label {{
    color: {NAVY};''',
     'progress labels'),

    # progress: completed connector -> gold, so done steps read at a glance
    ('''.progress-line.completed {
    background: #FF6600;
}''',
     f'''.progress-line.completed {{
    background: {GOLD};
}}''',
     'progress line'),

    # cart button, first definition (amber)
    ('''.cart-checkout-btn {
    background: #fbbf24;
    color: #111827;''',
     f'''.cart-checkout-btn {{
    background: {GOLD};
    color: {NAVY};''',
     'cart button v1'),

    ('''.cart-checkout-btn:hover {
    background: #f59e0b;
}''',
     '''.cart-checkout-btn:hover {
    background: #e0b416;
}''',
     'cart button v1 hover'),

    # cart button, second definition (black) — this is the one that wins
    ('''.cart-checkout-btn {
    height: 56px;
    border-radius: 28px;
    background: #000000;
    color: #FFFFFF;''',
     f'''.cart-checkout-btn {{
    height: 56px;
    border-radius: 28px;
    background: {NAVY};
    color: #FFFFFF;''',
     'cart button v2'),
]

css = open(CSS).read()
failures = []

for old, new, label in EDITS:
    n = css.count(old)
    if n != 1:
        failures.append(f'{label}: expected 1 match, found {n}')
    else:
        css = css.replace(old, new)

if failures:
    print('ABORTED — nothing written:\n')
    for f in failures:
        print('  ✗', f)
    sys.exit(1)

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy(CSS, f'{CSS}.bak_{stamp}')
open(CSS, 'w').write(css)

print(f'✓ Patched 9 rules. Backup: {CSS}.bak_{stamp}')
print('  Bump the cache-buster: style.css?v=21 -> ?v=22 (in every page that links it)')
print('\n  NOTE: .cart-checkout-btn is still defined twice, at ~1204 and ~1524.')
print('  Both are now on-palette, but the duplication is worth resolving.')
