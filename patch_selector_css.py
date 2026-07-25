path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old = ".pd-price { font-size: 22px; color: #16a34a; font-weight: bold; margin: 8px 0; }"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = """.pd-price { font-size: 22px; color: #16a34a; font-weight: bold; margin: 8px 0; }
.pd-selector-section.hidden { display: none; }
.pd-selector-row { margin: 16px 0; }
.pd-selector-label { display: block; font-size: 14px; color: #333; margin-bottom: 8px; font-weight: 600; }
.pd-color-swatches { display: flex; gap: 10px; flex-wrap: wrap; }
.pd-color-swatch { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid transparent; cursor: pointer; }
.pd-color-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pd-color-swatch.selected { border-color: #ff6a00; }
.pd-size-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.pd-size-btn { padding: 8px 16px; border-radius: 20px; border: 1px solid #ccc; background: #fff; font-size: 14px; cursor: pointer; }
.pd-size-btn.selected { border-color: #ff6a00; color: #ff6a00; font-weight: bold; }
.pd-size-btn.disabled { color: #ccc; border-color: #eee; text-decoration: line-through; cursor: not-allowed; }"""

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: selector CSS added")
