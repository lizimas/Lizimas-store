path = "client/product-detail.html"

with open(path, "r") as f:
    content = f.read()

old = '''<div class="pd-gallery">
    <img id="pd-main-image" src="" alt="" class="pd-main-image">
</div>'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''<div class="pd-gallery">
    <div id="pd-gallery-scroll" class="pd-gallery-scroll"></div>
    <div id="pd-gallery-counter" class="pd-gallery-counter">1/1</div>
</div>'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: gallery HTML patched")
