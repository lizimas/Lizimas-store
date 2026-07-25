path = "client/js/product-detail.js"

with open(path, "r") as f:
    content = f.read()

old = '''        document.getElementById("pd-name").textContent = product.name || "";
        document.getElementById("pd-main-image").src = product.image || "";
        document.getElementById("pd-main-image").alt = product.name || "";
        document.getElementById("pd-price").textContent = product.price'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        document.getElementById("pd-name").textContent = product.name || "";
        await loadGallery(id, product);
        document.getElementById("pd-price").textContent = product.price'''

content = content.replace(old, new)

# Add the loadGallery function before renderSpecs
old2 = "function renderSpecs(product) {"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)

new2 = '''async function loadGallery(id, product) {
    const scrollContainer = document.getElementById("pd-gallery-scroll");
    const counter = document.getElementById("pd-gallery-counter");
    scrollContainer.innerHTML = "";

    let images = [];
    try {
        const res = await fetch(`/api/products/${id}/images`);
        if (res.ok) images = await res.json();
    } catch (err) {
        console.error("Failed to load gallery images", err);
    }

    const imagePaths = images.length > 0
        ? images.map(img => img.image_path)
        : [product.image];

    imagePaths.forEach(src => {
        const img = document.createElement("img");
        img.src = src || "";
        img.alt = product.name || "";
        scrollContainer.appendChild(img);
    });

    counter.textContent = `1/${imagePaths.length}`;

    scrollContainer.onscroll = () => {
        const index = Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth) + 1;
        counter.textContent = `${index}/${imagePaths.length}`;
    };
}

function renderSpecs(product) {'''

content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: gallery JS patched")
