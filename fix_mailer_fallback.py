import re
import shutil
from datetime import datetime

PATH = "server/utils/mailer.js"
BACKUP = f"{PATH}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

with open(PATH, 'r') as f:
    src = f.read()

# Replace order.customer_name with a safe fallback
# Using a template literal that handles undefined
old = '${escHtml(order.customer_name)}'
new = '${escHtml(order.customer_name || order.customer_email || "Customer")}'

if old not in src:
    print(f"❌ Could not find '{old}' in mailer.js")
    exit(1)

src = src.replace(old, new)

shutil.copy2(PATH, BACKUP)
with open(PATH, 'w') as f:
    f.write(src)

print(f"✅ Fixed mailer fallback: {old} → {new}")
print(f"📁 Backup: {BACKUP}")
