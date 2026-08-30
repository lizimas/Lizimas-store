const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const pool = require("../config/database");
const { completeLogin, logLoginAttempt, CUSTOMER_LOGIN_ROLES } = require("./authController");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (!GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not set. Refusing to start with federated sign-in misconfigured.");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Federated sign-in proves an email address and nothing more. Everything that
// decides whether this account may hold a session — scope, deletion, lock,
// block, activation, device, password reset, 2FA — runs in completeLogin,
// exactly as it does for password login. This file must never issue a token.
async function googleSignIn(req, res) {
    const surface = "oauth_google";
    const { credential } = req.body;

    if (!credential) {
        return res.status(400).json({ error: "Sign-in failed. Please try again." });
    }

    try {
        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: GOOGLE_CLIENT_ID
            });
            payload = ticket.getPayload();
        } catch (err) {
            await logLoginAttempt(null, req, false, {
                surface: surface,
                failureReason: "token_invalid"
            });
            return res.status(401).json({ error: "Sign-in failed. Please try again." });
        }

        const sub = payload.sub;
        const email = (payload.email || "").toLowerCase();
        const emailVerified = payload.email_verified === true;
        const name = payload.name || email.split("@")[0];

        if (!email) {
            await logLoginAttempt(null, req, false, {
                surface: surface,
                failureReason: "no_email"
            });
            return res.status(401).json({ error: "Your Google account has no email address available." });
        }

        // Linked already? The provider subject is the key, never the email:
        // an email can change hands, a subject cannot.
        const linked = await pool.query(
            `SELECT u.* FROM users u
               JOIN user_identities i ON i.user_id = u.id
              WHERE i.provider = 'google' AND i.provider_user_id = $1`,
            [sub]
        );

        if (linked.rows.length > 0) {
            await pool.query(
                "UPDATE user_identities SET last_login_at = now() WHERE provider = 'google' AND provider_user_id = $1",
                [sub]
            );
            return completeLogin(linked.rows[0], req, res, {
                allowedRoles: CUSTOMER_LOGIN_ROLES,
                surface: surface,
                attemptedEmail: email
            });
        }

        // Not linked. An unverified provider email must never reach an existing
        // account: that is the account-takeover path.
        if (!emailVerified) {
            await logLoginAttempt(null, req, false, {
                surface: surface,
                failureReason: "email_unverified",
                attemptedEmail: email
            });
            return res.status(401).json({ error: "Your Google email address is not verified." });
        }

        const existing = await pool.query("SELECT * FROM users WHERE lower(email) = $1", [email]);

        if (existing.rows.length > 0) {
            const user = existing.rows[0];

            // Link, then run the gates. Linking before completeLogin is safe:
            // it grants no session, and a refusal below still returns nothing.
            await pool.query(
                `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email, email_verified, last_login_at)
                 VALUES ($1, 'google', $2, $3, true, now())
                 ON CONFLICT (provider, provider_user_id) DO NOTHING`,
                [user.id, sub, email]
            );

            if (!user.email_verified_at) {
                await pool.query(
                    "UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL",
                    [user.id]
                );
            }

            return completeLogin(user, req, res, {
                allowedRoles: CUSTOMER_LOGIN_ROLES,
                surface: surface,
                attemptedEmail: email
            });
        }

        // New customer. Password column is NOT NULL, so store a hash of random
        // bytes: a valid bcrypt hash with no producible plaintext. Password
        // login therefore fails closed until the user sets one via reset.
        const unusable = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "user";

        let created = null;
        for (let attempt = 0; attempt < 5 && !created; attempt++) {
            const username = attempt === 0 ? usernameBase : `${usernameBase}${attempt}`;
            try {
                const ins = await pool.query(
                    `INSERT INTO users (name, email, password, username, email_verified_at)
                     VALUES ($1, $2, $3, $4, now()) RETURNING *`,
                    [name.slice(0, 100), email, unusable, username]
                );
                created = ins.rows[0];
            } catch (err) {
                // 23505 is unique_violation. Retry only on username; an email
                // collision here means a race with another signup, so stop.
                if (err.code === "23505" && String(err.constraint || "").includes("username")) continue;
                throw err;
            }
        }

        if (!created) {
            return res.status(500).json({ error: "Could not create your account. Please try again." });
        }

        await pool.query(
            `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email, email_verified, last_login_at)
             VALUES ($1, 'google', $2, $3, true, now())`,
            [created.id, sub, email]
        );

        return completeLogin(created, req, res, {
            allowedRoles: CUSTOMER_LOGIN_ROLES,
            surface: surface,
            attemptedEmail: email
        });

    } catch (error) {
        console.error("Google sign-in error:", error);
        res.status(500).json({ error: "Something went wrong while signing you in." });
    }
}

module.exports = { googleSignIn };
