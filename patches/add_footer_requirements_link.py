import datetime, sys

pages = [
    "client/cart.html", "client/categories.html", "client/contact.html",
    "client/faq.html", "client/help.html", "client/index.html",
    "client/login.html", "client/orders.html", "client/privacy.html",
    "client/product-detail.html", "client/products.html", "client/register.html",
    "client/report.html", "client/returns.html", "client/terms.html",
]

old = '''<div>
<h4>Sell on Lizimas Store</h4>
<p><a href="vendor-register.html">Become a Vendor</a></p>
<p><a href="vendor-login.html">Vendor Login</a></p>
</div>'''

new = '''<div>
<h4>Sell on Lizimas Store</h4>
<p><a href="vendor-requirements.html">Vendor Requirements</a></p>
<p><a href="vendor-register.html">Become a Vendor</a></p>
<p><a href="vendor-login.html">Vendor Login</a></p>
</div>'''

results = []
for path in pages:
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        results.append((path, "FILE NOT FOUND"))
        continue

    n = content.count(old)
    if n == 0:
        results.append((path, "anchor not found (0x) - skipped, no changes"))
        continue
    if n > 1:
        results.append((path, f"ABORTED - anchor found {n}x (expected 1)"))
        continue

    backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    with open(backup, "w", encoding="utf-8") as f:
        f.write(content)
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    results.append((path, "patched"))

any_aborted = False
for path, status in results:
    print(f"{path}: {status}")
    if "ABORT" in status:
        any_aborted = True

if any_aborted:
    print("\nOne or more files had unexpected anchor counts - review above before proceeding.")
    sys.exit(1)
