path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = "let pdLocalPreviews = [];"
count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''let pdLocalPreviews = [];
let pdSpecRowCounter = 0;

function addSpecRow(label, value) {
    const list = document.getElementById("specs-list");
    const rowId = `spec-row-${pdSpecRowCounter++}`;
    const row = document.createElement("div");
    row.id = rowId;
    row.style.cssText = "display:flex; gap:6px;";
    row.innerHTML = `
        <input type="text" class="spec-label-input" placeholder="Label (e.g. Material)" value="${label || ''}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <input type="text" class="spec-value-input" placeholder="Value (e.g. Polyester)" value="${value || ''}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px;">
        <button type="button" onclick="document.getElementById('${rowId}').remove()" style="padding:8px 12px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">&times;</button>
    `;
    list.appendChild(row);
}

function collectSpecRows() {
    const rows = document.querySelectorAll("#specs-list > div");
    const specs = [];
    rows.forEach(row => {
        const label = row.querySelector(".spec-label-input").value.trim();
        const value = row.querySelector(".spec-value-input").value.trim();
        if (label) specs.push({ label, value });
    });
    return specs;
}'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_ADD_SPEC_FUNCTIONS_PRODUCT")
