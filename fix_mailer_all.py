import re
import shutil
from datetime import datetime

PATH = "server/utils/mailer.js"
BACKUP = f"{PATH}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

with open(PATH, 'r') as f:
    src = f.read()

# Fix all occurrences of order.customer_name with safe fallback
# Pattern 1: ${order.customer_name} in template strings
src = re.sub(
    r'\$\{order\.customer_name\}',
    '${order.customer_name || order.customer_email || "Customer"}',
    src
)

# Pattern 2: order.customer_name directly in text (not in template)
src = re.sub(
    r'order\.customer_name(?!\s*\|\|)',
    'order.customer_name || order.customer_email || "Customer"',
    src
)

# Pattern 3: In JSDoc comment, keep as-is (don't modify)

shutil.copy2(PATH, BACKUP)
with open(PATH, 'w') as f:
    f.write(src)

print(f"✅ Fixed all order.customer_name references with fallback")
print(f"📁 Backup: {BACKUP}")
