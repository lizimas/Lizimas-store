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

// Initialised through the JS API rather than data-* attributes: the
// declarative form did not put the rendered button into redirect mode, and a
// popup cannot survive a mobile browser turning it into a navigation. With
// ux_mode redirect Google form-POSTs the credential straight to login_uri, so
// no JavaScript handoff exists to fail.
function lzInitGoogleSignIn() {
    if (!window.google || !google.accounts || !google.accounts.id) return;

    google.accounts.id.initialize({
        client_id: "336325275087-ik8jcdf930foejlrb4her19m5p4r6h2s.apps.googleusercontent.com",
        login_uri: "https://lizimasstore.com/api/auth/oauth/google/callback",
        ux_mode: "redirect",
        auto_select: false
    });

    google.accounts.id.renderButton(
        document.getElementById("google-signin-button"),
        { type: "standard", theme: "outline", size: "large",
          text: "signin_with", shape: "rectangular", width: 280 }
    );
}

// Called by Google Identity Services with a signed ID token. The token is
// proof of an email address only; the server decides everything else, and
// answers in the same shape as password login so both paths land here.
async function handleGoogleCredential(response) {
    const statusEl = document.getElementById("login-status");
    statusEl.textContent = "Signing you in...";

    try {
        const result = await apiPost("/auth/oauth/google", { credential: response.credential });

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
        console.error("Google sign-in error:", error);
        statusEl.textContent = "Google sign-in failed. Please try again.";
    }
}

// Set this to the real Facebook App ID once the Meta app exists and has
// been through app review (see PENDING.md "Facebook sign-in" for what's
// still needed). Left as a placeholder sentinel on purpose: fbAsyncInit
// below checks for exactly this string and refuses to init or reveal the
// button while it is still here, so shipping this file today changes
// nothing for real visitors - the button stays exactly as invisible as it
// was before this landed, until someone deliberately flips this constant.
const FACEBOOK_APP_ID = "1632274215173850";

window.fbAsyncInit = function () {
    if (!FACEBOOK_APP_ID || FACEBOOK_APP_ID.indexOf("REPLACE_WITH") === 0) return;

    FB.init({ appId: FACEBOOK_APP_ID, cookie: false, xfbml: false, version: "v21.0" });

    document.querySelectorAll(".auth-social").forEach(function (el) {
        el.removeAttribute("aria-hidden");
        el.classList.add("is-ready");
    });
};

// Triggered by the Facebook button. FB.login()'s popup already degrades to a
// full-page redirect on mobile browsers by itself, so - unlike Google above -
// there is no separate redirect-mode entry point to wire up here.
function handleFacebookLogin() {
    if (typeof FB === "undefined") {
        document.getElementById("login-status").textContent = "Facebook sign-in is not available right now.";
        return;
    }

    FB.login(function (response) {
        if (response && response.authResponse && response.authResponse.accessToken) {
            submitFacebookToken(response.authResponse.accessToken);
        }
        // A user who cancels or declines the permission gets no callback
        // branch here - same as Google, nothing to report, they just stay on
        // the login form.
    }, { scope: "email" });
}

// Sends the access token to the server, which verifies it against the Graph
// API itself (this file never decides who the user is - see
// facebookSignIn in oauthController.js). Same response shape as password
// and Google login, so it lands on the same 2FA/redirect handling.
async function submitFacebookToken(accessToken) {
    const statusEl = document.getElementById("login-status");
    statusEl.textContent = "Signing you in...";

    try {
        const result = await apiPost("/auth/oauth/facebook", { accessToken });

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
        console.error("Facebook sign-in error:", error);
        statusEl.textContent = (error && error.message) || "Facebook sign-in failed. Please try again.";
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
