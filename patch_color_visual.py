path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old = """.pd-color-swatch { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid transparent; cursor: pointer; }
.pd-color-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pd-color-swatch.selected { border-color: #ff6a00; }"""

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = """.pd-color-swatch { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 3px solid #eee; cursor: pointer; box-sizing: border-box; position: relative; }
.pd-color-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pd-color-swatch.selected { border-color: #ff6a00; box-shadow: 0 0 0 2px rgba(255,106,0,0.3); }
.pd-selected-color-name { font-size: 13px; color: #666; margin-left: 4px; }"""

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: color visual cue strengthened")
