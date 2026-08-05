/* ============================================================
   Staff live chat inbox.

   Polling rather than WebSockets: Render can run more than one
   instance and a socket layer would need sticky sessions or a
   pub/sub adapter. Intervals are tuned so a customer message
   surfaces in a few seconds, and polling stops entirely when
   nobody is looking.
   ============================================================ */

(function () {
    "use strict";

    var API = "";
    var LIST_INTERVAL = 4000;      // conversation list
    var THREAD_INTERVAL = 2500;    // open conversation

    var token = localStorage.getItem("staffToken");
    var me = null;

    var state = {
        filter: "open",
        search: "",
        conversations: [],
        activeId: null,
        cursor: 0,
        sending: false
    };

    var listTimer = null;
    var threadTimer = null;

    /* ------------------------------------------------------ helpers */

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function timeAgo(iso) {
        if (!iso) return "";
        var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return "now";
        if (s < 3600) return Math.floor(s / 60) + "m";
        if (s < 86400) return Math.floor(s / 3600) + "h";
        if (s < 604800) return Math.floor(s / 86400) + "d";
        return new Date(iso).toLocaleDateString();
    }

    function clockTime(iso) {
        if (!iso) return "";
        return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    async function api(path, options) {
        options = options || {};
        options.headers = Object.assign({
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }, options.headers || {});

        var res = await fetch(API + path, options);

        if (res.status === 401 || res.status === 403) {
            stopPolling();
            localStorage.removeItem("staffToken");
            window.location.href = "../staff-login.html";
            return null;
        }
        if (!res.ok) throw new Error("Request failed: " + res.status);
        return res.json();
    }

    /* --------------------------------------------------- connection */

    function setOffline(off) {
        var el = $("sc-conn");
        if (el) el.hidden = !off;
    }

    /* -------------------------------------------- conversation list */

    function filterParams() {
        var p = new URLSearchParams();
        var f = state.filter;

        if (f === "mine") { p.set("status", "all"); p.set("mine", "true"); }
        else if (f === "unassigned") { p.set("status", "open"); p.set("unassigned", "true"); }
        else { p.set("status", f); }

        if (state.search) p.set("search", state.search);
        return p.toString();
    }

    async function loadList() {
        try {
            var rows = await api("/api/chat/conversations?" + filterParams());
            if (!rows) return;
            setOffline(false);
            state.conversations = rows;
            renderList();
        } catch (error) {
            console.error("Load conversations error:", error);
            setOffline(true);
        }
    }

    function renderList() {
        var wrap = $("sc-list");

        if (!state.conversations.length) {
            wrap.innerHTML = '<p class="sc-empty">No conversations here.</p>';
            return;
        }

        wrap.innerHTML = state.conversations.map(function (c) {
            var tags = '<span class="sc-tag sc-tag-' + esc(c.status) + '">'
                     + esc(c.status) + "</span>";
            if (c.is_guest) tags += '<span class="sc-tag sc-tag-guest">Guest</span>';
            if (c.assigned_staff_name) {
                tags += '<span class="sc-tag sc-tag-agent">'
                      + esc(c.assigned_staff_name) + "</span>";
            }

            var badge = c.staff_unread > 0
                ? '<span class="sc-badge">' + c.staff_unread + "</span>"
                : "";

            return '<div class="sc-card' + (c.id === state.activeId ? " is-active" : "")
                 + '" data-id="' + c.id + '">'
                 + '<span class="sc-card-name">' + esc(c.display_name || "Guest") + "</span>"
                 + '<span class="sc-card-time">' + esc(timeAgo(c.last_message_at)) + "</span>"
                 + '<span class="sc-card-preview">' + esc(c.last_message || "") + "</span>"
                 + '<span class="sc-card-tags">' + tags + badge + "</span>"
                 + "</div>";
        }).join("");
    }

    /* --------------------------------------------------------- thread */

    async function openConversation(id) {
        state.activeId = id;
        state.cursor = 0;
        $("sc-messages").innerHTML = '<p class="sc-empty">Loading…</p>';
        $("sc-composer").hidden = false;

        if (window.matchMedia("(max-width: 760px)").matches) {
            $("sc-thread-panel").classList.add("is-open");
        }

        renderList();
        await pollThread();
        startThreadPolling();
    }

    async function pollThread() {
        if (!state.activeId) return;
        try {
            var data = await api("/api/chat/conversations/" + state.activeId
                               + "?after=" + state.cursor);
            if (!data) return;
            setOffline(false);

            if (state.cursor === 0) {
                $("sc-messages").innerHTML = "";
                renderHeader(data.conversation);
                renderDetail(data.conversation);
            }

            if (data.messages.length) {
                appendMessages(data.messages);
                state.cursor = data.messages[data.messages.length - 1].id;
            } else if (state.cursor === 0) {
                $("sc-messages").innerHTML = '<p class="sc-empty">No messages yet.</p>';
            }
        } catch (error) {
            console.error("Poll thread error:", error);
            setOffline(true);
        }
    }

    function appendMessages(messages) {
        var box = $("sc-messages");
        var stuck = box.scrollHeight - box.scrollTop - box.clientHeight < 60;

        messages.forEach(function (m) {
            var div = document.createElement("div");
            div.className = "sc-msg sc-msg-" + m.sender_type;
            div.innerHTML = esc(m.body)
                + '<span class="sc-msg-time">' + esc(clockTime(m.created_at)) + "</span>";
            box.appendChild(div);
        });

        // Only auto-scroll if the agent was already at the bottom, so a new
        // message never yanks them away from something they are reading.
        if (stuck) box.scrollTop = box.scrollHeight;
    }

    function renderHeader(c) {
        $("sc-thread-name").textContent = c.display_name || "Guest";
        $("sc-thread-meta").textContent =
            (c.display_phone || "no phone") + " · " + c.status
            + (c.subject ? " · " + c.subject : "");
    }

    /* --------------------------------------------------- detail panel */

    function renderDetail(c) {
        var isGuest = c.customer_id === null;

        var html =
            field("Name", c.display_name || "Guest") +
            field("Phone", c.display_phone || "Not provided") +
            field("Type", isGuest ? "Guest (not signed in)" : "Registered customer") +
            field("Status", c.status) +
            field("Started", new Date(c.created_at).toLocaleString()) +
            field("Assigned to", c.assigned_staff_id
                ? (c.assigned_staff_id === (me && me.id) ? "You" : "Agent #" + c.assigned_staff_id)
                : "Nobody");

        html += '<div class="sc-actions">';
        html += '<button class="sc-btn sc-btn-primary" data-action="assign">Assign to me</button>';
        if (c.status === "closed") {
            html += '<button class="sc-btn" data-action="reopen">Reopen conversation</button>';
        } else {
            html += '<button class="sc-btn" data-action="pending">Mark pending</button>';
            html += '<button class="sc-btn" data-action="close">Close conversation</button>';
        }
        html += "</div>";

        // Honest placeholder rather than fabricated data: there is no endpoint
        // yet that returns a customer's orders, spend, or delivery address.
        html += '<div class="sc-note">'
              + "<strong>Orders &amp; notes</strong><br>"
              + "Needs a customer summary endpoint before this panel can show "
              + "order history, delivery address or staff notes."
              + "</div>";

        $("sc-detail-body").innerHTML = html;
    }

    function field(label, value) {
        return '<div class="sc-field">'
             + '<span class="sc-field-label">' + esc(label) + "</span>"
             + '<span class="sc-field-value">' + esc(value) + "</span>"
             + "</div>";
    }

    async function doAction(action) {
        if (!state.activeId) return;
        var body = {};

        if (action === "assign") body.assigned_staff_id = me ? me.id : null;
        if (action === "close") body.status = "closed";
        if (action === "reopen") body.status = "open";
        if (action === "pending") body.status = "pending";

        try {
            await api("/api/chat/conversations/" + state.activeId, {
                method: "PATCH",
                body: JSON.stringify(body)
            });
            state.cursor = 0;
            await pollThread();
            await loadList();
        } catch (error) {
            console.error("Conversation action error:", error);
        }
    }

    /* ---------------------------------------------------------- send */

    async function send() {
        var input = $("sc-input");
        var text = input.value.trim();
        if (!text || state.sending || !state.activeId) return;

        state.sending = true;
        $("sc-send").disabled = true;

        try {
            await api("/api/chat/conversations/" + state.activeId + "/messages", {
                method: "POST",
                body: JSON.stringify({ body: text })
            });
            input.value = "";
            input.style.height = "auto";
            await pollThread();
            await loadList();
        } catch (error) {
            console.error("Send reply error:", error);
            setOffline(true);
        } finally {
            state.sending = false;
            $("sc-send").disabled = false;
        }
    }

    /* -------------------------------------------------------- polling */

    function startPolling() {
        stopPolling();
        listTimer = setInterval(loadList, LIST_INTERVAL);
        if (state.activeId) startThreadPolling();
    }

    function startThreadPolling() {
        if (threadTimer) clearInterval(threadTimer);
        threadTimer = setInterval(pollThread, THREAD_INTERVAL);
    }

    function stopPolling() {
        if (listTimer) { clearInterval(listTimer); listTimer = null; }
        if (threadTimer) { clearInterval(threadTimer); threadTimer = null; }
    }

    /* ---------------------------------------------------------- wiring */

    function wire() {
        $("sc-list").addEventListener("click", function (e) {
            var card = e.target.closest(".sc-card");
            if (card) openConversation(Number(card.dataset.id));
        });

        $("sc-filters").addEventListener("click", function (e) {
            var chip = e.target.closest(".sc-chip");
            if (!chip) return;
            document.querySelectorAll(".sc-chip").forEach(function (c) {
                c.classList.remove("is-active");
            });
            chip.classList.add("is-active");
            state.filter = chip.dataset.filter;
            loadList();
        });

        var searchDebounce = null;
        $("sc-search").addEventListener("input", function (e) {
            clearTimeout(searchDebounce);
            var value = e.target.value.trim();
            searchDebounce = setTimeout(function () {
                state.search = value;
                loadList();
            }, 350);
        });

        $("sc-send").addEventListener("click", send);

        $("sc-input").addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
        });

        $("sc-input").addEventListener("input", function (e) {
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
        });

        $("sc-detail-body").addEventListener("click", function (e) {
            var btn = e.target.closest("[data-action]");
            if (btn) doAction(btn.dataset.action);
        });

        $("sc-back").addEventListener("click", function () {
            $("sc-thread-panel").classList.remove("is-open");
        });

        $("sc-info-btn").addEventListener("click", function () {
            $("sc-detail-panel").classList.add("is-open");
            $("sc-scrim").hidden = false;
        });

        function closeDrawer() {
            $("sc-detail-panel").classList.remove("is-open");
            $("sc-scrim").hidden = true;
        }
        $("sc-detail-close").addEventListener("click", closeDrawer);
        $("sc-scrim").addEventListener("click", closeDrawer);

        $("sc-logout").addEventListener("click", function () {
            stopPolling();
            localStorage.removeItem("staffToken");
            window.location.href = "../staff-login.html";
        });

        // Idle agents should not poll. Resuming refreshes immediately rather
        // than waiting out the interval.
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) {
                stopPolling();
            } else {
                loadList();
                if (state.activeId) pollThread();
                startPolling();
            }
        });

        window.addEventListener("offline", function () { setOffline(true); stopPolling(); });
        window.addEventListener("online", function () {
            setOffline(false);
            loadList();
            startPolling();
        });
    }

    /* ------------------------------------------------------------ init */

    async function init() {
        if (!token) {
            window.location.href = "../staff-login.html";
            return;
        }

        try {
            var res = await fetch(API + "/api/auth/me", {
                headers: { "Authorization": "Bearer " + token }
            });
            if (res.ok) {
                var data = await res.json();
                me = data.user || data;
                $("sc-agent").textContent = me.name || "";
            }
        } catch (error) {
            console.error("Identity lookup failed:", error);
        }

        wire();
        await loadList();
        startPolling();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
