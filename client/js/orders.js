const STATUS_LABELS = {
    pending: "Pending",
    paid: "Payment Confirmed",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled"
};

const STATUS_COLORS = {
    pending: "#999999",
    paid: "#FF6600",
    shipped: "#2563EB",
    delivered: "#16A34A",
    cancelled: "#DC2626"
};

function statusBadgeHtml(status) {
    const label = STATUS_LABELS[status] || status;
    const color = STATUS_COLORS[status] || "#999999";
    return `<span style="display:inline-block; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; color:#FFFFFF; background:${color};">${label}</span>`;
}

function formatDate(dateString) {
    const d = new Date(dateString);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function renderOrderCard(order) {
    return `
        <div style="border:1px solid #E5E7EB; border-radius:14px; padding:16px; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <strong style="font-size:15px;">Order #${order.id}</strong>
                ${statusBadgeHtml(order.status)}
            </div>
            <p style="font-size:13px; color:#666666; margin:4px 0;">${formatDate(order.created_at)}</p>
            <p style="font-size:14px; color:#111827; margin:4px 0;">Total: UGX ${Number(order.total).toLocaleString()}</p>
            <p style="font-size:13px; color:#666666; margin:4px 0;">${order.delivery_method === "pickup" ? "Self Pickup" : "Home Delivery"}</p>
        </div>
    `;
}

async function loadMyOrders() {
    const token = localStorage.getItem("userToken");
    const navLink = document.getElementById("nav-account-link");

    if (!token) {
        document.getElementById("logged-out-card").style.display = "block";
        navLink.innerHTML = `<a href="login.html">Login</a>`;
        return;
    }

    navLink.innerHTML = `<a href="#" onclick="logoutAccount(); return false;">Log Out</a>`;

    const myOrdersCard = document.getElementById("my-orders-card");
    const listEl = document.getElementById("my-orders-list");
    myOrdersCard.style.display = "block";
    listEl.innerHTML = "<p class='delivery-fee-status'>Loading your orders...</p>";

    try {
        const orders = await apiGetAuth("/checkout/my-orders");

        if (!orders || orders.length === 0) {
            listEl.innerHTML = "<p class='delivery-fee-status'>You haven't placed any orders yet.</p>";
            return;
        }

        listEl.innerHTML = orders.map(renderOrderCard).join("");

    } catch (error) {
        console.error(error);
        listEl.innerHTML = "<p class='delivery-fee-status'>Could not load your orders. Please try logging in again.</p>";
    }
}

function logoutAccount() {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userInfo");
    window.location.reload();
}

async function trackGuestOrder() {
    const orderId = document.getElementById("track-order-id").value.trim();
    const phone = document.getElementById("track-phone").value.trim();
    const statusEl = document.getElementById("track-status");
    const resultEl = document.getElementById("track-result");

    resultEl.innerHTML = "";

    if (!orderId || !phone) {
        statusEl.textContent = "Please enter both your Order ID and phone number.";
        return;
    }

    statusEl.textContent = "Looking up your order...";

    try {
        const result = await apiGet(`/checkout/track?order_id=${encodeURIComponent(orderId)}&phone=${encodeURIComponent(phone)}`);
        statusEl.textContent = "";

        const order = result.order;
        const items = result.items || [];

        const itemsHtml = items.map(item =>
            `<p style="font-size:13px; color:#666666; margin:4px 0;">${item.quantity} x ${item.product_name} - UGX ${Number(item.price).toLocaleString()}</p>`
        ).join("");

        resultEl.innerHTML = `
            <div style="border:1px solid #E5E7EB; border-radius:14px; padding:16px; margin-top:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="font-size:15px;">Order #${order.id}</strong>
                    ${statusBadgeHtml(order.status)}
                </div>
                <p style="font-size:13px; color:#666666; margin:4px 0;">${formatDate(order.created_at)}</p>
                <p style="font-size:14px; color:#111827; margin:8px 0 4px;">Items:</p>
                ${itemsHtml}
                <p style="font-size:14px; font-weight:bold; color:#111827; margin:8px 0 0;">Total: UGX ${Number(order.total).toLocaleString()}</p>
            </div>
        `;

    } catch (error) {
        console.error(error);
        statusEl.textContent = "No matching order found. Please check your Order ID and phone number.";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadMyOrders();
});
