const VENDOR_API_URL = "";

function getVendorToken() {
    return localStorage.getItem("vendorToken");
}

function setVendorToken(token) {
    localStorage.setItem("vendorToken", token);
}

let vendorPendingLoginToken = null;

// --- Registration wizard -------------------------------------------------
//
// Two steps: Account (name/email/phone/password), then Shop Information
// (account type, shop name, location, optional referral source, policy
// consent). Submitting step 2 creates the account and sends the applicant
// to the vendor login page - KYC verification (registration number or
// national ID, depending on account type) is completed afterwards, from
// inside the dashboard once they've signed in.

let vendorSelectedAccountType = null;

function vendorWizardGoToStep2() {
    const statusEl = document.getElementById("step1-status");
    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-password").value;

    if (!name || !email || !phone || !password) {
        statusEl.textContent = "Please fill in your name, email, phone, and password.";
        return;
    }
    if (password.length < 6) {
        statusEl.textContent = "Password must be at least 6 characters.";
        return;
    }
    statusEl.textContent = "";

    document.getElementById("wizard-step-1").classList.add("hidden");
    document.getElementById("wizard-step-2").classList.remove("hidden");
    document.getElementById("wizard-title").textContent = "Shop Information";
    document.getElementById("wizard-subtitle").textContent = "Set up your shop by completing the following details.";

    const dots = document.querySelectorAll(".vendor-wizard-dot");
    dots[0].classList.remove("is-active");
    dots[0].classList.add("is-done");
    dots[1].classList.add("is-active");
}

function vendorWizardGoToStep1() {
    document.getElementById("wizard-step-2").classList.add("hidden");
    document.getElementById("wizard-step-1").classList.remove("hidden");
    document.getElementById("wizard-title").textContent = "Create Your Account";
    document.getElementById("wizard-subtitle").textContent = "Let's start with a few details about you.";

    const dots = document.querySelectorAll(".vendor-wizard-dot");
    dots[1].classList.remove("is-active");
    dots[0].classList.remove("is-done");
    dots[0].classList.add("is-active");
}

function vendorSelectAccountType(type) {
    vendorSelectedAccountType = type;
    document.getElementById("account-type-company").classList.toggle("is-selected", type === "company");
    document.getElementById("account-type-individual").classList.toggle("is-selected", type === "individual");

    const hint = document.getElementById("account-type-hint");
    if (type === "company") {
        hint.textContent = "As a Company, you'll confirm your URSB registration number after you log in.";
    } else {
        hint.textContent = "As an Individual, you'll confirm your national ID after you log in.";
    }
}

async function registerVendor() {
    const statusEl = document.getElementById("register-status");

    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-password").value;
    const business_name = document.getElementById("reg-business-name").value.trim();
    const physical_address = document.getElementById("reg-address").value.trim();
    const referral_source = document.getElementById("reg-referral").value;
    const accept_policies = document.getElementById("reg-policies-consent").checked;

    if (!vendorSelectedAccountType) {
        statusEl.textContent = "Please choose an account type: Company or Individual.";
        return;
    }

    if (!business_name || !physical_address) {
        statusEl.textContent = "Please fill in your shop name and location.";
        return;
    }

    if (!accept_policies) {
        statusEl.textContent = "Please read and agree to the Vendor Policies to continue.";
        return;
    }

    statusEl.textContent = "Submitting your application...";

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/vendors/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name, email, phone, password, business_name,
                account_type: vendorSelectedAccountType,
                physical_address: physical_address || null,
                referral_source: referral_source || null,
                accept_policies
            })
        });

        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Could not submit your application.";
            return;
        }

        statusEl.classList.add("is-ok");
        statusEl.textContent = "Application submitted! Redirecting to login...";
        setTimeout(function () {
            window.location.href = "vendor-login.html?registered=1";
        }, 1200);

    } catch (error) {
        console.error("Vendor register error:", error);
        statusEl.textContent = "Could not connect to server.";
    }
}

// --- Login (mirrors the staff login flow: device approval, 2FA, forced
// reset can all apply here too, since vendorLogin runs the same
// completeLogin gates as every other login surface) ----------------------

function vendorShowDeviceWait(data, onApproved) {
    vendorPendingLoginToken = data.pendingToken;

    ["login-email", "login-password", "login-btn"].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });

    const err = document.getElementById("login-error");
    const deadline = new Date(data.expiresAt).getTime();
    let stopped = false;

    function say(text) { if (err) err.textContent = text; }
    say("We have emailed you to confirm this sign-in. Approve it from that email - this page will continue on its own.");

    const timer = setInterval(function () {
        if (stopped) return;
        if (Date.now() > deadline) {
            clearInterval(timer);
            say("This sign-in request expired. Please log in again.");
            setTimeout(function () { location.reload(); }, 4000);
            return;
        }
        fetch("/api/auth/device-request/" + encodeURIComponent(data.ref) + "/status")
            .then(function (r) { return r.json(); })
            .then(function (s) {
                if (stopped) return;
                if (s.status === "approved") {
                    stopped = true;
                    clearInterval(timer);
                    onApproved();
                } else if (s.status === "denied") {
                    stopped = true;
                    clearInterval(timer);
                    say("This sign-in was refused. The account has been locked.");
                } else if (s.status === "expired") {
                    stopped = true;
                    clearInterval(timer);
                    say("This sign-in request expired. Please log in again.");
                    setTimeout(function () { location.reload(); }, 4000);
                }
            })
            .catch(function () { /* transient - next tick retries */ });
    }, 3000);
}

async function handleVendorLogin() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");

    if (!email || !password) {
        errorEl.textContent = "Please enter both email and password.";
        return;
    }

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/vendors/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || "Login failed.";
            return;
        }

        if (data.requiresDeviceApproval) {
            vendorShowDeviceWait(data, function () {
                vendorPendingLoginToken = data.pendingToken;
                document.getElementById("login-email").classList.add("hidden");
                document.getElementById("login-password").classList.add("hidden");
                document.getElementById("login-btn").classList.add("hidden");

                if (data.requires2FASetup) {
                    errorEl.textContent = "Approved. Set up your authenticator app to finish.";
                    startVendor2FASetup();
                    return;
                }

                document.getElementById("login-2fa-code").classList.remove("hidden");
                document.getElementById("login-2fa-btn").classList.remove("hidden");
                errorEl.textContent = "Approved. Enter the 6-digit code from your authenticator app.";
            });
            return;
        }

        if (data.requiresPasswordReset) {
            vendorPendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            document.getElementById("login-reset-password").classList.remove("hidden");
            document.getElementById("login-reset-password-confirm").classList.remove("hidden");
            document.getElementById("login-reset-btn").classList.remove("hidden");
            errorEl.textContent = "You must set a new password before continuing.";
            return;
        }

        if (data.requires2FA) {
            vendorPendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            document.getElementById("login-2fa-code").classList.remove("hidden");
            document.getElementById("login-2fa-btn").classList.remove("hidden");
            document.getElementById("login-2fa-email-btn").classList.remove("hidden");
            errorEl.textContent = "Enter the 6-digit code from your authenticator app.";
            return;
        }

        if (data.requires2FASetup) {
            vendorPendingLoginToken = data.pendingToken;
            document.getElementById("login-email").classList.add("hidden");
            document.getElementById("login-password").classList.add("hidden");
            document.getElementById("login-btn").classList.add("hidden");
            errorEl.textContent = "Two-factor authentication is required. Set it up to continue.";
            await startVendor2FASetup();
            return;
        }

        setVendorToken(data.token);
        window.location.href = "vendor/dashboard.html";

    } catch (error) {
        console.error("Vendor login error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

async function submitVendorLogin2FA() {
    const code = document.getElementById("login-2fa-code").value.trim();
    const errorEl = document.getElementById("login-error");
    if (!code) { errorEl.textContent = "Please enter the 6-digit code."; return; }

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/auth/login/2fa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: vendorPendingLoginToken, code })
        });
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = data.error || "Invalid code."; return; }

        setVendorToken(data.token);
        window.location.href = "vendor/dashboard.html";
    } catch (error) {
        console.error("2FA verification error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

async function submitVendorForcedReset() {
    const newPassword = document.getElementById("login-reset-password").value;
    const confirmPassword = document.getElementById("login-reset-password-confirm").value;
    const errorEl = document.getElementById("login-error");

    if (!newPassword || !confirmPassword) { errorEl.textContent = "Please fill in both password fields."; return; }
    if (newPassword.length < 6) { errorEl.textContent = "Password must be at least 6 characters."; return; }
    if (newPassword !== confirmPassword) { errorEl.textContent = "Passwords do not match."; return; }

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/auth/complete-forced-reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: vendorPendingLoginToken, newPassword })
        });
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = data.error || "Could not reset password."; return; }

        setVendorToken(data.token);
        window.location.href = "vendor/dashboard.html";
    } catch (error) {
        console.error("Complete forced reset error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

let vendorEmailCodeCooldown = null;

async function requestVendorEmailLoginCode() {
    const btn = document.getElementById("login-2fa-email-btn");
    const errorEl = document.getElementById("login-error");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/auth/login/2fa/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingToken: vendorPendingLoginToken })
        });
        const data = await response.json();
        if (!response.ok) {
            errorEl.textContent = data.error || "Could not send the code.";
            btn.disabled = false;
            btn.textContent = "Email me a code instead";
            return;
        }
        errorEl.textContent = "A code has been sent to your email. It expires in 10 minutes.";
        let remaining = 60;
        if (vendorEmailCodeCooldown) clearInterval(vendorEmailCodeCooldown);
        btn.disabled = true;
        btn.textContent = `Resend in ${remaining}s`;
        vendorEmailCodeCooldown = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(vendorEmailCodeCooldown);
                vendorEmailCodeCooldown = null;
                btn.disabled = false;
                btn.textContent = "Email me a code instead";
            } else {
                btn.textContent = `Resend in ${remaining}s`;
            }
        }, 1000);
    } catch (error) {
        console.error("Request email login code error:", error);
        errorEl.textContent = "Could not connect to server.";
        btn.disabled = false;
        btn.textContent = "Email me a code instead";
    }
}

async function startVendor2FASetup() {
    const errorEl = document.getElementById("login-error");
    try {
        const response = await fetch(`${VENDOR_API_URL}/api/auth/2fa/setup`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${vendorPendingLoginToken}` }
        });
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = data.error || "Could not start 2FA setup."; return; }

        document.getElementById("login-setup-qr").src = data.qrCode;
        document.getElementById("login-setup-key").textContent = data.manualEntryKey;
        document.getElementById("login-setup-block").classList.remove("hidden");
    } catch (error) {
        console.error("2FA setup error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

async function submitVendor2FASetup() {
    const errorEl = document.getElementById("login-error");
    const code = document.getElementById("login-setup-code").value.trim();
    if (!code) { errorEl.textContent = "Please enter the 6-digit code."; return; }

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/auth/2fa/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${vendorPendingLoginToken}` },
            body: JSON.stringify({ token: code })
        });
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = data.error || "Invalid code."; return; }

        setVendorToken(data.token);
        window.location.href = "vendor/dashboard.html";
    } catch (error) {
        console.error("2FA verify error:", error);
        errorEl.textContent = "Could not connect to server.";
    }
}

// --- Post-registration banner on the login page --------------------------

document.addEventListener("DOMContentLoaded", function () {
    const banner = document.getElementById("registered-banner");
    if (!banner) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "1") {
        banner.classList.remove("hidden");
    }
});
