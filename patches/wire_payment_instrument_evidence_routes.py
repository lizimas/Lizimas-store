import shutil, datetime, sys

path = "server/routes/vendors.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

anchors.append((
'''const {
    getMyPaymentInstruments,
    addMyPaymentInstrument,
    updateMyPaymentInstrument,
    setPreferredPaymentInstrument
} = require("../controllers/vendorPaymentInstrumentsController");''',
'''const {
    getMyPaymentInstruments,
    addMyPaymentInstrument,
    updateMyPaymentInstrument,
    setPreferredPaymentInstrument,
    uploadMyPaymentInstrumentEvidence,
    getMyPaymentInstrumentEvidenceUrl
} = require("../controllers/vendorPaymentInstrumentsController");'''
))

anchors.append((
'''router.get("/me/payment-instruments", getMyPaymentInstruments);
router.post("/me/payment-instruments", addMyPaymentInstrument);
router.patch("/me/payment-instruments/:id", updateMyPaymentInstrument);
router.patch("/me/payment-instruments/preferred", setPreferredPaymentInstrument);''',
'''router.get("/me/payment-instruments", getMyPaymentInstruments);
router.post("/me/payment-instruments", addMyPaymentInstrument);
router.patch("/me/payment-instruments/:id", updateMyPaymentInstrument);
router.patch("/me/payment-instruments/preferred", setPreferredPaymentInstrument);
router.post("/me/payment-instruments/:id/evidence", upload.kycDocument.single("document"), uploadMyPaymentInstrumentEvidence);
router.get("/me/payment-instruments/:id/evidence/url", getMyPaymentInstrumentEvidenceUrl);'''
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
