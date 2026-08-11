/*
 * client/js/password-strength.js
 * Lizimas Store - strength meter under the password field.
 *
 * Attaches to any input carrying data-lz-strength and renders five
 * segments beneath it.
 *
 * Scoring is length plus character variety, deliberately simple. It is
 * feedback, not a gate: nothing here blocks a weak password, because a
 * meter that refuses to let people proceed mostly teaches them to add
 * "1!" to the end. The server's own rules remain the actual policy.
 */
(function () {
    "use strict";

    function score(value) {
        if (!value) return 0;

        var points = 0;

        // Length carries the most weight; it is the property that
        // actually resists guessing.
        if (value.length >= 8) points += 1;
        if (value.length >= 12) points += 1;
        if (value.length >= 16) points += 1;

        var variety = 0;
        if (/[a-z]/.test(value)) variety += 1;
        if (/[A-Z]/.test(value)) variety += 1;
        if (/\d/.test(value)) variety += 1;
        if (/[^A-Za-z0-9]/.test(value)) variety += 1;

        if (variety >= 2) points += 1;
        if (variety >= 3) points += 1;

        // A single repeated character or an obvious run should not
        // score on length alone.
        if (/^(.)\1+$/.test(value)) points = Math.min(points, 1);
        if (/^(?:0123|1234|abcd|qwer|password|admin)/i.test(value)) {
            points = Math.min(points, 1);
        }

        if (value.length < 6) points = Math.min(points, 1);

        return Math.max(0, Math.min(5, points));
    }

    function attach(input) {
        if (!input || input.dataset.lzStrengthReady === "1") return;
        input.dataset.lzStrengthReady = "1";

        var meter = document.createElement("div");
        meter.className = "auth-strength";
        meter.setAttribute("data-score", "0");
        meter.setAttribute("aria-hidden", "true");

        for (var i = 0; i < 5; i++) {
            meter.appendChild(document.createElement("span"));
        }

        // Sit after the hint if there is one, so the order reads
        // field -> advice -> meter.
        var field = input.closest(".auth-field") || input.parentNode;
        var hint = field ? field.querySelector(".auth-hint") : null;

        if (hint && hint.parentNode) {
            hint.parentNode.insertBefore(meter, hint.nextSibling);
        } else if (field) {
            field.appendChild(meter);
        }

        input.addEventListener("input", function () {
            meter.setAttribute("data-score", String(score(input.value)));
        });
    }

    function attachAll(root) {
        var scope = root || document;
        var fields = scope.querySelectorAll("input[data-lz-strength]");
        for (var i = 0; i < fields.length; i++) attach(fields[i]);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { attachAll(); });
    } else {
        attachAll();
    }

    window.LzPasswordStrength = { attachAll: attachAll, score: score };
})();
