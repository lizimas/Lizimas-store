(function () {
  "use strict";

  function tok() { return localStorage.getItem("staffToken"); }
  function el(id) { return document.getElementById(id); }
  function say(text, ok) {
    var m = el("account-2fa-msg");
    if (!m) return;
    m.textContent = text;
    m.className = "account-msg " + (ok ? "success" : "error");
  }

  var enabled = false;

  async function loadStatus() {
    var s = el("account-2fa-status");
    var b = el("account-2fa-toggle-btn");
    if (!s || !b) return;
    try {
      var r = await fetch("/api/auth/me", {
        headers: { "Authorization": "Bearer " + tok() }
      });
      var d = await r.json();
      if (r.ok) {
        enabled = !!d.user.two_factor_enabled;
        s.textContent = enabled
          ? "Two-factor authentication is ON."
          : "Two-factor authentication is OFF.";
        b.textContent = enabled ? "Disable 2FA" : "Enable 2FA";
      } else {
        s.textContent = "Could not load 2FA status.";
      }
    } catch (e) {
      s.textContent = "Could not connect to server.";
    }
  }

  async function toggle() {
    if (enabled) {
      var pw = prompt("Enter your current password to disable 2FA:");
      if (!pw) return;
      try {
        var r = await fetch("/api/auth/2fa/disable", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + tok()
          },
          body: JSON.stringify({ currentPassword: pw })
        });
        var d = await r.json();
        if (r.ok) {
          say("2FA disabled.", true);
          el("account-2fa-setup").classList.add("hidden");
          loadStatus();
        } else {
          say(d.error || "Something went wrong.", false);
        }
      } catch (e) {
        say("Could not connect to server.", false);
      }
      return;
    }

    try {
      var r2 = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        headers: { "Authorization": "Bearer " + tok() }
      });
      var d2 = await r2.json();
      if (r2.ok) {
        el("account-2fa-qr").src = d2.qrCode;
        el("account-2fa-key").textContent = d2.manualEntryKey;
        el("account-2fa-setup").classList.remove("hidden");
        say("", true);
      } else {
        say(d2.error || "Something went wrong.", false);
      }
    } catch (e) {
      say("Could not connect to server.", false);
    }
  }

  async function verify() {
    var input = el("account-2fa-code");
    var code = input ? input.value.trim() : "";
    if (!code) { say("Please enter the 6-digit code.", false); return; }
    try {
      var r = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + tok()
        },
        body: JSON.stringify({ token: code })
      });
      var d = await r.json();
      if (r.ok) {
        say("Two-factor authentication enabled successfully.", true);
        el("account-2fa-setup").classList.add("hidden");
        input.value = "";
        loadStatus();
      } else {
        say(d.error || "Invalid code.", false);
      }
    } catch (e) {
      say("Could not connect to server.", false);
    }
  }

  function open() {
    var m = el("sc-acct-modal");
    if (!m) return;
    m.classList.remove("hidden");
    var setup = el("account-2fa-setup");
    if (setup) setup.classList.add("hidden");
    var qr = el("account-2fa-qr");
    if (qr) qr.removeAttribute("src");
    var key = el("account-2fa-key");
    if (key) key.textContent = "";
    var code = el("account-2fa-code");
    if (code) code.value = "";
    say("", true);
    loadStatus();
  }

  function close() {
    var m = el("sc-acct-modal");
    if (m) m.classList.add("hidden");
  }

  window.StaffAccount = {
    load: loadStatus,
    toggle: toggle,
    verify: verify,
    open: open,
    close: close
  };

  document.addEventListener("DOMContentLoaded", function () {
    if (el("account-2fa-status")) loadStatus();
  });
})();
