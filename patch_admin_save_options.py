path = "client/js/admin.js"

with open(path, "r") as f:
    content = f.read()

old = '''        if (result.error) {
            errorEl.textContent = result.error;
            return;
        }

        closeProductForm();
        loadProducts();
        loadStats();'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        if (result.error) {
            errorEl.textContent = result.error;
            return;
        }

        const savedProductId = result.product ? result.product.id : id;
        const returnedImages = result.images || [];

        const colorsPayload = Object.keys(pdSelectedColors)
            .filter(name => Array.isArray(pdSelectedColors[name]) && pdSelectedColors[name].length > 0)
            .map(name => ({
                name,
                image_paths: pdSelectedColors[name].map(idx => returnedImages[idx]).filter(Boolean)
            }));

        const specsPayload = collectSpecRows();

        if (savedProductId && (pdSelectedSizes.length > 0 || colorsPayload.length > 0 || specsPayload.length > 0)) {
            try {
                await authorizedFetch(`/api/products/${savedProductId}/options`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sizes: pdSelectedSizes, colors: colorsPayload, specs: specsPayload })
                });
            } catch (optionsError) {
                console.error("Save options error:", optionsError);
            }
        }

        closeProductForm();
        loadProducts();
        loadStats();'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_ADMIN_SAVE_OPTIONS")
