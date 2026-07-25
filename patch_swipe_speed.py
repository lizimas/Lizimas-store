path = "client/css/product-detail.css"

with open(path, "r") as f:
    content = f.read()

old1 = ".pd-gallery-scroll img { flex: 0 0 100%; width: 100%; scroll-snap-align: center; object-fit: cover; display: block; }"
count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)
new1 = ".pd-gallery-scroll img { flex: 0 0 100%; width: 100%; scroll-snap-align: center; scroll-snap-stop: always; object-fit: cover; display: block; }"
content = content.replace(old1, new1)

old2 = ".pd-fullscreen-scroll img { flex: 0 0 100%; width: 100%; height: 100%; object-fit: contain; scroll-snap-align: center; }"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
new2 = ".pd-fullscreen-scroll img { flex: 0 0 100%; width: 100%; height: 100%; object-fit: contain; scroll-snap-align: center; scroll-snap-stop: always; }"
content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("DONE_SWIPE_SPEED_PATCH")
