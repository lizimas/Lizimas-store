path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old = ".pd-gallery-counter { position: absolute; bottom: 16px; left: 16px; background: rgba(0,0,0,0.6); color: #fff; padding: 8px 18px; border-radius: 20px; font-size: 16px; font-weight: 600; cursor: pointer; }"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = ".pd-gallery-counter { position: absolute; bottom: 16px; right: 16px; background: rgba(0,0,0,0.6); color: #fff; padding: 8px 18px; border-radius: 20px; font-size: 16px; font-weight: 600; cursor: pointer; }"

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: counter moved back to bottom-right")
