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
let lastKnownZone = null;

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
        addressGroup.style.display = "block";
        currentDeliveryFee = null;
    }

    renderOrderSummary();
}

async function calculateDeliveryFee() {
    if (currentDeliveryMethod === "pickup") return;

    const district = document.getElementById("district-select").value;
    const statusEl = document.getElementById("delivery-fee-status");

    if (!district) {
        currentDeliveryFee = null;
        renderOrderSummary();
        return;
    }

    const cart = JSON.parse(localStorage.getItem("cart")) || [];
    const productIds = cart.map(item => parseCartItemId(item.id).productId).filter(Boolean);

    if (productIds.length === 0) {
        currentDeliveryFee = null;
        statusEl.textContent = "Your cart is empty.";
        renderOrderSummary();
        return;
    }

    statusEl.textContent = "Calculating delivery fee...";

    try {
        const result = await apiGet(`/delivery/fee?district=${encodeURIComponent(district)}&product_ids=${productIds.join(",")}&method=delivery`);

        if (result.quoteRequired) {
            currentDeliveryFee = null;
            statusEl.textContent = result.message || "This order requires a custom delivery quote. Contact us to arrange delivery.";
            renderOrderSummary();
            return;
        }

        currentDeliveryFee = result.fee;
        lastKnownZone = result.zone;
        const zoneDisplayEl = document.getElementById("zone-display");
        if (zoneDisplayEl) zoneDisplayEl.textContent = `Delivery Zone: ${result.zone}`;
        statusEl.textContent = `Estimated delivery: ${result.eta}`;
        renderOrderSummary();
    } catch (error) {
        console.error(error);
        currentDeliveryFee = null;
        statusEl.textContent = "Could not calculate fee for that district. Please try again.";
        renderOrderSummary();
    }
}

let allDistricts = [];

async function loadDistricts() {
    try {
        const result = await apiGet("/delivery/districts");
        allDistricts = result.districts || [];
    } catch (error) {
        console.error("Failed to load districts:", error);
        allDistricts = [];
    }
}

function filterDistrictResults() {
    const query = document.getElementById("district-search").value.trim().toLowerCase();
    const dropdown = document.getElementById("district-results-dropdown");

    if (!allDistricts.length) {
        dropdown.innerHTML = "<div class='district-result-empty'>Districts still loading...</div>";
        dropdown.style.display = "block";
        return;
    }

    const matches = query
        ? allDistricts.filter(d => d.district.toLowerCase().includes(query))
        : allDistricts;

    if (matches.length === 0) {
        dropdown.innerHTML = "<div class='district-result-empty'>No matching district found</div>";
        dropdown.style.display = "block";
        return;
    }

    let currentZone = null;
    let html = "";
    matches.forEach(d => {
        if (d.zone !== currentZone) {
            currentZone = d.zone;
            html += `<div class="district-result-zone-label">${d.zone}</div>`;
        }
        const safeName = d.district.replace(/'/g, "\\'");
        html += `<div class="district-result-item" onclick="selectDistrict('${safeName}')">${d.district}</div>`;
    });

    dropdown.innerHTML = html;
    dropdown.style.display = "block";
}

function selectDistrict(districtName) {
    document.getElementById("district-select").value = districtName;
    document.getElementById("district-search").value = districtName;
    document.getElementById("district-results-dropdown").style.display = "none";
    calculateDeliveryFee();
}

document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("district-results-dropdown");
    const searchGroup = document.querySelector(".district-search-group");
    if (dropdown && searchGroup && !searchGroup.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = "none";
    }
});

let pendingOrder = null;
let momoPollInterval = null;

function placeOrder() {
    const firstName = document.getElementById("first-name").value.trim();
    const lastName = document.getElementById("last-name").value.trim();
    const name = `${firstName} ${lastName}`.trim();

    const phoneDigits = document.getElementById("phone").value.trim();
    const altPhoneDigits = document.getElementById("alt-phone").value.trim();
    const phone = phoneDigits ? `+256${phoneDigits}` : "";
    const altPhone = altPhoneDigits ? `+256${altPhoneDigits}` : "";

    const district = document.getElementById("district-select").value;
    const region = document.getElementById("region-select").value;
    const street = document.getElementById("street").value.trim();
    const landmark = document.getElementById("landmark").value.trim();
    const payment = document.getElementById("payment").value;
    const deliveryMethod = document.getElementById("delivery-method").value;

    if (!firstName || !lastName || !phoneDigits) {
        alert("Please complete your name and phone number.");
        return;
    }

    if (phoneDigits.length !== 9) {
        alert("Please enter a valid 9-digit phone number (without the +256 prefix).");
        return;
    }

    if (deliveryMethod === "delivery" && !district) {
        alert("Please select a delivery district.");
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

    let deliveryAddress = "Self pickup - Bugolobi store";
    if (deliveryMethod === "delivery") {
        const addressParts = [];
        if (region) addressParts.push(`${region} Region`);
        addressParts.push(`${district} District`);
        addressParts.push(`Zone: ${lastKnownZone || "N/A"}`);
        if (street) addressParts.push(`Street/Road: ${street}`);
        if (landmark) addressParts.push(`Plot/Landmark: ${landmark}`);
        deliveryAddress = addressParts.join(", ");
    }

    pendingOrder = {
        customer_name: name,
        phone: phone,
        alt_phone: altPhone || null,
        delivery_address: deliveryAddress,
        delivery_method: deliveryMethod,
        delivery_fee: deliveryFee,
        payment_method: payment,
        total: total,
        items: items
    };

    showConfirmModal();
}

function showConfirmModal() {
    const detailsEl = document.getElementById("confirm-order-details");
    const itemCount = pendingOrder.items.reduce((sum, i) => sum + i.quantity, 0);

    detailsEl.innerHTML = `
        <div class="modal-detail-row"><span>Name</span><span>${pendingOrder.customer_name}</span></div>
        <div class="modal-detail-row"><span>Phone</span><span>${pendingOrder.phone}</span></div>
        <div class="modal-detail-row"><span>Items</span><span>${itemCount}</span></div>
        <div class="modal-detail-row"><span>Delivery</span><span>${pendingOrder.delivery_method === "pickup" ? "Self pickup" : "UGX " + pendingOrder.delivery_fee.toLocaleString()}</span></div>
        <div class="modal-detail-row"><span>Payment Method</span><span>${pendingOrder.payment_method}</span></div>
        <div class="modal-detail-row modal-detail-total"><span>Total</span><span>UGX ${pendingOrder.total.toLocaleString()}</span></div>
    `;

    document.getElementById("confirm-order-modal").style.display = "flex";
}

function hideConfirmModal() {
    document.getElementById("confirm-order-modal").style.display = "none";
}

async function confirmAndSubmitOrder() {
    hideConfirmModal();

    try {
        const result = await apiPostAuth("/checkout", pendingOrder);
        const orderId = result.order.id;

        if (pendingOrder.payment_method === "Mobile Money") {
            await startMomoPayment(orderId, pendingOrder.phone);
        } else {
            finishOrderSuccess(orderId);
        }

    } catch (error) {
        console.error(error);
        alert("Unable to place your order. Please try again.");
    }
}

function finishOrderSuccess(orderId) {
    alert(
        `Thank you for shopping with Lizimas & Talent Enterprise!\n\nOrder #${orderId} has been received.`
    );
    localStorage.removeItem("cart");
    window.location.href = "index.html";
}

async function startMomoPayment(orderId, phone) {
    document.getElementById("momo-waiting-modal").style.display = "flex";
    document.getElementById("momo-waiting-text").textContent =
        "A payment prompt has been sent to your phone. Approve it to complete your order.";

    try {
        const payResult = await apiPost("/momo/pay", { orderId, phoneNumber: phone });
        const referenceId = payResult.referenceId;

        pollMomoStatus(referenceId, orderId);

    } catch (error) {
        console.error(error);
        document.getElementById("momo-waiting-modal").style.display = "none";
        alert("Could not start Mobile Money payment. Your order was saved as pending - please try paying again from your order history, or contact us.");
        localStorage.removeItem("cart");
        window.location.href = "index.html";
    }
}

function pollMomoStatus(referenceId, orderId) {
    let attempts = 0;
    const maxAttempts = 20;

    momoPollInterval = setInterval(async () => {
        attempts++;

        try {
            const statusResult = await apiGet(`/momo/status/${referenceId}`);

            if (statusResult.status === "SUCCESSFUL" || statusResult.status === "verified") {
                clearInterval(momoPollInterval);
                document.getElementById("momo-waiting-modal").style.display = "none";
                finishOrderSuccess(orderId);
                return;
            }

            if (statusResult.status === "FAILED" || statusResult.status === "REJECTED") {
                clearInterval(momoPollInterval);
                document.getElementById("momo-waiting-modal").style.display = "none";
                alert("Payment was not approved. Your order is saved as pending - you can try paying again from your order history.");
                localStorage.removeItem("cart");
                window.location.href = "index.html";
                return;
            }

        } catch (error) {
            console.error("Status check error:", error);
        }

        if (attempts >= maxAttempts) {
            clearInterval(momoPollInterval);
            document.getElementById("momo-waiting-modal").style.display = "none";
            alert("We could not confirm your payment yet. Your order is saved as pending - we will update it once payment is confirmed.");
            localStorage.removeItem("cart");
            window.location.href = "index.html";
        }
    }, 3000);
}

function cancelMomoWait() {
    if (momoPollInterval) clearInterval(momoPollInterval);
    document.getElementById("momo-waiting-modal").style.display = "none";
    alert("Payment cancelled. Your order is saved as pending - you can complete payment later from your order history.");
    localStorage.removeItem("cart");
    window.location.href = "index.html";
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("confirm-order-cancel").addEventListener("click", hideConfirmModal);
    document.getElementById("confirm-order-proceed").addEventListener("click", confirmAndSubmitOrder);
    document.getElementById("momo-cancel-wait").addEventListener("click", cancelMomoWait);
});

document.addEventListener("DOMContentLoaded", () => {
    renderOrderSummary();
    loadDistricts();
});




// --- Leaflet map picker (Select on Map / Share Live Location) ---
let leafletMapInstance = null;
let leafletMarker = null;
let selectedMapAddressText = "";

function initLeafletMapIfNeeded() {
    if (leafletMapInstance) return;

    leafletMapInstance = L.map("leaflet-map").setView([0.3476, 32.5825], 12); // Kampala default

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(leafletMapInstance);

    leafletMarker = L.marker([0.3476, 32.5825], { draggable: true }).addTo(leafletMapInstance);

    leafletMarker.on("dragend", () => {
        const pos = leafletMarker.getLatLng();
        reverseGeocodeAndPreview(pos.lat, pos.lng);
    });

    leafletMapInstance.on("click", (e) => {
        leafletMarker.setLatLng(e.latlng);
        reverseGeocodeAndPreview(e.latlng.lat, e.latlng.lng);
    });
}

function toggleMapPicker() {
    const container = document.getElementById("map-picker-container");
    const isHidden = container.style.display === "none" || !container.style.display;

    if (isHidden) {
        container.style.display = "block";
        initLeafletMapIfNeeded();
        setTimeout(() => { leafletMapInstance.invalidateSize(); }, 100);
    } else {
        container.style.display = "none";
    }
}

function useLiveLocation() {
    const previewEl = document.getElementById("map-address-preview");

    if (!navigator.geolocation) {
        alert("Location services are not available on this device.");
        return;
    }

    const container = document.getElementById("map-picker-container");
    container.style.display = "block";
    initLeafletMapIfNeeded();

    previewEl.textContent = "Getting your location...";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            leafletMapInstance.setView([lat, lng], 16);
            leafletMarker.setLatLng([lat, lng]);
            setTimeout(() => { leafletMapInstance.invalidateSize(); }, 100);

            reverseGeocodeAndPreview(lat, lng);
        },
        (error) => {
            console.error(error);
            previewEl.textContent = "Could not access your location. Please select on the map instead.";
        }
    );
}

async function reverseGeocodeAndPreview(lat, lng) {
    const previewEl = document.getElementById("map-address-preview");
    previewEl.textContent = "Looking up address...";

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
        const response = await fetch(url, {
            headers: { "User-Agent": "LizimasStore/1.0 (checkout address lookup)" }
        });
        const data = await response.json();

        selectedMapAddressText = (data && data.display_name) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        previewEl.textContent = selectedMapAddressText;
    } catch (error) {
        console.error("Reverse geocoding failed:", error);
        selectedMapAddressText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        previewEl.textContent = "Could not look up address name, but location was captured.";
    }
}

function confirmMapLocation() {
    if (!selectedMapAddressText) {
        alert("Please select a location on the map first.");
        return;
    }

    const parts = selectedMapAddressText.split(",").map(p => p.trim());
    document.getElementById("street").value = parts[0] || selectedMapAddressText;
    document.getElementById("landmark").value = parts.slice(1, 3).join(", ") || "";

    document.getElementById("map-picker-container").style.display = "none";
}
