import re
import shutil
from datetime import datetime

PATH = "server/payments/service.js"
BACKUP = f"{PATH}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

with open(PATH, 'r') as f:
    src = f.read()

# Fix the UPDATE block:
# 1. Remove trailing comma before WHERE
# 2. Change 'pending_payment' to 'pending'
# 3. Ensure WHERE is on its own line with proper indentation

old_block = '''      `UPDATE orders
          SET amount_paid = COALESCE(amount_paid, 0) + $2,
              paid_at     = COALESCE(paid_at, NOW()),
              status      = CASE WHEN status = 'pending_payment' THEN 'paid' ELSE status END,
        WHERE id = $1
        RETURNING *`,'''

new_block = '''      `UPDATE orders
          SET amount_paid = COALESCE(amount_paid, 0) + $2,
              paid_at     = COALESCE(paid_at, NOW()),
              status      = CASE WHEN status = 'pending' THEN 'paid' ELSE status END
        WHERE id = $1
        RETURNING *`,'''


if old_block not in src:
    print("❌ Old block not found. Search manually.")
    exit(1)

patched = src.replace(old_block, new_block, 1)

shutil.copy2(PATH, BACKUP)
with open(PATH, 'w') as f:
    f.write(patched)

print(f"✅ Fixed UPDATE block in {PATH}")
print(f"📁 Backup: {BACKUP}")
