import shutil, datetime, sys

path = "server/controllers/chatController.js"
with open(path) as f:
    content = f.read()

anchor1 = 'const { name, phone, email, subject, message } = req.body;'
anchor2 = '''        const conv = await client.query(
            `INSERT INTO chat_conversations
                 (customer_id, guest_token, guest_name, guest_phone, guest_email,
                  subject, status, staff_unread, last_message_at,
                  escalated_at, escalation_reason, last_customer_message_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'waiting', 1, CURRENT_TIMESTAMP,
                     CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP)
             RETURNING id, status, created_at`,
            [
                req.user ? currentUserId(req) : null,
                token,
                isGuest ? String(name).trim() : null,
                isGuest && phone ? String(phone).trim() : null,
                isGuest && email ? String(email).trim().slice(0, 255) : null,
                subject ? String(subject).trim().slice(0, 160) : null,
                reason
            ]
        );'''

c1 = content.count(anchor1)
c2 = content.count(anchor2)
if c1 != 1 or c2 != 1:
    print(f"ABORT: anchor1 found {c1}x (expected 1), anchor2 found {c2}x (expected 1). No changes made.")
    sys.exit(1)

replacement1 = '''const { name, phone, email, subject, message } = req.body;

    // Phase 1 routing: optional department chosen by the customer's category
    // picker. Omitted or invalid -> NULL, which keeps the conversation on
    // the original department-agnostic routing path in chatRouting.js --
    // an older/not-yet-updated client keeps working exactly as before.
    // (require() kept inline rather than moved to the top imports, since I
    // haven't seen this file's existing import block -- move it up if you'd
    // rather keep requires together.)
    const department = require("../lib/departments").isValidDepartment(req.body.department)
        ? req.body.department
        : null;'''

replacement2 = '''        const conv = await client.query(
            `INSERT INTO chat_conversations
                 (customer_id, guest_token, guest_name, guest_phone, guest_email,
                  subject, status, staff_unread, last_message_at,
                  escalated_at, escalation_reason, last_customer_message_at, department)
             VALUES ($1, $2, $3, $4, $5, $6, 'waiting', 1, CURRENT_TIMESTAMP,
                     CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP, $8)
             RETURNING id, status, created_at`,
            [
                req.user ? currentUserId(req) : null,
                token,
                isGuest ? String(name).trim() : null,
                isGuest && phone ? String(phone).trim() : null,
                isGuest && email ? String(email).trim().slice(0, 255) : null,
                subject ? String(subject).trim().slice(0, 160) : null,
                reason,
                department
            ]
        );'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor1, replacement1, 1)
content = content.replace(anchor2, replacement2, 1)
with open(path, "w") as f:
    f.write(content)
print("Patched both anchors. Backup at " + backup)
