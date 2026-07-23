function getResetToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get("token");
}

async function submitNewPassword() {
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

    if (newPassword.length < 6) {
        statusEl.textContent = "Password must be at least 6 characters.";
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
            window.location.href = "login.html";
        }, 2000);

    } catch (error) {
        console.error(error);
        statusEl.textContent = "This reset link has expired or is invalid. Please request a new one.";
    }
}
