import shutil, datetime, sys

path = "client/vendor-register.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''    <nav class="checkout-nav-links">
        <a href="index.html">Home</a>
        <a href="vendor-policies.html">Vendor Policies</a>
        <a href="vendor-login.html">Vendor Login</a>
    </nav>'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''    <nav class="checkout-nav-links">
        <a href="index.html">Home</a>
        <a href="vendor-requirements.html">Requirements</a>
        <a href="vendor-policies.html">Vendor Policies</a>
        <a href="vendor-login.html">Vendor Login</a>
    </nav>'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
