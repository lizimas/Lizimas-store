import datetime, sys

pages = [
    "client/admin.html", "client/cart.html", "client/categories.html",
    "client/checkout.html", "client/contact.html", "client/faq.html",
    "client/help.html", "client/index.html", "client/login.html",
    "client/orders.html", "client/privacy.html", "client/product-detail.html",
    "client/products.html", "client/register.html", "client/report.html",
    "client/returns.html", "client/store.html", "client/terms.html",
]

old = "<p>Mobile Money: +256792363104</p>"
new = "<p>Mobile Money</p>"

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
