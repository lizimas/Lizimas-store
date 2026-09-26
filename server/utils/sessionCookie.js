// Login sessions in httpOnly cookies (Ryan, Sept 2026).
//
// The session token used to live in the browser's localStorage, where any
// script on the page could read it. It is now kept in an httpOnly cookie that
// JavaScript can't see. Each part of the site has its own cookie so a
// customer, vendor, admin and staff login in the same browser stay separate:
//
//   X-LZ-Session: user | vendor | admin | staff   (sent by client/js/lz-session.js)
//
// picks which cookie a request uses. Cookie logins are only accepted together
// with that header - a custom header other sites can't send - and the cookies
// are SameSite=Lax, so a forged cross-site request can't use them.
// An old-style "Authorization: Bearer <jwt>" still works during the switch.

const jwt = require("jsonwebtoken");

const COOKIES = { user: "lz_s_user", vendor: "lz_s_vendor", admin: "lz_s_admin", staff: "lz_s_staff" };
const KEEP_MS = 7 * 24 * 3600 * 1000; // matches the 7-day token lifetime

function portalOf(req) {
    const p = String((req.get && req.get("X-LZ-Session")) || "").toLowerCase();
    return COOKIES[p] ? p : null;
}

function isJwt(t) {
    return typeof t === "string" && t.split(".").length === 3;
}

// The session token for this request: a real Bearer JWT, else the cookie
// named by X-LZ-Session.
function tokenFrom(req) {
    const h = req.headers && req.headers.authorization;
    if (h && h.startsWith("Bearer ")) {
        const t = h.slice(7).trim();
        if (isJwt(t)) return t;
    }
    const portal = portalOf(req);
    if (portal && req.cookies && req.cookies[COOKIES[portal]]) return req.cookies[COOKIES[portal]];
    return null;
}

function isHttps(req) {
    return !!(req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
}

function setSessionCookie(req, res, portal, token, keep) {
    if (!COOKIES[portal]) return;
    res.cookie(COOKIES[portal], token, {
        httpOnly: true,
        secure: isHttps(req),
        sameSite: "lax",
        path: "/",
        ...(keep ? { maxAge: KEEP_MS } : {})
    });
}

function clearSessionCookie(req, res, portal) {
    if (!COOKIES[portal]) return;
    res.clearCookie(COOKIES[portal], { httpOnly: true, secure: isHttps(req), sameSite: "lax", path: "/" });
}

// A signed-in session token (not a half-way 2FA/setup token)?
function isFullSessionToken(token) {
    try {
        const d = jwt.verify(token, process.env.JWT_SECRET);
        return !!(d && d.sessionToken && !d.pending2FA && !d.pendingSetup);
    } catch (e) {
        return false;
    }
}

// App-wide: when a login response carries { token }, move it into the
// portal's cookie and send the page the placeholder "cookie" instead, so the
// real token never reaches JavaScript. Pages keep storing whatever "token"
// says, which is how their existing "am I signed in?" checks keep working.
function sessionCookieResponder(req, res, next) {
    const portal = portalOf(req);
    if (!portal) return next();
    const original = res.json.bind(res);
    res.json = function (body) {
        if (body && isJwt(body.token) && isFullSessionToken(body.token)) {
            setSessionCookie(req, res, portal, body.token, req.get("X-LZ-Keep") === "1");
            body = { ...body, token: "cookie" };
        }
        return original(body);
    };
    next();
}

module.exports = { COOKIES, portalOf, isJwt, tokenFrom, setSessionCookie, clearSessionCookie, isFullSessionToken, sessionCookieResponder };
