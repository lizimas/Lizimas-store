path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old = ".pd-fullscreen-close { position: absolute; top: 16px; right: 16px; z-index: 1001; background: rgba(255,255,255,0.15); color: #fff; border: none; width: 40px; height: 40px; border-radius: 50%; font-size: 24px; line-height: 1; }"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = """.pd-fullscreen-close { position: absolute; top: 16px; left: 16px; z-index: 1001; background: rgba(255,255,255,0.15); color: #fff; border: none; width: 40px; height: 40px; border-radius: 50%; font-size: 24px; line-height: 1; }
.pd-fullscreen-share { position: absolute; top: 16px; right: 16px; z-index: 1001; background: rgba(255,255,255,0.15); color: #fff; border: none; width: 40px; height: 40px; border-radius: 50%; font-size: 18px; line-height: 1; }"""

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: share button CSS added")
