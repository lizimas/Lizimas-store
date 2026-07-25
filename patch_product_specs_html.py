path = "client/staff/product.html"

with open(path, "r") as f:
    content = f.read()

old = '''                            <div>
                                <label style="font-size:13px; font-weight:600; color:#333;">Available Sizes</label>'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''                            <div>
                                <label style="font-size:13px; font-weight:600; color:#333;">Specifications</label>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;">
                                    <input type="text" id="spec-material" placeholder="Material" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-color" placeholder="Color" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-sleeve" placeholder="Sleeve" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-style" placeholder="Style" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-length" placeholder="Length" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-fit" placeholder="Fit" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-pattern" placeholder="Pattern" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                    <input type="text" id="spec-occasion" placeholder="Occasion" style="padding:8px; border:1px solid #ccc; border-radius:6px;">
                                </div>
                                <textarea id="spec-care-instructions" placeholder="Care Instructions" style="margin-top:8px; width:100%; min-height:50px; padding:8px; border:1px solid #ccc; border-radius:6px;"></textarea>
                            </div>

                            <div>
                                <label style="font-size:13px; font-weight:600; color:#333;">Available Sizes</label>'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_PRODUCT_SPECS_HTML")
