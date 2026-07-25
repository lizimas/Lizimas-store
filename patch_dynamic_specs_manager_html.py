path = "client/staff/manager.html"

with open(path, "r") as f:
    content = f.read()

old = '''                            <div class="product-form-section">
                                <h4>Specifications</h4>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    <input type="text" id="spec-material" placeholder="Material">
                                    <input type="text" id="spec-color" placeholder="Color">
                                    <input type="text" id="spec-sleeve" placeholder="Sleeve">
                                    <input type="text" id="spec-style" placeholder="Style">
                                    <input type="text" id="spec-length" placeholder="Length">
                                    <input type="text" id="spec-fit" placeholder="Fit">
                                    <input type="text" id="spec-pattern" placeholder="Pattern">
                                    <input type="text" id="spec-occasion" placeholder="Occasion">
                                </div>
                                <textarea id="spec-care-instructions" placeholder="Care Instructions" style="margin-top:8px; width:100%; min-height:50px;"></textarea>
                            </div>'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''                            <div class="product-form-section">
                                <h4>Specifications</h4>
                                <div id="specs-list" style="display:flex; flex-direction:column; gap:6px;"></div>
                                <button type="button" onclick="addSpecRow()" style="margin-top:8px; padding:8px 12px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">+ Add Specification</button>
                            </div>'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_DYNAMIC_SPECS_MANAGER_HTML")
