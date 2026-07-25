path = "client/admin.html"

with open(path, "r") as f:
    content = f.read()

old = '''                                <p id="variant-form-error" class="error-text"></p>
                            </div>
                        </div>

                        <div class="form-actions">'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''                                <p id="variant-form-error" class="error-text"></p>
                            </div>

                            <div class="product-form-section">
                                <h4>Specifications</h4>
                                <div id="specs-list" style="display:flex; flex-direction:column; gap:6px;"></div>
                                <button type="button" onclick="addSpecRow()" style="margin-top:8px; padding:8px 12px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">+ Add Specification</button>
                            </div>

                            <div class="product-form-section">
                                <h4>Available Sizes</h4>
                                <div id="size-checkbox-list" style="display:flex; flex-wrap:wrap; gap:8px;">Loading...</div>
                            </div>

                            <div class="product-form-section">
                                <h4>Available Colors</h4>
                                <div id="color-checkbox-list" style="display:flex; flex-direction:column; gap:8px;">Loading...</div>
                            </div>
                        </div>

                        <div class="form-actions">'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_ADMIN_OPTIONS_HTML")
