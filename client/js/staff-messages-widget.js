// Messenger-style docked "Message Admin" chat window, shared by all staff
// dashboards (product.html, manager.html, chat.html). Wrapped in an IIFE so
// it never collides with each page's own API_URL/getToken-style globals.
//
// This file builds the window itself (hidden by default) and exposes
// window.LZTeamMessages = { open, close, toggle } plus a
// "lz-team-messages:update" document event carrying { enabled, unreadCount }
// so each page's own sidebar/topbar button can show/hide itself and render
// an unread badge without polling on its own.
(function () {
    const TOKEN_KEY = "staffToken";
    const STATUS_POLL_MS = 20000;
    const THREAD_POLL_MS = 6000;
    const HEARTBEAT_MS = 30000;
    const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

    const EMOJI = [
        "😀","😁","😂","🤣","😊","😍","😘","😜","🤔","😎",
        "🙂","🙃","😇","😉","😢","😭","😡","😱","🥳","🤗",
        "👍","👎","👏","🙏","💪","🙌","👌","✌️","🤝","💯",
        "❤️","🧡","💛","💚","💙","💜","🖤","💔","💕","✨",
        "🔥","🎉","🎊","⭐","☀️","🌧️","☕","🍕","🎂","⚽",
        "✅","❌","⚠️","❓","❗","⏰","📌","📷","🎁","🚀"
    ];

    const STICKERS = [
        "👍","❤️","😂","😮","😢","🙏","🎉","🔥",
        "👏","😍","🤝","💪","✅","🙌","😅","🥳"
    ];

    let token = () => localStorage.getItem(TOKEN_KEY);

    let messagingEnabled = false;
    let unreadCount = 0;
    let adminPresence = null;
    let windowState = "closed"; // closed | open | minimized | full
    let statusPollTimer = null;
    let threadPollTimer = null;
    let heartbeatTimer = null;
    let sending = false;

    function escapeHtml(str) {
        return String(str || "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function fmtTime(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function presenceLabel(iso) {
        if (!iso) return { text: "Offline", active: false };
        const diffMs = Date.now() - new Date(iso).getTime();
        if (diffMs < ACTIVE_WINDOW_MS) return { text: "Active now", active: true };
        const mins = Math.floor(diffMs / 60000);
        if (mins < 60) return { text: `Active ${mins}m ago`, active: false };
        const hours = Math.floor(mins / 60);
        if (hours < 24) return { text: `Active ${hours}h ago`, active: false };
        const days = Math.floor(hours / 24);
        return { text: `Active ${days}d ago`, active: false };
    }

    function formatBytes(n) {
        if (!n && n !== 0) return "";
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    function emitUpdate() {
        document.dispatchEvent(new CustomEvent("lz-team-messages:update", {
            detail: { enabled: messagingEnabled, unreadCount }
        }));
    }

    function buildWindow() {
        const wrap = document.createElement("div");
        wrap.id = "lz-team-chat";
        wrap.className = "lz-tc-hidden";
        wrap.innerHTML = `
            <div class="lz-tc-window" id="lz-tc-window">
                <div class="lz-tc-header" id="lz-tc-header">
                    <div class="lz-tc-header-info">
                        <span class="lz-tc-avatar">🛎️</span>
                        <div class="lz-tc-header-text">
                            <div class="lz-tc-title">Admin Support</div>
                            <div class="lz-tc-presence" id="lz-tc-presence">
                                <span class="lz-tc-dot" id="lz-tc-dot"></span>
                                <span id="lz-tc-presence-text">Offline</span>
                            </div>
                        </div>
                    </div>
                    <div class="lz-tc-header-actions">
                        <button type="button" id="lz-tc-min" title="Minimize" aria-label="Minimize">&#8211;</button>
                        <button type="button" id="lz-tc-full" title="Full view" aria-label="Full view">&#10021;</button>
                        <button type="button" id="lz-tc-close" title="Close" aria-label="Close">&times;</button>
                    </div>
                </div>
                <div class="lz-tc-body">
                    <div class="lz-tc-thread" id="lz-tc-thread"><p class="lz-tc-empty">Loading...</p></div>
                </div>
                <div class="lz-tc-composer-wrap">
                    <div class="lz-tc-popover" id="lz-tc-emoji-popover" hidden></div>
                    <div class="lz-tc-popover" id="lz-tc-sticker-popover" hidden></div>
                    <div class="lz-tc-composer">
                        <button type="button" class="lz-tc-icon-btn" id="lz-tc-emoji-btn" title="Emoji" aria-label="Emoji">&#128512;</button>
                        <button type="button" class="lz-tc-icon-btn" id="lz-tc-sticker-btn" title="Stickers" aria-label="Stickers">&#11088;</button>
                        <button type="button" class="lz-tc-icon-btn" id="lz-tc-attach-btn" title="Attach a file" aria-label="Attach a file">&#128206;</button>
                        <input type="file" id="lz-tc-file-input" hidden>
                        <textarea id="lz-tc-input" rows="1" placeholder="Aa"></textarea>
                        <button type="button" id="lz-tc-send">Send</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        document.getElementById("lz-tc-header").addEventListener("click", (e) => {
            if (windowState === "minimized" && !e.target.closest(".lz-tc-header-actions")) restoreWindow();
        });
        document.getElementById("lz-tc-min").addEventListener("click", (e) => { e.stopPropagation(); minimizeWindow(); });
        document.getElementById("lz-tc-full").addEventListener("click", (e) => { e.stopPropagation(); toggleFullView(); });
        document.getElementById("lz-tc-close").addEventListener("click", (e) => { e.stopPropagation(); closeWindow(); });
        document.getElementById("lz-tc-send").addEventListener("click", () => sendText());
        document.getElementById("lz-tc-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
            }
        });
        document.getElementById("lz-tc-emoji-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePopover("emoji"); });
        document.getElementById("lz-tc-sticker-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePopover("sticker"); });
        document.getElementById("lz-tc-attach-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById("lz-tc-file-input").click();
        });
        document.getElementById("lz-tc-file-input").addEventListener("change", onFileChosen);
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".lz-tc-popover") && !e.target.closest("#lz-tc-emoji-btn") && !e.target.closest("#lz-tc-sticker-btn")) {
                hidePopovers();
            }
        });

        buildEmojiPopover();
        buildStickerPopover();
    }

    function buildEmojiPopover() {
        const box = document.getElementById("lz-tc-emoji-popover");
        box.innerHTML = `<div class="lz-tc-emoji-grid">${EMOJI.map(e => `<button type="button" class="lz-tc-emoji-item">${e}</button>`).join("")}</div>`;
        box.querySelectorAll(".lz-tc-emoji-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                const input = document.getElementById("lz-tc-input");
                input.value += btn.textContent;
                input.focus();
            });
        });
    }

    function buildStickerPopover() {
        const box = document.getElementById("lz-tc-sticker-popover");
        box.innerHTML = `<div class="lz-tc-sticker-grid">${STICKERS.map(e => `<button type="button" class="lz-tc-sticker-item">${e}</button>`).join("")}</div>`;
        box.querySelectorAll(".lz-tc-sticker-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                hidePopovers();
                sendMessage(btn.textContent, "sticker");
            });
        });
    }

    function togglePopover(which) {
        const emoji = document.getElementById("lz-tc-emoji-popover");
        const sticker = document.getElementById("lz-tc-sticker-popover");
        if (which === "emoji") {
            const willShow = emoji.hidden;
            hidePopovers();
            emoji.hidden = !willShow;
        } else {
            const willShow = sticker.hidden;
            hidePopovers();
            sticker.hidden = !willShow;
        }
    }

    function hidePopovers() {
        document.getElementById("lz-tc-emoji-popover").hidden = true;
        document.getElementById("lz-tc-sticker-popover").hidden = true;
    }

    function setWindowClasses() {
        const outer = document.getElementById("lz-team-chat");
        const win = document.getElementById("lz-tc-window");
        outer.className = windowState === "closed" ? "lz-tc-hidden" : "";
        win.classList.toggle("lz-tc-minimized", windowState === "minimized");
        win.classList.toggle("lz-tc-full", windowState === "full");
    }

    function openWindow() {
        const wasClosed = windowState === "closed";
        windowState = windowState === "full" ? "full" : "open";
        setWindowClasses();
        unreadCount = 0;
        emitUpdate();
        if (wasClosed) loadThread();
        startThreadPolling();
    }

    function restoreWindow() {
        windowState = "open";
        setWindowClasses();
        loadThread();
        startThreadPolling();
    }

    function minimizeWindow() {
        windowState = "minimized";
        setWindowClasses();
        stopThreadPolling();
    }

    function toggleFullView() {
        windowState = windowState === "full" ? "open" : "full";
        setWindowClasses();
    }

    function closeWindow() {
        windowState = "closed";
        setWindowClasses();
        stopThreadPolling();
        hidePopovers();
    }

    function toggleWindow() {
        if (windowState === "closed") openWindow();
        else closeWindow();
    }

    function stopThreadPolling() {
        if (threadPollTimer) {
            clearInterval(threadPollTimer);
            threadPollTimer = null;
        }
    }

    function startThreadPolling() {
        stopThreadPolling();
        threadPollTimer = setInterval(loadThread, THREAD_POLL_MS);
    }

    function updatePresenceUi() {
        const { text, active } = presenceLabel(adminPresence);
        const label = document.getElementById("lz-tc-presence-text");
        const dot = document.getElementById("lz-tc-dot");
        if (label) label.textContent = text;
        if (dot) dot.classList.toggle("lz-tc-dot-active", active);
    }

    function renderMessage(m) {
        const mine = !m.is_from_admin;
        const rowCls = mine ? "lz-tc-mine" : "lz-tc-admin";
        let inner;
        if (m.message_type === "sticker") {
            inner = `<div class="lz-tc-sticker-msg">${escapeHtml(m.body || "")}</div>`;
        } else if (m.message_type === "file") {
            const size = formatBytes(m.attachment_bytes);
            inner = `<a class="lz-tc-file" href="${escapeHtml(m.attachment_url || "#")}" target="_blank" rel="noopener noreferrer">
                <span class="lz-tc-file-icon">&#128196;</span>
                <span class="lz-tc-file-meta">
                    <span class="lz-tc-file-name">${escapeHtml(m.attachment_name || "Attachment")}</span>
                    <span class="lz-tc-file-size">${size}</span>
                </span>
            </a>`;
        } else {
            inner = `<div class="lz-tc-bubble">${escapeHtml(m.body || "")}</div>`;
        }
        return `<div class="lz-tc-row ${rowCls}">
                ${inner}
                <div class="lz-tc-msg-time">${fmtTime(m.created_at)}</div>
            </div>`;
    }

    async function loadThread() {
        const box = document.getElementById("lz-tc-thread");
        if (!box) return;
        try {
            const res = await fetch(`/api/staff-messages/mine`, {
                headers: { "Authorization": `Bearer ${token()}` }
            });
            const data = await res.json();
            if (!res.ok) {
                box.innerHTML = `<p class="lz-tc-empty">${escapeHtml(data.error || "Could not load messages.")}</p>`;
                return;
            }
            adminPresence = data.adminPresence || null;
            updatePresenceUi();
            const msgs = data.messages || [];
            const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
            box.innerHTML = msgs.length
                ? msgs.map(renderMessage).join("")
                : `<p class="lz-tc-empty">No messages yet - say hello!</p>`;
            if (wasNearBottom) box.scrollTop = box.scrollHeight;
        } catch (error) {
            console.error("Team messages thread error:", error);
        }
    }

    async function sendMessage(body, messageType) {
        if (sending) return;
        sending = true;
        try {
            const res = await fetch(`/api/staff-messages/mine`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token()}`
                },
                body: JSON.stringify({ body, messageType })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Could not send message.");
                return;
            }
            loadThread();
        } catch (error) {
            console.error("Send team message error:", error);
            alert("Something went wrong sending that message.");
        } finally {
            sending = false;
        }
    }

    function sendText() {
        const input = document.getElementById("lz-tc-input");
        const body = input.value.trim();
        if (!body) return;
        input.value = "";
        sendMessage(body, "text");
    }

    async function onFileChosen(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            alert("That file is larger than the 15 MB limit.");
            return;
        }
        const box = document.getElementById("lz-tc-thread");
        const uploading = document.createElement("p");
        uploading.className = "lz-tc-empty";
        uploading.textContent = `Uploading ${file.name}...`;
        if (box) box.appendChild(uploading);
        try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(`/api/staff-messages/mine/attachment`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token()}` },
                body: form
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Could not upload that file.");
            }
            loadThread();
        } catch (error) {
            console.error("Attachment upload error:", error);
            alert("Something went wrong uploading that file.");
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
            adminPresence = data.adminPresence || null;
            updatePresenceUi();
            if (!messagingEnabled && windowState !== "closed") closeWindow();
            if (messagingEnabled && windowState === "open") {
                // window is open and visible: don't grow the badge, just clear it
                unreadCount = 0;
            } else {
                unreadCount = data.unreadCount || 0;
            }
            emitUpdate();
        } catch (error) {
            console.error("Team messages status error:", error);
        }
    }

    async function sendHeartbeat() {
        if (!token() || !messagingEnabled) return;
        try {
            await fetch(`/api/staff-messages/heartbeat`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token()}` }
            });
        } catch (error) {
            // Non-critical - presence just won't be perfectly fresh.
        }
    }

    function init() {
        if (!token()) return;
        buildWindow();
        pollStatus();
        statusPollTimer = setInterval(pollStatus, STATUS_POLL_MS);
        sendHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

        window.LZTeamMessages = {
            open: openWindow,
            close: closeWindow,
            toggle: toggleWindow,
            isEnabled: () => messagingEnabled,
            getUnreadCount: () => unreadCount
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
