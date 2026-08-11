/*
 * client/js/lz-phone-input.js
 * Lizimas Store - searchable country code picker for phone fields.
 *
 * Opt-in, not automatic: a field gets a picker only if it carries
 * data-lz-phone. Search boxes and the Uganda-locked delivery number
 * must never get one.
 *
 * Markup expected:
 *   <span class="phone-prefix" data-lz-phone-for="reg-phone">+256</span>
 *   <input id="reg-phone" type="tel" data-lz-phone data-lz-phone-default="UG">
 *
 * The closed state shows a short code and dial prefix -- "UG +256" --
 * rather than a country name, so it stays narrow on a phone screen.
 *
 * A native <select> cannot filter its own options, so the panel is a
 * custom element with a search box. It is appended to <body> and
 * positioned fixed: input groups clip overflow, and a dropdown that
 * gets cut off by its own container is worse than no dropdown.
 *
 * Read values with LzPhone.getE164("reg-phone"), which returns a full
 * +<dial><number> string or null when the field is empty or the number
 * is not plausible. E.164 in one column is what Flutterwave expects.
 */
(function () {
    "use strict";

    /*
     * [iso, dial, name]. ISO 3166-1 alpha-2 throughout, so Qatar is QA
     * and the UAE is AE. GB carries a display override to "UK" further
     * down, since that is what people look for.
     */
    var RAW = [
        ["UG","256","Uganda"],["KE","254","Kenya"],["TZ","255","Tanzania"],
        ["RW","250","Rwanda"],["BI","257","Burundi"],["SS","211","South Sudan"],
        ["CD","243","DR Congo"],["ET","251","Ethiopia"],["SO","252","Somalia"],
        ["SD","249","Sudan"],["ER","291","Eritrea"],["DJ","253","Djibouti"],
        ["AF","93","Afghanistan"],["AL","355","Albania"],["DZ","213","Algeria"],
        ["AD","376","Andorra"],["AO","244","Angola"],["AG","1268","Antigua and Barbuda"],
        ["AR","54","Argentina"],["AM","374","Armenia"],["AU","61","Australia"],
        ["AT","43","Austria"],["AZ","994","Azerbaijan"],["BS","1242","Bahamas"],
        ["BH","973","Bahrain"],["BD","880","Bangladesh"],["BB","1246","Barbados"],
        ["BY","375","Belarus"],["BE","32","Belgium"],["BZ","501","Belize"],
        ["BJ","229","Benin"],["BT","975","Bhutan"],["BO","591","Bolivia"],
        ["BA","387","Bosnia and Herzegovina"],["BW","267","Botswana"],
        ["BR","55","Brazil"],["BN","673","Brunei"],["BG","359","Bulgaria"],
        ["BF","226","Burkina Faso"],["KH","855","Cambodia"],["CM","237","Cameroon"],
        ["CA","1","Canada"],["CV","238","Cape Verde"],["CF","236","Central African Republic"],
        ["TD","235","Chad"],["CL","56","Chile"],["CN","86","China"],
        ["CO","57","Colombia"],["KM","269","Comoros"],["CG","242","Congo"],
        ["CR","506","Costa Rica"],["CI","225","Cote d'Ivoire"],["HR","385","Croatia"],
        ["CU","53","Cuba"],["CY","357","Cyprus"],["CZ","420","Czechia"],
        ["DK","45","Denmark"],["DM","1767","Dominica"],["DO","1809","Dominican Republic"],
        ["EC","593","Ecuador"],["EG","20","Egypt"],["SV","503","El Salvador"],
        ["GQ","240","Equatorial Guinea"],["EE","372","Estonia"],["SZ","268","Eswatini"],
        ["FJ","679","Fiji"],["FI","358","Finland"],["FR","33","France"],
        ["GA","241","Gabon"],["GM","220","Gambia"],["GE","995","Georgia"],
        ["DE","49","Germany"],["GH","233","Ghana"],["GR","30","Greece"],
        ["GD","1473","Grenada"],["GT","502","Guatemala"],["GN","224","Guinea"],
        ["GW","245","Guinea-Bissau"],["GY","592","Guyana"],["HT","509","Haiti"],
        ["HN","504","Honduras"],["HK","852","Hong Kong"],["HU","36","Hungary"],
        ["IS","354","Iceland"],["IN","91","India"],["ID","62","Indonesia"],
        ["IR","98","Iran"],["IQ","964","Iraq"],["IE","353","Ireland"],
        ["IL","972","Israel"],["IT","39","Italy"],["JM","1876","Jamaica"],
        ["JP","81","Japan"],["JO","962","Jordan"],["KZ","7","Kazakhstan"],
        ["KI","686","Kiribati"],["KW","965","Kuwait"],["KG","996","Kyrgyzstan"],
        ["LA","856","Laos"],["LV","371","Latvia"],["LB","961","Lebanon"],
        ["LS","266","Lesotho"],["LR","231","Liberia"],["LY","218","Libya"],
        ["LI","423","Liechtenstein"],["LT","370","Lithuania"],["LU","352","Luxembourg"],
        ["MO","853","Macau"],["MG","261","Madagascar"],["MW","265","Malawi"],
        ["MY","60","Malaysia"],["MV","960","Maldives"],["ML","223","Mali"],
        ["MT","356","Malta"],["MH","692","Marshall Islands"],["MR","222","Mauritania"],
        ["MU","230","Mauritius"],["MX","52","Mexico"],["FM","691","Micronesia"],
        ["MD","373","Moldova"],["MC","377","Monaco"],["MN","976","Mongolia"],
        ["ME","382","Montenegro"],["MA","212","Morocco"],["MZ","258","Mozambique"],
        ["MM","95","Myanmar"],["NA","264","Namibia"],["NR","674","Nauru"],
        ["NP","977","Nepal"],["NL","31","Netherlands"],["NZ","64","New Zealand"],
        ["NI","505","Nicaragua"],["NE","227","Niger"],["NG","234","Nigeria"],
        ["KP","850","North Korea"],["MK","389","North Macedonia"],["NO","47","Norway"],
        ["OM","968","Oman"],["PK","92","Pakistan"],["PW","680","Palau"],
        ["PS","970","Palestine"],["PA","507","Panama"],["PG","675","Papua New Guinea"],
        ["PY","595","Paraguay"],["PE","51","Peru"],["PH","63","Philippines"],
        ["PL","48","Poland"],["PT","351","Portugal"],["PR","1787","Puerto Rico"],
        ["QA","974","Qatar"],["RO","40","Romania"],["RU","7","Russia"],
        ["KN","1869","Saint Kitts and Nevis"],["LC","1758","Saint Lucia"],
        ["VC","1784","Saint Vincent and the Grenadines"],["WS","685","Samoa"],
        ["SM","378","San Marino"],["ST","239","Sao Tome and Principe"],
        ["SA","966","Saudi Arabia"],["SN","221","Senegal"],["RS","381","Serbia"],
        ["SC","248","Seychelles"],["SL","232","Sierra Leone"],["SG","65","Singapore"],
        ["SK","421","Slovakia"],["SI","386","Slovenia"],["SB","677","Solomon Islands"],
        ["ZA","27","South Africa"],["KR","82","South Korea"],["ES","34","Spain"],
        ["LK","94","Sri Lanka"],["SR","597","Suriname"],["SE","46","Sweden"],
        ["CH","41","Switzerland"],["SY","963","Syria"],["TW","886","Taiwan"],
        ["TJ","992","Tajikistan"],["TH","66","Thailand"],["TL","670","Timor-Leste"],
        ["TG","228","Togo"],["TO","676","Tonga"],["TT","1868","Trinidad and Tobago"],
        ["TN","216","Tunisia"],["TR","90","Turkey"],["TM","993","Turkmenistan"],
        ["TV","688","Tuvalu"],["UA","380","Ukraine"],["AE","971","United Arab Emirates"],
        ["GB","44","United Kingdom"],["US","1","United States"],["UY","598","Uruguay"],
        ["UZ","998","Uzbekistan"],["VU","678","Vanuatu"],["VA","379","Vatican City"],
        ["VE","58","Venezuela"],["VN","84","Vietnam"],["YE","967","Yemen"],
        ["ZM","260","Zambia"],["ZW","263","Zimbabwe"]
    ];

    // Short label shown in the closed state where the ISO code alone
    // would not be what people expect.
    var LABEL_OVERRIDE = { GB: "UK" };

    // Extra search terms so common informal names still match.
    var ALIASES = {
        GB: "uk britain england scotland wales",
        AE: "uae emirates dubai abu dhabi",
        US: "usa america united states",
        CD: "drc congo kinshasa",
        KR: "south korea",
        NL: "holland",
        CI: "ivory coast",
        CZ: "czech republic",
        SZ: "swaziland",
        TR: "turkiye"
    };

    var COUNTRIES = RAW.map(function (row) {
        return {
            iso: row[0],
            dial: row[1],
            name: row[2],
            label: LABEL_OVERRIDE[row[0]] || row[0],
            search: (row[0] + " " + row[2] + " " + row[1] + " " +
                     (ALIASES[row[0]] || "")).toLowerCase()
        };
    });

    // Uganda and its neighbours first; the rest alphabetical.
    var PINNED = ["UG", "KE", "TZ", "RW", "SS", "BI", "CD"];

    var ORDERED = (function () {
        var pinned = [];
        var rest = [];

        COUNTRIES.forEach(function (c) {
            if (PINNED.indexOf(c.iso) !== -1) pinned.push(c);
            else rest.push(c);
        });

        pinned.sort(function (a, b) {
            return PINNED.indexOf(a.iso) - PINNED.indexOf(b.iso);
        });
        rest.sort(function (a, b) { return a.name.localeCompare(b.name); });

        return pinned.concat(rest);
    })();

    var STYLE_ID = "lz-phone-input-styles";
    var registry = {};
    var openPanel = null;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        var css = [
            ".lz-phone-trigger {",
            "  display: inline-flex !important;",
            "  align-items: center;",
            "  gap: 3px;",
            "  border: 0 !important;",
            "  background: transparent !important;",
            "  font: inherit !important;",
            "  color: inherit !important;",
            "  padding: 0 4px 0 0 !important;",
            "  margin: 0 !important;",
            "  width: auto !important;",
            "  min-width: 0 !important;",
            "  white-space: nowrap;",
            "  cursor: pointer !important;",
            "  text-transform: none !important;",
            "}",
            ".lz-phone-trigger:focus-visible {",
            "  outline: 2px solid #c9a227;",
            "  outline-offset: 1px;",
            "}",
            ".lz-phone-caret { font-size: 9px; opacity: 0.6; }",

            ".lz-phone-panel {",
            "  position: fixed;",
            "  z-index: 99999;",
            "  background: #fff;",
            "  border: 1px solid #d8dce6;",
            "  border-radius: 10px;",
            "  box-shadow: 0 10px 30px rgba(13,27,62,0.18);",
            "  overflow: hidden;",
            "  display: flex;",
            "  flex-direction: column;",
            "}",
            ".lz-phone-search {",
            "  border: 0;",
            "  border-bottom: 1px solid #eceef4;",
            "  padding: 11px 13px;",
            "  font: inherit;",
            "  font-size: 15px;",
            "  outline: none;",
            "  width: 100%;",
            "  box-sizing: border-box;",
            "}",
            ".lz-phone-list {",
            "  overflow-y: auto;",
            "  -webkit-overflow-scrolling: touch;",
            "  margin: 0;",
            "  padding: 4px 0;",
            "  list-style: none;",
            "}",
            ".lz-phone-item {",
            "  display: flex;",
            "  align-items: baseline;",
            "  gap: 8px;",
            "  padding: 9px 13px;",
            "  cursor: pointer;",
            "  font-size: 15px;",
            "  color: #0d1b3e;",
            "}",
            ".lz-phone-item:hover, .lz-phone-item.active { background: #f2f4fa; }",
            ".lz-phone-item[aria-selected='true'] { font-weight: 600; }",
            ".lz-phone-code { min-width: 30px; font-weight: 600; }",
            ".lz-phone-dial { color: #667; font-variant-numeric: tabular-nums; }",
            ".lz-phone-name {",
            "  color: #667;",
            "  overflow: hidden;",
            "  text-overflow: ellipsis;",
            "  white-space: nowrap;",
            "}",
            ".lz-phone-empty { padding: 14px; color: #888; font-size: 14px; }",
            ".lz-phone-divider { height: 1px; background: #eceef4; margin: 4px 0; }",

            /* Flags. Fixed box so a missing image does not shift the row. */
            ".lz-flag {",
            "  width: 22px;",
            "  height: 16px;",
            "  flex: 0 0 22px;",
            "  object-fit: cover;",
            "  border-radius: 3px;",
            "  background: #eceef4;",
            "  display: block;",
            "}"
        ].join("\n");

        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function digitsOnly(value) {
        return String(value || "").replace(/\D/g, "");
    }

    /*
     * flagcdn serves by lowercase ISO code. w40 is enough at 22px wide;
     * w80 covers retina without doubling the cost for everyone else.
     */
    function flagUrl(iso, wide) {
        return "https://flagcdn.com/w" + (wide ? "80" : "40") + "/" +
               iso.toLowerCase() + ".png";
    }

    function buildFlag(country, lazy) {
        var img = document.createElement("img");
        img.className = "lz-flag";
        img.src = flagUrl(country.iso, false);
        img.srcset = flagUrl(country.iso, false) + " 1x, " +
                     flagUrl(country.iso, true) + " 2x";
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        img.width = 22;
        img.height = 16;
        if (lazy) img.loading = "lazy";
        return img;
    }

    function findCountry(iso) {
        for (var i = 0; i < COUNTRIES.length; i++) {
            if (COUNTRIES[i].iso === iso) return COUNTRIES[i];
        }
        return null;
    }

    function closePanel() {
        if (!openPanel) return;
        if (openPanel.el && openPanel.el.parentNode) {
            openPanel.el.parentNode.removeChild(openPanel.el);
        }
        document.removeEventListener("mousedown", openPanel.onOutside, true);
        document.removeEventListener("touchstart", openPanel.onOutside, true);
        if (openPanel.onReflow) {
            window.removeEventListener("resize", openPanel.onReflow);
            window.removeEventListener("scroll", openPanel.onReflow, true);
        }
        openPanel = null;
    }

    function buildPanel(entry) {
        var panel = document.createElement("div");
        panel.className = "lz-phone-panel";

        var search = document.createElement("input");
        search.className = "lz-phone-search";
        search.type = "text";
        search.placeholder = "Search country or code";
        search.setAttribute("aria-label", "Search country");
        search.autocomplete = "off";

        var list = document.createElement("ul");
        list.className = "lz-phone-list";
        list.setAttribute("role", "listbox");

        panel.appendChild(search);
        panel.appendChild(list);

        var filtered = ORDERED.slice();
        var activeIndex = 0;

        function render() {
            list.innerHTML = "";

            if (!filtered.length) {
                var empty = document.createElement("li");
                empty.className = "lz-phone-empty";
                empty.textContent = "No match.";
                list.appendChild(empty);
                return;
            }

            filtered.forEach(function (c, i) {
                var item = document.createElement("li");
                item.className = "lz-phone-item" + (i === activeIndex ? " active" : "");
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected",
                    c.iso === entry.iso ? "true" : "false");

                item.appendChild(buildFlag(c, true));

                var code = document.createElement("span");
                code.className = "lz-phone-code";
                code.textContent = c.label;

                var dial = document.createElement("span");
                dial.className = "lz-phone-dial";
                dial.textContent = "+" + c.dial;

                var name = document.createElement("span");
                name.className = "lz-phone-name";
                name.textContent = c.name;

                item.appendChild(code);
                item.appendChild(dial);
                item.appendChild(name);

                item.addEventListener("mousedown", function (ev) {
                    ev.preventDefault();
                    choose(c);
                });

                list.appendChild(item);

                // Separator after the pinned block, only when unfiltered.
                if (search.value === "" && c.iso === PINNED[PINNED.length - 1]) {
                    var hr = document.createElement("li");
                    hr.className = "lz-phone-divider";
                    list.appendChild(hr);
                }
            });
        }

        function choose(country) {
            setCountry(entry, country);
            closePanel();
            entry.input.focus();
        }

        search.addEventListener("input", function () {
            var q = search.value.trim().toLowerCase();
            activeIndex = 0;

            if (!q) {
                filtered = ORDERED.slice();
            } else {
                var bare = q.replace(/^\+/, "");
                filtered = ORDERED.filter(function (c) {
                    return c.search.indexOf(q) !== -1 ||
                           c.dial.indexOf(bare) === 0;
                });
            }

            render();
        });

        search.addEventListener("keydown", function (ev) {
            if (ev.key === "Escape") {
                ev.preventDefault();
                closePanel();
                entry.trigger.focus();
                return;
            }
            if (ev.key === "Enter") {
                ev.preventDefault();
                if (filtered[activeIndex]) choose(filtered[activeIndex]);
                return;
            }
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                ev.preventDefault();
                if (!filtered.length) return;
                activeIndex += (ev.key === "ArrowDown" ? 1 : -1);
                if (activeIndex < 0) activeIndex = filtered.length - 1;
                if (activeIndex >= filtered.length) activeIndex = 0;
                render();
                var active = list.querySelector(".lz-phone-item.active");
                if (active && active.scrollIntoView) {
                    active.scrollIntoView({ block: "nearest" });
                }
            }
        });

        render();
        return { panel: panel, search: search };
    }

    function positionPanel(panel, trigger) {
        var rect = trigger.getBoundingClientRect();
        var margin = 8;

        // Wide enough to read country names, but never wider than the
        // screen -- this has to work on a narrow phone.
        var width = Math.min(320, window.innerWidth - margin * 2);

        var left = rect.left;
        if (left + width > window.innerWidth - margin) {
            left = window.innerWidth - margin - width;
        }
        if (left < margin) left = margin;

        var spaceBelow = window.innerHeight - rect.bottom - margin;
        var spaceAbove = rect.top - margin;
        var useAbove = spaceBelow < 200 && spaceAbove > spaceBelow;
        var maxHeight = Math.max(160, Math.min(300, useAbove ? spaceAbove : spaceBelow));

        panel.style.width = width + "px";
        panel.style.left = left + "px";

        if (useAbove) {
            panel.style.bottom = (window.innerHeight - rect.top + 4) + "px";
            panel.style.top = "auto";
        } else {
            panel.style.top = (rect.bottom + 4) + "px";
            panel.style.bottom = "auto";
        }

        panel.querySelector(".lz-phone-list").style.maxHeight =
            (maxHeight - 46) + "px";
    }

    function togglePanel(entry) {
        if (openPanel && openPanel.entry === entry) {
            closePanel();
            return;
        }
        closePanel();

        var built = buildPanel(entry);
        document.body.appendChild(built.panel);
        positionPanel(built.panel, entry.trigger);

        function onOutside(ev) {
            if (built.panel.contains(ev.target) || entry.trigger.contains(ev.target)) {
                return;
            }
            closePanel();
        }

        // Reposition rather than close: on a phone, focusing the search
        // box raises the keyboard, which fires both resize and scroll.
        // Closing on those events made the panel shut the instant it
        // opened, which looked like the trigger doing nothing at all.
        function onReflow() {
            if (openPanel && openPanel.el) {
                positionPanel(openPanel.el, entry.trigger);
            }
        }

        openPanel = {
            el: built.panel,
            entry: entry,
            onOutside: onOutside,
            onReflow: onReflow
        };

        document.addEventListener("mousedown", onOutside, true);
        document.addEventListener("touchstart", onOutside, true);
        window.addEventListener("resize", onReflow);
        window.addEventListener("scroll", onReflow, true);

        // Only auto-focus where a keyboard will not swallow the list.
        var isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
        if (!isTouch) {
            built.search.focus();
        }
    }

    function setCountry(entry, country) {
        entry.iso = country.iso;
        entry.trigger.querySelector(".lz-phone-label").textContent =
            country.label + " +" + country.dial;

        var flag = entry.trigger.querySelector(".lz-flag");
        if (flag) {
            flag.src = flagUrl(country.iso, false);
            flag.srcset = flagUrl(country.iso, false) + " 1x, " +
                          flagUrl(country.iso, true) + " 2x";
        }
        entry.trigger.setAttribute("aria-label",
            "Country code: " + country.name + " plus " + country.dial);

        // Uganda numbers are always 9 digits after the code; elsewhere
        // varies, so the cap only applies while UG is selected.
        if (country.iso === "UG") {
            entry.input.setAttribute("maxlength", "9");
        } else {
            entry.input.setAttribute("maxlength", "15");
        }
    }

    function attach(input) {
        if (!input || input.dataset.lzPhoneReady === "1") return;

        var id = input.id;
        if (!id) return;

        var defaultIso = input.dataset.lzPhoneDefault || "UG";
        var country = findCountry(defaultIso) || findCountry("UG");

        var trigger = document.createElement("button");
        trigger.type = "button";
        // No .phone-prefix here: that style is a span with a right-hand
        // divider, meant for sitting inside the number field. The
        // trigger is now its own box.
        trigger.className = "lz-phone-trigger";
        trigger.setAttribute("aria-haspopup", "listbox");

        trigger.appendChild(buildFlag(country, false));

        var label = document.createElement("span");
        label.className = "lz-phone-label";
        trigger.appendChild(label);

        var caret = document.createElement("span");
        caret.className = "lz-phone-caret";
        caret.textContent = "\u25BC";
        trigger.appendChild(caret);

        var span = document.querySelector('[data-lz-phone-for="' + id + '"]');
        if (!span) {
            var prev = input.previousElementSibling;
            if (prev && prev.classList.contains("phone-prefix")) span = prev;
        }

        if (span && span.parentNode) {
            span.parentNode.replaceChild(trigger, span);
        } else if (input.parentNode) {
            input.parentNode.insertBefore(trigger, input);
        }

        var entry = { input: input, trigger: trigger, iso: country.iso };
        setCountry(entry, country);

        trigger.addEventListener("click", function (ev) {
            ev.preventDefault();
            togglePanel(entry);
        });

        input.dataset.lzPhoneReady = "1";
        registry[id] = entry;
    }

    function attachAll(root) {
        var scope = root || document;
        var fields = scope.querySelectorAll("input[data-lz-phone]");
        for (var i = 0; i < fields.length; i++) attach(fields[i]);
    }

    /*
     * Full E.164, or null when empty or implausible.
     *
     * Validation stays light: E.164 allows 4-15 digits and per-country
     * rules change often enough that hardcoding them would reject valid
     * numbers. Uganda is the exception, since that is the number a
     * rider dials and a wrong one costs a delivery.
     */
    function getE164(id) {
        var entry = registry[id];
        var input = entry ? entry.input : document.getElementById(id);
        if (!input) return null;

        var local = digitsOnly(input.value);
        if (!local) return null;

        var iso = entry ? entry.iso : (input.dataset.lzPhoneDefault || "UG");
        var country = findCountry(iso);
        if (!country) return null;

        // People type the trunk zero out of habit: 0772... in a field
        // that already carries the country code.
        if (local.length > 1 && local.charAt(0) === "0") {
            local = local.replace(/^0+/, "");
        }

        if (iso === "UG" && local.length !== 9) return null;

        var full = country.dial + local;
        if (full.length < 7 || full.length > 15) return null;

        return "+" + full;
    }

    function getCountry(id) {
        var entry = registry[id];
        return entry ? findCountry(entry.iso) : null;
    }

    /* Split an existing E.164 value back into picker and field. */
    function setE164(id, value) {
        var entry = registry[id];
        if (!entry || !value) return false;

        var digits = digitsOnly(value);

        // Longest dial code first, so +1 does not shadow +1268.
        var sorted = COUNTRIES.slice().sort(function (a, b) {
            return b.dial.length - a.dial.length;
        });

        for (var i = 0; i < sorted.length; i++) {
            if (digits.indexOf(sorted[i].dial) === 0) {
                setCountry(entry, sorted[i]);
                entry.input.value = digits.slice(sorted[i].dial.length);
                return true;
            }
        }

        entry.input.value = digits;
        return false;
    }

    function init() {
        injectStyles();
        attachAll(document);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    window.LzPhone = {
        attachAll: attachAll,
        getE164: getE164,
        getCountry: getCountry,
        setE164: setE164,
        countries: COUNTRIES
    };
})();
