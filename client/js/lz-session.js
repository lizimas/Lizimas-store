// Login sessions in httpOnly cookies (Ryan, Sept 2026) - the browser half of
// server/utils/sessionCookie.js. Loaded first on every page.
//
// The real session token now lives in a cookie JavaScript can't read. Pages
// keep a placeholder ("cookie") in localStorage under their usual key
// (userToken / vendorToken / adminToken / staffToken), so every existing
// "am I signed in?" check keeps working. This file:
//   - tags every same-site /api request with X-LZ-Session (which part of the
//     site it is) and X-LZ-Keep ("keep me logged in"), and drops the
//     placeholder "Bearer cookie" header - the cookie goes along by itself;
//   - moves an old real token still sitting in localStorage into the cookie;
//   - ends the server session whenever a page signs out (removes its key).
(function () {
    "use strict";
    if (window.LzSession) return;

    var KEYS = { user: "userToken", vendor: "vendorToken", admin: "adminToken", staff: "staffToken" };
    var PORTAL_OF_KEY = { userToken: "user", vendorToken: "vendor", adminToken: "admin", staffToken: "staff" };

    function detectPortal() {
        var forced = document.documentElement.getAttribute("data-lz-portal");
        if (forced && KEYS[forced]) return forced;
        var p = location.pathname;
        if (/^\/admin(\.html)?$/.test(p) || /^\/admin-system-guide\.html$/.test(p)) return "admin";
        if (/^\/staff\//.test(p) || /^\/staff-(login|reset-password)\.html$/.test(p)) return "staff";
        if (/^\/vendor\//.test(p) || /^\/vendor-(login|register|forgot-password)\.html$/.test(p)) return "vendor";
        return "user";
    }
    var PORTAL = detectPortal();

    function isJwt(v) { return typeof v === "string" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v); }
    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }

    // Admin and staff stay signed in as before; customers and vendors follow
    // their "Keep me logged in" choice (lz-remember.js).
    function keepFor(portal) {
        if (portal === "admin" || portal === "staff") return "1";
        return lsGet("lzKeepPref_" + KEYS[portal]) === "1" ? "1" : "0";
    }
    // Google/Facebook redirect sign-in can't send headers, so mirror the
    // customer's choice in a small readable cookie the server checks there.
    try {
        document.cookie = "lz_keep_user=" + keepFor("user") + "; path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    } catch (e) { /* ignore */ }

    // ---- fetch -----------------------------------------------------------
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    function isOurApi(url) {
        try {
            var u = new URL(url, location.href);
            return u.origin === location.origin && u.pathname.indexOf("/api/") === 0;
        } catch (e) { return false; }
    }
    if (nativeFetch) {
        window.fetch = function (input, init) {
            try {
                var url = typeof input === "string" ? input : (input && input.url) || String(input);
                if (isOurApi(url)) {
                    init = init ? Object.assign({}, init) : {};
                    var h = new Headers(init.headers || (typeof input !== "string" && input && input.headers) || undefined);
                    if (!h.has("X-LZ-Session")) h.set("X-LZ-Session", PORTAL);
                    var portal = (h.get("X-LZ-Session") || PORTAL).toLowerCase();
                    if (!h.has("X-LZ-Keep")) h.set("X-LZ-Keep", keepFor(KEYS[portal] ? portal : PORTAL));
                    var auth = h.get("Authorization");
                    if (auth && !isJwt(auth.replace(/^Bearer\s+/i, "").trim())) h.delete("Authorization");
                    init.headers = h;
                    if (!init.credentials) init.credentials = "same-origin";
                    if (typeof input !== "string" && input instanceof Request) return nativeFetch(new Request(input, init));
                }
            } catch (e) { /* fall through untouched */ }
            return nativeFetch(input, init);
        };
    }

    // ---- sign-out and old tokens ----------------------------------------
    function endServerSession(portal) {
        if (!nativeFetch) return;
        try {
            nativeFetch("/api/auth/logout", {
                method: "POST",
                keepalive: true,
                credentials: "same-origin",
                headers: { "X-LZ-Session": portal }
            }).catch(function () {});
        } catch (e) { /* ignore */ }
    }
    function adopt(key, jwt) {
        var portal = PORTAL_OF_KEY[key];
        if (!portal || !nativeFetch) return;
        nativeFetch("/api/auth/session/adopt", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Authorization": "Bearer " + jwt, "X-LZ-Session": portal, "X-LZ-Keep": keepFor(portal) }
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
            if (d && d.token === "cookie" && lsGet(key) === jwt) {
                try { nativeSet.call(window.localStorage, key, "cookie"); } catch (e) { /* ignore */ }
            }
        }).catch(function () {});
    }

    var proto = window.Storage && window.Storage.prototype;
    var nativeSet = proto && proto.setItem;
    var nativeRemove = proto && proto.removeItem;
    if (proto && nativeSet && nativeRemove) {
        proto.removeItem = function (key) {
            if (this === window.localStorage && PORTAL_OF_KEY[key] && nativeGetSafe(this, key)) {
                endServerSession(PORTAL_OF_KEY[key]);
            }
            return nativeRemove.apply(this, arguments);
        };
        proto.setItem = function (key, value) {
            var r = nativeSet.apply(this, arguments);
            if (this === window.localStorage && PORTAL_OF_KEY[key] && isJwt(String(value))) adopt(key, String(value));
            return r;
        };
    }
    function nativeGetSafe(store, key) { try { return window.Storage.prototype.getItem.call(store, key); } catch (e) { return null; } }

    // A real token left over from before the switch: move it into the cookie.
    Object.keys(PORTAL_OF_KEY).forEach(function (key) {
        var v = lsGet(key);
        if (isJwt(v)) adopt(key, v);
    });

    window.LzSession = { portal: PORTAL, endServerSession: endServerSession };
})();
