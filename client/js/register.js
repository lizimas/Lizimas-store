async function registerAccount() {
    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const phoneDigits = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-password").value;
    const statusEl = document.getElementById("register-status");

    if (!name || !email || !password) {
        statusEl.textContent = "Please fill in your name, email, and password.";
        return;
    }

    if (password.length < 6) {
        statusEl.textContent = "Password must be at least 6 characters.";
        return;
    }

    // Consent must be actively given, so the box starts unchecked and
    // registration is blocked until the customer ticks it themselves.
    const consentEl = document.getElementById("reg-privacy-consent");
    if (consentEl && !consentEl.checked) {
        statusEl.textContent = "Please read and agree to the Privacy Policy to continue.";
        return;
    }

    // The picker owns the country code now; getE164 returns null when
    // the number is not plausible for the country selected, so a typo
    // is caught here rather than becoming an unreachable contact.
    let phone = null;
    if (phoneDigits) {
        phone = window.LzPhone ? window.LzPhone.getE164("reg-phone") : `+256${phoneDigits}`;

        if (!phone) {
            const statusEl = document.getElementById("register-status");
            if (statusEl) {
                statusEl.textContent = "That phone number doesn't look right for the country selected.";
            }
            return;
        }
    }

    statusEl.textContent = "Creating your account...";

    try {
        const result = await apiPost("/auth/register", { name, email, password, phone });

        localStorage.setItem("userToken", result.token);
        localStorage.setItem("userInfo", JSON.stringify(result.user));

        statusEl.textContent = "Account created! Redirecting...";
        window.location.href = "orders.html";

    } catch (error) {
        console.error(error);
        statusEl.textContent = "Could not create account. This email may already be registered.";
    }
}
