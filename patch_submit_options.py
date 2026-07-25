path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = '''        showToast(data.message || "Saved successfully.");
        resetProductForm();
        await loadMyProducts();'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        const savedProductId = data.product ? data.product.id : id;
        const returnedImages = data.images || [];

        const colorsPayload = Object.keys(pdSelectedColors)
            .filter(name => pdSelectedColors[name] !== null && pdSelectedColors[name] !== undefined)
            .map(name => ({
                name,
                image_path: returnedImages[pdSelectedColors[name]] || null
            }));

        if (savedProductId && (pdSelectedSizes.length > 0 || colorsPayload.length > 0)) {
            try {
                await fetch(`${API_URL}/api/products/${savedProductId}/options`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${getStaffToken()}`
                    },
                    body: JSON.stringify({ sizes: pdSelectedSizes, colors: colorsPayload })
                });
            } catch (optionsError) {
                console.error("Save options error:", optionsError);
            }
        }

        showToast(data.message || "Saved successfully.");
        resetProductForm();
        await loadMyProducts();'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: submit flow now saves sizes/colors")
