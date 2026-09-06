// Floating "Message Admin" widget, shared by all staff dashboards
// (product.html, manager.html, chat.html). Wrapped in an IIFE so it never
// collides with each page's own API_URL/getToken-style globals.
(function () {
    const TOKEN_KEY = "staffToken";
    let panelOpen = false;
    let messagingEnabled = false;
    let statusPollTimer = null;
    let threadPollTimer = null;

    function token() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function fmtTime(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function buildWidget() {
        const wrap = document.createElement("div");
        wrap.id = "lz-team-msg-widget";
        wrap.innerHTML = `
            <button id="lz-tm-launcher" type="button">
                <span>&#128233;</span> Message Admin
                <span id="lz-tm-badge" class="lz-tm-badge" hidden>0</span>
            </button>
            <div id="lz-tm-panel" hidden>
                <div class="lz-tm-panel-head">
                    <strong>Message Admin</strong>
                    <button id="lz-tm-close" type="button">&times;</button>
                </div>
                <div id="lz-tm-thread"><p class="lz-tm-empty">Loading...</p></div>
                <div class="lz-tm-compose">
                    <textarea id="lz-tm-input" rows="2" placeholder="Type a message..."></textarea>
                    <button id="lz-tm-send" type="button">Send</button>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        document.getElementById("lz-tm-launcher").addEventListener("click", openPanel);
        document.getElementById("lz-tm-close").addEventListener("click", closePanel);
        document.getElementById("lz-tm-send").addEventListener("click", sendMessage);
        document.getElementById("lz-tm-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    function showLauncher(show) {
        const el = document.getElementById("lz-team-msg-widget");
        if (el) el.style.display = show ? "" : "none";
    }

    function setBadge(count) {
        const badge = document.getElementById("lz-tm-badge");
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 9 ? "9+" : String(count);
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    }

    async function pollStatus() {
        if (!token()) return;
        try {
            const res = await fetch(`/api/staff-messages/status`, {
                headers: { "Authorization": `Bearer ${token()}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            messagingEnabled = !!data.enabled;
            showLauncher(messagingEnabled);
            if (!messagingEnabled && panelOpen) closePanel();
            if (messagingEnabled) setBadge(data.unreadCount || 0);
        } catch (error) {
            console.error("Team messages status error:", error);
        }
    }

    async function openPanel() {
        panelOpen = true;
        document.getElementById("lz-tm-panel").hidden = false;
        setBadge(0);
        await loadThread();
        stopThreadPolling();
        threadPollTimer = setInterval(loadThread, 10000);
    }

    function closePanel() {
        panelOpen = false;
        const panel = document.getElementById("lz-tm-panel");
        if (panel) panel.hidden = true;
        stopThreadPolling();
    }

    function stopThreadPolling() {
        if (threadPollTimer) {
            clearInterval(threadPollTimer);
            threadPollTimer = null;
        }
    }

    async function loadThread() {
        const box = document.getElementById("lz-tm-thread");
        if (!box) return;
        try {
            const res = await fetch(`/api/staff-messages/mine`, {
                headers: { "Authorization": `Bearer ${token()}` }
            });
            const data = await res.json();
            if (!res.ok) {
                box.innerHTML = `<p class="lz-tm-empty">${data.error || "Could not load messages."}</p>`;
                return;
            }
            const msgs = data.messages || [];
            box.innerHTML = msgs.length
                ? msgs.map(m => `<div class="lz-tm-msg ${m.is_from_admin ? "lz-tm-admin" : "lz-tm-mine"}">
                       <div class="lz-tm-msg-body">${(m.body || "").replace(/</g, "&lt;")}</div>
                       <div class="lz-tm-msg-time">${fmtTime(m.created_at)}</div>
                   </div>`).join("")
                : `<p class="lz-tm-empty">No messages yet - say hello!</p>`;
            box.scrollTop = box.scrollHeight;
        } catch (error) {
            console.error("Team messages thread error:", error);
            box.innerHTML = `<p class="lz-tm-empty">Could not connect to server.</p>`;
        }
    }

    async function sendMessage() {
        const input = document.getElementById("lz-tm-input");
        const body = input.value.trim();
        if (!body) return;
        try {
            const res = await fetch(`/api/staff-messages/mine`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token()}`
                },
                body: JSON.stringify({ body })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Could not send.");
                return;
            }
            input.value = "";
            loadThread();
        } catch (error) {
            console.error("Send team message error:", error);
            alert("Something went wrong.");
        }
    }

    function init() {
        if (!token()) return;
        buildWidget();
        showLauncher(false);
        pollStatus();
        statusPollTimer = setInterval(pollStatus, 20000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
