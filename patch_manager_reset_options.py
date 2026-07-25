path = "client/js/staff-manager.js"

with open(path, "r") as f:
    content = f.read()

old = '''    document.getElementById("product-form-status").textContent = "";
}'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    document.getElementById("product-form-status").textContent = "";

    pdLocalPreviews = [];
    pdSelectedSizes = [];
    pdSelectedColors = {};
    document.querySelectorAll("#size-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll("#color-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => { picker.style.display = "none"; picker.value = ""; });
}'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: manager reset clears options")
