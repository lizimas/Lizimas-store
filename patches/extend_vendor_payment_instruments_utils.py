import shutil, datetime, sys

path = "server/utils/vendorPaymentInstruments.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''module.exports = {
    METHODS,
    isValidMethod,
    INSTRUMENT_STATUSES,
    isValidInstrumentStatus,
    canVendorEditInstrument,
    expectedLegalName,
    normalizeName,
    namesMatch,
    NAME_MISMATCH_REASON,
    missingFieldsForMethod
};'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''// --- Evidence document extension (Ryan, Sept 2026, Jumia-parity) -----------
// migration 122 adds evidence_cloudinary_public_id (+ resource_type/format/
// filename/bytes/uploaded_at) directly on vendor_payment_instruments - one
// document per INSTRUMENT, not per vendor, since a vendor can hold several
// instruments (a MoMo account and a bank account) each needing its own
// specific proof. An instrument only needs a name-match to be CREATED
// (existing behavior, unchanged) but now also needs evidence on file
// before admin can approve it - enforced here, not by making evidence
// mandatory at creation, since the instrument has to exist first to
// attach a document to it.

function hasEvidence(instrument) {
    return Boolean(instrument && instrument.evidence_cloudinary_public_id);
}

// The gate reviewPaymentInstrumentAdmin checks before allowing 'approved'.
// Rejecting never requires evidence - an admin can reject an instrument
// with no evidence uploaded at all.
function canApprovePaymentInstrument(instrument) {
    return instrument
        && instrument.status === "pending"
        && hasEvidence(instrument);
}

module.exports = {
    METHODS,
    isValidMethod,
    INSTRUMENT_STATUSES,
    isValidInstrumentStatus,
    canVendorEditInstrument,
    expectedLegalName,
    normalizeName,
    namesMatch,
    NAME_MISMATCH_REASON,
    missingFieldsForMethod,
    hasEvidence,
    canApprovePaymentInstrument
};'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
