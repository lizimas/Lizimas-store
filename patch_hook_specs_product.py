path = "client/js/staff-product.js"

with open(path, "r") as f:
    content = f.read()

old = '''        if (savedProductId && (pdSelectedSizes.length > 0 || colorsPayload.length > 0)) {'''
count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        const specsPayload = collectSpecRows();

        if (savedProductId && (pdSelectedSizes.length > 0 || colorsPayload.length > 0 || specsPayload.length > 0)) {'''
content = content.replace(old, new)

old2 = "body: JSON.stringify({ sizes: pdSelectedSizes, colors: colorsPayload })"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
content = content.replace(old2, "body: JSON.stringify({ sizes: pdSelectedSizes, colors: colorsPayload, specs: specsPayload })")

with open(path, "w") as f:
    f.write(content)

print("DONE_HOOK_SPECS_PRODUCT")
