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

function ordEscape(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function ordStars(rating) {
    const filled = Math.round(Number(rating) || 0);
    let out = "";
    for (let i = 1; i <= 5; i++) {
        out += '<span class="ord-star' + (i <= filled ? " filled" : "") + '">\u2605</span>';
    }
    return out;
}

// Only delivered orders can be reviewed - this mirrors the server gate in
// reviewController. Anything else renders as a plain line item.
function renderOrderItems(order) {
    if (!Array.isArray(order.items) || order.items.length === 0) return "";

    const reviewable = order.status === "delivered";

    return '<div class="ord-items">' + order.items.map(function (item) {
        const name = ordEscape(item.product_name);
        const qty = Number(item.quantity) || 1;
        let action = "";

        if (reviewable) {
            const hasReview = item.review_id != null;
            const label = hasReview ? "Edit review" : "Review";
            action =
                '<button type="button" class="ord-review-btn" ' +
                        'onclick="toggleReviewForm(' + item.product_id + ')">' +
                    label +
                "</button>" +
                (hasReview
                    ? '<span class="ord-review-current">' + ordStars(item.review_rating) + "</span>"
                    : "");
        }

        return '<div class="ord-item">' +
            '<div class="ord-item-row">' +
                '<span class="ord-item-name">' + name + " &times; " + qty + "</span>" +
                action +
            "</div>" +
            (reviewable ? renderReviewForm(item) : "") +
        "</div>";
    }).join("") + "</div>";
}

function renderReviewForm(item) {
    const pid = item.product_id;
    const rating = Number(item.review_rating) || 0;
    const comment = ordEscape(item.review_comment || "");

    let stars = "";
    for (let i = 1; i <= 5; i++) {
        stars +=
            '<button type="button" class="ord-rate-star' + (i <= rating ? " filled" : "") + '" ' +
                    'data-value="' + i + '" ' +
                    'onclick="setReviewRating(' + pid + ", " + i + ')">\u2605</button>';
    }

    return '<div class="ord-review-form" id="ord-review-form-' + pid + '" hidden ' +
                'data-rating="' + rating + '">' +
        '<div class="ord-rate-row" id="ord-rate-row-' + pid + '">' + stars + "</div>" +
        '<textarea class="ord-review-text" id="ord-review-text-' + pid + '" rows="3" ' +
                  'placeholder="Tell other shoppers what you think">' + comment + "</textarea>" +
        '<div class="ord-review-actions">' +
            '<button type="button" class="ord-review-submit" ' +
                    'onclick="submitReview(' + pid + ')">Submit</button>' +
            '<span class="ord-review-status" id="ord-review-status-' + pid + '"></span>' +
        "</div>" +
    "</div>";
}

function toggleReviewForm(productId) {
    const form = document.getElementById("ord-review-form-" + productId);
    if (form) form.hidden = !form.hidden;
}

function setReviewRating(productId, value) {
    const form = document.getElementById("ord-review-form-" + productId);
    if (!form) return;

    form.dataset.rating = String(value);

    const row = document.getElementById("ord-rate-row-" + productId);
    if (!row) return;

    row.querySelectorAll(".ord-rate-star").forEach(function (star) {
        star.classList.toggle("filled", Number(star.dataset.value) <= value);
    });
}

async function submitReview(productId) {
    const form = document.getElementById("ord-review-form-" + productId);
    const statusEl = document.getElementById("ord-review-status-" + productId);
    if (!form) return;

    const rating = Number(form.dataset.rating) || 0;
    if (rating < 1) {
        if (statusEl) statusEl.textContent = "Pick a star rating first.";
        return;
    }

    const textEl = document.getElementById("ord-review-text-" + productId);
    const comment = textEl ? textEl.value.trim() : "";

    if (statusEl) statusEl.textContent = "Saving...";

    try {
        await apiPostAuth("/reviews/product/" + productId, { rating: rating, comment: comment });
        if (statusEl) statusEl.textContent = "Thanks - your review is live.";
        setTimeout(loadMyOrders, 900);
    } catch (error) {
        if (statusEl) statusEl.textContent = error.message || "Could not save your review.";
    }
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
            ${renderOrderItems(order)}
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
