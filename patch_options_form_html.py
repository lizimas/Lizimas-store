path = "client/staff/product.html"

with open(path, "r") as f:
    content = f.read()

old = '''                            <input type="file" id="product-image" accept="image/*" multiple>
                            <div style="display:flex; gap:10px;">'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''                            <input type="file" id="product-image" accept="image/*" multiple>

                            <div>
                                <label style="font-size:13px; font-weight:600; color:#333;">Available Sizes</label>
                                <div id="size-checkbox-list" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:6px;">Loading...</div>
                            </div>

                            <div>
                                <label style="font-size:13px; font-weight:600; color:#333;">Available Colors</label>
                                <div id="color-checkbox-list" style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">Loading...</div>
                            </div>

                            <div style="display:flex; gap:10px;">'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: options form HTML added")
