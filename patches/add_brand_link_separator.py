import shutil, datetime, sys

# --- JS: add a separator span between the two links ---
js_path = "client/js/product-detail.js"
with open(js_path, encoding="utf-8") as f:
    js_content = f.read()

js_anchor = '''                brandEl.innerHTML =
                    '<span class="pd-brand-label">Brand</span>' +
                    '<a class="pd-brand-name-link" href="' + brandUrl + '">' + pdEscape(brandName) + '</a>' +
                    '<a class="pd-brand-viewall-link" href="' + brandUrl + '">View all products from ' + pdEscape(brandName) + '</a>';'''

n = js_content.count(js_anchor)
if n != 1:
    print(f"ABORT (js): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

js_replacement = '''                brandEl.innerHTML =
                    '<span class="pd-brand-label">Brand</span>' +
                    '<a class="pd-brand-name-link" href="' + brandUrl + '">' + pdEscape(brandName) + '</a>' +
                    '<span class="pd-brand-sep">|</span>' +
                    '<a class="pd-brand-viewall-link" href="' + brandUrl + '">View all products from ' + pdEscape(brandName) + '</a>';'''

js_backup = js_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(js_path, js_backup)
js_content = js_content.replace(js_anchor, js_replacement, 1)
with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)
print("Patched js. Backup at " + js_backup)

# --- CSS: subtle styling for the separator, matching the muted label color ---
css_path = "client/css/style.css"
with open(css_path, encoding="utf-8") as f:
    css_content = f.read()

css_anchor = '''.pd-brand-label {
    color: #6b7280;
}'''

n = css_content.count(css_anchor)
if n != 1:
    print(f"ABORT (css): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

css_replacement = '''.pd-brand-label {
    color: #6b7280;
}
.pd-brand-sep {
    color: #d1d5db;
}'''

css_backup = css_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(css_path, css_backup)
css_content = css_content.replace(css_anchor, css_replacement, 1)
with open(css_path, "w", encoding="utf-8") as f:
    f.write(css_content)
print("Patched css. Backup at " + css_backup)
