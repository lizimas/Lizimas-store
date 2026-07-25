path = "client/js/staff-manager.js"

with open(path, "r") as f:
    content = f.read()

old1 = '''    formData.append("material", document.getElementById("spec-material").value.trim());
    formData.append("color", document.getElementById("spec-color").value.trim());
    formData.append("sleeve", document.getElementById("spec-sleeve").value.trim());
    formData.append("style", document.getElementById("spec-style").value.trim());
    formData.append("length", document.getElementById("spec-length").value.trim());
    formData.append("fit", document.getElementById("spec-fit").value.trim());
    formData.append("pattern", document.getElementById("spec-pattern").value.trim());
    formData.append("occasion", document.getElementById("spec-occasion").value.trim());
    formData.append("care_instructions", document.getElementById("spec-care-instructions").value.trim());
'''
count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)
content = content.replace(old1, "")

old2 = '''    document.getElementById("spec-material").value = "";
    document.getElementById("spec-color").value = "";
    document.getElementById("spec-sleeve").value = "";
    document.getElementById("spec-style").value = "";
    document.getElementById("spec-length").value = "";
    document.getElementById("spec-fit").value = "";
    document.getElementById("spec-pattern").value = "";
    document.getElementById("spec-occasion").value = "";
    document.getElementById("spec-care-instructions").value = "";
'''
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
content = content.replace(old2, '    document.getElementById("specs-list").innerHTML = "";\n')

with open(path, "w") as f:
    f.write(content)

print("DONE_REMOVE_FIXED_SPECS_MANAGER")
