import shutil, datetime, sys

# --- HTML: change pd-brand from a single <a> into a container ---
html_path = "client/product-detail.html"
with open(html_path, encoding="utf-8") as f:
    html_content = f.read()

html_anchor = '    <a id="pd-brand" class="pd-brand" hidden></a>'

n = html_content.count(html_anchor)
if n != 1:
    print(f"ABORT (html): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

html_replacement = '    <div id="pd-brand" class="pd-brand" hidden></div>'

html_backup = html_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(html_path, html_backup)
html_content = html_content.replace(html_anchor, html_replacement, 1)
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)
print("Patched html. Backup at " + html_backup)

# --- JS: "Brand" label (not clickable) + brand name (clickable) + "View
# all products from X" (clickable) - both links point at the same
# /products.html?brand= filter ---
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

js_replacement = '''        var brandEl = document.getElementById("pd-brand");
        if (brandEl) {
            var brandName = (product.brand || "").trim();
            if (brandName) {
                var brandUrl = "/products.html?brand=" + encodeURIComponent(brandName);
                brandEl.innerHTML =
                    '<span class="pd-brand-label">Brand</span>' +
                    '<a class="pd-brand-name-link" href="' + brandUrl + '">' + pdEscape(brandName) + '</a>' +
                    '<a class="pd-brand-viewall-link" href="' + brandUrl + '">View all products from ' + pdEscape(brandName) + '</a>';
                brandEl.hidden = false;
            } else {
                brandEl.hidden = true;
            }
        }'''

js_backup = js_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(js_path, js_backup)
js_content = js_content.replace(js_anchor, js_replacement, 1)
with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)
print("Patched js. Backup at " + js_backup)

# --- CSS: .pd-brand is now a flex container, not the link itself - the
# old rules assumed .pd-brand WAS the <a>, so replace them entirely
# rather than layer new rules on top of now-irrelevant ones ---
css_path = "client/css/style.css"
with open(css_path, encoding="utf-8") as f:
    css_content = f.read()

css_anchor = '''.pd-brand {
    display: block;
    margin: 0 0 6px;
    font-size: 14px;
    color: #6b7280;
    text-decoration: none;
}
.pd-brand span {
    color: #c0392b;
    font-weight: 600;
}
.pd-brand:hover span { text-decoration: underline; }'''

n = css_content.count(css_anchor)
if n != 1:
    print(f"ABORT (css): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

css_replacement = '''.pd-brand {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 14px;
    color: #6b7280;
}
.pd-brand-label {
    color: #6b7280;
}
.pd-brand-name-link,
.pd-brand-viewall-link {
    color: #c0392b;
    font-weight: 600;
    text-decoration: none;
}
.pd-brand-name-link:hover,
.pd-brand-viewall-link:hover { text-decoration: underline; }'''

css_backup = css_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(css_path, css_backup)
css_content = css_content.replace(css_anchor, css_replacement, 1)
with open(css_path, "w", encoding="utf-8") as f:
    f.write(css_content)
print("Patched css. Backup at " + css_backup)
