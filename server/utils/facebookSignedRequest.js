'use strict';

const crypto = require('crypto');

// Split out from oauthController.js on purpose: that module requires
// GOOGLE_CLIENT_ID / JWT_SECRET-dependent code at load time and throws if
// they're unset (correct for a running server - wrong for a unit test,
// which should be able to exercise this pure signature-verification logic
// with none of that configured). No Express, no database, no env reads
// beyond the secret passed in by the caller.

function base64UrlDecode(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64');
}

// Facebook's signed_request format: base64url(HMAC-SHA256 signature) + "." +
// base64url(JSON payload), the signature computed over the payload segment
// exactly as sent (not the decoded JSON). Returns the decoded payload
// object, or null for anything that fails to parse or whose signature does
// not match - callers must treat null as "reject the request", never as "no
// user_id" (a forged payload could easily omit it to look harmless).
function parseSignedRequest(signedRequest, appSecret) {
    if (!signedRequest || typeof signedRequest !== 'string' || !appSecret) return null;

    const parts = signedRequest.split('.');
    if (parts.length !== 2) return null;
    const [encodedSig, encodedPayload] = parts;

    let sig, expectedSig;
    try {
        sig = base64UrlDecode(encodedSig);
        expectedSig = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
    } catch (err) {
        return null;
    }

    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
        return null;
    }

    let data;
    try {
        data = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    } catch (err) {
        return null;
    }

    if (!data || data.algorithm !== 'HMAC-SHA256') return null;
    return data;
}

module.exports = { parseSignedRequest };
