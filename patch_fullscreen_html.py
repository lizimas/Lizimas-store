path = "client/product-detail.html"

with open(path, "r") as f:
    content = f.read()

old = '''<div class="pd-gallery">
    <div id="pd-gallery-scroll" class="pd-gallery-scroll"></div>
    <div id="pd-gallery-counter" class="pd-gallery-counter">1/1</div>
</div>'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''<div class="pd-gallery">
    <div id="pd-gallery-scroll" class="pd-gallery-scroll"></div>
    <div id="pd-gallery-counter" class="pd-gallery-counter">1/1</div>
</div>

<div id="pd-fullscreen-viewer" class="pd-fullscreen-viewer hidden">
    <button id="pd-fullscreen-close" class="pd-fullscreen-close">&times;</button>
    <div id="pd-fullscreen-counter" class="pd-fullscreen-counter">1/1</div>
    <div id="pd-fullscreen-scroll" class="pd-fullscreen-scroll"></div>
</div>'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: fullscreen HTML added")
