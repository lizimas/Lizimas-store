// Pure logic for Phase 5 - Payment Instrument Approval (Ryan, Sept 2026 -
// modelled on Jumia's Vendor Center: a payment instrument must belong to
// the vendor under their own verified legal name before it can ever
// receive a payout). No DB/network here - see
// server/controllers/vendorPaymentInstrumentsController.js for the
// wrapper that reads/writes vendor_payment_instruments.
//
// The whole point of this feature: today the payout guard only checks
// KYC STATUS (is this vendor verified), never WHERE the money is going. A
// vendor whose KYC is fully verified could still swap their MoMo number to
// someone else's account, and the next statement would pay that account
// without question. This closes that gap with a name-match rule plus an
// edit lock once an instrument is in play.

const METHODS = ["momo", "bank"];

function isValidMethod(method) {
    return METHODS.includes(method);
}

const INSTRUMENT_STATUSES = ["pending", "approved", "rejected"];

function isValidInstrumentStatus(status) {
    return INSTRUMENT_STATUSES.includes(status);
}

// Once pending or approved, an instrument is locked - a compromised
// session (or an honest mistake) can't silently swap the account number
// on something already in the approval queue or already trusted. Only a
// rejected instrument can be edited and resubmitted.
function canVendorEditInstrument(status) {
    return status === "rejected";
}

// Which legal name a submitted account_holder_name must match, per
// account type. Individual vendors don't have a separate "name on file"
// beyond their own account name (vendor_kyc stores an ID NUMBER, not a
// name) - so this is the user's registered name. Company vendors match
// against the registered business name, same legal-identity boundary
// vendor_kyc itself draws for URSB verification.
function expectedLegalName({ accountType, businessName, ownerName }) {
    return accountType === "company" ? businessName : ownerName;
}

// Normalize before comparing: case-insensitive, whitespace-collapsed,
// common punctuation stripped (a bank teller typing "O'Brien" vs "OBrien",
// or extra spaces from a form field) - but NOT a fuzzy/partial match.
// This is a fraud control, not an autocomplete; a normalized EXACT match
// is the bar, deliberately, so "John Okello" is never accepted against a
// legal name of "John Okello Mukasa".
function normalizeName(name) {
    return (name || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

function namesMatch(a, b) {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return false;
    return na === nb;
}

const NAME_MISMATCH_REASON = "Beneficiary name does not match your verified legal name.";

// Required fields per method - checked before an instrument is even
// created, independent of the name-match rule.
function missingFieldsForMethod(method, fields) {
    const missing = [];
    if (!fields.account_holder_name || !fields.account_holder_name.trim()) missing.push("account_holder_name");
    if (method === "momo") {
        if (!fields.momo_number || !fields.momo_number.trim()) missing.push("momo_number");
    } else if (method === "bank") {
        if (!fields.bank_name || !fields.bank_name.trim()) missing.push("bank_name");
        if (!fields.account_number || !fields.account_number.trim()) missing.push("account_number");
    }
    return missing;
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
    missingFieldsForMethod
};
