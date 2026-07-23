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

    const phone = phoneDigits ? `+256${phoneDigits}` : null;

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
