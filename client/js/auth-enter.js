// Enter-to-submit for the auth pages.
//
// None of these pages uses a <form>, so the browser has nothing to submit and
// Enter did nothing at all — every sign-in cost an extra tap. Rather than
// restructure the markup on five pages and risk the 2FA flow, this finds the
// primary action button and clicks it.
//
// Login shows two .auth-submit buttons (credentials, then the 2FA panel), so
// the visible one is the one that matters. Clicking a hidden button would fire
// a login attempt while someone is typing their verification code.

(function () {
    "use strict";

    // staff-login.html predates the .auth-submit convention and identifies its
    // buttons by id instead, one per stage: credentials, 2FA, forced reset,
    // and first-time 2FA enrolment. Order matters only in that the visibility
    // test below picks whichever stage is currently on screen.
    var SELECTOR = [
        ".auth-submit",
        "#login-btn",
        "#login-2fa-btn",
        "#login-reset-btn",
        "#login-setup-btn"
    ].join(", ");

    function visibleSubmit() {
        var buttons = document.querySelectorAll(SELECTOR);
        for (var i = 0; i < buttons.length; i++) {
            var b = buttons[i];
            if (b.offsetParent !== null && !b.disabled) return b;
        }
        return null;
    }

    document.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;

        var el = e.target;
        if (!el || el.tagName !== "INPUT") return;

        // Checkboxes and the like have their own Enter semantics.
        var type = (el.type || "").toLowerCase();
        if (type !== "text" && type !== "email" && type !== "password" &&
            type !== "tel" && type !== "number" && type !== "search") return;

        var btn = visibleSubmit();
        if (!btn) return;

        e.preventDefault();
        btn.click();
    });
})();
