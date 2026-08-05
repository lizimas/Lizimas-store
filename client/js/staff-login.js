const API_URL = "";

function getStaffToken() {
    return localStorage.getItem("staffToken");
}

function setStaffToken(token) {
    localStorage.setItem("staffToken", token);
}

let pendingLoginToken = null;

function redirectByRole(role) {
    if (role === "product_staff") {
        window.location.href = "staff/product.html";
    } else if (role === "store_manager") {
        window.location.href = "staff/manager.html";
    } else if (role === "customer_support") {
        window.location.href = "staff/chat.html";
    } else {
        localStorage.removeItem("staffToken");
        document.getElementById("login-error").textContent = "This login is for staff accounts only.";
    }
}

async function handleStaffLogin() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (!email || !password) {
        document.getElementById("login-error").textContent = "Please enter both email and password.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Login failed.";
            return;
        }

        if (data.requiresPasswordReset) {
            pendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            document.getElementById("login-reset-password").classList.remove("hidden");
            document.getElementById("login-reset-password-confirm").classList.remove("hidden");
            document.getElementById("login-reset-btn").classList.remove("hidden");
            document.getElementById("login-error").textContent = "You must set a new password before continuing.";
            return;
        }

        if (data.requires2FA) {
            pendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-2fa-code").classList.remove("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            document.getElementById("login-2fa-btn").classList.remove("hidden");
            document.getElementById("login-2fa-email-btn").classList.remove("hidden");
            document.getElementById("login-error").textContent = "Enter the 6-digit code from your authenticator app.";
            return;
        }

        setStaffToken(data.token);
        redirectByRole(data.user.role);

    } catch (error) {
        console.error("Login error:", error);
        document.getElementById("login-error").textContent = "Could not connect to server.";
    }
}

async function submitStaffLogin2FA() {
    const code = document.getElementById("login-2fa-code").value.trim();

    if (!code) {
        document.getElementById("login-error").textContent = "Please enter the 6-digit code.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/login/2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken, code })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Invalid code.";
            return;
        }

        setStaffToken(data.token);
        redirectByRole(data.user.role);

    } catch (error) {
        console.error("2FA verification error:", error);
        document.getElementById("login-error").textContent = "Could not connect to server.";
    }
}

async function submitStaffForcedReset() {
    const newPassword = document.getElementById("login-reset-password").value;
    const confirmPassword = document.getElementById("login-reset-password-confirm").value;

    if (!newPassword || !confirmPassword) {
        document.getElementById("login-error").textContent = "Please fill in both password fields.";
        return;
    }

    if (newPassword.length < 6) {
        document.getElementById("login-error").textContent = "Password must be at least 6 characters.";
        return;
    }

    if (newPassword !== confirmPassword) {
        document.getElementById("login-error").textContent = "Passwords do not match.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/complete-forced-reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken, newPassword })
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById("login-error").textContent = data.error || "Could not reset password.";
            return;
        }

        setStaffToken(data.token);
        redirectByRole(data.user.role);

    } catch (error) {
        console.error("Complete forced reset error:", error);
        document.getElementById("login-error").textContent = "Could not connect to server.";
    }
}


let emailCodeCooldown = null;

async function requestEmailLoginCode() {
    const btn = document.getElementById("login-2fa-email-btn");
    const errorEl = document.getElementById("login-error");

    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        const response = await fetch(`${API_URL}/api/auth/login/2fa/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: pendingLoginToken })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || "Could not send the code.";
            btn.disabled = false;
            btn.textContent = "Email me a code instead";
            return;
        }

        errorEl.textContent = "A code has been sent to your email. It expires in 10 minutes.";
        startEmailCodeCooldown(60);

    } catch (error) {
        console.error("Request email login code error:", error);
        errorEl.textContent = "Could not connect to server.";
        btn.disabled = false;
        btn.textContent = "Email me a code instead";
    }
}

function startEmailCodeCooldown(seconds) {
    const btn = document.getElementById("login-2fa-email-btn");
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
