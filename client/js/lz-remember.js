// "Keep me logged in" (Ryan, Sept 2026) - customer and vendor login.
//
// Ticked:   stays signed in through refreshes and closing tabs/windows.
//           When the browser is quit - which always happens when the device
//           restarts - they must log in again.
// Unticked: stays signed in through refreshes only. Once every Lizimas tab
//           has been closed (for more than ~45 seconds), or the browser is
//           quit / the device restarts, they must log in again.
//
// A web page can't see the device itself restarting; what it can see is the
// browser having been quit, which a restart always does. That's detected
// with a session cookie (lz_alive_<key>, no expiry): the browser deletes it
// when it quits, and every tab shares it. Unticked logins also need a
// heartbeat (lzBeat_<key>) written every few seconds by any open tab.
//
// Tokens stay in localStorage (every page already reads them there). This
// file runs first on every customer/vendor page and removes an ended login
// before any other script looks at it.
(function () {
    "use strict";
    // token key -> other keys to clear with it
    const KEYS = { userToken: ["userInfo"], vendorToken: [] };
    const BEAT_MS = 5000;
    const TAB_GRACE_MS = 45000; // a refresh or quick re-open inside this keeps an unticked login

    function hasCookie(name) {
        return document.cookie.split("; ").some((c) => c.indexOf(name + "=") === 0);
    }
    function setSessionCookie(name) {
        document.cookie = name + "=1; path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    }
    function clearCookie(name) {
        document.cookie = name + "=; path=/; max-age=0; SameSite=Lax";
    }
    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

    // Mode per login: "browser" (ticked) or "tab" (unticked). Logins stored
    // before this existed have no mode and are left alone. The older
    // lzSessionOnly_ flag is read as "browser".
    function mode(key) {
        const m = get("lzMode_" + key);
        if (m) return m;
        return get("lzSessionOnly_" + key) === "1" ? "browser" : null;
    }
    function endLogin(key) {
        del(key);
        KEYS[key].forEach(del);
        del("lzMode_" + key);
        del("lzSessionOnly_" + key);
        del("lzBeat_" + key);
        clearCookie("lz_alive_" + key);
    }

    // 1. Expire ended logins before anything else runs.
    Object.keys(KEYS).forEach((key) => {
        const m = mode(key);
        if (!m || !get(key)) return;
        const browserStillOpen = hasCookie("lz_alive_" + key);
        if (!browserStillOpen) { endLogin(key); return; }
        if (m === "tab") {
            const beat = Number(get("lzBeat_" + key)) || 0;
            if (Date.now() - beat > TAB_GRACE_MS) endLogin(key);
        }
    });

    // 2. Heartbeat from every open tab keeps unticked logins alive.
    function beat() {
        Object.keys(KEYS).forEach((key) => {
            if (mode(key) === "tab" && get(key)) set("lzBeat_" + key, String(Date.now()));
        });
    }
    beat();
    setInterval(beat, BEAT_MS);
    window.addEventListener("pagehide", beat);
    document.addEventListener("visibilitychange", beat);

    function setPreference(key, keep) { set("lzKeepPref_" + key, keep ? "1" : "0"); }

    // Call right after storing a login token. keep: true/false, or omit to use
    // the last choice made on the login page (default: not kept).
    function apply(key, keep) {
        const k = keep === undefined ? get("lzKeepPref_" + key) === "1" : !!keep;
        del("lzSessionOnly_" + key);
        set("lzMode_" + key, k ? "browser" : "tab");
        setSessionCookie("lz_alive_" + key);
        set("lzBeat_" + key, String(Date.now()));
    }

    // Wire a checkbox: <input type="checkbox" data-lz-remember="userToken">
    function bindCheckboxes() {
        document.querySelectorAll("input[data-lz-remember]").forEach((box) => {
            const key = box.getAttribute("data-lz-remember");
            box.checked = get("lzKeepPref_" + key) === "1";
            box.addEventListener("change", () => setPreference(key, box.checked));
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindCheckboxes); else bindCheckboxes();

    window.LzRemember = { apply, setPreference };
})();
