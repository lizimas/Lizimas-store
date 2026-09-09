// Pure logic for vendor storefront branding (Task #68) - the logo/banner/
// about a vendor sets themselves on their own public store page
// (client/store.html). No DB or Cloudinary access here - see
// server/controllers/vendorController.js's updateVendorStorefront for the
// wrapper that uploads images and writes vendors.logo_url/banner_url/about.

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

module.exports = { MAX_ABOUT_LENGTH, isValidAboutText };
