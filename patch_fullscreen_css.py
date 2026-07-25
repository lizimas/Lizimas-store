path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old = ".pd-gallery-counter { position: absolute; bottom: 16px; right: 16px; background: rgba(0,0,0,0.6); color: #fff; padding: 8px 18px; border-radius: 20px; font-size: 16px; font-weight: 600; }"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = """.pd-gallery-counter { position: absolute; bottom: 16px; left: 16px; background: rgba(0,0,0,0.6); color: #fff; padding: 8px 18px; border-radius: 20px; font-size: 16px; font-weight: 600; cursor: pointer; }
.pd-gallery-scroll img { cursor: pointer; }
.pd-fullscreen-viewer { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: #000; z-index: 1000; }
.pd-fullscreen-viewer.hidden { display: none; }
.pd-fullscreen-close { position: absolute; top: 16px; right: 16px; z-index: 1001; background: rgba(255,255,255,0.15); color: #fff; border: none; width: 40px; height: 40px; border-radius: 50%; font-size: 24px; line-height: 1; }
.pd-fullscreen-counter { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 1001; background: rgba(255,255,255,0.15); color: #fff; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; }
.pd-fullscreen-scroll { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; height: 100%; -webkit-overflow-scrolling: touch; }
.pd-fullscreen-scroll img { flex: 0 0 100%; width: 100%; height: 100%; object-fit: contain; scroll-snap-align: center; }"""

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: fullscreen CSS added")
