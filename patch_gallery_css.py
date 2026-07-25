path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old = ".pd-gallery { width: 100%; background: #fff; }\n.pd-main-image { width: 100%; display: block; object-fit: cover; }"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = """.pd-gallery { width: 100%; background: #fff; position: relative; }
.pd-gallery-scroll { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
.pd-gallery-scroll img { flex: 0 0 100%; width: 100%; scroll-snap-align: center; object-fit: cover; display: block; }
.pd-gallery-counter { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.55); color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 12px; }"""

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: gallery CSS patched")
