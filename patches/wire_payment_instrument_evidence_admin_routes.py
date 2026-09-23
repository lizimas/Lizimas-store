import shutil, datetime, sys

path = "server/routes/admin.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

anchors.append((
'''const {
    listPaymentInstrumentsAdmin,
    reviewPaymentInstrumentAdmin
} = require("../controllers/vendorPaymentInstrumentsController");''',
'''const {
    listPaymentInstrumentsAdmin,
    reviewPaymentInstrumentAdmin,
    getPaymentInstrumentEvidenceUrlAdmin
} = require("../controllers/vendorPaymentInstrumentsController");'''
))

anchors.append((
'''router.get("/payment-instruments", listPaymentInstrumentsAdmin);
router.patch("/payment-instruments/:id/review", reviewPaymentInstrumentAdmin);''',
'''router.get("/payment-instruments", listPaymentInstrumentsAdmin);
router.patch("/payment-instruments/:id/review", reviewPaymentInstrumentAdmin);
router.get("/payment-instruments/:id/evidence/url", getPaymentInstrumentEvidenceUrlAdmin);'''
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
