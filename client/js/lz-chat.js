/*
 * lz-chat.js - Lizimas Store customer chat widget
 *
 * Self-injecting: builds its own markup and styles on load. To add the widget
 * to a page, the only edit needed is one script tag before </body>:
 *
 *     <script src="js/lz-chat.js?v=1"></script>
 *
 * Talks to the guest endpoints in server/routes/chat.js:
 *     POST /api/chat/start            open a thread + first message
 *     GET  /api/chat/:id/messages     poll for new messages (cursor on id)
 *     POST /api/chat/:id/messages     post a customer message
 *     POST /api/chat/:id/read         clear the customer unread counter
 *
 * Identity is a 64-hex guest token held in localStorage and sent as the
 * X-Chat-Token header. The server compares it against the conversation's
 * guest_token, so a lost token means a lost thread - that is by design.
 *
 * Built for the human tier. The AI tier slots in later without a rewrite:
 * renderMessage() already handles an "ai" sender_type, and the option chips
 * are the same UI the assistant will use for suggested replies.
 */
(function () {
  "use strict";

  if (window.__lzChatLoaded) return;
  window.__lzChatLoaded = true;

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------

  var CFG = {
    apiBase: "/api/chat",
    storeName: "Lizimas Store Assistant",
    whatsapp: "https://wa.me/256792363104",
    // Poll intervals in ms. Slow cadence when the thread is idle, fast for a
    // couple of minutes after either side speaks, so replies feel immediate
    // without every open tab hammering the server all day.
    pollFast: 3000,
    pollSlow: 12000,
    fastWindowMs: 120000,
    tokenKey: "lz_chat_token",
    convKey: "lz_chat_conversation"
  };

  // Topics offered the moment the panel opens. Answered here first, so a
  // question that has a known answer gets one immediately instead of waiting
  // for a staff member to be free. Anything not covered - or an answer that
  // did not help - falls through to the contact form.
  //
  // EDIT THESE FREELY. They are plain strings, no code involved. When the AI
  // tier lands it replaces the `answer` field; the menu itself stays.
  var TOPICS = [
    {
      label: "Delivery",
      answer:
        "We deliver between 08:00 and 18:00.\n\n" +
        "Kampala: same day or next day.\n" +
        "Upcountry: 2 to 3 days.\n\n" +
        "Delivery fees depend on distance and are shown at checkout before you pay."
    },
    {
      label: "Returns",
      answer:
        "You have 7 days from delivery to return an item.\n\n" +
        "It should be unused and in its original packaging. Tell us the order " +
        "number and what went wrong, and we will arrange the return."
    },
    {
      label: "Payments",
      answer:
        "We accept MTN Mobile Money and cash on delivery.\n\n" +
        "You choose your payment method at checkout."
    },
    {
      label: "Track order",
      answer:
        "Sign in and open My Orders to see the current status of anything you " +
        "have ordered.\n\n" +
        "If you checked out as a guest, send us your order number here and we " +
        "will look it up."
    }
  ];

  var NAVY = "#0f1b3d";
  var GOLD = "#f5c518";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = {
    open: false,
    conversationId: null,
    token: null,
    messages: [],
    lastId: 0,
    sending: false,
    starting: false,
    pollTimer: null,
    lastActivity: 0,
    agentName: null,
    escalating: false,
    escalated: false,
    status: "open"
  };

  // ---------------------------------------------------------------------
  // Storage - wrapped because private browsing can throw on access
  // ---------------------------------------------------------------------

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      return null;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------

  var CSS = [
    ".lzc-launcher{position:fixed;right:20px;bottom:88px;width:56px;height:56px;",
    "border-radius:50%;background:" + NAVY + ";border:none;cursor:pointer;z-index:2147483000;",
    "display:flex;align-items:center;justify-content:center;",
    "box-shadow:0 4px 12px rgba(0,0,0,.25);transition:transform .15s ease}",
    ".lzc-launcher:hover{transform:scale(1.06)}",
    ".lzc-launcher:focus-visible{outline:3px solid " + GOLD + ";outline-offset:3px}",
    ".lzc-launcher.lzc-hidden{display:none}",
    ".lzc-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;",
    "border-radius:10px;background:#d7263d;color:#fff;font:700 12px/20px system-ui,sans-serif;",
    "text-align:center;padding:0 5px;display:none}",
    ".lzc-badge.lzc-on{display:block}",

    ".lzc-panel{position:fixed;right:20px;bottom:20px;width:380px;height:600px;",
    "max-height:calc(100vh - 40px);background:#fff;border-radius:16px;z-index:2147483001;",
    "display:none;flex-direction:column;overflow:hidden;",
    "box-shadow:0 12px 40px rgba(0,0,0,.28);",
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
    ".lzc-panel.lzc-on{display:flex}",

    ".lzc-head{background:" + NAVY + ";color:#fff;padding:14px 16px;",
    "display:flex;align-items:center;gap:10px;flex:0 0 auto}",
    ".lzc-mark{width:34px;height:34px;border-radius:9px;background:" + GOLD + ";",
    "color:" + NAVY + ";font:800 13px/34px system-ui,sans-serif;text-align:center;flex:0 0 auto}",
    ".lzc-titles{flex:1;min-width:0}",
    ".lzc-title{font-weight:700;font-size:15px;line-height:1.2}",
    ".lzc-sub{font-size:12px;opacity:.72;line-height:1.4;margin-top:2px}",
    ".lzc-x{background:none;border:none;color:#fff;font-size:26px;line-height:1;",
    "cursor:pointer;padding:0 4px;opacity:.85}",
    ".lzc-x:hover{opacity:1}",

    ".lzc-body{flex:1;overflow-y:auto;padding:16px;background:#f6f7f9;",
    "display:flex;flex-direction:column;gap:10px}",

    ".lzc-welcome{background:#fff;border-radius:14px;padding:18px 16px;",
    "border:1px solid #e7e9ee}",
    ".lzc-welcome h3{margin:0 0 6px;font-size:16px;color:" + NAVY + "}",
    ".lzc-welcome p{margin:0;font-size:13.5px;color:#5b6472;line-height:1.5}",

    ".lzc-chips{display:flex;flex-direction:column;gap:8px;margin-top:14px}",
    ".lzc-chip{width:100%;background:#fff;border:1px solid #d9dde5;border-radius:10px;",
    "padding:12px 14px;font-size:14px;color:" + NAVY + ";cursor:pointer;text-align:left;",
    "font-family:inherit;transition:border-color .12s ease,background .12s ease}",
    ".lzc-chip:hover{border-color:" + NAVY + ";background:#fbfcfe}",
    ".lzc-chip:focus-visible{outline:2px solid " + GOLD + ";outline-offset:2px}",

    // Topics get tiles in two columns rather than a stacked list: they are
    // peers being scanned, not steps being read in order, and the grid fills
    // the dead space under the greeting on a tall phone screen. The two-word
    // follow-up prompts stay stacked - those are sequential choices.
    ".lzc-chips--grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    ".lzc-chips--grid .lzc-chip{min-height:48px;display:flex;align-items:center;",
    "justify-content:center;text-align:center;padding:12px 10px;line-height:1.3}",
    ".lzc-chip--wide{grid-column:1 / -1}",

    ".lzc-msg{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;",
    "line-height:1.45;word-wrap:break-word;white-space:pre-wrap}",
    ".lzc-in{align-self:flex-start;background:#fff;color:#1b2233;",
    "border:1px solid #e7e9ee;border-bottom-left-radius:5px}",
    ".lzc-out{align-self:flex-end;background:" + NAVY + ";color:#fff;",
    "border-bottom-right-radius:5px}",
    ".lzc-time{font-size:11px;opacity:.6;margin-top:4px}",
    ".lzc-who{font-size:11px;font-weight:700;opacity:.75;margin-bottom:3px}",

    ".lzc-sys{align-self:center;max-width:90%;text-align:center;font-size:12px;",
    "color:#6b7280;background:#eceef2;border-radius:20px;padding:6px 14px}",

    ".lzc-note{background:#fff;border:1px solid #e7e9ee;border-radius:14px;padding:14px}",
    ".lzc-note h4{margin:0 0 4px;font-size:14px;color:" + NAVY + "}",
    ".lzc-note p{margin:0 0 10px;font-size:13px;color:#5b6472;line-height:1.45}",
    ".lzc-row{display:flex;gap:8px}",
    ".lzc-lab{display:block;font-size:12px;font-weight:600;color:" + NAVY + ";",
    "margin:10px 0 4px}",
    ".lzc-opt{font-weight:400;color:#8a93a2}",
    ".lzc-hint{font-size:11.5px;color:#7a8493;line-height:1.4;margin:0 0 6px}",
    ".lzc-note input{width:100%;box-sizing:border-box;border:1px solid #d9dde5;",
    "border-radius:9px;padding:10px 11px;font-size:14px;font-family:inherit}",
    ".lzc-note input:focus{outline:none;border-color:" + NAVY + ";box-shadow:0 0 0 3px rgba(245,197,24,.35)}",
    ".lzc-note input.lzc-bad{border-color:#d7263d;background:#fff7f8}",
    ".lzc-err{color:#d7263d;font-size:12px;min-height:16px;margin-top:6px}",
    ".lzc-mini{background:" + NAVY + ";color:#fff;border:none;border-radius:9px;",
    "padding:11px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}",
    ".lzc-block{width:100%;margin-top:4px}",
    ".lzc-skip{background:none;border:none;color:#7a8493;font-size:12.5px;",
    "cursor:pointer;padding:8px 0 0;font-family:inherit;text-decoration:underline}",

    ".lzc-foot{flex:0 0 auto;border-top:1px solid #e7e9ee;background:#fff;padding:10px 12px}",
    ".lzc-typing{font-size:12px;color:#6b7280;padding:0 2px 6px;display:none}",
    ".lzc-typing.lzc-on{display:block}",
    ".lzc-compose{display:flex;gap:8px;align-items:flex-end}",
    ".lzc-input{flex:1;min-width:0;border:1px solid #d9dde5;border-radius:20px;",
    "padding:10px 14px;font-size:14px;font-family:inherit;resize:none;max-height:96px;",
    "line-height:1.4}",
    ".lzc-input:focus{outline:none;border-color:" + NAVY + ";box-shadow:0 0 0 3px rgba(245,197,24,.35)}",
    ".lzc-send{background:" + GOLD + ";color:" + NAVY + ";border:none;border-radius:20px;",
    "padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;",
    "flex:0 0 auto}",
    ".lzc-send:disabled{opacity:.5;cursor:default}",
    ".lzc-alt{text-align:center;font-size:12px;color:#6b7280;padding:8px 0 2px;",
    "display:flex;align-items:center;justify-content:center;gap:8px}",
    ".lzc-alt a{color:" + NAVY + ";font-weight:600}",
    ".lzc-link{background:none;border:none;color:" + NAVY + ";font-weight:600;",
    "font-size:12px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline}",
    ".lzc-dot{opacity:.5}",

    "@media (max-width:600px){",
    ".lzc-panel{right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0}",
    ".lzc-msg{max-width:86%}",
    "}",
    "@media (prefers-reduced-motion:reduce){",
    ".lzc-launcher{transition:none}",
    "}"
  ].join("");

  // ---------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------

  var el = {};

  function build() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    el.launcher = document.createElement("button");
    el.launcher.className = "lzc-launcher";
    el.launcher.setAttribute("aria-label", "Chat with Lizimas Store");
    el.launcher.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="' + GOLD + '">' +
      '<path d="M12 3C6.9 3 2.8 6.6 2.8 11c0 2.3 1.1 4.4 3 5.9-.1 1-.6 2.4-1.6 3.4 1.7-.2 3.4-.9 4.6-1.8 1 .3 2.1.4 3.2.4 5.1 0 9.2-3.6 9.2-8s-4.1-7.9-9.2-7.9Z"/>' +
      "</svg>" +
      '<span class="lzc-badge" id="lzc-badge"></span>';
    document.body.appendChild(el.launcher);
    el.badge = el.launcher.querySelector("#lzc-badge");

    el.panel = document.createElement("div");
    el.panel.className = "lzc-panel";
    el.panel.setAttribute("role", "dialog");
    el.panel.setAttribute("aria-label", CFG.storeName);
    el.panel.innerHTML =
      '<div class="lzc-head">' +
      '<div class="lzc-mark">LS</div>' +
      '<div class="lzc-titles">' +
      '<div class="lzc-title">' + CFG.storeName + "</div>" +
      '<div class="lzc-sub" id="lzc-sub">Ask us anything about your order</div>' +
      "</div>" +
      '<button class="lzc-x" id="lzc-x" aria-label="Close chat">&times;</button>' +
      "</div>" +
      '<div class="lzc-body" id="lzc-body"></div>' +
      '<div class="lzc-foot">' +
      '<div class="lzc-typing" id="lzc-typing"></div>' +
      '<div class="lzc-compose">' +
      '<textarea class="lzc-input" id="lzc-input" rows="1" placeholder="Type your message..."></textarea>' +
      '<button class="lzc-send" id="lzc-send">Send</button>' +
      "</div>" +
      '<div class="lzc-alt">' +
      'Prefer WhatsApp? <a href="' + CFG.whatsapp +
      '" target="_blank" rel="noopener">Message us there</a>' +
      "</div>" +
      "</div>";
    document.body.appendChild(el.panel);

    el.body = el.panel.querySelector("#lzc-body");
    el.input = el.panel.querySelector("#lzc-input");
    el.send = el.panel.querySelector("#lzc-send");
    el.close = el.panel.querySelector("#lzc-x");
    el.sub = el.panel.querySelector("#lzc-sub");
    el.typing = el.panel.querySelector("#lzc-typing");

    el.launcher.addEventListener("click", openPanel);
    el.close.addEventListener("click", closePanel);
    el.send.addEventListener("click", onSend);

    el.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    });

    // Grow the box with the message, to a ceiling.
    el.input.addEventListener("input", function () {
      el.input.style.height = "auto";
      el.input.style.height = Math.min(el.input.scrollHeight, 96) + "px";
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) closePanel();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopPoll();
      else if (state.open && state.conversationId) {
        poll();
        startPoll();
      }
    });
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clockOf(v) {
    var d = v ? new Date(v) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function atBottom() {
    return el.body.scrollHeight - el.body.scrollTop - el.body.clientHeight < 60;
  }

  function toBottom() {
    el.body.scrollTop = el.body.scrollHeight;
  }

  function renderWelcome() {
    el.body.innerHTML =
      '<div class="lzc-welcome">' +
      "<h3>Hey, I'm the Lizimas Store assistant \uD83D\uDC4B</h3>" +
      "<p>Your smart shopping assistant. How can I help today?</p>" +
      "</div>";
    el.body.appendChild(topicMenu(false));
  }

  // sender_type may be customer, staff, system - and later ai. Anything not
  // recognised is drawn as an inbound message rather than dropped, so adding
  // a new type server-side cannot blank the thread.
  function renderMessage(m) {
    var type = String(m.sender_type || m.senderType || "").toLowerCase();
    var text = m.body != null ? m.body : (m.message != null ? m.message : "");
    var when = m.created_at || m.createdAt;

    if (type === "system") {
      var sys = document.createElement("div");
      sys.className = "lzc-sys";
      sys.textContent = text;
      return sys;
    }

    var mine = type === "customer";
    var d = document.createElement("div");
    d.className = "lzc-msg " + (mine ? "lzc-out" : "lzc-in");

    var who = "";
    if (!mine) {
      var name = m.staff_name || m.sender_name || m.assigned_staff_name;
      if (type === "ai" || (!name && type !== "staff")) who = "Assistant";
      else if (name) who = String(name).split(" ")[0];
    }

    d.innerHTML =
      (who ? '<div class="lzc-who">' + esc(who) + "</div>" : "") +
      esc(text) +
      '<div class="lzc-time">' + clockOf(when) + "</div>";
    return d;
  }

  function renderThread() {
    var stick = atBottom();
    el.body.innerHTML = "";
    state.messages.forEach(function (m) {
      el.body.appendChild(renderMessage(m));
    });
    if (stick) toBottom();
  }

  // Shown only when the customer asks for an agent. Nothing is gated before
  // that - a question never waits on a form. Once the AI tier lands this is
  // the handover point, and the details go to whoever picks up the thread.
  // Name and phone are required - the agent needs a way to follow up when the
  // customer closes the page mid-conversation. Email is optional because many
  // customers here do not have one to hand, and blocking on it would cost more
  // escalations than the address is worth.
  function contactCard() {
    var card = document.createElement("div");
    card.className = "lzc-note";
    card.innerHTML =
      "<h4>Contact information</h4>" +
      "<p>An agent will take over from here. We need these so they can reach " +
      "you if you leave this page.</p>" +
      '<label class="lzc-lab" for="lzc-name">Full name</label>' +
      '<input type="text" id="lzc-name" autocomplete="name" placeholder="Jane Nakato">' +
      '<label class="lzc-lab" for="lzc-phone">Phone number</label>' +
      '<input type="tel" id="lzc-phone" autocomplete="tel" placeholder="07XX XXX XXX">' +
      '<label class="lzc-lab" for="lzc-email">Email address <span class="lzc-opt">(optional)</span></label>' +
      '<div class="lzc-hint">Add your email to receive your order receipt and delivery updates.</div>' +
      '<input type="email" id="lzc-email" autocomplete="email" placeholder="you@example.com">' +
      '<div class="lzc-err" id="lzc-err"></div>' +
      '<button class="lzc-mini lzc-block" id="lzc-contact-save">Connect me to an agent</button>';

    var name = card.querySelector("#lzc-name");
    var phone = card.querySelector("#lzc-phone");
    var email = card.querySelector("#lzc-email");
    var err = card.querySelector("#lzc-err");
    var save = card.querySelector("#lzc-contact-save");

    function fail(field, msg) {
      err.textContent = msg;
      field.classList.add("lzc-bad");
      field.focus();
      return false;
    }

    function validate() {
      err.textContent = "";
      Array.prototype.forEach.call(card.querySelectorAll("input"), function (i) {
        i.classList.remove("lzc-bad");
      });

      var n = name.value.trim();
      var p = phone.value.replace(/[\s-]/g, "");
      var e = email.value.trim();

      if (n.length < 2) return fail(name, "Please enter your name.");
      // Loose on purpose - accepts 0770..., +256770..., 256770...
      if (!/^\+?\d{9,13}$/.test(p)) return fail(phone, "Enter a phone number we can call.");
      // Optional, but if given it has to be usable.
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
        return fail(email, "Enter a valid email address, or leave it blank.");
      }

      return { name: n, phone: p, email: e };
    }

    save.addEventListener("click", function () {
      var v = validate();
      if (!v) return;

      state.escalating = false;
      state.escalated = true;
      // Held so startWith can put these on the conversation record itself.
      // Without it the row is created as an anonymous "Website visitor" and
      // the inbox list shows no name or phone - staff would have to open
      // every thread and read the message body to know who is waiting.
      state.contact = v;
      card.remove();

      // Posted as a normal message so it lands in the transcript staff are
      // already reading. No extra endpoint for three fields.
      submit(
        "I would like to talk to an agent.\nName: " + v.name +
        "\nPhone: " + v.phone +
        (v.email ? "\nEmail: " + v.email : ""),
        true
      );
      note("Connecting you to an agent. Thanks for waiting.");
    });

    Array.prototype.forEach.call(card.querySelectorAll("input"), function (i) {
      i.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          save.click();
        }
      });
    });

    return card;
  }

  // A system line in the thread, used for handover and for errors.
  function note(text) {
    var d = document.createElement("div");
    d.className = "lzc-sys";
    d.textContent = text;
    el.body.appendChild(d);
    toBottom();
  }

  // The topic menu is the front door: it opens with the panel, and it is the
  // only route to a human. Most questions have a known answer, and answering
  // one in two seconds beats queueing for a staff member who is stocking
  // shelves. Only an answer that did not help reaches the contact form.
  // The heading is redundant directly under the welcome greeting, which has
  // already asked how it can help. It still earns its place when the menu
  // reappears later, after an answer failed, so it stays available.
  function topicMenu(heading) {
    var card = document.createElement("div");
    card.className = "lzc-note";

    var html = heading === false ? "" : "<h4>What do you need help with?</h4>";
    html += '<div class="lzc-chips lzc-chips--grid">';
    TOPICS.forEach(function (t, i) {
      html += '<button class="lzc-chip" data-topic="' + i + '">' + esc(t.label) + "</button>";
    });
    html += '<button class="lzc-chip lzc-chip--wide" data-topic="none">Something else</button>';
    html += "</div>";
    card.innerHTML = html;

    Array.prototype.forEach.call(card.querySelectorAll(".lzc-chip"), function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-topic");
        card.remove();
        if (key === "none") return showContactForm();
        answerTopic(TOPICS[parseInt(key, 10)]);
      });
    });

    return card;
  }

  function answerTopic(topic) {
    // The customer's choice goes into the thread as their own message, so the
    // transcript reads as a conversation and staff can see what was asked.
    state.messages.push({
      id: -Date.now(),
      sender_type: "customer",
      body: topic.label,
      local: true,
      created_at: new Date().toISOString()
    });
    state.messages.push({
      id: -Date.now() - 1,
      sender_type: "ai",
      body: topic.answer,
      local: true,
      created_at: new Date().toISOString()
    });
    renderThread();
    el.body.appendChild(followUp());
    toBottom();
  }

  // Two stages on purpose. Asking "did that answer it?" with three options
  // puts "talk to an agent" in front of someone whose question was already
  // answered. A plain yes or no first means only the people the answer failed
  // ever see the escalation route.
  function followUp() {
    var card = document.createElement("div");
    card.className = "lzc-note";
    card.innerHTML =
      "<h4>Did that answer it?</h4>" +
      '<div class="lzc-chips">' +
      '<button class="lzc-chip" data-ok="yes">Yes, thanks</button>' +
      '<button class="lzc-chip" data-ok="no">No</button>' +
      "</div>";

    Array.prototype.forEach.call(card.querySelectorAll(".lzc-chip"), function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-ok");
        card.remove();
        if (key === "yes") {
          state.escalating = false;
          note("Glad that helped. Type below any time if something else comes up.");
        } else {
          el.body.appendChild(nextStep());
          toBottom();
        }
      });
    });

    return card;
  }

  function nextStep() {
    var card = document.createElement("div");
    card.className = "lzc-note";
    card.innerHTML =
      "<h4>What would you like to do?</h4>" +
      '<div class="lzc-chips">' +
      '<button class="lzc-chip" data-go="menu">Ask about something else</button>' +
      '<button class="lzc-chip" data-go="agent">Talk to an agent</button>' +
      "</div>";

    Array.prototype.forEach.call(card.querySelectorAll(".lzc-chip"), function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-go");
        card.remove();
        if (key === "menu") {
          el.body.appendChild(topicMenu());
          toBottom();
        } else {
          showContactForm();
        }
      });
    });

    return card;
  }

  function showContactForm() {
    el.body.appendChild(contactCard());
    toBottom();
  }

  function setSubtitle() {
    if (state.status === "closed") {
      el.sub.textContent = "This conversation is closed";
    } else if (state.agentName) {
      el.sub.textContent = state.agentName + " is helping you";
    } else if (state.conversationId) {
      el.sub.textContent = "We usually reply within a few minutes";
    } else {
      el.sub.textContent = "Ask us anything about your order";
    }
  }

  function setBadge(n) {
    if (n > 0) {
      el.badge.textContent = n > 9 ? "9+" : String(n);
      el.badge.classList.add("lzc-on");
    } else {
      el.badge.classList.remove("lzc-on");
    }
  }

  // ---------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------

  function headers() {
    var h = { "Content-Type": "application/json" };
    if (state.token) h["X-Chat-Token"] = state.token;
    var jwt = store("token") || store("authToken");
    if (jwt) h["Authorization"] = "Bearer " + jwt;
    return h;
  }

  function api(path, opts) {
    opts = opts || {};
    return fetch(CFG.apiBase + path, {
      method: opts.method || "GET",
      headers: headers(),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.message || data.error || ("HTTP " + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  // Response shapes differ slightly between handlers, so pull the pieces out
  // rather than assuming one envelope.
  function pickConversation(data) {
    return data.conversation || data.data || data;
  }

  function pickMessages(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.messages)) return data.messages;
    if (data.data && Array.isArray(data.data.messages)) return data.data.messages;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  function submit(text, quiet) {
    text = String(text || "").trim();
    if (!text || state.sending || state.starting) return;

    if (!state.conversationId) return startWith(text);

    state.sending = true;
    el.send.disabled = true;

    // Optimistic - the message appears immediately and is reconciled by the
    // next poll, which is what makes the widget feel instant on a slow link.
    var temp = {
      id: -Date.now(),
      sender_type: "customer",
      body: text,
      created_at: new Date().toISOString()
    };
    state.messages.push(temp);
    renderThread();
    toBottom();

    api("/" + state.conversationId + "/messages", { method: "POST", body: { message: text, body: text } })
      .then(function () {
        state.lastActivity = Date.now();
        return poll();
      })
      .catch(function (err) {
        state.messages = state.messages.filter(function (m) { return m.id !== temp.id; });
        renderThread();
        showError(err);
      })
      .then(function () {
        state.sending = false;
        el.send.disabled = false;
        if (!quiet) el.input.focus();
      });
  }

  function startWith(text) {
    state.starting = true;
    el.send.disabled = true;

    var c = state.contact || {};
    var body = {
      message: text,
      name: c.name || "Website visitor",
      subject: "Website chat"
    };
    if (c.phone) body.phone = c.phone;
    if (c.email) body.email = c.email;

    api("/start", { method: "POST", body: body })
      .then(function (data) {
        var conv = pickConversation(data);
        state.conversationId = conv.id || conv.conversation_id;
        state.token = conv.guest_token || data.guest_token || data.token;

        if (!state.conversationId) throw new Error("No conversation id returned");

        store(CFG.convKey, String(state.conversationId));
        if (state.token) store(CFG.tokenKey, state.token);

        state.lastActivity = Date.now();
        state.starting = false;
        el.send.disabled = false;
        setSubtitle();
        return poll();
      })
      .then(function () {
        startPoll();
        toBottom();
      })
      .catch(function (err) {
        state.starting = false;
        el.send.disabled = false;
        showError(err);
      });
  }

  function showError(err) {
    note(err && err.status === 429
      ? "You have sent a lot of messages. Please wait a few minutes, or reach us on WhatsApp."
      : "That message did not send. Check your connection and try again.");
  }

  function poll() {
    if (!state.conversationId) return Promise.resolve();

    return api("/" + state.conversationId + "/messages?after=" + state.lastId)
      .then(function (data) {
        var incoming = pickMessages(data);
        var conv = data.conversation || {};

        if (conv.status) state.status = conv.status;
        var agent = conv.assigned_staff_name || conv.staff_name;
        if (agent && agent !== state.agentName) {
          state.agentName = agent;
          state.messages.push({
            sender_type: "system",
            body: String(agent).split(" ")[0] + " has joined the conversation",
            created_at: new Date().toISOString()
          });
        }

        if (incoming.length) {
          // Drop optimistic placeholders once the server copy arrives, but
          // keep locally-generated ones. The FAQ exchange never reaches the
          // server, so an id-only test would erase the whole conversation the
          // moment a real message came back - the customer would watch their
          // own history vanish.
          state.messages = state.messages.filter(function (m) {
            return m.id > 0 || m.local;
          });
          incoming.forEach(function (m) {
            if (m.id > state.lastId) state.lastId = m.id;
            var dup = state.messages.some(function (x) { return x.id === m.id; });
            if (!dup) state.messages.push(m);
          });
          state.lastActivity = Date.now();
          renderThread();

          var fromStaff = incoming.some(function (m) {
            return String(m.sender_type).toLowerCase() !== "customer";
          });
          if (fromStaff && !state.open) setBadge(incoming.length);
          if (fromStaff && state.open) markRead();
        }

        setSubtitle();
      })
      .catch(function () {
        // Silent. A failed poll is usually a dropped connection and the next
        // tick will recover; surfacing it would flood the thread with noise.
      });
  }

  function markRead() {
    if (!state.conversationId) return;
    api("/" + state.conversationId + "/read", { method: "POST" }).catch(function () {});
    setBadge(0);
  }

  function interval() {
    var recent = Date.now() - state.lastActivity < CFG.fastWindowMs;
    return recent ? CFG.pollFast : CFG.pollSlow;
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = setTimeout(function tick() {
      poll().then(function () {
        state.pollTimer = setTimeout(tick, interval());
      });
    }, interval());
  }

  function stopPoll() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function onSend() {
    var v = el.input.value;
    el.input.value = "";
    el.input.style.height = "auto";
    submit(v);
  }

  function openPanel() {
    state.open = true;
    el.panel.classList.add("lzc-on");
    el.launcher.classList.add("lzc-hidden");
    setBadge(0);

    if (state.conversationId) {
      renderThread();
      markRead();
      poll().then(toBottom);
      startPoll();
    } else {
      renderWelcome();
    }
    setSubtitle();
    setTimeout(function () { el.input.focus(); }, 60);
  }

  function closePanel() {
    state.open = false;
    el.panel.classList.remove("lzc-on");
    el.launcher.classList.remove("lzc-hidden");
    stopPoll();
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function init() {
    build();

    // Phone-only development has no JS console, so saved state is otherwise
    // impossible to clear. Loading any page with ?lzreset=1 wipes the stored
    // conversation and starts fresh at the topic menu. Harmless in production:
    // it only ever discards the visitor's own local handle on their own thread.
    if (/[?&]lzreset=1(&|$)/.test(window.location.search)) {
      store(CFG.convKey, null);
      store(CFG.tokenKey, null);
      return;
    }

    var savedId = store(CFG.convKey);
    var savedToken = store(CFG.tokenKey);
    if (savedId && savedToken) {
      state.conversationId = parseInt(savedId, 10) || null;
      state.token = savedToken;
      // Quiet catch-up so an unread badge is waiting if staff replied while
      // the customer was away.
      poll().then(function () {
        var unread = state.messages.filter(function (m) {
          return String(m.sender_type).toLowerCase() !== "customer";
        }).length;
        if (unread) setBadge(unread);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ---------------------------------------------------------------------
  // Public API
  //
  // Lets anything on the page drive the widget — a "Live chat" menu item,
  // a help-page button, a "still stuck?" prompt at checkout. Without this
  // the launcher bubble is the only way in.
  // ---------------------------------------------------------------------

  window.LzChat = {
    open: openPanel,
    close: closePanel,
    toggle: function () { state.open ? closePanel() : openPanel(); },
    // Drops the saved thread and starts clean at the topic menu.
    reset: function () {
      stopPoll();
      store(CFG.convKey, null);
      store(CFG.tokenKey, null);
      state.conversationId = null;
      state.token = null;
      state.messages = [];
      state.lastId = 0;
      el.body.innerHTML = "";
      renderWelcome();
    }
  };
})();
