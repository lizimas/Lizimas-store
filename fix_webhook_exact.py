import re
import shutil
from datetime import datetime

PATH = "server/routes/paymentWebhook.js"
BACKUP = f"{PATH}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

with open(PATH, 'r') as f:
    src = f.read()

old_block = '''      const dedupe = await client.query(
        `INSERT INTO payment_events (provider, event_key, source, headers, body)
         VALUES ($1, $2, 'webhook', $3, $4)
         ON CONFLICT (provider, event_key) DO NOTHING
         RETURNING id`,
        [provider.name, eventKey, JSON.stringify(safeHeaders(req.headers)), JSON.stringify(body)]
      );
      if (dedupe.rowCount === 0) {
        return res.status(200).json({ ok: true, duplicate: true });
      }'''

new_block = '''      // Check for existing event to avoid duplicate processing (append-only rules prevent ON CONFLICT)
      const existing = await client.query(
        `SELECT id FROM payment_events
         WHERE provider = $1 AND event_key = $2`,
        [provider.name, eventKey]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      // Insert the new event
      await client.query(
        `INSERT INTO payment_events (provider, event_key, source, headers, body)
         VALUES ($1, $2, 'webhook', $3, $4)`,
        [provider.name, eventKey, JSON.stringify(safeHeaders(req.headers)), JSON.stringify(body)]
      );'''

if old_block not in src:
    print("❌ Exact old block not found. Check the file manually.")
    exit(1)

patched = src.replace(old_block, new_block, 1)

shutil.copy2(PATH, BACKUP)
with open(PATH, 'w') as f:
    f.write(patched)

print(f"✅ Patched {PATH}")
print(f"📁 Backup: {BACKUP}")
print("Run: node --check server/routes/paymentWebhook.js")
