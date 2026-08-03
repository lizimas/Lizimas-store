#!/usr/bin/env python3
"""
Cart badge fix.

cart.js updates document.getElementById("cart-count"). product-detail.html
names its badge "pd-cart-count", so the lookup returns null, the function
returns early, and the badge sits at 0 while items do reach the cart.

Rather than renaming one element, this makes updateCartCount write to every
badge it can find — by id, and by a .js-cart-count class. cart.html,
checkout.html and the auth pages each carry their own header markup, so this
same bug is waiting on any page that names its badge differently. Adding the
class to those headers is then all that's needed.

Run from ~/lizimas-store.
"""

import sys
import shutil
from datetime import datetime

JS = 'client/js/cart.js'
HTML = 'client/product-detail.html'

failures = []

# ------------------------------------------------------------------- JS
js = open(JS).read()

OLD = '''function updateCartCount() {
    const count = document.getElementById("cart-count");'''

NEW = '''function updateCartCount() {
    // Every header in the app rolled its own badge markup, so collect all of
    // them: the canonical id, the product-detail id, and any element opted in
    // with the class. Missing ones are simply skipped.
    const badges = [
        document.getElementById("cart-count"),
        document.getElementById("pd-cart-count"),
        ...document.querySelectorAll(".js-cart-count")
    ].filter(Boolean);

    const count = badges[0];'''

if js.count(OLD) != 1:
    failures.append(f'JS updateCartCount: expected 1 match, found {js.count(OLD)}')
else:
    js = js.replace(OLD, NEW)

    # after the existing body runs, mirror whatever it wrote to the rest
    lines = js.split('\n')
    start = next(i for i, l in enumerate(lines)
                 if l.startswith('function updateCartCount()'))

    depth, end = 0, None
    for i in range(start, len(lines)):
        depth += lines[i].count('{') - lines[i].count('}')
        if depth == 0 and i > start:
            end = i
            break

    if end is None:
        failures.append('JS: could not find end of updateCartCount')
    else:
        lines.insert(end, '''
    // mirror the first badge's result onto any others on the page
    if (badges.length > 1 && badges[0]) {
        badges.slice(1).forEach(b => {
            b.textContent = badges[0].textContent;
            b.style.display = badges[0].style.display;
        });
    }''')
        js = '\n'.join(lines)


# ----------------------------------------------------------------- HTML
html = open(HTML).read()

OLD_SPAN = '<span id="pd-cart-count">0</span>'
NEW_SPAN = '<span id="pd-cart-count" class="js-cart-count">0</span>'

if html.count(OLD_SPAN) != 1:
    failures.append(f'HTML badge: expected 1 match, found {html.count(OLD_SPAN)}')
else:
    html = html.replace(OLD_SPAN, NEW_SPAN)


# ---------------------------------------------------------------- write
if failures:
    print('ABORTED — nothing written:\n')
    for f in failures:
        print('  ✗', f)
    sys.exit(1)

stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
for p in (JS, HTML):
    shutil.copy(p, f'{p}.bak_{stamp}')

open(JS, 'w').write(js)
open(HTML, 'w').write(html)

print(f'✓ Patched. Backups suffixed .bak_{stamp}')
print('  Bump: cart.js?v=2 -> ?v=3  (in every page that loads it)')
print('\n  To fix any other page later, add class="js-cart-count" to its badge.')
