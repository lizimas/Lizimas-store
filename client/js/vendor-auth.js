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
// Four steps, in this order and no skipping ahead: (1) Email, (2) verify
// the 6-digit code we email to it, (3) Personal Information (name, phone,
// password), (4) Shop Information (account type, shop name, location,
// referral source, policy consent). Every field on every step is
// required - none of the vendorWizardGoTo* functions below will advance
// until the step it's leaving is actually complete.
//
// Nothing is written to the database until the very last "Submit" on step
// 4: registerVendor() is the only call that creates a users/vendors row,
// and it can't succeed without a registrationToken proving step 2 was
// actually verified (server-checked again in registerVendor - see
// server/controllers/authController.js). Everything collected before
// that point lives only in these JS variables, in the browser.
//
// KYC verification (registration number or national ID, depending on
// account type) is completed afterwards, from inside the dashboard once
// the applicant has signed in - registration itself never asks for it.

let vendorSelectedAccountType = null;
let vendorPendingAccountType = null;
let vendorRegistrationToken = null;
let vendorRegistrationEmail = "";
let vendorResendCooldownTimer = null;

function vendorDismissInstructions() {
    document.getElementById("wizard-instructions-modal").classList.add("hidden");
}

function vendorSetDot(activeIndex, doneUpTo) {
    const dots = document.querySelectorAll(".vendor-wizard-dot");
    dots.forEach(function (dot, i) {
        dot.classList.remove("is-active", "is-done");
        if (i < doneUpTo) dot.classList.add("is-done");
        if (i === activeIndex) dot.classList.add("is-active");
    });
}

function vendorShowStep(stepId, title, subtitle, dotIndex, doneUpTo) {
    document.querySelectorAll(".wizard-step").forEach(function (el) {
        el.classList.add("hidden");
    });
    document.getElementById(stepId).classList.remove("hidden");
    document.getElementById("wizard-title").textContent = title;
    document.getElementById("wizard-subtitle").textContent = subtitle;
    vendorSetDot(dotIndex, doneUpTo);
}

// --- Step 1: Email --------------------------------------------------------

async function vendorSendRegistrationCode(isResend) {
    const statusEl = document.getElementById(isResend ? "code-step-status" : "email-step-status");
    const btn = document.getElementById(isResend ? "resend-code-btn" : "send-code-btn");

    let email;
    if (isResend) {
        email = vendorRegistrationEmail;
    } else {
        email = document.getElementById("reg-email").value.trim();
        if (!email) {
            statusEl.textContent = "Please enter your email address.";
            return;
        }
    }

    if (btn.disabled) return;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Sending...";

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/vendors/register/send-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Could not send the code.";
            btn.disabled = false;
            btn.textContent = originalLabel;
            return;
        }

        vendorRegistrationEmail = email;
        document.getElementById("code-step-email").textContent = email;
        document.getElementById("email-step-status").textContent = "";
        document.getElementById("code-step-status").textContent = "";
        document.getElementById("reg-code").value = "";

        vendorShowStep(
            "wizard-step-code",
            "Enter Your Code",
            "We just emailed you a 6-digit verification code.",
            1, 1
        );

        if (!isResend) {
            // The resend button's disabled/label state is fully owned by
            // vendorStartResendCooldown() below - touching it here would
            // race the cooldown it's about to start.
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
        vendorStartResendCooldown();

    } catch (error) {
        console.error("Send registration code error:", error);
        statusEl.textContent = "Could not connect to server.";
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

function vendorStartResendCooldown() {
    const resendBtn = document.getElementById("resend-code-btn");
    let remaining = 60;
    if (vendorResendCooldownTimer) clearInterval(vendorResendCooldownTimer);
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend code in ${remaining}s`;
    vendorResendCooldownTimer = setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(vendorResendCooldownTimer);
            vendorResendCooldownTimer = null;
            resendBtn.disabled = false;
            resendBtn.textContent = "Resend code";
        } else {
            resendBtn.textContent = `Resend code in ${remaining}s`;
        }
    }, 1000);
}

function vendorWizardGoToEmail() {
    if (vendorResendCooldownTimer) {
        clearInterval(vendorResendCooldownTimer);
        vendorResendCooldownTimer = null;
    }
    document.getElementById("resend-code-btn").disabled = false;
    document.getElementById("resend-code-btn").textContent = "Resend code";
    vendorShowStep(
        "wizard-step-email",
        "Verify Your Email",
        "We'll send you a code to confirm it's really you.",
        0, 0
    );
}

// --- Step 2: Verify code --------------------------------------------------

async function vendorVerifyRegistrationCode() {
    const statusEl = document.getElementById("code-step-status");
    const code = document.getElementById("reg-code").value.trim();

    if (!code) {
        statusEl.textContent = "Please enter the 6-digit code.";
        return;
    }

    const btn = document.getElementById("verify-code-btn");
    btn.disabled = true;
    statusEl.textContent = "";

    try {
        const response = await fetch(`${VENDOR_API_URL}/api/vendors/register/verify-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: vendorRegistrationEmail, code })
        });
        const data = await response.json();

        if (!response.ok) {
            statusEl.textContent = data.error || "Invalid code.";
            btn.disabled = false;
            return;
        }

        vendorRegistrationToken = data.registrationToken;

        vendorShowStep(
            "wizard-step-personal",
            "Personal Information",
            "Now let's set up your sign-in details.",
            2, 2
        );

    } catch (error) {
        console.error("Verify registration code error:", error);
        statusEl.textContent = "Could not connect to server.";
    } finally {
        btn.disabled = false;
    }
}

function vendorWizardGoToCode() {
    vendorShowStep(
        "wizard-step-code",
        "Enter Your Code",
        "We just emailed you a 6-digit verification code.",
        1, 1
    );
}

// --- Step 3: Personal Information ----------------------------------------

function vendorWizardGoToShop() {
    const statusEl = document.getElementById("personal-step-status");
    const name = document.getElementById("reg-name").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-password").value;
    const confirmPassword = document.getElementById("reg-password-confirm").value;

    if (!name || !phone || !password || !confirmPassword) {
        statusEl.textContent = "Please fill in your name, phone, and password.";
        return;
    }

    const strongEnough = password.length >= 8 &&
        /[a-z]/.test(password) && /[A-Z]/.test(password) &&
        /\d/.test(password) && /[^A-Za-z0-9]/.test(password);

    if (!strongEnough) {
        statusEl.textContent = "Password must be 8+ characters with an uppercase letter, a lowercase letter, a number, and a symbol.";
        return;
    }

    if (password !== confirmPassword) {
        statusEl.textContent = "Passwords do not match.";
        return;
    }

    statusEl.textContent = "";

    vendorShowStep(
        "wizard-step-shop",
        "Shop Information",
        "Set up your shop by completing the following details.",
        3, 3
    );
}

function vendorWizardGoToPersonal() {
    vendorShowStep(
        "wizard-step-personal",
        "Personal Information",
        "Now let's set up your sign-in details.",
        2, 2
    );
}

// --- Step 4: Shop Information ---------------------------------------------

function vendorSelectAccountType(type) {
    // Choosing an account type is treated as a decision, not a click - it
    // is confirmed via modal (and can't be changed after submission), so
    // nothing is applied to the UI until vendorConfirmAccountType() below.
    vendorPendingAccountType = type;

    const label = type === "company" ? "Company" : "Individual";
    const explain = type === "company"
        ? "As a Company, you'll confirm your URSB registration number after you log in."
        : "As an Individual, you'll confirm your national ID after you log in.";

    document.getElementById("account-type-confirm-text").textContent =
        `You're registering as a ${label}. ${explain}`;
    document.getElementById("account-type-confirm-modal").classList.remove("hidden");
}

function vendorCancelAccountType() {
    vendorPendingAccountType = null;
    document.getElementById("account-type-confirm-modal").classList.add("hidden");
}

function vendorConfirmAccountType() {
    const type = vendorPendingAccountType;
    if (!type) return;

    vendorSelectedAccountType = type;
    document.getElementById("account-type-company").classList.toggle("is-selected", type === "company");
    document.getElementById("account-type-individual").classList.toggle("is-selected", type === "individual");

    const hint = document.getElementById("account-type-hint");
    if (type === "company") {
        hint.textContent = "As a Company, you'll confirm your URSB registration number after you log in.";
    } else {
        hint.textContent = "As an Individual, you'll confirm your national ID after you log in.";
    }

    vendorPendingAccountType = null;
    document.getElementById("account-type-confirm-modal").classList.add("hidden");
}

async function registerVendor() {
    const statusEl = document.getElementById("register-status");

    const name = document.getElementById("reg-name").value.trim();
    const email = vendorRegistrationEmail;
    const phone = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-password").value;
    const business_name = document.getElementById("reg-business-name").value.trim();
    const physical_address = document.getElementById("reg-address").value.trim();
    const referral_source = document.getElementById("reg-referral").value;
    const accept_policies = document.getElementById("reg-policies-consent").checked;

    if (!vendorRegistrationToken) {
        statusEl.textContent = "Your email verification has expired. Please verify your email again.";
        vendorWizardGoToEmail();
        return;
    }

    if (!vendorSelectedAccountType) {
        statusEl.textContent = "Please choose an account type: Company or Individual.";
        return;
    }

    if (!business_name || !physical_address) {
        statusEl.textContent = "Please fill in your shop name and location.";
        return;
    }

    if (!referral_source) {
        statusEl.textContent = "Please tell us how you heard about Lizimas Store.";
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
                physical_address,
                referral_source,
                accept_policies,
                registrationToken: vendorRegistrationToken
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
