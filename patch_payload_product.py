path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = '''        const colorsPayload = Object.keys(pdSelectedColors)
            .filter(name => pdSelectedColors[name] !== null && pdSelectedColors[name] !== undefined)
            .map(name => ({
                name,
                image_path: returnedImages[pdSelectedColors[name]] || null
            }));'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        const colorsPayload = Object.keys(pdSelectedColors)
            .filter(name => Array.isArray(pdSelectedColors[name]) && pdSelectedColors[name].length > 0)
            .map(name => ({
                name,
                image_paths: pdSelectedColors[name].map(idx => returnedImages[idx]).filter(Boolean)
            }));'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_PAYLOAD_PRODUCT")
