/*
 * client/js/password-toggle.js
 * Lizimas Store - eye toggle on every password field.
 *
 * Self-initialising: finds every input[type=password] on the page and
 * attaches a show/hide control. No markup changes needed, so fields
 * added later are picked up automatically.
 *
 * Three details worth knowing:
 *
 * - Pages style their buttons by container, e.g. `.login-box button`
 *   sets a full-width gold block. That selector also matches this
 *   toggle, so the rules below are scoped as a child selector and use
 *   !important on the layout properties. Without that the eye renders
 *   as a full-width bar across the field.
 *
 * - Each input gets wrapped in a positioned span. Some fields (the
 *   reset-password pair on the login screens) are toggled by adding a
 *   `hidden` class to the input itself, which would leave the eye
 *   floating on its own. A MutationObserver mirrors that class onto the
 *   wrapper so the pair stays in sync.
 *
 * - The button is type="button". Without it, browsers treat a bare
 *   button inside a form as a submit and tapping the eye would post the
 *   login form.
 */
(function () {
    "use strict";

    var WRAPPER_CLASS = "lz-pw-wrap";
    var BUTTON_CLASS = "lz-pw-toggle";
    var STYLE_ID = "lz-pw-toggle-styles";

    var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

    var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        var wrap = "." + WRAPPER_CLASS;
        var btn = wrap + " > ." + BUTTON_CLASS;

        var css = [
            wrap + " {",
            "  position: relative !important;",
            "  display: block !important;",
            "  width: 100%;",
            "}",
            wrap + ".hidden { display: none !important; }",
            wrap + " > input {",
            "  width: 100%;",
            "  padding-right: 46px !important;",
            "  box-sizing: border-box;",
            "  margin: 0 !important;",
            "}",

            // Scoped as a child selector and forced, so container rules
            // like `.login-box button` cannot turn this into a bar.
            btn + " {",
            "  position: absolute !important;",
            "  top: 50% !important;",
            "  right: 6px !important;",
            "  bottom: auto !important;",
            "  left: auto !important;",
            "  transform: translateY(-50%) !important;",
            "  display: flex !important;",
            "  align-items: center !important;",
            "  justify-content: center !important;",
            "  width: 34px !important;",
            "  min-width: 0 !important;",
            "  max-width: 34px !important;",
            "  height: 34px !important;",
            "  min-height: 0 !important;",
            "  margin: 0 !important;",
            "  padding: 0 !important;",
            "  border: 0 !important;",
            "  border-radius: 6px !important;",
            "  background: transparent !important;",
            "  background-color: transparent !important;",
            "  background-image: none !important;",
            "  box-shadow: none !important;",
            "  color: #0d1b3e !important;",
            "  font-size: 0 !important;",
            "  line-height: 0 !important;",
            "  letter-spacing: normal !important;",
            "  text-transform: none !important;",
            "  cursor: pointer !important;",
            "  opacity: 0.75;",
            "}",
            btn + ":hover {",
            "  background: transparent !important;",
            "  color: #0d1b3e !important;",
            "  opacity: 1;",
            "}",
            btn + ":focus-visible {",
            "  outline: 2px solid #c9a227 !important;",
            "  outline-offset: 1px;",
            "  opacity: 1;",
            "}",
            btn + " svg {",
            "  display: block;",
            "  width: 20px;",
            "  height: 20px;",
            "  pointer-events: none;",
            "}"
        ].join("\n");

        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function syncHidden(input, wrapper) {
        // Mirror the input's own hidden state onto the wrapper, so a
        // field that gets shown or hidden by class takes its eye with it.
        var isHidden = input.classList.contains("hidden") ||
                       input.hasAttribute("hidden");
        wrapper.classList.toggle("hidden", isHidden);
    }

    function attach(input) {
        if (!input || input.dataset.lzPwToggle === "1") return;
        if (input.type !== "password") return;

        input.dataset.lzPwToggle = "1";

        var parent = input.parentNode;
        if (!parent) return;

        var wrapper = document.createElement("span");
        wrapper.className = WRAPPER_CLASS;

        parent.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        var button = document.createElement("button");
        button.type = "button";
        button.className = BUTTON_CLASS;
        button.innerHTML = EYE;
        button.setAttribute("aria-label", "Show password");
        button.setAttribute("aria-pressed", "false");
        button.tabIndex = -1;

        button.addEventListener("click", function (event) {
            event.preventDefault();

            var showing = input.type === "text";

            input.type = showing ? "password" : "text";
            button.innerHTML = showing ? EYE : EYE_OFF;
            button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
            button.setAttribute("aria-pressed", showing ? "false" : "true");

            // Keep the caret at the end rather than jumping to the start.
            if (typeof input.selectionStart === "number") {
                var pos = input.value.length;
                input.focus();
                try {
                    input.setSelectionRange(pos, pos);
                } catch (err) {
                    /* some input types reject setSelectionRange */
                }
            }
        });

        wrapper.appendChild(button);

        syncHidden(input, wrapper);

        var observer = new MutationObserver(function () {
            syncHidden(input, wrapper);
        });
        observer.observe(input, {
            attributes: true,
            attributeFilter: ["class", "hidden"]
        });
    }

    function attachAll(root) {
        var scope = root || document;
        var fields = scope.querySelectorAll('input[type="password"]');
        for (var i = 0; i < fields.length; i++) {
            attach(fields[i]);
        }
    }

    function init() {
        injectStyles();
        attachAll(document);

        // Admin and staff dashboards swap panels in after load, so watch
        // for password fields that arrive later.
        var bodyObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches('input[type="password"]')) {
                        attach(node);
                    } else if (node.querySelectorAll) {
                        attachAll(node);
                    }
                }
            }
        });

        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    window.LzPasswordToggle = { attachAll: attachAll };
})();
