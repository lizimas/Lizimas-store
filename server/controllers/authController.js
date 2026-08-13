const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const crypto = require("crypto");
const cloudinary = require("../config/cloudinary");

function uploadProfilePhotoToCloudinary(fileBuffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "lizimas-store/profiles" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        );
        stream.end(fileBuffer);
    });
}
const { sendAdminLoginAlert, sendPasswordResetEmail, sendStaffActivationEmail, sendAccountBlockedEmail, sendAdminBlockAlert, sendTwoFactorCodeEmail } = require("../utils/mailer");

const { issueDeviceCookie } = require("../utils/deviceTrust");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set. Refusing to start with an insecure default.");
}
const TOKEN_EXPIRY = "7d";
// res is optional so that any call site missed here still works; it simply
// enrols no device. Every current caller passes it.
// Roles held to device recognition. Customers are deliberately excluded:
// locking a shopper out of their own account over a new phone would cost far
// more than it protects, and their approval-by-email flow is a separate step.
const DEVICE_GATED_ROLES = ["admin", "product_staff", "store_manager", "customer_support"];

// Returns an error message if the login should be refused, or null to proceed.
//
// Runs only when DEVICE_LOCK_ENFORCED is true, so this whole mechanism can be
// switched on and off with an environment variable and a restart rather than a
// deploy. Enrolment continues regardless.
async function deviceGate(user, req, surface) {
    const { isEnforced, findTrustedDevice, readDeviceToken } = require("../utils/deviceTrust");

    if (!isEnforced()) return null;
    if (!DEVICE_GATED_ROLES.includes(user.role)) return null;

    // An unlock opens a short window in which a login may enrol a device.
    // Without it, unlocking would be futile: the account has no trusted device
    // by definition, so the next attempt would lock it again immediately.
    if (user.device_grace_until && new Date(user.device_grace_until) > new Date()) {
        return null;
    }

    const device = await findTrustedDevice(user.id, readDeviceToken(req));
    if (device) return null;

    // Lock, but never overwrite an existing lock time - the first refusal is
    // the one worth keeping.
    await pool.query(
        `UPDATE users
            SET security_locked_at = COALESCE(security_locked_at, NOW()),
                security_locked_reason = 'unknown_device'
          WHERE id = $1`,
        [user.id]
    );

    await logLoginAttempt(user.id, req, false, {
        surface: surface,
        failureReason: "unknown_device",
        attemptedEmail: user.email
    });

    const { sendSecurityLockAlert } = require("../utils/mailer");
    sendSecurityLockAlert({
        email: user.email,
        role: user.role,
        surface: surface,
        ip: req.headers["cf-connecting-ip"] || req.ip,
        userAgent: req.headers["user-agent"] || "unknown",
        time: new Date().toISOString()
    }).catch(err => console.error("Security lock alert failed:", err));

    return "This account has been locked because the sign-in came from an unrecognised device. Please contact the administrator.";
}

async function createSession(userId, req, res) {
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const userAgent = (req.headers["user-agent"] || "Unknown device").slice(0, 255);
    // Behind Cloudflare req.ip is the edge address, so prefer the forwarded one.
    const ipAddress = (
        req.headers["cf-connecting-ip"] || req.ip || req.connection.remoteAddress || "Unknown"
    ).toString().slice(0, 45);

    await pool.query(
        "INSERT INTO sessions (session_token, user_id, device_label, ip_address) VALUES ($1, $2, $3, $4)",
        [sessionToken, userId, userAgent, ipAddress]
    );

    // Enrol this browser as a trusted device.
    if (res) {
        await issueDeviceCookie(res, req, userId);

        // Consume any unlock grace window. Deliberately here rather than in
        // deviceGate: reaching this line means the login actually completed,
        // second factor and all. Clearing it at the gate would let a mistyped
        // 2FA code spend the window and lock the account straight back up.
        //
        // One unlock therefore restores exactly one device, rather than
        // leaving the account open to every device for the full window.
        try {
            await pool.query(
                "UPDATE users SET device_grace_until = NULL WHERE id = $1 AND device_grace_until IS NOT NULL",
                [userId]
            );
        } catch (error) {
            console.error("Failed to clear device grace window:", error);
        }
    }

    return sessionToken;
}

// Records a login attempt. userId may be null for attempts against an
// email that does not exist. The fourth argument is optional so that
// existing call sites remain valid.
//
//   opts.surface        'admin' | 'staff' | 'customer'
//   opts.failureReason  'wrong_password' | 'wrong_portal' | 'unknown_email'
//                       | 'blocked' | 'inactive' | 'bad_2fa'
//   opts.attemptedEmail  the address typed at the prompt
async function logLoginAttempt(userId, req, success, opts = {}) {
    const userAgent = (req.headers["user-agent"] || "Unknown device").slice(0, 255);
    // Behind Cloudflare, req.ip is Cloudflare's edge address rather than the
    // visitor's, so the forwarded header is preferred where present.
    const ipAddress = (
        req.headers["cf-connecting-ip"] ||
        req.ip ||
        req.connection.remoteAddress ||
        "Unknown"
    ).toString().slice(0, 45);

    const surface = opts.surface || "unknown";
    const failureReason = success ? null : (opts.failureReason || null);
    const attemptedEmail = opts.attemptedEmail ? String(opts.attemptedEmail).slice(0, 255) : null;

    try {
        await pool.query(
            `INSERT INTO login_history
                (user_id, ip_address, device_label, success, surface, failure_reason, attempted_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, ipAddress, userAgent, success, surface, failureReason, attemptedEmail]
        );
    } catch (err) {
        console.error("Failed to log login attempt:", err);
    }
}

async function registerUser(req, res) {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }

    try {
        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Auto-generate a unique username from the email prefix, since customers
        // registering via the storefront don't provide one directly.
        const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "user";
        let username = usernameBase;
        let usernameSuffix = 0;

        while (true) {
            const existingUsername = await pool.query(
                "SELECT id FROM users WHERE username = $1",
                [username]
            );
            if (existingUsername.rows.length === 0) break;
            usernameSuffix += 1;
            username = `${usernameBase}${usernameSuffix}`;
        }

        const result = await pool.query(
            "INSERT INTO users (name, email, password, phone, username) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, phone, role",
            [name, email, hashedPassword, phone || null, username]
        );

        const newUser = result.rows[0];

        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email, role: newUser.role },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        res.status(201).json({
            message: "Account created successfully.",
            token,
            user: { id: newUser.id, name: newUser.name, email: newUser.email, phone: newUser.phone, role: newUser.role }
        });

    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ error: "Something went wrong while creating your account." });
    }
}

// Roles permitted on each login portal. A portal will not authenticate
// any account outside its own list, regardless of password correctness.
const CUSTOMER_LOGIN_ROLES = ["customer"];
const STAFF_LOGIN_ROLES = ["product_staff", "store_manager", "customer_support"];

async function loginUser(req, res) {
    return handleLogin(req, res, CUSTOMER_LOGIN_ROLES, "customer");
}

async function staffLogin(req, res) {
    return handleLogin(req, res, STAFF_LOGIN_ROLES, "staff");
}

async function handleLogin(req, res, allowedRoles, surface) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const result = await pool.query(
            "SELECT id, name, email, password, phone, role, two_factor_enabled, is_active, blocked_at, must_reset_password, security_locked_at, device_grace_until FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            // No such account. Recorded against attempted_email so that
            // guessing runs are visible in the Security tab.
            await logLoginAttempt(null, req, false, {
                surface: surface,
                failureReason: "unknown_email",
                attemptedEmail: email
            });
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = result.rows[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            await logLoginAttempt(user.id, req, false, {
                surface: surface,
                failureReason: "wrong_password",
                attemptedEmail: email
            });
            return res.status(401).json({ error: "Invalid email or password." });
        }

        // Portal scope gate. Runs before blocked_at, before must_reset_password
        // and before either 2FA branch, so a wrong-portal attempt can never mint
        // a pendingToken, reach 2FA enrolment, or write a secret to the account.
        if (!allowedRoles.includes(user.role)) {
            await logLoginAttempt(user.id, req, false, {
                surface: surface,
                failureReason: "wrong_portal",
                attemptedEmail: email
            });

            const { sendScopeViolationAlert } = require("../utils/mailer");
            sendScopeViolationAlert({
                email: user.email,
                role: user.role,
                surface: surface,
                ip: req.headers["cf-connecting-ip"] || req.ip,
                userAgent: req.headers["user-agent"] || "unknown",
                time: new Date().toISOString()
            }).catch(err => console.error("Scope violation alert failed:", err));

            // Deliberately identical to a wrong-password response: same status,
            // same wording. Reveals nothing about whether the account exists,
            // whether the password was right, or which portal would work.
            return res.status(401).json({ error: "Invalid email or password." });
        }

        if (user.security_locked_at) {
            await logLoginAttempt(user.id, req, false, {
                surface: surface,
                failureReason: "security_locked",
                attemptedEmail: email
            });
            return res.status(403).json({ error: "This account is locked pending security review. Please contact the administrator." });
        }

        if (user.blocked_at) {
            await logLoginAttempt(user.id, req, false, {
                surface: surface,
                failureReason: "blocked",
                attemptedEmail: email
            });
            return res.status(403).json({ error: "This account has been blocked. Please contact the administrator." });
        }

        if (!user.is_active) {
            await logLoginAttempt(user.id, req, false, {
                surface: surface,
                failureReason: "inactive",
                attemptedEmail: email
            });
            return res.status(403).json({ error: "Your account is pending activation by the administrator." });
        }

        // Before must_reset_password and before either 2FA branch, so an
        // unrecognised device cannot mint a pendingToken of any kind.
        const deviceRefusal = await deviceGate(user, req, surface);
        if (deviceRefusal) {
            return res.status(403).json({ error: deviceRefusal });
        }

        if (user.must_reset_password) {
            const pendingToken = jwt.sign(
                { userId: user.id, email: user.email, pendingPasswordReset: true },
                JWT_SECRET,
                { expiresIn: "15m" }
            );
            return res.json({
                message: "Password reset required before continuing.",
                requiresPasswordReset: true,
                pendingToken
            });
        }

        if (user.two_factor_enabled) {
            const pendingToken = jwt.sign(
                { userId: user.id, email: user.email, pending2FA: true },
                JWT_SECRET,
                { expiresIn: "15m" }
            );

            return res.json({
                message: "Password verified. Two-factor code required.",
                requires2FA: true,
                pendingToken
            });
        }

        const enforcedRoles = ["admin", "store_manager", "product_staff", "customer_support"];
        if (enforcedRoles.includes(user.role)) {
            const setupToken = jwt.sign(
                { userId: user.id, email: user.email, role: user.role, pendingSetup: true },
                JWT_SECRET,
                { expiresIn: "15m" }
            );

            return res.json({
                message: "Two-factor authentication setup is required before continuing.",
                requires2FASetup: true,
                pendingToken: setupToken
            });
        }

        const sessionToken = await createSession(user.id, req, res);
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, sessionToken },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        if (user.role === "admin") {
            sendAdminLoginAlert({
                name: user.name,
                email: user.email,
                time: new Date().toISOString(),
                ip: req.ip || req.connection.remoteAddress || "Unknown"
            }).catch(err => console.error("Admin login alert failed:", err));
        }

        await logLoginAttempt(user.id, req, true);

        res.json({
            message: "Login successful.",
            token,
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }
        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Something went wrong while logging in." });
    }
}

async function createStaffAccount(req, res) {
    try {
        const { name, email, password, role } = req.body;

        const allowedStaffRoles = ["product_staff", "store_manager", "customer_support"];

        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: "Name, email, password, and role are required." });
        }

        if (!allowedStaffRoles.includes(role)) {
            return res.status(400).json({ error: `Role must be one of: ${allowedStaffRoles.join(", ")}` });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters." });
        }

        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "staff";
        let username = usernameBase;
        let usernameSuffix = 0;

        while (true) {
            const existingUsername = await pool.query(
                "SELECT id FROM users WHERE username = $1",
                [username]
            );
            if (existingUsername.rows.length === 0) break;
            usernameSuffix += 1;
            username = `${usernameBase}${usernameSuffix}`;
        }

        const result = await pool.query(
            "INSERT INTO users (name, email, password, role, username, is_active) VALUES ($1, $2, $3, $4, $5, false) RETURNING id, name, email, role, is_active",
            [name, email, hashedPassword, role, username]
        );

        res.status(201).json({
            message: "Staff account created successfully.",
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Create staff account error:", error);
        res.status(500).json({ error: "Something went wrong while creating the staff account." });
    }
}

async function adminLogin(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        const result = await pool.query(
            "SELECT id, name, email, password, role, two_factor_enabled, is_active, blocked_at, failed_admin_attempts, must_reset_password, security_locked_at, device_grace_until FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            // Previously unrecorded. An attacker guessing admin addresses left
            // no trace at all on this endpoint.
            await logLoginAttempt(null, req, false, {
                surface: "admin",
                failureReason: "unknown_email",
                attemptedEmail: email
            });
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = result.rows[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            await logLoginAttempt(user.id, req, false, {
                surface: "admin",
                failureReason: "wrong_password",
                attemptedEmail: email
            });
            return res.status(401).json({ error: "Invalid email or password." });
        }

        if (user.security_locked_at) {
            await logLoginAttempt(user.id, req, false, {
                surface: "admin",
                failureReason: "security_locked",
                attemptedEmail: email
            });
            return res.status(403).json({ error: "This account is locked pending security review. Please contact the administrator." });
        }

        if (user.blocked_at) {
            await logLoginAttempt(user.id, req, false, {
                surface: "admin",
                failureReason: "blocked",
                attemptedEmail: email
            });
            return res.status(403).json({ error: "This account has been blocked due to repeated unauthorized admin access attempts." });
        }

        if (user.role !== "admin") {
            const newAttempts = (user.failed_admin_attempts || 0) + 1;

            if (newAttempts >= 3) {
                await pool.query(
                    "UPDATE users SET failed_admin_attempts = $1, blocked_at = NOW(), is_active = false WHERE id = $2",
                    [newAttempts, user.id]
                );

                await logLoginAttempt(user.id, req, false, {
                    surface: "admin",
                    failureReason: "wrong_portal",
                    attemptedEmail: email
                });

                sendAccountBlockedEmail(user.email, user.name).catch(err => console.error("Blocked email failed:", err));
                sendAdminBlockAlert({
                    name: user.name,
                    email: user.email,
                    time: new Date().toISOString()
                }).catch(err => console.error("Admin block alert failed:", err));

                return res.status(403).json({ error: "This account has been blocked due to repeated unauthorized admin access attempts." });
            }

            await pool.query(
                "UPDATE users SET failed_admin_attempts = $1 WHERE id = $2",
                [newAttempts, user.id]
            );

            // A staff or customer account reaching the admin endpoint with a
            // correct password is the strongest single signal in the system.
            await logLoginAttempt(user.id, req, false, {
                surface: "admin",
                failureReason: "wrong_portal",
                attemptedEmail: email
            });

            const attemptsRemaining = 3 - newAttempts;
            return res.status(403).json({ error: `This account does not have admin access. ${attemptsRemaining} attempt(s) remaining before it is blocked.` });
        }

        if (!user.is_active) {
            await logLoginAttempt(user.id, req, false, {
                surface: "admin",
                failureReason: "inactive",
                attemptedEmail: email
            });
            return res.status(403).json({ error: "Your account is pending activation." });
        }

        const deviceRefusal = await deviceGate(user, req, "admin");
        if (deviceRefusal) {
            return res.status(403).json({ error: deviceRefusal });
        }

        if (user.must_reset_password) {
            const pendingToken = jwt.sign(
                { userId: user.id, email: user.email, pendingPasswordReset: true },
                JWT_SECRET,
                { expiresIn: "15m" }
            );
            return res.json({
                message: "Password reset required before continuing.",
                requiresPasswordReset: true,
                pendingToken
            });
        }

        if (user.two_factor_enabled) {
            const pendingToken = jwt.sign(
                { userId: user.id, email: user.email, pending2FA: true },
                JWT_SECRET,
                { expiresIn: "15m" }
            );

            return res.json({
                message: "Password verified. Two-factor code required.",
                requires2FA: true,
                pendingToken
            });
        }

        const enforced2FARoles = ["admin", "store_manager", "product_staff", "customer_support"];
        if (enforced2FARoles.includes(user.role)) {
            const setupToken = jwt.sign(
                { userId: user.id, email: user.email, role: user.role, pendingSetup: true },
                JWT_SECRET,
                { expiresIn: "15m" }
            );

            return res.json({
                message: "Two-factor authentication setup is required before continuing.",
                requires2FASetup: true,
                pendingToken: setupToken
            });
        }

        const sessionToken = await createSession(user.id, req, res);
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, sessionToken },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        await logLoginAttempt(user.id, req, true, {
                surface: "admin",
                attemptedEmail: email
            });

        sendAdminLoginAlert({
            name: user.name,
            email: user.email,
            time: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress || "Unknown"
        }).catch(err => console.error("Admin login alert failed:", err));

        res.json({
            message: "Login successful.",
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });

    } catch (error) {
        console.error("Admin login error:", error);
        res.status(500).json({ error: "Something went wrong while logging in." });
    }
}

async function activateStaffAccount(req, res) {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "UPDATE users SET is_active = true, failed_admin_attempts = 0, blocked_at = NULL WHERE id = $1 RETURNING id, name, email",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Account not found." });
        }

        const user = result.rows[0];

        sendStaffActivationEmail(user.email, user.name).catch(err => console.error("Staff activation email failed:", err));

        res.json({ message: `${user.name}'s account has been activated.` });

    } catch (error) {
        console.error("Activate staff account error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function blockStaffAccount(req, res) {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "UPDATE users SET is_active = false, blocked_at = NOW() WHERE id = $1 RETURNING id, name, email",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Account not found." });
        }

        const user = result.rows[0];

        sendAccountBlockedEmail(user.email, user.name).catch(err => console.error("Blocked email failed:", err));

        res.json({ message: `${user.name}'s account has been blocked.` });

    } catch (error) {
        console.error("Block staff account error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function getProfile(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, role, profile_photo_url, profile_photo_original_url, first_name, last_name,
                    display_name, gender, date_of_birth, country, city, created_at
             FROM users WHERE id = $1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        res.json({ user: result.rows[0] });

    } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function updateProfile(req, res) {
    try {
        const { first_name, last_name, display_name, phone, gender, date_of_birth, country, city } = req.body;

        const result = await pool.query(
            `UPDATE users
             SET first_name = $1, last_name = $2, display_name = $3, phone = $4,
                 gender = $5, date_of_birth = $6, country = $7, city = $8
             WHERE id = $9
             RETURNING id, name, email, phone, role, profile_photo_url, first_name, last_name,
                       display_name, gender, date_of_birth, country, city`,
            [
                first_name || null,
                last_name || null,
                display_name || null,
                phone || null,
                gender || null,
                date_of_birth || null,
                country || null,
                city || null,
                req.user.userId
            ]
        );

        res.json({ message: "Profile updated successfully.", user: result.rows[0] });

    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function uploadProfilePhoto(req, res) {
    try {
        const croppedFile = req.files && req.files.photo ? req.files.photo[0] : null;
        const originalFile = req.files && req.files.original_photo ? req.files.original_photo[0] : null;

        if (!croppedFile) {
            return res.status(400).json({ error: "No photo uploaded." });
        }

        const photoUrl = await uploadProfilePhotoToCloudinary(croppedFile.buffer);
        const originalUrl = originalFile
            ? await uploadProfilePhotoToCloudinary(originalFile.buffer)
            : photoUrl;

        const result = await pool.query(
            "UPDATE users SET profile_photo_url = $1, profile_photo_original_url = $2 WHERE id = $3 RETURNING profile_photo_url, profile_photo_original_url",
            [photoUrl, originalUrl, req.user.userId]
        );

        res.json({
            message: "Profile photo updated.",
            profile_photo_url: result.rows[0].profile_photo_url,
            profile_photo_original_url: result.rows[0].profile_photo_original_url
        });

    } catch (error) {
        console.error("Upload profile photo error:", error);
        res.status(500).json({ error: "Could not upload photo. Please try again." });
    }
}

async function removeProfilePhoto(req, res) {
    try {
        await pool.query(
            "UPDATE users SET profile_photo_url = NULL, profile_photo_original_url = NULL WHERE id = $1",
            [req.user.userId]
        );

        res.json({ message: "Profile photo removed." });

    } catch (error) {
        console.error("Remove profile photo error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function forgotPassword(req, res) {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required." });
        }

        const genericMessage = "If an account with that email exists, a password reset link has been sent.";

        const result = await pool.query(
            "SELECT id, name, email FROM users WHERE email = $1 AND role = 'customer'",
            [email]
        );

        if (result.rows.length === 0) {
            // Don't reveal whether the email is registered, or that staff/admin accounts
            // are intentionally excluded from self-service password reset
            return res.json({ message: genericMessage });
        }

        const user = result.rows[0];

        const resetToken = jwt.sign(
            { userId: user.id, email: user.email, purpose: "passwordReset" },
            JWT_SECRET,
            { expiresIn: "5m" }
        );

        const resetLink = `${req.protocol}://${req.get("host")}/reset-password.html?token=${resetToken}`;

        sendPasswordResetEmail(user.email, resetLink, 5).catch(err => console.error("Password reset email failed:", err));

        res.json({ message: genericMessage });

    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: "Token and new password are required." });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters." });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "This reset link has expired or is invalid. Please request a new one." });
        }

        if (decoded.purpose !== "passwordReset") {
            return res.status(401).json({ error: "Invalid reset link." });
        }

        // Single-use enforcement. JWTs can't be revoked, so instead any password
        // change stamps password_changed_at, and a token issued before that stamp
        // is treated as spent. NULL means never recorded, which stays valid.
        const freshness = await pool.query(
            "SELECT password_changed_at FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (freshness.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const changedAt = freshness.rows[0].password_changed_at;
        if (changedAt && decoded.iat * 1000 < new Date(changedAt).getTime()) {
            return res.status(401).json({ error: "This reset link has already been used. Please request a new one." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE users SET password = $1, must_reset_password = false, password_changed_at = NOW() WHERE id = $2",
            [hashedPassword, decoded.userId]
        );

        res.json({ message: "Password reset successfully. You can now log in with your new password." });

    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// Admin-triggered: flags an account so the next login must go through a password reset
async function forcePasswordReset(req, res) {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "UPDATE users SET must_reset_password = true WHERE id = $1 RETURNING id, name, email",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const target = result.rows[0];

        // Staff and admins are excluded from self-service reset by design, so this
        // email is their only route back in. Longer validity than the 5 minute
        // self-service link because the person is not sitting at the screen waiting.
        const resetToken = jwt.sign(
            { userId: target.id, email: target.email, purpose: "passwordReset" },
            JWT_SECRET,
            { expiresIn: "30m" }
        );

        const resetLink = `${req.protocol}://${req.get("host")}/reset-password.html?token=${resetToken}`;
        const emailSent = await sendPasswordResetEmail(target.email, resetLink, 30);

        res.json({
            message: emailSent
                ? `A password reset link has been emailed to ${target.email}. It expires in 30 minutes.`
                : `Reset flag set, but the email to ${target.email} could not be sent. Check the mail credentials and try again.`,
            emailSent,
            user: target
        });

    } catch (error) {
        console.error("Force password reset error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// Completes a forced password reset using the short-lived pendingToken issued at login
async function completeForcedPasswordReset(req, res) {
    try {
        const { pendingToken, newPassword } = req.body;

        if (!pendingToken || !newPassword) {
            return res.status(400).json({ error: "Token and new password are required." });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters." });
        }

        let decoded;
        try {
            decoded = jwt.verify(pendingToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "This session has expired. Please log in again." });
        }

        if (!decoded.pendingPasswordReset) {
            return res.status(401).json({ error: "Invalid token." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE users SET password = $1, must_reset_password = false, password_changed_at = NOW() WHERE id = $2",
            [hashedPassword, decoded.userId]
        );

        const userResult = await pool.query(
            "SELECT id, name, email, phone, role FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const user = userResult.rows[0];

        const sessionToken = await createSession(user.id, req, res);
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, sessionToken },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        await logLoginAttempt(user.id, req, true);

        res.json({
            message: "Password updated. Login successful.",
            token,
            user
        });

    } catch (error) {
        console.error("Complete forced password reset error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// Admin-triggered: force-logs-out a staff member from every device by wiping their sessions
async function logoutAllDevices(req, res) {
    try {
        const { id } = req.params;

        await pool.query("DELETE FROM sessions WHERE user_id = $1", [id]);

        res.json({ message: "All active sessions for this user have been logged out." });

    } catch (error) {
        console.error("Logout all devices error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// Admin action: clear a staff member's 2FA so they re-enrol at next login
async function resetStaff2FA(req, res) {
    try {
        const { id } = req.params;

        const target = await pool.query("SELECT id, name, role FROM users WHERE id = $1", [id]);
        if (target.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const staffRoles = ["store_manager", "product_staff", "customer_support"];
        if (!staffRoles.includes(target.rows[0].role)) {
            return res.status(403).json({ error: "Only staff accounts can be reset this way." });
        }

        await pool.query(
            "UPDATE users SET two_factor_secret = NULL, two_factor_enabled = false WHERE id = $1",
            [id]
        );
        await pool.query("DELETE FROM sessions WHERE user_id = $1", [id]);

        res.json({ message: "Two-factor authentication has been reset. They will set it up again at next login." });

    } catch (error) {
        console.error("Reset staff 2FA error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// Admin view: login history (date, time, IP, device, success/fail) for a given user
async function getLoginHistory(req, res) {
    try {
        const { id } = req.params;

        const result = await pool.query(
            "SELECT id, ip_address, device_label, success, logged_in_at FROM login_history WHERE user_id = $1 ORDER BY logged_in_at DESC LIMIT 50",
            [id]
        );

        res.json({ history: result.rows });

    } catch (error) {
        console.error("Get login history error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

async function getCurrentUser(req, res) {
    try {
        const result = await pool.query(
            "SELECT id, name, username, email, phone, role, two_factor_enabled FROM users WHERE id = $1",
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        res.json({ user: result.rows[0] });

    } catch (error) {
        console.error("Get current user error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}



const bcryptForAccount = require("bcryptjs");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");

// Change username
exports.changeUsername = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { username } = req.body;
        if (!username || username.trim().length < 3) {
            return res.status(400).json({ error: "Username must be at least 3 characters." });
        }
        const existing = await pool.query("SELECT id FROM users WHERE username = $1 AND id != $2", [username, userId]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "That username is already taken." });
        }
        const result = await pool.query(
            "UPDATE users SET username = $1 WHERE id = $2 RETURNING id, username, email",
            [username, userId]
        );
        res.json({ message: "Username updated successfully.", user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Change email (requires current password)
exports.changeEmail = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { email, currentPassword } = req.body;
        if (!email || !email.includes("@")) {
            return res.status(400).json({ error: "Please provide a valid email address." });
        }
        if (!currentPassword) {
            return res.status(400).json({ error: "Current password is required to change email." });
        }
        const userResult = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: "User not found." });
        const validPassword = await bcryptForAccount.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) return res.status(401).json({ error: "Current password is incorrect." });
        const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND id != $2", [email, userId]);
        if (existing.rows.length > 0) return res.status(409).json({ error: "That email is already in use." });
        const result = await pool.query(
            "UPDATE users SET email = $1 WHERE id = $2 RETURNING id, username, email",
            [email, userId]
        );
        res.json({ message: "Email updated successfully.", user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Change password
exports.changePassword = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: "Current and new password are required." });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters." });
        }
        const userResult = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: "User not found." });
        const validPassword = await bcryptForAccount.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) return res.status(401).json({ error: "Current password is incorrect." });
        const hashedPassword = await bcryptForAccount.hash(newPassword, 10);
        // password_changed_at is what invalidates outstanding reset tokens.
        // Without it a stale reset link still works after a voluntary change.
        await pool.query(
            "UPDATE users SET password = $1, password_changed_at = NOW() WHERE id = $2",
            [hashedPassword, userId]
        );
        res.json({ message: "Password updated successfully." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2FA step 1: generate secret + QR code
exports.setup2FA = async (req, res) => {
    try {
        const userId = req.user.userId;
        const secret = speakeasy.generateSecret({ name: `Lizimas Store (${req.user.email})`, length: 20 });
        await pool.query("UPDATE users SET two_factor_secret = $1, two_factor_enabled = false WHERE id = $2", [secret.base32, userId]);
        const qrImageUrl = await qrcode.toDataURL(secret.otpauth_url);
        res.json({ qrCode: qrImageUrl, manualEntryKey: secret.base32 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2FA step 2: verify code, enable it
exports.verify2FA = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { token } = req.body;
        const userResult = await pool.query("SELECT two_factor_secret FROM users WHERE id = $1", [userId]);
        const secret = userResult.rows[0] && userResult.rows[0].two_factor_secret;
        if (!secret) return res.status(400).json({ error: "No 2FA setup in progress. Start setup first." });
        const verified = speakeasy.totp.verify({ secret: secret, encoding: "base32", token: token, window: 1 });
        if (!verified) return res.status(400).json({ error: "Invalid code. Please try again." });
        await pool.query("UPDATE users SET two_factor_enabled = true WHERE id = $1", [userId]);

        if (req.isSetupToken) {
            const sessionToken = await createSession(userId, req, res);
            const authToken = jwt.sign(
                { userId: userId, email: req.user.email, role: req.user.role, sessionToken },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRY }
            );
            await logLoginAttempt(userId, req, true);
            return res.json({
                message: "Two-factor authentication enabled successfully.",
                token: authToken,
                role: req.user.role
            });
        }

        res.json({ message: "Two-factor authentication enabled successfully." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2FA: disable
exports.disable2FA = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { currentPassword } = req.body;
        if (!currentPassword) return res.status(400).json({ error: "Current password is required to disable 2FA." });
        const userResult = await pool.query("SELECT password FROM users WHERE id = $1", [userId]);
        const validPassword = await bcryptForAccount.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) return res.status(401).json({ error: "Current password is incorrect." });
        await pool.query("UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = $1", [userId]);
        res.json({ message: "Two-factor authentication disabled." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    registerUser,
    loginUser,
    staffLogin,
    forgotPassword,
    resetPassword,
    forcePasswordReset,
    completeForcedPasswordReset,
    logoutAllDevices,
    resetStaff2FA,
    getLoginHistory,
    createStaffAccount,
    adminLogin,
    activateStaffAccount,
    blockStaffAccount,
    getProfile,
    updateProfile,
    uploadProfilePhoto,
    removeProfilePhoto,
    getCurrentUser,
    changePassword: exports.changePassword,
    changeUsername: exports.changeUsername,
    changeEmail: exports.changeEmail,
    setup2FA: exports.setup2FA,
    verify2FA: exports.verify2FA,
    disable2FA: exports.disable2FA,
    verifyLogin2FA,
    requestEmail2FACode,
    listSessions,
    deleteSession
};

// Send a one-time login code by email as a fallback to the authenticator app
async function requestEmail2FACode(req, res) {
    try {
        const { pendingToken } = req.body;
        if (!pendingToken) {
            return res.status(400).json({ error: "Missing pending token." });
        }

        let decoded;
        try {
            decoded = jwt.verify(pendingToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "Session expired. Please log in again." });
        }

        if (!decoded.pending2FA) {
            return res.status(401).json({ error: "Invalid session. Please log in again." });
        }

        const userResult = await pool.query(
            "SELECT id, name, email, two_factor_enabled, email_otp_last_sent_at FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].two_factor_enabled) {
            return res.status(404).json({ error: "User not found." });
        }

        const user = userResult.rows[0];

        if (user.email_otp_last_sent_at) {
            const elapsed = Date.now() - new Date(user.email_otp_last_sent_at).getTime();
            if (elapsed < 60000) {
                const wait = Math.ceil((60000 - elapsed) / 1000);
                return res.status(429).json({ error: "Please wait " + wait + " seconds before requesting another code." });
            }
        }

        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        const hash = await bcrypt.hash(code, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            "UPDATE users SET email_otp_hash = $1, email_otp_expires_at = $2, email_otp_attempts = 0, email_otp_last_sent_at = NOW() WHERE id = $3",
            [hash, expiresAt, user.id]
        );

        try {
            await sendTwoFactorCodeEmail(user.email, code);
        } catch (err) {
            await pool.query(
                "UPDATE users SET email_otp_hash = NULL, email_otp_expires_at = NULL, email_otp_last_sent_at = NULL WHERE id = $1",
                [user.id]
            );
            return res.status(500).json({ error: "Could not send the code. Please use your authenticator app." });
        }

        res.json({ message: "A login code has been sent to your email." });
    } catch (error) {
        console.error("Request email 2FA code error:", error);
        res.status(500).json({ error: "Server error requesting code." });
    }
}

// Complete login when 2FA is required
async function verifyLogin2FA(req, res) {
    try {
        const { pendingToken, code } = req.body;

        if (!pendingToken || !code) {
            return res.status(400).json({ error: "Pending token and code are required." });
        }

        let decoded;
        try {
            decoded = jwt.verify(pendingToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "Login session expired. Please log in again." });
        }

        if (!decoded.pending2FA) {
            return res.status(401).json({ error: "Invalid session. Please log in again." });
        }

        const userResult = await pool.query(
            "SELECT id, name, email, phone, role, two_factor_secret, email_otp_hash, email_otp_expires_at, email_otp_attempts FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const user = userResult.rows[0];
        let verified = speakeasy.totp.verify({
            secret: user.two_factor_secret,
            encoding: "base32",
            token: code,
            window: 1
        });

        if (!verified && user.email_otp_hash) {
            const clearOtp = "UPDATE users SET email_otp_hash = NULL, email_otp_expires_at = NULL, email_otp_attempts = 0 WHERE id = $1";

            if (!user.email_otp_expires_at || new Date(user.email_otp_expires_at) < new Date()) {
                await pool.query(clearOtp, [user.id]);
                return res.status(401).json({ error: "That code has expired. Please request a new one." });
            }

            if (user.email_otp_attempts >= 5) {
                await pool.query(clearOtp, [user.id]);
                return res.status(429).json({ error: "Too many attempts. Please request a new code." });
            }

            const emailMatch = await bcrypt.compare(String(code), user.email_otp_hash);
            if (emailMatch) {
                verified = true;
                await pool.query(clearOtp, [user.id]);
            } else {
                await pool.query("UPDATE users SET email_otp_attempts = email_otp_attempts + 1 WHERE id = $1", [user.id]);
            }
        }

        if (!verified) {
            await logLoginAttempt(user.id, req, false, {
                failureReason: "bad_2fa",
                attemptedEmail: user.email
            });
            return res.status(401).json({ error: "Invalid code. Please try again." });
        }

        const sessionToken = await createSession(user.id, req, res);
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, sessionToken },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        if (user.role === "admin") {
            sendAdminLoginAlert({
                name: user.name,
                email: user.email,
                time: new Date().toISOString(),
                ip: req.ip || req.connection.remoteAddress || "Unknown"
            }).catch(err => console.error("Admin login alert failed:", err));
        }

        await logLoginAttempt(user.id, req, true);

        res.json({
            message: "Login successful.",
            token,
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }
        });

    } catch (error) {
        console.error("2FA login verification error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// List all active sessions/devices for the logged-in user
async function listSessions(req, res) {
    try {
        const userId = req.user.userId;
        const currentSessionToken = req.user.sessionToken;

        const result = await pool.query(
            "SELECT id, device_label, ip_address, created_at, last_used_at, session_token FROM sessions WHERE user_id = $1 ORDER BY last_used_at DESC",
            [userId]
        );

        const sessions = result.rows.map(row => ({
            id: row.id,
            deviceLabel: row.device_label,
            ipAddress: row.ip_address,
            createdAt: row.created_at,
            lastUsedAt: row.last_used_at,
            isCurrent: row.session_token === currentSessionToken
        }));

        res.json({ sessions });
    } catch (error) {
        console.error("List sessions error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

// Revoke/delete a specific session (log out that device)
async function deleteSession(req, res) {
    try {
        const userId = req.user.userId;
        const { sessionId } = req.params;

        const result = await pool.query(
            "DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id",
            [sessionId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Session not found." });
        }

        res.json({ message: "Device logged out successfully." });
    } catch (error) {
        console.error("Delete session error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}
