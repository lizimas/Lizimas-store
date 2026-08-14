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

// ---- Device approval requests (phase 4c) --------------------------------
// An unrecognised device raises one of these instead of locking the account.
// Three separate secrets: a ref the browser polls with, and one token each for
// approve and deny, so a denial link can never be replayed as an approval.
const REQUEST_TTL_MS = 10 * 60 * 1000;

async function createDeviceRequest(userId, req, surface) {
    // Only one live request per account: a second login attempt supersedes
    // the first rather than leaving two approvable rows in the wild.
    await pool.query(
        "UPDATE device_requests SET status = 'expired' WHERE user_id = $1 AND status = 'pending'",
        [userId]
    );

    const ref = crypto.randomBytes(32).toString("hex");
    const approveToken = crypto.randomBytes(32).toString("hex");
    const denyToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);

    await pool.query(
        `INSERT INTO device_requests
           (user_id, ref_hash, approve_token_hash, deny_token_hash,
            surface, ip_address, user_agent, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
            userId,
            hashToken(ref),
            hashToken(approveToken),
            hashToken(denyToken),
            surface || null,
            clientIp(req),
            (req.headers["user-agent"] || "Unknown device").slice(0, 500),
            expiresAt
        ]
    );

    return { ref, approveToken, denyToken, expiresAt };
}

// Lookup by any of the three secrets. Expiry is evaluated on read so a row
// never has to be swept to stop being usable.
async function findDeviceRequest(column, rawToken) {
    if (!rawToken) return null;
    if (!["ref_hash", "approve_token_hash", "deny_token_hash"].includes(column)) return null;

    const result = await pool.query(
        `SELECT d.*, u.email, u.name, u.role
           FROM device_requests d
           JOIN users u ON u.id = d.user_id
          WHERE d.${column} = $1`,
        [hashToken(rawToken)]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    if (row.status === "pending" && new Date(row.expires_at) < new Date()) {
        await pool.query("UPDATE device_requests SET status = 'expired' WHERE id = $1", [row.id]);
        row.status = "expired";
    }
    return row;
}

// Guarded by status so a double-tap on the emailed link cannot flip an
// already-decided request.
async function decideDeviceRequest(id, decision) {
    const result = await pool.query(
        `UPDATE device_requests
            SET status = $2, decided_at = NOW()
          WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
      RETURNING *`,
        [id, decision]
    );
    return result.rows[0] || null;
}

// Single-use: consumed in the same breath as the session is created, so an
// approval cannot be spent twice.
async function consumeDeviceRequest(id) {
    const result = await pool.query(
        `UPDATE device_requests
            SET status = 'consumed', consumed_at = NOW()
          WHERE id = $1 AND status = 'approved'
      RETURNING *`,
        [id]
    );
    return result.rows[0] || null;
}

module.exports = {
    createDeviceRequest,
    findDeviceRequest,
    decideDeviceRequest,
    consumeDeviceRequest,
    REQUEST_TTL_MS,
    COOKIE_NAME,
    isEnforced,
    hashToken,
    readDeviceToken,
    findTrustedDevice,
    issueDeviceCookie
};
