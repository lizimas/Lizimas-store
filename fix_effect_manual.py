import re
import shutil
from datetime import datetime

PATH = "server/payments/service.js"
BACKUP = f"{PATH}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

with open(PATH, 'r') as f:
    src = f.read()

# Find and replace the effect block
old_effect = '''    return [
      async () => {
        await sendOrderConfirmationEmail({
          orderId: order.id,
          receiptNumber,
          paymentId: payment.id,
        });
      },
    ];'''

# We need to fetch items and build receiptUrl inside the effect
new_effect = '''    // Fetch line items for the email (same transaction snapshot)
    const { rows: items } = await client.query(
      `SELECT product_name, quantity, price
         FROM order_items
        WHERE order_id = $1
        ORDER BY id`,
      [payment.order_id]
    );

    // Generate signed receipt URL
    const receiptUrl = `https://lizimasstore.com/receipt/${order.id}?t=${signReceipt(order.id)}`;

    return [
      // Runs after commit. Email sends outside the transaction.
      async () => {
        await sendOrderConfirmationEmail(
          order.customer_email || 'sentzalizimas@gmail.com',
          order,
          items,
          receiptUrl
        );
      },
    ];'''

if old_effect not in src:
    print("❌ Old effect not found. Check the exact code.")
    print("Looking for:", old_effect[:100] + "...")
    exit(1)

src = src.replace(old_effect, new_effect)

# Also ensure signReceipt is imported
if 'signReceipt' not in src:
    # Find the imports section
    import_line = "const { logActivity } = require('../utils/activityLog');"
    if import_line in src:
        src = src.replace(
            import_line,
            import_line + '\nconst { sign: signReceipt } = require(\'../routes/receipt\');'
        )
        print("✅ Added signReceipt import")

shutil.copy2(PATH, BACKUP)
with open(PATH, 'w') as f:
    f.write(src)

print(f"✅ Fixed email effect with correct signature")
print(f"📁 Backup: {BACKUP}")
