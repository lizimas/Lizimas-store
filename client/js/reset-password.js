// Reset password (customers and vendors). The emailed link carries
// ?portal=customer|vendor so the page shows the right password rule and sends
// the person back to the right sign-in page afterwards.
const RESET_PORTAL = new URLSearchParams(window.location.search).get("portal") === "vendor" ? "vendor" : "customer";
const RESET_RULES = {
    customer: { re: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/, text: "At least 8 characters, including a letter and a number." },
    vendor: { re: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, text: "At least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol." }
};
const LOGIN_PAGE = RESET_PORTAL === "vendor" ? "vendor-login.html" : "login.html";

function getResetToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get("token");
}

(function setupResetPage() {
    const rule = document.getElementById("reset-rule");
    if (rule) rule.textContent = RESET_RULES[RESET_PORTAL].text;
    document.querySelectorAll("[data-login-link]").forEach((a) => {
        a.href = LOGIN_PAGE;
        if (RESET_PORTAL === "vendor") a.textContent = a.textContent.replace("Sign in", "Vendor Sign in");
    });
    if (RESET_PORTAL === "vendor") {
        const sub = document.getElementById("reset-subtitle");
        if (sub) sub.textContent = "Choose a new password for your vendor account.";
        const badge = document.getElementById("auth-badge-text");
        if (badge) badge.textContent = "Vendor Account";
    }
    if (!getResetToken()) {
        const s = document.getElementById("reset-status");
        if (s) s.textContent = "This reset link is incomplete. Please request a new one from the Forgot password page.";
    }
})();

async function submitNewPassword() {
    const token = getResetToken();
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    const statusEl = document.getElementById("reset-status");
    const btn = document.getElementById("reset-submit-btn");
    statusEl.classList.remove("is-ok");

    if (!token) {
        statusEl.textContent = "This reset link is invalid or missing a token. Please request a new one.";
        return;
    }
    if (!newPassword || !confirmPassword) {
        statusEl.textContent = "Please fill in both password fields.";
        return;
    }
    if (!RESET_RULES[RESET_PORTAL].re.test(newPassword)) {
        statusEl.textContent = RESET_RULES[RESET_PORTAL].text;
        return;
    }
    if (newPassword !== confirmPassword) {
        statusEl.textContent = "Passwords do not match.";
        return;
    }

    statusEl.textContent = "Saving your new password...";
    if (btn) btn.disabled = true;

    try {
        const result = await apiPost("/auth/reset-password", { token, newPassword });
        statusEl.classList.add("is-ok");
        statusEl.textContent = (result.message || "Password reset successfully.") + " Taking you to sign in...";
        const dest = result.role && result.role !== "customer" ? "vendor-login.html" : LOGIN_PAGE;
        setTimeout(() => { window.location.href = dest; }, 2000);
    } catch (error) {
        console.error(error);
        statusEl.textContent = error.message || "This reset link has expired or is invalid. Please request a new one.";
        if (btn) btn.disabled = false;
    }
}
