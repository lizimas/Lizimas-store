path = "client/product-detail.html"

with open(path, "r") as f:
    content = f.read()

old = '''    <div id="pd-price" class="pd-price"></div>

    <div class="pd-section">
        <h2>Description</h2>'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    <div id="pd-price" class="pd-price"></div>

    <div id="pd-selector-section" class="pd-selector-section hidden"></div>

    <div class="pd-section">
        <h2>Description</h2>'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: selector container added to HTML")
