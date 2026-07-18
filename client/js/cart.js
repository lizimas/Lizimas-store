let selectedIndexes = new Set();

function getCart() {
    return JSON.parse(localStorage.getItem("cart")) || [];
}

function saveCart(cart) {
    localStorage.setItem("cart", JSON.stringify(cart));
    updateCartCount();
}

function addToCart(id, name, price, image, description) {
    let cart = getCart();
    let existing = cart.find(item => item.id === id);

    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            id,
            name,
            price: Number(price),
            image,
            description: description || "",
            quantity: 1
        });
    }

    saveCart(cart);
    alert(name + " added to cart");
}

function updateCartCount() {
    const count = document.getElementById("cart-count");
    if (!count) return;

    const cart = getCart();
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    count.textContent = totalItems;
}

function splitNameAndVariant(fullName) {
    const parts = fullName.split(" — ");
    if (parts.length === 2) {
        return { baseName: parts[0], variantLabel: parts[1] };
    }
    return { baseName: fullName, variantLabel: null };
}

function getBaseProductId(cartItemId) {
    const idStr = String(cartItemId);
    const match = idStr.match(/^(\d+)-v\d+$/);
    if (match) {
        return match[1];
    }
    return idStr;
}

function goToChangeVariant(cartItemId) {
    const baseId = getBaseProductId(cartItemId);
    window.location.href = `index.html?openProduct=${baseId}`;
}

function recalculateFooter() {
    const cart = getCart();
    const totalBox = document.getElementById("total");
    const badgeEl = document.getElementById("selected-count-badge");
    const itemCountEl = document.getElementById("cart-item-count");
    const selectAllCheckbox = document.getElementById("select-all-checkbox");

    if (!totalBox) return;

    let total = 0;
    let selectedCount = 0;

    cart.forEach((item, index) => {
        if (selectedIndexes.has(index)) {
            total += Number(item.price) * item.quantity;
            selectedCount++;
        }
    });

    totalBox.textContent = "UGX " + total.toLocaleString();
    if (badgeEl) badgeEl.textContent = selectedCount;
    if (itemCountEl) itemCountEl.textContent = cart.length;
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = cart.length > 0 && selectedCount === cart.length;
    }
}

function toggleItemSelection(index, checked) {
    if (checked) {
        selectedIndexes.add(index);
    } else {
        selectedIndexes.delete(index);
    }
    recalculateFooter();
}

function toggleSelectAll(checked) {
    const cart = getCart();
    selectedIndexes = new Set();

    if (checked) {
        cart.forEach((_, index) => selectedIndexes.add(index));
    }

    document.querySelectorAll(".cart-row-checkbox").forEach(cb => {
        cb.checked = checked;
    });

    recalculateFooter();
}

function changeQuantityPrompt(index) {
    const cart = getCart();
    const current = cart[index].quantity;
    const input = prompt("Enter quantity:", current);

    if (input === null) return;

    const newQty = parseInt(input, 10);

    if (isNaN(newQty) || newQty <= 0) {
        removeFromCart(index);
        return;
    }

    cart[index].quantity = newQty;
    saveCart(cart);
    loadCart();
}

function changeQuantity(index, amount) {
    const cart = getCart();
    cart[index].quantity += amount;

    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
        selectedIndexes = new Set();
    }

    saveCart(cart);
    loadCart();
}

function loadCart() {
    const container = document.getElementById("cartItems");
    const totalBox = document.getElementById("total");

    if (!container || !totalBox) return;

    let cart = getCart();

    if (selectedIndexes.size === 0 && cart.length > 0) {
        cart.forEach((_, index) => selectedIndexes.add(index));
    }

    if (cart.length === 0) {
        container.innerHTML = `<p class="cart-empty-message">Your cart is empty.</p>`;
        recalculateFooter();
        updateCartCount();
        return;
    }

    container.innerHTML = "";

    cart.forEach((item, index) => {
        const imageSrc = item.image
            ? (item.image.startsWith("http") ? item.image : `/${item.image}`)
            : "";

        const isChecked = selectedIndexes.has(index);
        const { baseName, variantLabel } = splitNameAndVariant(item.name);

        container.innerHTML += `
            <div class="cart-row">
                <input
                    type="checkbox"
                    class="circular-checkbox cart-row-checkbox"
                    ${isChecked ? "checked" : ""}
                    onchange="toggleItemSelection(${index}, this.checked)"
                >
                <img src="${imageSrc}" class="cart-row-image" alt="${baseName}">
                <div class="cart-row-details">
                    <p class="cart-row-name">${baseName}</p>
                    <span class="variant-pill" onclick="goToChangeVariant('${item.id}')">${(item.description || variantLabel || "View details").slice(0, 40)} <span class="variant-pill-arrow">›</span></span>
                    <div class="cart-row-price-row">
                        <p class="cart-row-price">UGX ${Number(item.price).toLocaleString()}</p>
                        <div class="cart-row-stepper">
                            <button class="qty-btn" onclick="changeQuantity(${index},-1)">−</button>
                            <span class="qty-value">${item.quantity}</span>
                            <button class="qty-btn" onclick="changeQuantity(${index},1)">+</button>
                        </div>
                    </div>
                </div>
                <button class="cart-row-remove" onclick="removeFromCart(${index})">🗑️</button>
            </div>
        `;
    });

    recalculateFooter();
    updateCartCount();
}

function removeFromCart(index) {
    let cart = getCart();
    cart.splice(index, 1);
    selectedIndexes = new Set();
    saveCart(cart);
    loadCart();
}

updateCartCount();
loadCart();
