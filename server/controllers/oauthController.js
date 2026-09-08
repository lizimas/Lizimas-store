const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const pool = require("../config/database");
const { parseSignedRequest } = require("../utils/facebookSignedRequest");
const { completeLogin, logLoginAttempt, CUSTOMER_LOGIN_ROLES } = require("./authController");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (!GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not set. Refusing to start with federated sign-in misconfigured.");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- Facebook Login -------------------------------------------------------
//
// Unlike Google above, this does NOT throw at module load when unconfigured.
// The Google throw made sense once Google was the only federated path and a
// missing client id meant the whole feature was broken - but that same
// pattern here would mean a missing Facebook app id crashes the entire
// server (this file is required unconditionally from routes/auth.js), for a
// provider that, unlike Google, has real external prerequisites (a Terms of
// Service page, a data-deletion callback, and Meta app review) that can take
// time to clear. So Facebook fails soft: the routes answer 503 until both
// env vars are set, and everything else keeps working.
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || null;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || null;
const FACEBOOK_CONFIGURED = Boolean(FACEBOOK_APP_ID && FACEBOOK_APP_SECRET);

// Overridable because Graph API endpoints are versioned and Meta deprecates
// old versions on a schedule; whoever sets FACEBOOK_APP_ID up should check
// the current supported version in the Meta developer console.
const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v21.0";
const FACEBOOK_GRAPH_BASE = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}`;

const PUBLIC_BASE_URL =
    String(process.env.PUBLIC_BASE_URL || "https://lizimasstore.com").replace(/\/+$/, "");

async function verifyFacebookAccessToken(accessToken) {
    const appToken = `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`;
    const url = `${FACEBOOK_GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`;

    const res = await fetch(url);
    const body = await res.json();
    const info = body && body.data;

    if (!res.ok || !info || !info.is_valid || String(info.app_id) !== String(FACEBOOK_APP_ID)) {
        return null;
    }
    return info; // { is_valid, app_id, user_id, ... }
}

// Facebook Login proves an email address (when it returns one) and nothing
// more, exactly like Google above - completeLogin() is still where every
// real access decision happens. Mirrors googleSignIn's structure; NOT
// sharing code with it because the two providers' verification steps
// (ID token vs access token + debug_token + /me) are different enough that a
// shared abstraction would just be an if/else in disguise.
async function facebookSignIn(req, res) {
    const surface = "oauth_facebook";
    const { accessToken } = req.body;

    if (!FACEBOOK_CONFIGURED) {
        return res.status(503).json({ error: "Facebook sign-in is not available yet." });
    }
    if (!accessToken) {
        return res.status(400).json({ error: "Sign-in failed. Please try again." });
    }

    try {
        let tokenInfo;
        try {
            tokenInfo = await verifyFacebookAccessToken(accessToken);
        } catch (err) {
            tokenInfo = null;
        }
        if (!tokenInfo) {
            await logLoginAttempt(null, req, false, { surface, failureReason: "token_invalid" });
            return res.status(401).json({ error: "Sign-in failed. Please try again." });
        }

        const fbUserId = String(tokenInfo.user_id);

        const meRes = await fetch(
            `${FACEBOOK_GRAPH_BASE}/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
        );
        const me = await meRes.json();
        if (!meRes.ok || !me || String(me.id) !== fbUserId) {
            await logLoginAttempt(null, req, false, { surface, failureReason: "profile_fetch_failed" });
            return res.status(401).json({ error: "Sign-in failed. Please try again." });
        }

        const email = (me.email || "").toLowerCase();
        const name = me.name || (email ? email.split("@")[0] : "Facebook user");

        // Already linked? Match on the provider subject, never on email - same
        // anti-takeover reasoning as the Google path.
        const linked = await pool.query(
            `SELECT u.* FROM users u
               JOIN user_identities i ON i.user_id = u.id
              WHERE i.provider = 'facebook' AND i.provider_user_id = $1`,
            [fbUserId]
        );

        if (linked.rows.length > 0) {
            await pool.query(
                "UPDATE user_identities SET last_login_at = now() WHERE provider = 'facebook' AND provider_user_id = $1",
                [fbUserId]
            );
            return completeLogin(linked.rows[0], req, res, {
                allowedRoles: CUSTOMER_LOGIN_ROLES,
                surface,
                attemptedEmail: email || undefined
            });
        }

        // Not linked yet. Facebook can decline to return an email at all - a
        // phone-only account, or the user declined the email permission. The
        // rest of this app is entirely email-based (login, receipts, password
        // reset), so there is nowhere safe to put an account with no email.
        // Documented decision (see PENDING.md before this landed): refuse
        // cleanly rather than inventing a placeholder address.
        if (!email) {
            await logLoginAttempt(null, req, false, { surface, failureReason: "no_email" });
            return res.status(401).json({
                error: "Your Facebook account has no email address available. Please sign in with email/password or Google instead."
            });
        }

        // Facebook only ever returns an email Facebook itself has confirmed
        // belongs to the account, so - unlike Google, which flags this
        // explicitly via email_verified - presence of an email here already
        // means it is verified. Safe to link straight to an existing account.
        const existing = await pool.query("SELECT * FROM users WHERE lower(email) = $1", [email]);

        if (existing.rows.length > 0) {
            const user = existing.rows[0];

            await pool.query(
                `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email, email_verified, last_login_at)
                 VALUES ($1, 'facebook', $2, $3, true, now())
                 ON CONFLICT (provider, provider_user_id) DO NOTHING`,
                [user.id, fbUserId, email]
            );

            if (!user.email_verified_at) {
                await pool.query(
                    "UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL",
                    [user.id]
                );
            }

            return completeLogin(user, req, res, {
                allowedRoles: CUSTOMER_LOGIN_ROLES,
                surface,
                attemptedEmail: email
            });
        }

        // New customer, same unusable-password-hash approach as Google: the
        // password column is NOT NULL, so store a hash of random bytes that
        // has no producible plaintext. Password login fails closed until the
        // customer sets one via reset.
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
                if (err.code === "23505" && String(err.constraint || "").includes("username")) continue;
                throw err;
            }
        }

        if (!created) {
            return res.status(500).json({ error: "Could not create your account. Please try again." });
        }

        await pool.query(
            `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email, email_verified, last_login_at)
             VALUES ($1, 'facebook', $2, $3, true, now())`,
            [created.id, fbUserId, email]
        );

        return completeLogin(created, req, res, {
            allowedRoles: CUSTOMER_LOGIN_ROLES,
            surface,
            attemptedEmail: email
        });

    } catch (error) {
        console.error("Facebook sign-in error:", error);
        res.status(500).json({ error: "Something went wrong while signing you in." });
    }
}

// Meta's required data-deletion callback. Called server-to-server by
// Facebook's platform (never by a browser) whenever a user removes this app
// from their Facebook settings or requests deletion through Facebook's own
// Data Deletion Request flow - Meta will not approve the app for Login
// without one configured.
//
// We do NOT delete the account itself here: order and payment records may be
// data we are legally required to retain (see privacy.html#retention), and
// account deletion already goes through a human-reviewed path for password
// accounts. What Meta actually requires is that we stop being able to use
// Facebook data for this person and give them a way to check status - so
// this unlinks the identity immediately and alerts an admin to review the
// rest, mirroring how a footer account-issue report is handled.
async function facebookDataDeletion(req, res) {
    if (!FACEBOOK_CONFIGURED) {
        return res.status(503).json({ error: "Facebook sign-in is not available yet." });
    }

    const signedRequest = req.body && req.body.signed_request;
    const data = parseSignedRequest(signedRequest, FACEBOOK_APP_SECRET);

    if (!data || !data.user_id) {
        return res.status(400).json({ error: "Invalid signed request." });
    }

    const fbUserId = String(data.user_id);
    const confirmationCode = crypto.randomBytes(8).toString("hex");

    try {
        const result = await pool.query(
            `DELETE FROM user_identities
              WHERE provider = 'facebook' AND provider_user_id = $1
              RETURNING user_id`,
            [fbUserId]
        );

        let linkedEmail = null;
        if (result.rows.length > 0) {
            const u = await pool.query("SELECT email FROM users WHERE id = $1", [result.rows[0].user_id]);
            linkedEmail = u.rows[0] ? u.rows[0].email : null;
        }

        const { sendDataDeletionAlert } = require("../utils/mailer");
        sendDataDeletionAlert({
            confirmationCode,
            fbUserId,
            linkedEmail,
            unlinked: result.rows.length > 0,
            time: new Date().toLocaleString("en-GB", { timeZone: "Africa/Kampala" }) + " (EAT)"
        }).catch(err => console.error("Data deletion alert failed:", err));

    } catch (error) {
        // Still answer Meta with a valid confirmation even if the unlink or
        // the alert email failed - Meta polls this endpoint's contract, not
        // our internal follow-up, and the admin alert failing silently is
        // strictly better than Facebook marking our callback as broken.
        console.error("Facebook data deletion error:", error);
    }

    return res.json({
        url: `${PUBLIC_BASE_URL}/data-deletion-status.html?id=${confirmationCode}`,
        confirmation_code: confirmationCode
    });
}


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


// Redirect-mode entry point. Google submits a form POST here rather than
// handing the credential to JavaScript, which is the only flow that survives
// mobile browsers turning the sign-in popup into a navigation.
//
// Identity handling is deliberately not duplicated: this verifies CSRF, then
// falls through to the same googleSignIn body via a shaped request.
async function googleCallback(req, res) {
    const cookieToken = req.cookies && req.cookies.g_csrf_token;
    const bodyToken = req.body && req.body.g_csrf_token;

    // Double-submit: a forged cross-site POST cannot read the cookie, so it
    // cannot make the two halves match.
    if (!cookieToken || !bodyToken || cookieToken !== bodyToken) {
        await logLoginAttempt(null, req, false, {
            surface: "oauth_google",
            failureReason: "csrf_mismatch"
        });
        return res.redirect("/login.html?e=csrf");
    }

    // completeLogin answers with JSON. Capture it rather than letting it reach
    // the browser, then translate to the redirect this flow needs.
    const captured = {};
    const shim = {
        status(code) { captured.code = code; return shim; },
        json(body) { captured.body = body; return shim; },
        redirect(url) { captured.redirect = url; return shim; },
        cookie(...args) { return res.cookie(...args); },
        clearCookie(...args) { return res.clearCookie(...args); },
        set(...args) { return res.set(...args); },
        setHeader(...args) { return res.setHeader(...args); },
        getHeader(...args) { return res.getHeader(...args); }
    };

    const shapedReq = Object.create(req);
    shapedReq.body = { credential: req.body.credential };

    await googleSignIn(shapedReq, shim);

    const out = captured.body || {};

    if (out.token) {
        // Fragment, not query: fragments are never sent to a server, so the
        // token stays out of access logs and Referer headers. It does land in
        // browser history, which is why PENDING.md carries the cookie migration.
        const payload = encodeURIComponent(JSON.stringify({ t: out.token, u: out.user }));
        return res.redirect(`/oauth-complete.html#${payload}`);
    }

    if (out.requires2FA || out.requiresPasswordReset || out.requiresDeviceApproval) {
        const payload = encodeURIComponent(JSON.stringify(out));
        return res.redirect(`/oauth-complete.html#${payload}`);
    }

    return res.redirect("/login.html?e=oauth");
}

module.exports = {
    googleSignIn,
    googleCallback,
    facebookSignIn,
    facebookDataDeletion,
    // exported for unit tests only
    _parseSignedRequest: parseSignedRequest
};
