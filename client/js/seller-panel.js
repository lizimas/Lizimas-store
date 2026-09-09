// Shared "Seller Information" panel - used on both the product detail page
// (a compact box in the sidebar, sourced from the vendor's slug already on
// the product) and the storefront page itself. Renders the seller score
// badge, follower count + Follow button, and the Excellent/Good/Fair/Poor
// performance checklist Jumia's seller box uses - all computed server-side
// by server/utils/sellerScore.js so nothing here ever shows a commission
// rate or amount, which sellers must never see (Ryan, Sept 2026).

function spEscape(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function spFetchStore(slug) {
    const res = await fetch(`/api/vendors/store/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return res.json();
}

async function spCheckFollowing(vendorId) {
    const token = localStorage.getItem("userToken");
    if (!token) return null; // not logged in - caller shows a plain "Follow" that prompts login on click
    try {
        const res = await fetch(`/api/vendors/${vendorId}/follow-status`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return !!data.following;
    } catch (error) {
        console.error("Follow status check error:", error);
        return null;
    }
}

function spPerformanceRow(label, value) {
    const level = String(value || "New").toLowerCase();
    return `<li class="seller-perf-item seller-perf-${level}"><span class="seller-perf-dot"></span>${label}: <strong>${spEscape(value)}</strong></li>`;
}

// Renders into `container` and wires the Follow button. `vendor`/`sellerScore`/
// `followerCount` are the fields from GET /api/vendors/store/:slug.
async function renderSellerPanel(container, { vendor, sellerScore, followerCount }, options = {}) {
    const scoreBadge = sellerScore && !sellerScore.isNew
        ? `<span class="seller-score-badge">${sellerScore.score}%</span>`
        : `<span class="seller-score-badge seller-score-new">New Seller</span>`;

    const visitLink = options.showVisitLink
        ? `<a href="/store/${spEscape(vendor.slug)}" class="seller-visit-link">Visit Store</a>`
        : "";

    const performanceHtml = sellerScore && !sellerScore.isNew
        ? `<ul class="seller-performance-list">
            ${spPerformanceRow("Shipping speed", sellerScore.performance.shipping)}
            ${spPerformanceRow("Quality Score", sellerScore.performance.quality)}
            ${spPerformanceRow("Customer Rating", sellerScore.performance.rating)}
            ${spPerformanceRow("Cancellation Rate", sellerScore.performance.cancellation)}
           </ul>`
        : `<p class="seller-performance-empty">This store is still building up order history for a performance score.</p>`;

    container.innerHTML = `
        <div class="seller-panel-head">
            <a href="/store/${spEscape(vendor.slug)}" class="seller-panel-name">${spEscape(vendor.business_name)}</a>
            ${scoreBadge}
        </div>
        <div class="seller-panel-meta">
            <span class="seller-followers" id="seller-follower-count">${Number(followerCount || 0).toLocaleString()} Followers</span>
            <button type="button" class="seller-follow-btn" id="seller-follow-btn">Follow</button>
            ${visitLink}
        </div>
        ${performanceHtml}
    `;

    const followBtn = container.querySelector("#seller-follow-btn");
    const followerCountEl = container.querySelector("#seller-follower-count");
    let isFollowing = await spCheckFollowing(vendor.id);
    if (isFollowing) {
        followBtn.textContent = "Following";
        followBtn.classList.add("seller-following");
    }

    followBtn.onclick = async () => {
        const token = localStorage.getItem("userToken");
        if (!token) {
            window.location.href = "/login.html";
            return;
        }
        followBtn.disabled = true;
        try {
            const method = isFollowing ? "DELETE" : "POST";
            const res = await fetch(`/api/vendors/${vendor.id}/follow`, {
                method,
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Follow request failed");
            const data = await res.json();
            isFollowing = data.following;
            followBtn.textContent = isFollowing ? "Following" : "Follow";
            followBtn.classList.toggle("seller-following", isFollowing);
            followerCountEl.textContent = `${Number(data.followerCount || 0).toLocaleString()} Followers`;
        } catch (error) {
            console.error("Follow toggle error:", error);
        } finally {
            followBtn.disabled = false;
        }
    };
}
