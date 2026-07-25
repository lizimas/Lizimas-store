path = "client/js/admin.js"

with open(path, "r") as f:
    content = f.read()

old = '''    document.getElementById("variants-section").classList.add("hidden");
    document.getElementById("variants-list").innerHTML = "";
    document.getElementById("product-form-container").classList.remove("hidden");
}'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    document.getElementById("variants-section").classList.add("hidden");
    document.getElementById("variants-list").innerHTML = "";
    document.getElementById("specs-list").innerHTML = "";
    pdLocalPreviews = [];
    pdSelectedSizes = [];
    pdSelectedColors = {};
    document.querySelectorAll("#size-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll("#color-checkbox-list input[type=checkbox]").forEach(cb => cb.checked = false);
    document.querySelectorAll(".pd-color-thumb-picker").forEach(picker => { picker.style.display = "none"; picker.innerHTML = ""; });
    document.getElementById("product-form-container").classList.remove("hidden");
}'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_ADMIN_OPEN_RESET")
