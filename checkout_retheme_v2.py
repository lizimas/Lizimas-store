#!/usr/bin/env python3
"""
Checkout retheme v2 — orange to the homepage navy/gold palette.

Fixes the abort in v1: #FFF3E9 (the pale orange tint) appears four times,
not once — progress circle, order summary icon, a badge at ~2335, and the
district picker's hover state. All four play the same role, so all four
move to a pale gold tint together.

Scope stays narrow: checkout and cart only. The oranges belonging to
login/register (#E65C00, #FF5C39, #C0392B) are left for a later pass.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

CSS = 'client/css/style.css'

NAVY = '#1a1a2e'
GOLD = '#F5C518'
GREEN = '#0a8f3c'
TINT = '#FDF4D9'          # pale gold, replacing the pale orange #FFF3E9

# (old, new, label, expected_count)
EDITS = [
    ('''.checkout-logo-badge {
    width: 40px;
    height: 40px;
    background: #FF6600;''',
     f'''.checkout-logo-badge {{
    width: 40px;
    height: 40px;
    background: {GOLD};''',
     'logo badge', 1),

    ('''    font-size: 12px;
    color: #FF6600;
    font-weight: 600;
    white-space: nowrap;''',
     f'''    font-size: 12px;
    color: {GREEN};
    font-weight: 600;
    white-space: nowrap;''',
     'secure badge', 1),

    # all four pale-orange tints move together
    ('    background: #FFF3E9;', f'    background: {TINT};',
     'pale tints (x4)', 4),

    ('''.progress-step.active .progress-circle {
    background: #FF6600;
}''',
     f'''.progress-step.active .progress-circle {{
    background: {NAVY};
}}''',
     'progress circle active', 1),

    ('''.progress-step.completed .progress-label {
    color: #FF6600;''',
     f'''.progress-step.completed .progress-label {{
    color: {NAVY};''',
     'progress labels', 1),

    ('''.progress-line.completed {
    background: #FF6600;
}''',
     f'''.progress-line.completed {{
    background: {GOLD};
}}''',
     'progress line', 1),

    ('''.cart-checkout-btn {
    background: #fbbf24;
    color: #111827;''',
     f'''.cart-checkout-btn {{
    background: {GOLD};
    color: {NAVY};''',
     'cart button v1', 1),

    ('''.cart-checkout-btn:hover {
    background: #f59e0b;
}''',
     '''.cart-checkout-btn:hover {
    background: #e0b416;
}''',
     'cart button v1 hover', 1),

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
     'cart button v2', 1),
]

css = open(CSS).read()
failures = []

for old, new, label, expected in EDITS:
    n = css.count(old)
    if n != expected:
        failures.append(f'{label}: expected {expected} match(es), found {n}')
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

print(f'✓ Patched. Backup: {CSS}.bak_{stamp}')
print('  Cache-buster is already at v22.')
print('\n  Still outstanding: .cart-checkout-btn is defined twice (~1204, ~1524).')
print('  Both are on-palette now, but the duplicate should go eventually.')
