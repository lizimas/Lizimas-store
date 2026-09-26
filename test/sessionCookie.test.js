process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const sc = require("../server/utils/sessionCookie");

const req = (headers = {}, cookies = {}) => ({ headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), cookies, get(n) { return this.headers[n.toLowerCase()]; } });

test("portal comes only from X-LZ-Session", () => {
    assert.equal(sc.portalOf(req({ "X-LZ-Session": "vendor" })), "vendor");
    assert.equal(sc.portalOf(req({ "X-LZ-Session": "hacker" })), null);
    assert.equal(sc.portalOf(req()), null);
});

test("tokenFrom: real Bearer JWT first, then the portal cookie; placeholder ignored", () => {
    const t = jwt.sign({ userId: 1, sessionToken: "s" }, process.env.JWT_SECRET);
    assert.equal(sc.tokenFrom(req({ Authorization: "Bearer " + t })), t);
    assert.equal(sc.tokenFrom(req({ Authorization: "Bearer cookie", "X-LZ-Session": "admin" }, { lz_s_admin: t })), t);
    // a cookie without the header is not used (CSRF guard)
    assert.equal(sc.tokenFrom(req({}, { lz_s_admin: t })), null);
    // the other portal's cookie is not used
    assert.equal(sc.tokenFrom(req({ "X-LZ-Session": "vendor" }, { lz_s_admin: t })), null);
});

test("only full sessions become cookies", () => {
    const full = jwt.sign({ userId: 1, sessionToken: "abc" }, process.env.JWT_SECRET);
    const pending = jwt.sign({ userId: 1, pending2FA: true }, process.env.JWT_SECRET);
    const setup = jwt.sign({ userId: 1, sessionToken: "x", pendingSetup: true }, process.env.JWT_SECRET);
    assert.equal(sc.isFullSessionToken(full), true);
    assert.equal(sc.isFullSessionToken(pending), false);
    assert.equal(sc.isFullSessionToken(setup), false);
    assert.equal(sc.isFullSessionToken("cookie"), false);
});

test("responder swaps a login token for the placeholder and sets the cookie", () => {
    const full = jwt.sign({ userId: 1, sessionToken: "abc" }, process.env.JWT_SECRET);
    const r = req({ "X-LZ-Session": "user", "X-LZ-Keep": "1" });
    const set = [];
    let sent = null;
    const res = { json(b) { sent = b; return this; }, cookie(...a) { set.push(a); } };
    sc.sessionCookieResponder(r, res, () => {});
    res.json({ message: "ok", token: full, user: { id: 1 } });
    assert.equal(sent.token, "cookie");
    assert.equal(set[0][0], "lz_s_user");
    assert.equal(set[0][1], full);
    assert.equal(set[0][2].httpOnly, true);
    assert.equal(set[0][2].sameSite, "lax");
    assert.ok(set[0][2].maxAge > 0);
});
