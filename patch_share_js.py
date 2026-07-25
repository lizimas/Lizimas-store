path = "client/js/product-detail.js"

with open(path, "r") as f:
    content = f.read()

old = '''        document.getElementById("pd-add-to-cart-btn").onclick = () => {
            addToCart(product.id, product.name, product.price, product.image, product.description);
        };'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        document.getElementById("pd-add-to-cart-btn").onclick = () => {
            addToCart(product.id, product.name, product.price, product.image, product.description);
        };

        document.getElementById("pd-fullscreen-share").onclick = () => sharePdProduct(product);'''

content = content.replace(old, new)

old2 = "document.getElementById(\"pd-fullscreen-close\").onclick = closeFullscreenViewer;"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)

new2 = '''document.getElementById("pd-fullscreen-close").onclick = closeFullscreenViewer;

async function sharePdProduct(product) {
    const shareData = {
        title: product.name || "Check out this product",
        text: `${product.name || "Check this out"} - UGX ${Number(product.price).toLocaleString()}`,
        url: window.location.href
    };

    if (navigator.share) {
        try {
            await navigator.share(shareData);
        } catch (err) {
            console.log("Share cancelled or failed", err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(shareData.url);
            alert("Link copied to clipboard!");
        } catch (err) {
            console.error("Copy failed", err);
        }
    }
}'''

content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: share JS wired up")
