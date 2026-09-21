import shutil, datetime, sys

path = "client/js/lz-chat.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# 1. TOPICS: add a department key to each existing entry, and add the new
#    DEPARTMENTS list (must match server/lib/departments.js -- no shared
#    bundle between browser and server code here, so keep these two lists
#    in sync by hand if you ever add/rename a department).
anchors.append((
'''  var TOPICS = [
    {
      label: "Delivery",
      answer:
        "We deliver between 08:00 and 18:00.\\n\\n" +
        "Kampala: same day or next day.\\n" +
        "Upcountry: 2 to 3 days.\\n\\n" +
        "Delivery fees depend on distance and are shown at checkout before you pay."
    },
    {
      label: "Returns",
      answer:
        "You have 7 days from delivery to return an item.\\n\\n" +
        "It should be unused and in its original packaging. Tell us the order " +
        "number and what went wrong, and we will arrange the return."
    },
    {
      label: "Payments",
      answer:
        "We accept MTN Mobile Money and cash on delivery.\\n\\n" +
        "You choose your payment method at checkout."
    },
    {
      label: "Track order",
      answer:
        "Sign in and open My Orders to see the current status of anything you " +
        "have ordered.\\n\\n" +
        "If you checked out as a guest, send us your order number here and we " +
        "will look it up."
    }
  ];''',
'''  var TOPICS = [
    {
      label: "Delivery",
      department: "delivery",
      answer:
        "We deliver between 08:00 and 18:00.\\n\\n" +
        "Kampala: same day or next day.\\n" +
        "Upcountry: 2 to 3 days.\\n\\n" +
        "Delivery fees depend on distance and are shown at checkout before you pay."
    },
    {
      label: "Returns",
      department: "returns_refunds",
      answer:
        "You have 7 days from delivery to return an item.\\n\\n" +
        "It should be unused and in its original packaging. Tell us the order " +
        "number and what went wrong, and we will arrange the return."
    },
    {
      label: "Payments",
      department: "orders_payments",
      answer:
        "We accept MTN Mobile Money and cash on delivery.\\n\\n" +
        "You choose your payment method at checkout."
    },
    {
      label: "Track order",
      department: "orders_payments",
      answer:
        "Sign in and open My Orders to see the current status of anything you " +
        "have ordered.\\n\\n" +
        "If you checked out as a guest, send us your order number here and we " +
        "will look it up."
    }
  ];

  // Must match server/lib/departments.js exactly -- there is no shared
  // bundle between browser and server code here, so keep these two lists
  // in sync by hand if you ever add, rename, or remove a department.
  var DEPARTMENTS = [
    { key: "orders_payments", label: "Orders & Payments", emoji: "\U0001F6D2" },
    { key: "delivery", label: "Delivery", emoji: "\U0001F69A" },
    { key: "product_info", label: "Product Information", emoji: "\U0001F4E6" },
    { key: "returns_refunds", label: "Returns & Refunds", emoji: "\u21A9\uFE0F" },
    { key: "account_login", label: "Account & Login", emoji: "\U0001F510" },
    { key: "technical", label: "Technical Support", emoji: "\U0001F6E0\uFE0F" },
    { key: "general", label: "General Question", emoji: "\U0001F4AC" }
  ];'''
))

# 2. Insert a small helper that builds the <option> list, right before
#    contactCard() -- pre-selects state.suggestedDepartment if one was set
#    by answerTopic() (change 5), but the customer can always change it.
anchors.append((
'''  function contactCard() {
    var card = document.createElement("div");''',
'''  function departmentOptionsHtml() {
    var suggested = state.suggestedDepartment || "";
    var html = suggested ? "" : '<option value="">Select a topic (optional)</option>';
    html += DEPARTMENTS.map(function (d) {
      var sel = d.key === suggested ? " selected" : "";
      return '<option value="' + d.key + '"' + sel + '>' + d.emoji + ' ' + d.label + '</option>';
    }).join("");
    return html;
  }

  function contactCard() {
    var card = document.createElement("div");'''
))

# 3. Add the department <select> to the contact form itself, right after
#    the intro paragraph and before the name field.
anchors.append((
'''    card.innerHTML =
      "<h4>Contact information</h4>" +
      "<p>An agent will take over from here. We need these so they can reach " +
      "you if you leave this page.</p>" +
      '<label class="lzc-lab" for="lzc-name">Full name</label>' +''',
'''    card.innerHTML =
      "<h4>Contact information</h4>" +
      "<p>An agent will take over from here. We need these so they can reach " +
      "you if you leave this page.</p>" +
      '<label class="lzc-lab" for="lzc-department">What is this about?</label>' +
      '<select id="lzc-department">' + departmentOptionsHtml() + '</select>' +
      '<label class="lzc-lab" for="lzc-name">Full name</label>' +'''
))

# 4. Capture the picked department alongside name/phone/email.
anchors.append((
'''      return { name: n, phone: p, email: e };
    }''',
'''      var dept = card.querySelector("#lzc-department");
      return { name: n, phone: p, email: e, department: dept ? dept.value : "" };
    }'''
))

# 5. Suggest a department from whichever FAQ topic the customer clicked,
#    if any -- confirmed/changeable by them in the contact form (change 3).
anchors.append((
'''  function answerTopic(topic) {
    // The customer's choice goes into the thread as their own message, so the
    // transcript reads as a conversation and staff can see what was asked.
    // Travels with the escalation so the agent opens the chat already
    // knowing what was asked and what the customer was told.
    state.faqTrail = (state.faqTrail || []).concat({''',
'''  function answerTopic(topic) {
    // Suggests (does not force) a department for the contact form, in case
    // the customer reaches it later via "No" -> "Talk to an agent". They
    // can still change it there.
    state.suggestedDepartment = topic.department || null;

    // The customer's choice goes into the thread as their own message, so the
    // transcript reads as a conversation and staff can see what was asked.
    // Travels with the escalation so the agent opens the chat already
    // knowing what was asked and what the customer was told.
    state.faqTrail = (state.faqTrail || []).concat({'''
))

# 6. Actually send it to the backend.
anchors.append((
'''    if (c.phone) body.phone = c.phone;
    if (c.email) body.email = c.email;

    api("/start", { method: "POST", body: body })''',
'''    if (c.phone) body.phone = c.phone;
    if (c.email) body.email = c.email;
    if (c.department) body.department = c.department;

    api("/start", { method: "POST", body: body })'''
))

problems = []
for i, (old, new) in enumerate(anchors, 1):
    n = content.count(old)
    if n != 1:
        problems.append(f"  anchor {i}: found {n}x (expected 1)")

if problems:
    print("ABORT: one or more anchors did not match exactly once. No changes made.")
    print("\n".join(problems))
    sys.exit(1)

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)

for old, new in anchors:
    content = content.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Patched all {len(anchors)} anchors. Backup at " + backup)
