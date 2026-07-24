const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const crypto = require("crypto");
const { sendAdminLoginAlert, sendPasswordResetEmail, sendStaffActivationEmail, sendAccountBlockedEmail, sendAdminBlockAlert } = require("../utils/mailer");

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env_file";
const TOKEN_EXPIRY = "7d";
async function createSession(userId, req) {
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const userAgent = (req.headers["user-agent"] || "Unknown device").slice(0, 255);
    const ipAddress = req.ip || req.connection.remoteAddress || "Unknown";

    await pool.query(
        "INSERT INTO sessions (session_token, user_id, device_label, ip_address) VALUES ($1, $2, $3, $4)",
        [sessionToken, userId, userAgent, ipAddress]
    );

    return sessionToken;
}

async function logLoginAttempt(userId, req, success) {
    const userAgent = (req.headers["user-agent"] || "Unknown device").slice(0, 255);
    const ipAddress = req.ip || req.connection.remoteAddress || "Unknown";
    try {
        await pool.query(
            "INSERT INTO login_history (user_id, ip_address, device_label, success) VALUES ($1, $2, $3, $4)",
            [userId, ipAddress, userAgent, success]
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

async function loginUser(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const result = await pool.query(
            "SELECT id, name, email, password, phone, role, two_factor_enabled, is_active, blocked_at, must_reset_password FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = result.rows[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            await logLoginAttempt(user.id, req, false);
            return res.status(401).json({ error: "Invalid email or password." });
        }

        if (user.blocked_at) {
            await logLoginAttempt(user.id, req, false);
            return res.status(403).json({ error: "This account has been blocked. Please contact the administrator." });
        }

        if (!user.is_active) {
            await logLoginAttempt(user.id, req, false);
            return res.status(403).json({ error: "Your account is pending activation by the administrator." });
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

        const sessionToken = await createSession(user.id, req);
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

        const allowedStaffRoles = ["product_staff", "store_manager"];

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
            "SELECT id, name, email, password, role, two_factor_enabled, is_active, blocked_at, failed_admin_attempts, must_reset_password FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = result.rows[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            await logLoginAttempt(user.id, req, false);
            return res.status(401).json({ error: "Invalid email or password." });
        }

        if (user.blocked_at) {
            await logLoginAttempt(user.id, req, false);
            return res.status(403).json({ error: "This account has been blocked due to repeated unauthorized admin access attempts." });
        }

        if (user.role !== "admin") {
            const newAttempts = (user.failed_admin_attempts || 0) + 1;

            if (newAttempts >= 3) {
                await pool.query(
                    "UPDATE users SET failed_admin_attempts = $1, blocked_at = NOW(), is_active = false WHERE id = $2",
                    [newAttempts, user.id]
                );

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

            const attemptsRemaining = 3 - newAttempts;
            return res.status(403).json({ error: `This account does not have admin access. ${attemptsRemaining} attempt(s) remaining before it is blocked.` });
        }

        if (!user.is_active) {
            await logLoginAttempt(user.id, req, false);
            return res.status(403).json({ error: "Your account is pending activation." });
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

        const sessionToken = await createSession(user.id, req);
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, sessionToken },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        await logLoginAttempt(user.id, req, true);

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
            { expiresIn: "15m" }
        );

        const resetLink = `${req.protocol}://${req.get("host")}/reset-password.html?token=${resetToken}`;

        sendPasswordResetEmail(user.email, resetLink).catch(err => console.error("Password reset email failed:", err));

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

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE users SET password = $1 WHERE id = $2",
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

        res.json({ message: "This user will be required to reset their password on next login.", user: result.rows[0] });

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
            "UPDATE users SET password = $1, must_reset_password = false WHERE id = $2",
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

        const sessionToken = await createSession(user.id, req);
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


async function changePassword(req, res) {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password are required." });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters." });
    }

    try {
        const result = await pool.query(
            "SELECT id, password FROM users WHERE id = $1",
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const user = result.rows[0];
        const passwordMatches = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatches) {
            return res.status(401).json({ error: "Current password is incorrect." });
        }

        const newHashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
            "UPDATE users SET password = $1 WHERE id = $2",
            [newHashedPassword, user.id]
        );

        res.json({ message: "Password updated successfully." });

    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ error: "Something went wrong while changing your password." });
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
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, userId]);
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
    forgotPassword,
    resetPassword,
    forcePasswordReset,
    completeForcedPasswordReset,
    logoutAllDevices,
    getLoginHistory,
    createStaffAccount,
    adminLogin,
    activateStaffAccount,
    blockStaffAccount,
    getCurrentUser,
    changePassword: exports.changePassword,
    changeUsername: exports.changeUsername,
    changeEmail: exports.changeEmail,
    setup2FA: exports.setup2FA,
    verify2FA: exports.verify2FA,
    disable2FA: exports.disable2FA,
    verifyLogin2FA,
    listSessions,
    deleteSession
};

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
            "SELECT id, name, email, phone, role, two_factor_secret FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const user = userResult.rows[0];
        const verified = speakeasy.totp.verify({
            secret: user.two_factor_secret,
            encoding: "base32",
            token: code,
            window: 1
        });

        if (!verified) {
            return res.status(401).json({ error: "Invalid code. Please try again." });
        }

        const sessionToken = await createSession(user.id, req);
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
