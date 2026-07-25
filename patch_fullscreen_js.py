path = "client/js/product-detail.js"

with open(path, "r") as f:
    content = f.read()

old = '''    imagePaths.forEach(src => {
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
}'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''    pdGalleryImages = imagePaths;
    pdGalleryAlt = product.name || "";

    imagePaths.forEach((src, index) => {
        const img = document.createElement("img");
        img.src = src || "";
        img.alt = product.name || "";
        img.onclick = () => openFullscreenViewer(index);
        scrollContainer.appendChild(img);
    });

    counter.textContent = `1/${imagePaths.length}`;
    counter.onclick = () => openFullscreenViewer(getCurrentGalleryIndex());

    scrollContainer.onscroll = () => {
        const index = getCurrentGalleryIndex();
        counter.textContent = `${index + 1}/${imagePaths.length}`;
    };
}

function getCurrentGalleryIndex() {
    const scrollContainer = document.getElementById("pd-gallery-scroll");
    return Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth);
}

let pdGalleryImages = [];
let pdGalleryAlt = "";
let pdTouchStartY = 0;

function openFullscreenViewer(startIndex) {
    const viewer = document.getElementById("pd-fullscreen-viewer");
    const scrollContainer = document.getElementById("pd-fullscreen-scroll");
    const counter = document.getElementById("pd-fullscreen-counter");

    scrollContainer.innerHTML = "";
    pdGalleryImages.forEach(src => {
        const img = document.createElement("img");
        img.src = src || "";
        img.alt = pdGalleryAlt;
        img.onclick = closeFullscreenViewer;
        scrollContainer.appendChild(img);
    });

    viewer.classList.remove("hidden");

    requestAnimationFrame(() => {
        scrollContainer.scrollLeft = startIndex * scrollContainer.clientWidth;
        counter.textContent = `${startIndex + 1}/${pdGalleryImages.length}`;
    });

    scrollContainer.onscroll = () => {
        const index = Math.round(scrollContainer.scrollLeft / scrollContainer.clientWidth);
        counter.textContent = `${index + 1}/${pdGalleryImages.length}`;
    };

    viewer.addEventListener("touchstart", handleFullscreenTouchStart);
    viewer.addEventListener("touchend", handleFullscreenTouchEnd);
}

function closeFullscreenViewer() {
    const viewer = document.getElementById("pd-fullscreen-viewer");
    viewer.classList.add("hidden");
    viewer.removeEventListener("touchstart", handleFullscreenTouchStart);
    viewer.removeEventListener("touchend", handleFullscreenTouchEnd);
}

function handleFullscreenTouchStart(e) {
    pdTouchStartY = e.touches[0].clientY;
}

function handleFullscreenTouchEnd(e) {
    const deltaY = e.changedTouches[0].clientY - pdTouchStartY;
    if (deltaY > 80) {
        closeFullscreenViewer();
    }
}

document.getElementById("pd-fullscreen-close").onclick = closeFullscreenViewer;'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: fullscreen JS added")
