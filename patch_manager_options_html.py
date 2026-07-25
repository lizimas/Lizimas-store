path = "client/staff/manager.html"

with open(path, "r") as f:
    content = f.read()

old = '''                                <input type="file" id="product-image" accept="image/*" multiple class="hidden">
                                <div class="drag-drop-preview-grid" id="product-image-preview"></div>
                            </div>
                        </div>'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''                                <input type="file" id="product-image" accept="image/*" multiple class="hidden">
                                <div class="drag-drop-preview-grid" id="product-image-preview"></div>
                            </div>

                            <div class="product-form-section">
                                <h4>Available Sizes</h4>
                                <div id="size-checkbox-list" style="display:flex; flex-wrap:wrap; gap:8px;">Loading...</div>
                            </div>

                            <div class="product-form-section">
                                <h4>Available Colors</h4>
                                <div id="color-checkbox-list" style="display:flex; flex-direction:column; gap:8px;">Loading...</div>
                            </div>
                        </div>'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: manager.html options HTML added")
