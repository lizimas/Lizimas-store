// Pure logic for Phase 8 - Prohibited Items (Ryan, Sept 2026). Admin
// maintains a list of prohibited keywords and/or entire prohibited
// categories; every product create/update is checked against the active
// list before it's allowed to save. See
// server/controllers/prohibitedItemsController.js for the admin CRUD and
// productController.js's addProduct/updateProduct for enforcement.

// Word-boundary-ish match: case-insensitive, and doesn't fire on a
// keyword that's merely a substring of an unrelated word ("gun" matching
// inside "fungus"). Deliberately simple (no stemming/fuzzy matching) -
// admin can always add close variants as separate keywords.
function normalizeForMatch(text) {
    return (text || "").toLowerCase();
}

function keywordMatches(text, keyword) {
    const normalizedText = normalizeForMatch(text);
    const normalizedKeyword = normalizeForMatch(keyword).trim();
    if (!normalizedKeyword) return false;
    // Escape regex metacharacters in the admin-entered keyword, then
    // require it not be embedded inside a larger word on either side.
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
    return pattern.test(` ${normalizedText} `);
}

// Checks one product's name/description/brand against every active
// keyword entry, and its category_id against every active category-ban
// entry. Returns { blocked, matches: [{type, keyword|category_id, reason}] } -
// every match that fired, not just the first, so admin (and the vendor-
// facing error) can see the full picture.
function checkProductAgainstProhibitedList(product, prohibitedItems) {
    const matches = [];
    const fieldsToCheck = [product.name, product.description, product.brand].filter(Boolean).join(" \n ");

    for (const entry of prohibitedItems || []) {
        if (entry.is_active === false) continue;

        if (entry.keyword && keywordMatches(fieldsToCheck, entry.keyword)) {
            matches.push({ type: "keyword", keyword: entry.keyword, reason: entry.reason });
        }
        if (entry.category_id && product.category_id && Number(entry.category_id) === Number(product.category_id)) {
            matches.push({ type: "category", category_id: entry.category_id, reason: entry.reason });
        }
    }

    return { blocked: matches.length > 0, matches };
}

function isValidProhibitedItemInput({ keyword, category_id }) {
    return Boolean((keyword && keyword.trim()) || category_id);
}

module.exports = {
    normalizeForMatch,
    keywordMatches,
    checkProductAgainstProhibitedList,
    isValidProhibitedItemInput
};
