// Pure logic for vendor storefront branding (Task #68) - the logo/banner/
// about a vendor sets themselves on their own public store page
// (client/store.html). No DB or Cloudinary access here - see
// server/controllers/vendorController.js's updateVendorStorefront for the
// wrapper that writes vendors.about/delivery_method.

// Matches the layout the storefront page's about section is built for -
// a short bio, not a full page of text. Flagged as a starting point, not
// a settled rule, same spirit as every other tunable default in this
// codebase (MIN_PAYOUT_UGX, MAX_VENDOR_DISCOUNT_PERCENT, ...).
const MAX_ABOUT_LENGTH = 1000;

// Empty/missing about text is always valid - it just means "no bio yet"
// (or "clear the bio" on an update). Anything present just can't run past
// the length cap.
function isValidAboutText(text) {
    if (text === undefined || text === null || text === "") return true;
    return typeof text === "string" && text.length <= MAX_ABOUT_LENGTH;
}

// --- Delivery/payment method badge (Task #74) ------------------------------
// How a vendor fulfils orders, vendor-set from their dashboard, shown next
// to the business name on the public storefront. See PENDING.md - kept to
// two options on purpose (no "negotiable"/free text) since the whole point
// is a customer can read it at a glance, the same reason it isn't a bio
// field.
const DELIVERY_METHODS = ["cash_on_delivery", "payment_first"];

// Unlike about text, there's no valid non-empty-string "clear" state here
// distinct from null - a vendor either has a method on file or doesn't.
function isValidDeliveryMethod(value) {
    if (value === undefined || value === null) return true;
    return DELIVERY_METHODS.includes(value);
}

// --- Storefront bio content filter (Task #75) -------------------------------
// The public "about" bio must not become a way for a vendor to route
// customers around the platform - a phone number, a "message me on
// WhatsApp instead", or a physical address all do that. See PENDING.md
// ("Storefront bio content filter") for the policy and its known limits:
// this is a best-effort keyword/pattern filter, not a guarantee - it will
// not catch every way someone might spell out a number or describe a
// location in words, and isn't meant to replace admin review.
//
// Phone patterns cover the common written forms of a Ugandan mobile
// number: 07XXXXXXXX, +256 7XX XXX XXX, 256XXXXXXXXX, and the bare 9-digit
// subscriber number without the leading 0, each allowing spaces/dots/
// dashes as separators. Deliberately anchored on a leading 0/+256/256 (or
// exactly 9 digits starting with 7) rather than "any long digit run", so a
// price like "UGX 1,500,000" in a bio doesn't false-positive.
const PHONE_PATTERN =
    /(\+?256[\s.-]?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3})|(\b0[1-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b)|(\b7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b)/;

// Explicit "reach me off-platform" phrasing, even without a number attached.
const CONTACT_KEYWORD_PATTERN =
    /\b(whatsapp|wa\.me|t\.me|telegram|call me|contact me\s*(on|at)?|reach me\s*(on|at)?|dm me|text me|message me\s*(on|at)?)\b/i;

// Explicit address/location phrasing - plot/shop numbers, "located at",
// "find/visit us at", or raw GPS-style coordinates. Does not attempt to
// catch an indirect description ("behind the big mosque past the
// roundabout") - see the module comment above.
const ADDRESS_PATTERN =
    /\b(plot\s*(no\.?|number)?\s*\d+|shop\s*(no\.?|number)?\s*\d+|located\s+at|find\s+us\s+at|visit\s+us\s+at|our\s+(shop|store|office)\s+is\s+(at|located))\b/i;
const GPS_PATTERN = /-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;

// Returns a short, vendor-facing reason string if `text` trips the filter,
// or null if it's clean. Checked at write time in updateVendorStorefront -
// the update is rejected outright (not silently stripped/redacted) so the
// vendor sees exactly why and can rewrite it themselves.
function findStorefrontContactViolation(text) {
    if (!text || typeof text !== "string") return null;
    if (PHONE_PATTERN.test(text)) return "a phone number";
    if (CONTACT_KEYWORD_PATTERN.test(text)) return "a request to contact you outside Lizimas Store";
    if (ADDRESS_PATTERN.test(text) || GPS_PATTERN.test(text)) return "a store address or location";
    return null;
}

module.exports = {
    MAX_ABOUT_LENGTH,
    isValidAboutText,
    DELIVERY_METHODS,
    isValidDeliveryMethod,
    findStorefrontContactViolation
};
