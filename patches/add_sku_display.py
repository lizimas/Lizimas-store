import shutil, datetime, sys

# --- HTML: add the SKU line right after the specs table ---
html_path = "client/product-detail.html"
with open(html_path, encoding="utf-8") as f:
    html_content = f.read()

html_anchor = '''    <section class="pd-section" id="pd-specs-section">
        <h2 class="pd-section-title">Specifications</h2>
        <table id="pd-specs-table" class="pd-specs-table"></table>
    </section>'''

n = html_content.count(html_anchor)
if n != 1:
    print(f"ABORT (html): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

html_replacement = '''    <section class="pd-section" id="pd-specs-section">
        <h2 class="pd-section-title">Specifications</h2>
        <table id="pd-specs-table" class="pd-specs-table"></table>
    </section>
    <p id="pd-sku" class="pd-sku" hidden></p>'''

html_backup = html_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(html_path, html_backup)
html_content = html_content.replace(html_anchor, html_replacement, 1)
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)
print("Patched html. Backup at " + html_backup)

# --- JS: populate it in loadProductDetail(), same pattern as pd-brand ---
js_path = "client/js/product-detail.js"
with open(js_path, encoding="utf-8") as f:
    js_content = f.read()

js_anchor = '''        var brandEl = document.getElementById("pd-brand");
        if (brandEl) {
            var brandName = (product.brand || "").trim();
            if (brandName) {
                brandEl.href = "/products.html?brand=" + encodeURIComponent(brandName);
                brandEl.innerHTML = 'View all products from <span>' +
                    pdEscape(brandName) + '</span>';
                brandEl.hidden = false;
            } else {
                brandEl.hidden = true;
            }
        }'''

n = js_content.count(js_anchor)
if n != 1:
    print(f"ABORT (js): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

js_replacement = js_anchor + '''

        // SKU is auto-generated for every product (server/utils/sku.js),
        // so it's shown independently of the specs section's own
        // show/hide logic (renderSpecs hides that whole section when
        // there are no manual specs - SKU should still show either way).
        var skuEl = document.getElementById("pd-sku");
        if (skuEl) {
            var skuValue = (product.sku || "").trim();
            if (skuValue) {
                skuEl.textContent = "SKU: " + skuValue;
                skuEl.hidden = false;
            } else {
                skuEl.hidden = true;
            }
        }'''

js_backup = js_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(js_path, js_backup)
js_content = js_content.replace(js_anchor, js_replacement, 1)
with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)
print("Patched js. Backup at " + js_backup)
