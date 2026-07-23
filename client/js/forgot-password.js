async function sendResetLink() {
    const email = document.getElementById("forgot-email").value.trim();
    const statusEl = document.getElementById("forgot-status");

    if (!email) {
        statusEl.textContent = "Please enter your email address.";
        return;
    }

    statusEl.textContent = "Sending...";

    try {
        const result = await apiPost("/auth/forgot-password", { email });
        statusEl.textContent = result.message || "If an account with that email exists, a password reset link has been sent.";
    } catch (error) {
        console.error(error);
        statusEl.textContent = "Something went wrong. Please try again.";
    }
}
