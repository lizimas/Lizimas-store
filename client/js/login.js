let pendingLoginToken = null;

async function loginAccount() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const statusEl = document.getElementById("login-status");

    if (!email || !password) {
        statusEl.textContent = "Please enter your email and password.";
        return;
    }

    statusEl.textContent = "Logging in...";

    try {
        const result = await apiPost("/auth/login", { email, password });

        if (result.requires2FA) {
            pendingLoginToken = result.pendingToken;
            document.getElementById("login-form-card").style.display = "none";
            document.getElementById("twofa-form-card").style.display = "block";
            return;
        }

        localStorage.setItem("userToken", result.token);
        localStorage.setItem("userInfo", JSON.stringify(result.user));

        statusEl.textContent = "Login successful! Redirecting...";
        window.location.href = "orders.html";

    } catch (error) {
        console.error(error);
        statusEl.textContent = "Invalid email or password.";
    }
}

async function verifyTwoFactor() {
    const code = document.getElementById("twofa-code").value.trim();
    const statusEl = document.getElementById("twofa-status");

    if (!code) {
        statusEl.textContent = "Please enter your 6-digit code.";
        return;
    }

    statusEl.textContent = "Verifying...";

    try {
        const result = await apiPost("/auth/login/2fa", { pendingToken: pendingLoginToken, code });

        localStorage.setItem("userToken", result.token);
        localStorage.setItem("userInfo", JSON.stringify(result.user));

        statusEl.textContent = "Login successful! Redirecting...";
        window.location.href = "orders.html";

    } catch (error) {
        console.error(error);
        statusEl.textContent = "Invalid code. Please try again.";
    }
}
