path = "client/js/product-detail.js"

with open(path, "r") as f:
    content = f.read()

old1 = "        renderSpecs(product);"
count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)
content = content.replace(old1, "")

old2 = '''    if (data.colors.length === 0 && data.sizes.length === 0) {
        section.classList.add("hidden");
        return;
    }'''
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
new2 = '''    renderSpecs(data.specs || []);

    if (data.colors.length === 0 && data.sizes.length === 0) {
        section.classList.add("hidden");
        return;
    }'''
content = content.replace(old2, new2)

old3 = '''function renderSpecs(product) {
    const table = document.getElementById("pd-specs-table");
    table.innerHTML = "";

    Object.keys(PD_SPEC_LABELS).forEach(key => {
        const value = product[key];
        if (value && value.toString().trim() !== "") {
            const row = document.createElement("tr");
            row.innerHTML = `<td class="pd-spec-label">${PD_SPEC_LABELS[key]}</td><td class="pd-spec-value">${value}</td>`;
            table.appendChild(row);
        }
    });

    if (table.children.length === 0) {
        table.innerHTML = `<tr><td colspan="2">No specifications listed for this product.</td></tr>`;
    }
}'''
count3 = content.count(old3)
if count3 != 1:
    print(f"ABORT: expected 1 occurrence of old3, found {count3}")
    exit(1)
new3 = '''function renderSpecs(specs) {
    const table = document.getElementById("pd-specs-table");
    table.innerHTML = "";

    specs.forEach(spec => {
        if (spec.value && spec.value.toString().trim() !== "") {
            const row = document.createElement("tr");
            row.innerHTML = `<td class="pd-spec-label">${spec.label}</td><td class="pd-spec-value">${spec.value}</td>`;
            table.appendChild(row);
        }
    });

    if (table.children.length === 0) {
        table.innerHTML = `<tr><td colspan="2">No specifications listed for this product.</td></tr>`;
    }
}'''
content = content.replace(old3, new3)

with open(path, "w") as f:
    f.write(content)

print("DONE_DYNAMIC_SPECS_FRONTEND")
