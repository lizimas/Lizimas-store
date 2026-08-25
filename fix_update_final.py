import re
import shutil
from datetime import datetime

PATH = "server/payments/service.js"
BACKUP = f"{PATH}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

with open(PATH, 'r') as f:
    lines = f.readlines()

# Find the UPDATE block (lines 8-13 in the sed output)
# We need to:
# 1. Remove the comma after the CASE statement (line 11)
# 2. Change 'pending_payment' to 'pending' (line 11)
# 3. Fix indentation of WHERE (line 12)

fixed_lines = []
in_update = False
update_started = False

for i, line in enumerate(lines):
    if '`UPDATE orders' in line:
        in_update = True
        update_started = True
    
    if in_update:
        # Fix the CASE line - remove trailing comma and change pending_payment
        if 'status      = CASE WHEN status =' in line:
            line = line.replace("'pending_payment'", "'pending'")
            line = line.rstrip().rstrip(',') + ',\n'  # Keep the comma at end of line
        
        # Fix WHERE line - ensure proper indentation
        if 'WHERE id = $1' in line:
            line = '        WHERE id = $1\n'
            in_update = False
        
        # Fix RETURNING line
        if 'RETURNING *`' in line:
            line = '        RETURNING *`,\n'
            in_update = False
    
    fixed_lines.append(line)

# Alternative approach: direct string replace
src = ''.join(fixed_lines)

# Also do a direct replace as safety
src = src.replace(
    "status      = CASE WHEN status = 'pending_payment' THEN 'paid' ELSE status END,",
    "status      = CASE WHEN status = 'pending' THEN 'paid' ELSE status END"
)

# Remove the comma before WHERE using regex
src = re.sub(
    r'END,\s*\n\s+WHERE',
    'END\n        WHERE',
    src
)

shutil.copy2(PATH, BACKUP)
with open(PATH, 'w') as f:
    f.write(src)

print(f"✅ Fixed UPDATE block in {PATH}")
print(f"📁 Backup: {BACKUP}")
