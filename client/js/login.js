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


let emailCodeCooldown = null;

async function requestEmailLoginCode() {
    const btn = document.getElementById("twofa-email-btn");
    const statusEl = document.getElementById("twofa-status");

    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        const response = await fetch("/api/auth/login/2fa/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken })
        });

        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Could not send the code.";
            btn.disabled = false;
            btn.textContent = "Email me a code instead";
            return;
        }

        statusEl.textContent = "A code has been sent to your email. It expires in 10 minutes.";
        startEmailCodeCooldown(60);

    } catch (error) {
        console.error("Request email login code error:", error);
        statusEl.textContent = "Could not connect to server.";
        btn.disabled = false;
        btn.textContent = "Email me a code instead";
    }
}

function startEmailCodeCooldown(seconds) {
    const btn = document.getElementById("twofa-email-btn");
    let remaining = seconds;

    if (emailCodeCooldown) clearInterval(emailCodeCooldown);

    btn.disabled = true;
    btn.textContent = `Resend in ${remaining}s`;

    emailCodeCooldown = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(emailCodeCooldown);
            emailCodeCooldown = null;
            btn.disabled = false;
            btn.textContent = "Email me a code instead";
        } else {
            btn.textContent = `Resend in ${remaining}s`;
        }
    }, 1000);
}
