function parseCartItemId(cartItemId) {
    const idStr = String(cartItemId);
    const match = idStr.match(/^(\d+)-v(\d+)$/);
    if (match) {
        return { productId: Number(match[1]), variantId: Number(match[2]) };
    }
    return { productId: Number(idStr), variantId: null };
}

let currentDeliveryFee = null;
let currentDeliveryMethod = "delivery";

function getCartTotal() {
    const cart = JSON.parse(localStorage.getItem("cart")) || [];
    return cart.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
}

function renderOrderSummary() {
    const productTotal = getCartTotal();
    document.getElementById("order-product-total").textContent = "UGX " + productTotal.toLocaleString();

    const feeEl = document.getElementById("order-delivery-fee");
    const totalEl = document.getElementById("order-total-amount");

    if (currentDeliveryMethod === "pickup") {
        feeEl.textContent = "Free";
        totalEl.textContent = "UGX " + productTotal.toLocaleString();
        return;
    }

    if (currentDeliveryFee === null) {
        feeEl.textContent = "Enter address";
        totalEl.textContent = "UGX " + productTotal.toLocaleString();
        return;
    }

    feeEl.textContent = "UGX " + currentDeliveryFee.toLocaleString();
    totalEl.textContent = "UGX " + (productTotal + currentDeliveryFee).toLocaleString();
}

function onDeliveryMethodChange() {
    const method = document.getElementById("delivery-method").value;
    currentDeliveryMethod = method;

    const addressGroup = document.getElementById("address-group");
    const statusEl = document.getElementById("delivery-fee-status");

    if (method === "pickup") {
        addressGroup.style.display = "none";
        statusEl.textContent = "";
        currentDeliveryFee = 0;
    } else {
        addressGroup.style.display = "flex";
        currentDeliveryFee = null;
    }

    renderOrderSummary();
}

async function calculateDeliveryFee() {
    if (currentDeliveryMethod === "pickup") return;

    const address = document.getElementById("address").value.trim();
    const statusEl = document.getElementById("delivery-fee-status");

    if (!address) {
        currentDeliveryFee = null;
        renderOrderSummary();
        return;
    }

    statusEl.textContent = "Calculating delivery fee...";

    try {
        const result = await apiGet(`/delivery/fee?address=${encodeURIComponent(address)}&method=delivery`);
        currentDeliveryFee = result.fee;
        statusEl.textContent = `Approx. ${result.distanceKm} km from our Bugolobi store`;
        renderOrderSummary();
    } catch (error) {
        console.error(error);
        currentDeliveryFee = null;
        statusEl.textContent = "Could not calculate fee. Please check the address and try again.";
        renderOrderSummary();
    }
}

async function placeOrder() {
    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const address = document.getElementById("address").value.trim();
    const payment = document.getElementById("payment").value;
    const deliveryMethod = document.getElementById("delivery-method").value;

    if (!name || !phone) {
        alert("Please complete your name and phone number.");
        return;
    }

    if (deliveryMethod === "delivery" && !address) {
        alert("Please enter a delivery address.");
        return;
    }

    if (deliveryMethod === "delivery" && currentDeliveryFee === null) {
        alert("Please wait for the delivery fee to be calculated before placing your order.");
        return;
    }

    const cart = JSON.parse(localStorage.getItem("cart")) || [];

    if (cart.length === 0) {
        alert("Your cart is empty.");
        return;
    }

    const productTotal = getCartTotal();
    const deliveryFee = deliveryMethod === "pickup" ? 0 : currentDeliveryFee;
    const total = productTotal + deliveryFee;

    const items = cart.map(item => {
        const { productId, variantId } = parseCartItemId(item.id);
        return {
            productId,
            variantId,
            quantity: item.quantity
        };
    });

    const order = {
        customer_name: name,
        phone: phone,
        delivery_address: deliveryMethod === "pickup" ? "Self pickup - Bugolobi store" : address,
        delivery_method: deliveryMethod,
        delivery_fee: deliveryFee,
        payment_method: payment,
        total: total,
        items: items
    };

    try {
        const result = await apiPost("/checkout", order);

        alert(
            `Thank you for shopping with Lizimas & Talent Enterprise Ltd!\n\nOrder #${result.order.id} has been received.`
        );

        localStorage.removeItem("cart");

        window.location.href = "index.html";

    } catch (error) {
        console.error(error);
        alert("Unable to place your order. Please try again.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    renderOrderSummary();
});

function useMyLocation() {
    const statusEl = document.getElementById("delivery-fee-status");

    if (!navigator.geolocation) {
        statusEl.textContent = "Location services are not available on this device.";
        return;
    }

    statusEl.textContent = "Getting your location...";

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            statusEl.textContent = "Calculating delivery fee...";

            try {
                const result = await apiGet(`/delivery/fee?lat=${lat}&lng=${lng}&method=delivery`);

                currentDeliveryFee = result.fee;
                document.getElementById("address").value = result.resolvedAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                statusEl.textContent = `Approx. ${result.distanceKm} km from our Bugolobi store`;
                renderOrderSummary();

            } catch (error) {
                console.error(error);
                statusEl.textContent = "Could not calculate fee for your location. Please type your address instead.";
            }
        },
        (error) => {
            console.error(error);
            statusEl.textContent = "Could not access your location. Please allow location access or type your address instead.";
        }
    );
}
