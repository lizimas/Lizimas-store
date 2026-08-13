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

  // ---------------------------------------------------------------------
  // Password change and device management.
  //
  // Both sections are injected into the existing modal rather than added to
  // the markup, because that markup is duplicated across product.html,
  // manager.html and chat.html. One copy here keeps all three identical.
  // ---------------------------------------------------------------------

  var MIN_PASSWORD = 8; // matches the server; do not relax without changing it there

  function ensureSections() {
    var body = document.querySelector(".sc-acct-body");
    if (!body || el("sc-pw-section")) return;

    var section = document.createElement("div");
    section.id = "sc-pw-section";
    section.style.cssText = "margin-top:24px; padding-top:20px; border-top:1px solid #e5e5e5;";
    section.innerHTML =
      '<h4 style="margin:0 0 10px;">Change password</h4>' +
      '<div style="display:flex; flex-direction:column; gap:8px; max-width:360px;">' +
        '<input type="password" id="sc-pw-current" placeholder="Current password" autocomplete="current-password">' +
        '<input type="password" id="sc-pw-new" placeholder="New password (at least ' + MIN_PASSWORD + ' characters)" autocomplete="new-password">' +
        '<input type="password" id="sc-pw-confirm" placeholder="Confirm new password" autocomplete="new-password">' +
        '<button type="button" onclick="StaffAccount.changePassword()">Update password</button>' +
        '<p id="sc-pw-msg" class="account-msg"></p>' +
      '</div>';

    var devices = document.createElement("div");
    devices.id = "sc-dev-section";
    devices.style.cssText = "margin-top:24px; padding-top:20px; border-top:1px solid #e5e5e5;";
    devices.innerHTML =
      '<h4 style="margin:0 0 4px;">Signed-in devices</h4>' +
      '<p style="font-size:13px; color:#666; margin:0 0 10px;">Sign out any device you do not recognise.</p>' +
      '<div id="sc-dev-list">Loading...</div>';

    body.appendChild(section);
    body.appendChild(devices);
  }

  function pwSay(text, ok) {
    var m = el("sc-pw-msg");
    if (!m) return;
    m.textContent = text;
    m.style.color = ok ? "#0a7a3d" : "#b00020";
  }

  async function changePassword() {
    var current = el("sc-pw-current");
    var next = el("sc-pw-new");
    var confirmField = el("sc-pw-confirm");
    if (!current || !next || !confirmField) return;

    if (!current.value || !next.value) {
      pwSay("Enter your current and new password.", false);
      return;
    }

    if (next.value.length < MIN_PASSWORD) {
      pwSay("New password must be at least " + MIN_PASSWORD + " characters.", false);
      return;
    }

    if (next.value !== confirmField.value) {
      pwSay("The new passwords do not match.", false);
      return;
    }

    if (next.value === current.value) {
      pwSay("The new password must be different from the current one.", false);
      return;
    }

    pwSay("Updating...", true);

    try {
      var r = await fetch("/api/auth/password", {
        method: "PATCH",
        headers: {
          "Authorization": "Bearer " + tok(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword: current.value,
          newPassword: next.value
        })
      });

      var data = await r.json();

      if (!r.ok) {
        pwSay(data.error || "Could not update the password.", false);
        return;
      }

      current.value = "";
      next.value = "";
      confirmField.value = "";
      pwSay("Password updated. Other devices stay signed in - sign them out below if you want.", true);
    } catch (e) {
      pwSay("Could not connect to server.", false);
    }
  }

  function shortDevice(label) {
    if (!label) return "Unknown device";
    if (label.indexOf("Android") !== -1) return "Android phone";
    if (label.indexOf("iPhone") !== -1) return "iPhone";
    if (label.indexOf("iPad") !== -1) return "iPad";
    if (label.indexOf("Linux") !== -1) return "Linux computer";
    if (label.indexOf("Windows") !== -1) return "Windows computer";
    if (label.indexOf("Mac") !== -1) return "Mac";
    if (label.indexOf("curl") !== -1) return "Command line";
    return label.slice(0, 40);
  }

  function safeText(value) {
    var d = document.createElement("div");
    d.textContent = value === null || value === undefined ? "" : String(value);
    return d.innerHTML;
  }

  function whenText(value) {
    if (!value) return "";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  async function loadDevices() {
    var box = el("sc-dev-list");
    if (!box) return;

    try {
      var r = await fetch("/api/auth/sessions", {
        headers: { "Authorization": "Bearer " + tok() }
      });
      var data = await r.json();

      if (!r.ok) {
        box.textContent = data.error || "Could not load devices.";
        return;
      }

      var sessions = data.sessions || [];
      if (!sessions.length) {
        box.textContent = "No active devices found.";
        return;
      }

      box.innerHTML = sessions.map(function (session) {
        var current = session.isCurrent
          ? ' <span style="color:#0a7a3d; font-size:12px;">(this device)</span>'
          : '';
        var action = session.isCurrent
          ? ''
          : '<button type="button" onclick="StaffAccount.revokeDevice(' + session.id + ')" style="font-size:13px;">Sign out</button>';

        return '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f0f0f0;">' +
          '<div><strong>' + safeText(shortDevice(session.deviceLabel)) + '</strong>' + current +
          '<div style="font-size:12px; color:#777;">' + safeText(session.ipAddress) + ' &middot; ' + safeText(whenText(session.lastUsedAt)) + '</div></div>' +
          action +
        '</div>';
      }).join("");
    } catch (e) {
      box.textContent = "Could not connect to server.";
    }
  }

  async function revokeDevice(sessionId) {
    if (!confirm("Sign out this device? It will need to log in again.")) return;

    try {
      var r = await fetch("/api/auth/sessions/" + sessionId, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + tok() }
      });
      var data = await r.json();

      if (!r.ok) {
        alert(data.error || "Could not sign out that device.");
        return;
      }

      loadDevices();
    } catch (e) {
      alert("Could not connect to server.");
    }
  }

  // The panel lives inline in the page's main area, the way the admin
  // dashboard shows its Account tab, rather than as an overlay. The modal
  // markup in the three staff pages is reused as the source of the content;
  // it is simply relocated rather than duplicated into every page.
  function mainArea() {
    return document.querySelector(".admin-main") || document.querySelector(".sc-shell");
  }

  function inlineHost() {
    var main = mainArea();
    if (!main) return null;

    var host = el("sc-acct-inline");
    if (host) return host;

    host = document.createElement("section");
    host.id = "sc-acct-inline";
    host.className = "hidden";
    host.style.cssText = "padding:20px;";

    var panel = document.querySelector("#sc-acct-modal .sc-acct-panel");
    if (panel) {
        // Move the real panel in, so the 2FA controls keep their element ids
        // and every existing handler continues to work untouched.
        host.appendChild(panel);
    }

    main.appendChild(host);
    return host;
  }

  // The topbar carries the page title and stays put; only the dashboard
  // content beneath it is swapped out, the way the admin tabs behave.
  var KEEP_VISIBLE = ["admin-topbar", "sc-topbar", "sc-head"];

  function staysVisible(node) {
    if (node.id === "sc-acct-inline") return true;
    if (node.tagName === "HEADER") return true;
    for (var i = 0; i < KEEP_VISIBLE.length; i++) {
        if (node.classList && node.classList.contains(KEEP_VISIBLE[i])) return true;
    }
    return false;
  }

  function setDashboardHidden(hidden) {
    var main = mainArea();
    if (!main) return;

    Array.prototype.forEach.call(main.children, function (child) {
        if (staysVisible(child)) return;
        child.style.display = hidden ? "none" : "";
    });
  }

  function open() {
    var host = inlineHost();
    if (!host) return;

    setDashboardHidden(true);
    host.classList.remove("hidden");
    window.scrollTo(0, 0);
    var setup = el("account-2fa-setup");
    if (setup) setup.classList.add("hidden");
    var qr = el("account-2fa-qr");
    if (qr) qr.removeAttribute("src");
    var key = el("account-2fa-key");
    if (key) key.textContent = "";
    var code = el("account-2fa-code");
    if (code) code.value = "";
    say("", true);
    ensureSections();
    loadStatus();
    loadDevices();
  }

  function close() {
    var host = el("sc-acct-inline");
    if (host) host.classList.add("hidden");
    setDashboardHidden(false);
  }

  window.StaffAccount = {
    load: loadStatus,
    toggle: toggle,
    verify: verify,
    open: open,
    close: close,
    changePassword: changePassword,
    loadDevices: loadDevices,
    revokeDevice: revokeDevice
  };

  document.addEventListener("DOMContentLoaded", function () {
    if (el("account-2fa-status")) loadStatus();
  });
})();
