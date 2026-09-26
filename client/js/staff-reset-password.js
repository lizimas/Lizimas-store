// Staff/admin counterpart of js/reset-password.js. Same backend endpoint
// (/auth/reset-password is role-agnostic - it just validates the JWT and
// updates whichever user id is in it), only the page chrome and the
// post-reset redirect differ: this one sends staff back to the staff
// login page instead of the customer storefront login.
function getResetToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get("token");
}

async function submitStaffPasswordReset() {
    const token = getResetToken();
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    const statusEl = document.getElementById("reset-status");

    if (!token) {
        statusEl.textContent = "This reset link is invalid or missing a token. Please request a new one.";
        return;
    }

    if (!newPassword || !confirmPassword) {
        statusEl.textContent = "Please fill in both password fields.";
        return;
    }

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(newPassword)) {
        statusEl.textContent = "Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.";
        return;
    }

    if (newPassword !== confirmPassword) {
        statusEl.textContent = "Passwords do not match.";
        return;
    }

    statusEl.textContent = "Resetting your password...";

    try {
        const result = await apiPost("/auth/reset-password", { token, newPassword });
        statusEl.textContent = result.message || "Password reset successfully.";

        setTimeout(() => {
            // Admin team members (invited from Admin > Users & Permissions)
            // sign in on the admin page, not the staff login.
            window.location.href = new URLSearchParams(window.location.search).get("portal") === "admin"
                ? "admin.html" : "staff-login.html";
        }, 2000);

    } catch (error) {
        console.error(error);
        statusEl.textContent = error.message || "This reset link has expired or is invalid. Please request a new one.";
    }
}
