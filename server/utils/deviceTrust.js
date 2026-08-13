const crypto = require("crypto");
const pool = require("../config/database");

// Device recognition.
//
// A trusted device is a browser holding a cookie whose SHA-256 hash matches a
// live row in trusted_devices. The raw token is never stored, so a database
// leak yields no usable credentials.
//
// Phase A enrols devices without enforcing anything. isEnforced() gates the
// refusal logic, so enforcement is turned on by environment variable and a
// restart rather than a deploy.

const COOKIE_NAME = "lz_device";
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // one year

function isEnforced() {
    return String(process.env.DEVICE_LOCK_ENFORCED || "").toLowerCase() === "true";
}

function hashToken(raw) {
    return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function clientIp(req) {
    return (
        req.headers["cf-connecting-ip"] ||
        req.ip ||
        (req.connection && req.connection.remoteAddress) ||
        "Unknown"
    ).toString().slice(0, 45);
}

// Reads the device cookie, if the browser sent one.
function readDeviceToken(req) {
    if (!req.cookies) return null;
    const raw = req.cookies[COOKIE_NAME];
    return raw ? String(raw) : null;
}

// Returns the matching trusted_devices row, or null. Touches last_seen_at so
// the Security tab can show genuinely dormant devices.
async function findTrustedDevice(userId, rawToken) {
    if (!rawToken) return null;

    try {
        const result = await pool.query(
            `SELECT id, device_label, origin, created_at
               FROM trusted_devices
              WHERE user_id = $1
                AND token_hash = $2
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())`,
            [userId, hashToken(rawToken)]
        );

        if (result.rows.length === 0) return null;

        await pool.query(
            "UPDATE trusted_devices SET last_seen_at = NOW() WHERE id = $1",
            [result.rows[0].id]
        );

        return result.rows[0];
    } catch (error) {
        console.error("findTrustedDevice error:", error);
        // Fail open in phase A. Phase B will need this to fail closed.
        return null;
    }
}

// Mints a new device token, stores its hash, and sets the cookie on the
// response. Called on every successful login; if the browser already holds a
// valid token, that row is refreshed instead of creating a duplicate.
async function issueDeviceCookie(res, req, userId) {
    try {
        const existing = await findTrustedDevice(userId, readDeviceToken(req));
        if (existing) return existing.id;

        const rawToken = crypto.randomBytes(32).toString("hex");
        const label = (req.headers["user-agent"] || "Unknown device").slice(0, 255);

        const result = await pool.query(
            `INSERT INTO trusted_devices (user_id, token_hash, device_label, ip_address, origin, expires_at)
             VALUES ($1, $2, $3, $4, 'cookie', NOW() + INTERVAL '1 year')
             RETURNING id`,
            [userId, hashToken(rawToken), label, clientIp(req)]
        );

        res.cookie(COOKIE_NAME, rawToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: COOKIE_MAX_AGE_MS,
            path: "/"
        });

        return result.rows[0].id;
    } catch (error) {
        // Never block a legitimate login because enrolment failed.
        console.error("issueDeviceCookie error:", error);
        return null;
    }
}

module.exports = {
    COOKIE_NAME,
    isEnforced,
    hashToken,
    readDeviceToken,
    findTrustedDevice,
    issueDeviceCookie
};
