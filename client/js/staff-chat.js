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
    var agentList = [];

    var state = {
        filter: "active",
        search: "",
        conversations: [],
        activeId: null,
        cursor: 0,
        sending: false,
        tier: "agent",
        senior: false,
        events: [],
        conv: null
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

        if (res.status === 403) {
            // "Not your chat" / "senior agents only" are normal answers, not
            // an expired login - show them instead of signing out.
            var denied = await res.clone().json().catch(function () { return {}; });
            if (denied && (denied.code === "not_your_chat" || denied.code === "senior_only")) {
                var err = new Error(denied.message || "Not allowed");
                err.code = denied.code;
                throw err;
            }
        }
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

    function waitLabel(since) {
        var mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
        if (isNaN(mins) || mins < 1) return "just now";
        if (mins < 60) return mins + "m waiting";
        return Math.floor(mins / 60) + "h " + (mins % 60) + "m waiting";
    }

    function filterParams() {
        var p = new URLSearchParams();
        var f = state.filter;

        if (f === "mine") { p.set("status", "all"); p.set("mine", "true"); }
        else if (f === "unassigned") { p.set("status", "active"); p.set("unassigned", "true"); }
        else if (f === "escalated") { p.set("status", "active"); p.set("escalated", "true"); }
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

        // A queue read newest-first buries the person who has waited
        // longest. Waiting chats sort oldest-first and sit above everything.
        var ordered = state.conversations.slice().sort(function (a, b) {
            var aw = a.status === "waiting";
            var bw = b.status === "waiting";
            if (aw && !bw) return -1;
            if (bw && !aw) return 1;
            if (aw && bw) {
                return new Date(a.escalated_at || 0) - new Date(b.escalated_at || 0);
            }
            return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
        });

        wrap.innerHTML = ordered.map(function (c) {
            var tags = '<span class="sc-tag sc-tag-' + esc(c.status) + '">'
                     + esc(c.status) + "</span>";
            if (c.status === "waiting" && c.escalated_at) {
                tags += '<span class="sc-tag sc-tag-wait">'
                      + esc(waitLabel(c.escalated_at)) + "</span>";
            }
            if (c.escalation_level > 0) tags += '<span class="sc-tag sc-tag-esc">Escalated</span>';
            if (c.priority === "critical" || c.priority === "high") {
                tags += '<span class="sc-tag sc-tag-prio-' + esc(c.priority) + '">'
                      + (c.priority === "critical" ? "Critical" : "High") + "</span>";
            }
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
                state.conv = data.conversation;
                state.events = data.events || [];
                renderHeader(data.conversation);
                await loadAgents();
                renderDetail(data.conversation);
            }

            if (data.messages.length) {
                appendMessages(data.messages);
                state.cursor = data.messages[data.messages.length - 1].id;
            } else if (state.cursor === 0) {
                $("sc-messages").innerHTML = '<p class="sc-empty">No messages yet.</p>';
            }
        } catch (error) {
            if (error.code === "not_your_chat") {
                if (threadTimer) { clearInterval(threadTimer); threadTimer = null; }
                $("sc-messages").innerHTML = '<p class="sc-empty">' + esc(error.message) + "</p>";
                $("sc-composer").hidden = true;
                $("sc-detail-body").innerHTML = '<p class="sc-empty">' + esc(error.message) + "</p>";
                return;
            }
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

    // Colleagues available for transfer. Refreshed when a thread is opened so
    // the online dots and chat counts are current rather than page-load stale.
    async function loadAgents() {
        try {
            var data = await api("/api/chat/availability");
            agentList = (data && data.agents) || [];
        } catch (error) {
            console.error("Load agents error:", error);
            agentList = [];
        }
    }

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

        var mine = me && c.assigned_staff_id === me.id;
        var tierName = state.senior ? "senior" : "agent";

        if (c.escalation_level > 0 || c.priority === "high" || c.priority === "critical") {
            html += '<div class="sc-flag">'
                  + (c.escalation_level > 0 ? "Escalated" + (c.escalation_level > 1 ? " \u00d7" + c.escalation_level : "") + " \u00b7 " : "")
                  + esc((c.priority || "normal").replace(/^./, function (x) { return x.toUpperCase(); })) + " priority</div>";
        }

        html += '<div class="sc-actions">';
        if (!mine && (state.senior || !c.assigned_staff_id)) {
            html += '<button class="sc-btn sc-btn-primary" data-action="assign">'
                  + (c.assigned_staff_id ? "Take over this chat" : "Assign to me") + "</button>";
        }
        if (c.status === "closed") {
            html += '<button class="sc-btn" data-action="reopen">Reopen conversation</button>';
        } else {
            html += '<button class="sc-btn" data-action="pending">Mark pending</button>';
            html += '<button class="sc-btn" data-action="close">Close conversation</button>';
        }
        html += "</div>";
        html += '<p class="sc-action-msg" id="sc-action-msg" role="status"></p>';

        if (c.status !== "closed") {
            // Escalate: any agent can pass a difficult case to a senior agent.
            html += '<div class="sc-escalate">';
            html += "<strong>Escalate to senior agent</strong>";
            html += '<select id="sc-esc-reason">'
                  + '<option value="complaint">Complaint</option>'
                  + '<option value="refund">Refund or return dispute</option>'
                  + '<option value="payment">Payment problem</option>'
                  + '<option value="delivery">Delivery problem</option>'
                  + '<option value="angry_customer">Upset customer</option>'
                  + '<option value="needs_approval">Needs a senior decision</option>'
                  + '<option value="other">Other</option></select>';
            html += '<textarea id="sc-esc-note" rows="2" maxlength="1000" placeholder="What has been tried so far? (seen by the team only)"></textarea>';
            html += '<button class="sc-btn sc-btn-warn" data-action="escalate">Escalate</button>';
            html += "</div>";
        }

        // Transfer to a named colleague: senior agents and up. Everyone can
        // hand a chat back to the queue.
        if (c.status !== "closed") {
            html += '<div class="sc-transfer">';
            if (state.senior) {
                html += "<strong>Transfer this chat</strong>";
                var others = agentList.filter(function (a) {
                    return !(me && a.staff_id === me.id);
                });
                if (others.length === 0) {
                    html += '<p class="sc-transfer-empty">No other agents on the team yet. '
                          + "Return it to the queue instead.</p>";
                } else {
                    html += '<select id="sc-transfer-select">';
                    html += '<option value="">Choose a colleague...</option>';
                    others.forEach(function (a) {
                        var dot = a.is_online ? "\u25CF " : "\u25CB ";
                        var nm = a.staff_name || ("Agent #" + a.staff_id);
                        var t = a.tier === "senior_agent" ? " \u00b7 Senior" : a.tier === "supervisor" ? " \u00b7 Supervisor" : "";
                        html += '<option value="' + a.staff_id + '">' + esc(dot + nm + t)
                              + " (" + a.active_chats + ")</option>";
                    });
                    html += "</select>";
                    html += '<button class="sc-btn" data-action="transfer">Transfer</button>';
                }
            }
            html += '<button class="sc-btn" data-action="requeue">Return to queue</button>';
            html += "</div>";
        }

        // Team notes: staff-only notes and escalation history. Senior agents
        // use these to coach and hand over; customers never see them.
        var notes = (state.events || []).filter(function (ev) {
            return ev.event_type === "internal_note" || ev.event_type === "escalated_to_senior";
        });
        html += '<div class="sc-notes"><strong>Team notes</strong>';
        if (!notes.length) html += '<p class="sc-notes-empty">No notes yet.</p>';
        notes.forEach(function (ev) {
            var m = ev.meta || {};
            var who = esc(ev.actor_name || "Staff");
            var when = esc(new Date(ev.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
            if (ev.event_type === "internal_note") {
                html += '<div class="sc-note-item"><span class="sc-note-who">' + who
                      + (m.tier === "senior_agent" ? ' <em>Senior</em>' : m.tier === "supervisor" ? ' <em>Supervisor</em>' : "")
                      + " \u00b7 " + when + "</span>" + esc(m.text || "") + "</div>";
            } else {
                html += '<div class="sc-note-item sc-note-esc"><span class="sc-note-who">' + who + " escalated \u00b7 " + when + "</span>"
                      + esc((m.reason || "").replace(/_/g, " ")) + (m.note ? ": " + esc(m.note) : "")
                      + (m.to_staff_id ? "" : " (no senior on duty - flagged)") + "</div>";
            }
        });
        html += '<textarea id="sc-note-text" rows="2" maxlength="2000" placeholder="Add a note for the team (the customer never sees it)"></textarea>';
        html += '<button class="sc-btn" data-action="note">Add note</button>';
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

    function actionMsg(text, bad) {
        var el = $("sc-action-msg");
        if (!el) return;
        el.textContent = text || "";
        el.className = "sc-action-msg" + (bad ? " is-bad" : "");
    }

    async function doAction(action) {
        if (!state.activeId) return;
        var body = {};

        if (action === "escalate") {
            try {
                var r = await api("/api/chat/conversations/" + state.activeId + "/escalate", {
                    method: "POST",
                    body: JSON.stringify({ reason: $("sc-esc-reason").value, note: $("sc-esc-note").value })
                });
                state.cursor = 0;
                await pollThread();
                actionMsg(r && r.message);
                await loadList();
            } catch (error) {
                actionMsg(error.message, true);
            }
            return;
        }
        if (action === "note") {
            var text = ($("sc-note-text").value || "").trim();
            if (!text) return;
            try {
                await api("/api/chat/conversations/" + state.activeId + "/notes", {
                    method: "POST",
                    body: JSON.stringify({ text: text })
                });
                state.cursor = 0;
                await pollThread();
            } catch (error) {
                actionMsg(error.message, true);
            }
            return;
        }

        if (action === "assign") body.assigned_staff_id = me ? me.id : null;

        if (action === "transfer") {
            var sel = $("sc-transfer-select");
            var target = sel ? sel.value : "";
            if (!target) return;
            body.assigned_staff_id = Number(target);
            body.status = "open";
        }

        // Back to the queue: routing picks it up again when an agent is on duty.
        if (action === "requeue") {
            body.assigned_staff_id = null;
            body.status = "waiting";
        }
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
            actionMsg(error.message, true);
        }
    }

    /* ------------------------------------------------------ team view */

    // Senior agents and up: who is on duty, their load, today's numbers.
    function fmtSecs(n) {
        if (n == null) return "\u2013";
        if (n < 60) return n + "s";
        return Math.floor(n / 60) + "m " + (n % 60) + "s";
    }
    async function openTeam() {
        var box = $("sc-team");
        box.hidden = false;
        $("sc-team-body").innerHTML = '<p class="sc-empty">Loading\u2026</p>';
        try {
            var d = await api("/api/chat/team");
            if (!d) return;
            var html = '<div class="sc-team-stats">'
                + '<span><b>' + d.waiting + "</b> waiting</span>"
                + '<span><b>' + d.escalated_open + "</b> escalated</span>"
                + '<span><b>' + d.awaiting_first_reply + "</b> awaiting first reply</span></div>";
            html += '<table class="sc-team-table"><thead><tr><th>Agent</th><th>Role</th><th>Status</th><th>Chats now</th><th>Escalated</th><th>Closed today</th><th>Avg first reply</th></tr></thead><tbody>';
            d.agents.forEach(function (a) {
                var status = a.is_online && a.is_available ? '<span class="sc-dot on"></span>Available'
                    : a.is_online ? '<span class="sc-dot away"></span>Online, not taking chats'
                    : '<span class="sc-dot off"></span>Offline';
                var full = a.active_chats >= a.max_concurrent ? " sc-full" : "";
                html += "<tr><td>" + esc(a.name) + "</td><td>" + esc(a.tier_label) + "</td><td>" + status + "</td>"
                      + '<td class="' + full + '">' + a.active_chats + " / " + a.max_concurrent + "</td>"
                      + "<td>" + a.escalated_chats + "</td><td>" + a.closed_today + "</td><td>" + fmtSecs(a.avg_first_response_s) + "</td></tr>";
            });
            html += "</tbody></table>";
            html += '<p class="sc-team-tip">Open the <b>Escalated</b> filter to pick up difficult chats. Use <b>Take over</b> or <b>Transfer</b> on any chat, and leave coaching in <b>Team notes</b>.</p>';
            $("sc-team-body").innerHTML = html;
        } catch (error) {
            $("sc-team-body").innerHTML = '<p class="sc-empty">' + esc(error.message) + "</p>";
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

        var bar = $("sc-filters");
        bar.insertAdjacentHTML("beforebegin",
            '<div class="sc-avail" id="sc-avail">'
          + '<button type="button" class="sc-avail-btn" id="sc-avail-btn">'
          + "Go available</button>"
          + '<span class="sc-avail-note" id="sc-avail-note"></span>'
          + "</div>");

        function paintAvailability(isOn, waiting) {
            var btn = $("sc-avail-btn");
            var note = $("sc-avail-note");
            btn.textContent = isOn ? "Available" : "Go available";
            btn.className = "sc-avail-btn" + (isOn ? " is-on" : "");
            if (!note) return;
            if (!isOn) {
                note.textContent = "Off duty - no chats will route to you";
            } else if (waiting) {
                note.textContent = waiting + " waiting in queue";
            } else {
                note.textContent = "On duty";
            }
        }

        var availOn = false;

        async function beat() {
            try {
                var data = await api("/api/chat/heartbeat", { method: "POST" });
                availOn = !!data.is_available;
                paintAvailability(availOn, data.waiting);
            } catch (error) {
                console.error("Heartbeat failed:", error);
            }
        }

        $("sc-avail-btn").addEventListener("click", async function () {
            try {
                var data = await api(
                    "/api/chat/availability?is_available=" + (!availOn),
                    { method: "POST" }
                );
                availOn = !!data.is_available;
                paintAvailability(availOn, null);
                await loadConversations();
            } catch (error) {
                console.error("Availability toggle failed:", error);
            }
        });

        paintAvailability(false, null);
        beat();
        setInterval(beat, 30000);

        bar.addEventListener("click", function (e) {
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

        var teamBtn = $("sc-team-btn");
        if (teamBtn) teamBtn.addEventListener("click", openTeam);
        var teamClose = $("sc-team-close");
        if (teamClose) teamClose.addEventListener("click", function () { $("sc-team").hidden = true; });

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
        try {
            var t = await api("/api/chat/me");
            if (t) {
                state.tier = t.tier;
                state.senior = !!t.senior;
                if (t.tier !== "agent") {
                    $("sc-agent").insertAdjacentHTML("beforeend", ' <span class="sc-tier">' + esc(t.label) + "</span>");
                }
            }
        } catch (error) {
            console.error("Tier lookup failed:", error);
        }
        var teamBtn = $("sc-team-btn");
        if (teamBtn) teamBtn.hidden = !state.senior;

        wire();
        await loadList();
        startPolling();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
