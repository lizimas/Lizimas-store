// Phase 8 - Prohibited Items. Pure-logic tests for
// server/utils/prohibitedItems.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    keywordMatches,
    checkProductAgainstProhibitedList,
    isValidProhibitedItemInput
} = require("../server/utils/prohibitedItems.js");

test("keywordMatches is case-insensitive", () => {
    assert.equal(keywordMatches("A Loaded Pistol for sale", "pistol"), true);
    assert.equal(keywordMatches("a loaded PISTOL for sale", "Pistol"), true);
});

test("keywordMatches requires a word boundary, not a bare substring", () => {
    // "gun" should not match inside "fungus" or "shotgunner"
    assert.equal(keywordMatches("A fungus among us", "gun"), false);
    assert.equal(keywordMatches("Professional shotgunner's glove", "gun"), false);
    assert.equal(keywordMatches("A gun safe (empty)", "gun"), true);
});

test("keywordMatches works at the start/end of the text", () => {
    assert.equal(keywordMatches("Machete for gardening", "machete"), true);
    assert.equal(keywordMatches("Genuine leather machete", "machete"), true);
});

test("keywordMatches escapes regex metacharacters in the keyword safely", () => {
    assert.equal(keywordMatches("Buy 2 get 1 free (limited)", "2 get 1"), true);
    assert.doesNotThrow(() => keywordMatches("some text", "a+b*c?"));
});

test("keywordMatches: empty/whitespace keyword never matches anything", () => {
    assert.equal(keywordMatches("anything at all", ""), false);
    assert.equal(keywordMatches("anything at all", "   "), false);
});

test("checkProductAgainstProhibitedList: flags a keyword match across name/description/brand", () => {
    const product = { name: "Tactical Knife Set", description: "For camping", brand: "Generic", category_id: 5 };
    const list = [{ keyword: "knife", reason: "Weapons are not allowed on Lizimas.", is_active: true }];
    const result = checkProductAgainstProhibitedList(product, list);
    assert.equal(result.blocked, true);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].type, "keyword");
});

test("checkProductAgainstProhibitedList: flags a category-wide ban", () => {
    const product = { name: "Anything", description: "", brand: "", category_id: 42 };
    const list = [{ category_id: 42, reason: "This entire category is banned.", is_active: true }];
    const result = checkProductAgainstProhibitedList(product, list);
    assert.equal(result.blocked, true);
    assert.equal(result.matches[0].type, "category");
});

test("checkProductAgainstProhibitedList: ignores inactive entries", () => {
    const product = { name: "Knife Set", description: "", brand: "", category_id: 5 };
    const list = [{ keyword: "knife", reason: "test", is_active: false }];
    const result = checkProductAgainstProhibitedList(product, list);
    assert.equal(result.blocked, false);
});

test("checkProductAgainstProhibitedList: a clean product against a real list is not blocked", () => {
    const product = { name: "Cotton T-Shirt", description: "Soft and breathable", brand: "Lizimas Basics", category_id: 3 };
    const list = [
        { keyword: "firearm", reason: "Weapons", is_active: true },
        { keyword: "narcotic", reason: "Drugs", is_active: true },
        { category_id: 99, reason: "Banned category", is_active: true }
    ];
    const result = checkProductAgainstProhibitedList(product, list);
    assert.equal(result.blocked, false);
    assert.deepEqual(result.matches, []);
});

test("checkProductAgainstProhibitedList: reports every match, not just the first", () => {
    const product = { name: "Knife and Gun Combo Set", description: "", brand: "", category_id: 7 };
    const list = [
        { keyword: "knife", reason: "Weapons", is_active: true },
        { keyword: "gun", reason: "Weapons", is_active: true }
    ];
    const result = checkProductAgainstProhibitedList(product, list);
    assert.equal(result.matches.length, 2);
});

test("isValidProhibitedItemInput: requires a keyword or a category, not neither", () => {
    assert.equal(isValidProhibitedItemInput({ keyword: "gun" }), true);
    assert.equal(isValidProhibitedItemInput({ category_id: 5 }), true);
    assert.equal(isValidProhibitedItemInput({ keyword: "  " }), false);
    assert.equal(isValidProhibitedItemInput({}), false);
});
