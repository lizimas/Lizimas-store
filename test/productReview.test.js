const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../server/utils/productReview");

test("reject needs a reason; 'other' needs an explanation", () => {
    const p = { status: "pending", vendor_id: 3 };
    assert.equal(R.validateDecision(p, { action: "reject" }).ok, false);
    assert.equal(R.validateDecision(p, { action: "reject", reason_code: "other", reason_text: "x" }).ok, false);
    const ok = R.validateDecision(p, { action: "reject", reason_code: "poor_images", reason_text: "Photo 2 is dark." });
    assert.equal(ok.ok, true);
    assert.equal(ok.to, "rejected");
    assert.match(ok.vendorMessage, /blurry.*Photo 2 is dark\./);
});

test("request changes needs a note or reason; investigation needs an internal note", () => {
    const p = { status: "pending", vendor_id: 3 };
    assert.equal(R.validateDecision(p, { action: "request_changes" }).ok, false);
    assert.equal(R.validateDecision(p, { action: "request_changes", reason_text: "Add the capacity." }).to, "changes_requested");
    assert.equal(R.validateDecision(p, { action: "investigate" }).ok, false);
    assert.equal(R.validateDecision(p, { action: "investigate", reason_text: "Brand looks fake" }).to, "under_investigation");
});

test("allowed moves follow the status; drafts are for Lizimas' own products only", () => {
    assert.equal(R.validateDecision({ status: "approved" }, { action: "approve" }).ok, false);
    assert.equal(R.validateDecision({ status: "pending", vendor_id: 5 }, { action: "draft" }).ok, false);
    assert.equal(R.validateDecision({ status: "pending", vendor_id: null }, { action: "draft" }).to, "draft");
    assert.equal(R.validateDecision({ status: "pending" }, { action: "fly" }).ok, false);
    assert.equal(R.validateDecision({ status: "pending" }, { action: "reject", reason_code: "made_up" }).ok, false);
});

test("price flag: Too Low / Low / Normal / High / Too High / Unknown", () => {
    const j = { lowest: 38000, typical: 54500, highest: 89000 };
    assert.equal(R.marketFlag(132000, j).flag, "too_high");  // > 130% of highest
    assert.equal(R.marketFlag(75000, j).flag, "high");       // > 125% of typical
    assert.equal(R.marketFlag(56000, j).flag, "normal");
    assert.equal(R.marketFlag(42000, j).flag, "low");        // < 80% of typical
    assert.equal(R.marketFlag(25000, j).flag, "too_low");    // < 75% of lowest
    assert.equal(R.marketFlag(50000, {}).flag, "unknown");
    assert.equal(R.marketFlag(0, j).flag, "unknown");
    assert.equal(R.marketFlag(132000, j).diff_percent, 142);
    const s = R.priceStats([30000, 50000, 40000, 45000], 132000);
    assert.equal(s.enough, true);
    assert.deepEqual([s.lowest, s.typical, s.highest], [30000, 42500, 50000]);
    assert.equal(s.result.flag, "too_high");
    assert.equal(R.priceStats([1, 2], 5).enough, false);
});

test("both comparisons agreeing gives a stronger warning", () => {
    assert.match(R.combinedVerdict("high", "too_high").text, /Both .* high/);
    assert.match(R.combinedVerdict("too_low", "low").text, /Both .* low/);
    assert.equal(R.combinedVerdict("high", "normal"), null);
    assert.equal(R.combinedVerdict(undefined, "high"), null);
});

test("products from UGX 100,000 need a recent Jumia check before approval", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    assert.equal(R.needsMarketCheck(99000, null, now), false);
    assert.equal(R.needsMarketCheck(132000, null, now), true);
    assert.equal(R.needsMarketCheck(132000, "2026-09-20T00:00:00Z", now), false);
    assert.equal(R.needsMarketCheck(132000, "2026-08-01T00:00:00Z", now), true);
    const blocked = R.validateDecision({ status: "pending", price: 132000 }, { action: "approve", now });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Jumia prices/);
    assert.equal(R.validateDecision({ status: "pending", price: 132000, last_market_check_at: "2026-09-28T00:00:00Z" }, { action: "approve", now }).ok, true);
    assert.equal(R.validateDecision({ status: "pending", price: 50000 }, { action: "approve", now }).ok, true);
});

test("prices are read from a pasted results page", () => {
    const page = [
        "Thermal Bottle 570ml", "UGX 45,000", "UGX 60,000", "-25%",     // old price skipped
        "Vacuum Flask 500ml", "UGX 52,000",
        "Steel Bottle", "UGX 58,500", "4.5 out of 5",
        "Price (UGX)", "UGX 1,000 - UGX 900,000",                       // filter widget: outlier
        "Straw brush", "UGX 800"                                        // accessory: outlier
    ].join("\n");
    const r = R.parsePastedPrices(page);
    assert.deepEqual(r.prices, [45000, 52000, 58500]);
    assert.equal(r.typical, 52000);
    assert.equal(r.dropped, 2);
    assert.deepEqual(R.parsePastedPrices("USh 30,000\nShs 32 000\nnothing").prices, [30000, 32000]);
    assert.equal(R.parsePastedPrices("no prices here").prices.length, 0);
    assert.deepEqual(R.parsePastedPrices("UGX 45,000 4 reviews\nUGX 47,500 (12)\nUGX 50000").prices, [45000, 47500, 50000]);
});

test("margin from cost", () => {
    assert.deepEqual(R.margin(132000, 59976), { times: 2.2, percent: 55, profit: 72024 });
    assert.equal(R.margin(100, 0), null);
    assert.equal(R.margin(100, null), null);
});

test("key attribute and market search words", () => {
    assert.equal(R.keyAttribute("COCOSMILE Thermal Bottle with Cup Lid, 570ml"), "570ml");
    assert.equal(R.keyAttribute("Hisense 55 inch 4K Smart TV"), "55 inch");
    assert.equal(R.keyAttribute("Thermal Water Jug with Handle, 1L"), "1L");
    assert.equal(R.keyAttribute("Phone 128GB"), "128GB");
    const t = R.marketSearchTerm({ name: "COCOSMILE Thermal Water Bottle with Cup Lid, 570ml", brand: "COCOSMILE" });
    assert.equal(t, "COCOSMILE thermal water bottle cup 570ml");
    assert.equal(R.jumiaSearchUrl("a b"), "https://www.jumia.ug/catalog/?q=a+b");
    assert.ok(R.similarity("DUDU Water Bottle with Straw, 350ml", "DUDU Water Bottle with Straw, 530ml") > 0.9);
});

test("recorded market prices are checked", () => {
    assert.equal(R.validateMarketCheck({}).ok, false);
    assert.equal(R.validateMarketCheck({ typical_price: "40,000", lowest_price: "50000" }).ok, false);
    const v = R.validateMarketCheck({ lowest_price: "UGX 25,000", typical_price: "38000", highest_price: "60,000", product_count: "12" });
    assert.deepEqual([v.value.lowest_price, v.value.typical_price, v.value.highest_price, v.value.product_count], [25000, 38000, 60000, 12]);
});

test("a pasted list of SKUs is recognised; ordinary searches are not", () => {
    assert.deepEqual(R.parseSkuList("YD-8203, YD-8209\nyd-8210  YD-8203"), ["YD-8203", "YD-8209", "yd-8210"]);
    assert.deepEqual(R.parseSkuList("YD-8203 YD-8209"), ["YD-8203", "YD-8209"]);
    assert.equal(R.parseSkuList("YD-8203"), null);                       // one SKU: normal search
    assert.equal(R.parseSkuList("Thermal bottle 500ml"), null);          // words: name search
    assert.equal(R.parseSkuList("DUDU 350ml"), null);
    assert.deepEqual(R.parseSkuList("LS8HNP5ME312LZMS LSFKG4PUQ8DHLZMS"), ["LS8HNP5ME312LZMS", "LSFKG4PUQ8DHLZMS"]);
});
