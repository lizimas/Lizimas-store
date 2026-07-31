let forgotCooldownTimer = null;

async function sendResetLink() {
    const email = document.getElementById("forgot-email").value.trim();
    const statusEl = document.getElementById("forgot-status");
    const btn = document.getElementById("forgot-submit-btn");

    if (!email) {
        statusEl.textContent = "Please enter your email address.";
        return;
    }

    if (btn && btn.disabled) return;

    statusEl.textContent = "Sending...";
    if (btn) btn.disabled = true;

    try {
        const result = await apiPost("/auth/forgot-password", { email });
        statusEl.textContent = result.message || "If an account with that email exists, a password reset link has been sent.";
        startForgotCooldown(60);
    } catch (error) {
        console.error(error);
        statusEl.textContent = "Something went wrong. Please try again.";
        if (btn) btn.disabled = false;
    }
}

// Convenience only - stops accidental double taps and inbox spam.
// The real protection is the server side limiter on /forgot-password.
function startForgotCooldown(seconds) {
    const btn = document.getElementById("forgot-submit-btn");
    if (!btn) return;

    const label = "Send Reset Link";
    let remaining = seconds;

    btn.disabled = true;
    btn.textContent = `Resend in ${remaining}s`;

    clearInterval(forgotCooldownTimer);
    forgotCooldownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(forgotCooldownTimer);
            btn.disabled = false;
            btn.textContent = label;
        } else {
            btn.textContent = `Resend in ${remaining}s`;
        }
    }, 1000);
}
