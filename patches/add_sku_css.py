import shutil, datetime, sys

path = "client/css/style.css"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''.pd-brand {
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

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = anchor + '''

/* SKU line under the specs table - plain, muted, no interaction (unlike
   .pd-brand above, which is a link). */
.pd-sku {
    display: block;
    margin: 10px 0 0;
    font-size: 13px;
    color: #6b7280;
}'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
