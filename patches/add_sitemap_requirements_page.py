import shutil, datetime, sys

path = "server/routes/sitemap.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = "      { url: '/vendor-register.html', priority: '0.8', changefreq: 'monthly' },"

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = ("      { url: '/vendor-requirements.html', priority: '0.8', changefreq: 'monthly' },\n"
                "      { url: '/vendor-register.html', priority: '0.8', changefreq: 'monthly' },")

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
