const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../client/js/lz-id-ocr");

const NOW = "2026-09-29T09:00:00Z";
// ICAO 9303 specimen lines (public example document "UTOPIA", expired 2012).
const TD3 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
const TD1 = "I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<";

// A future passport MRZ line 2 with correct check digits.
function td3Line2(num, birth, expiry) {
    const n = (num + "<<<<<<<<<").slice(0, 9);
    return n + O.checkDigit(n) + "UGA" + birth + O.checkDigit(birth) + "M" + expiry + O.checkDigit(expiry) + "<<<<<<<<<<<<<<<0";
}
const passportText = (line2, extra = "") => `REPUBLIC OF UGANDA\nPASSPORT\nSurname TESTPERSON\nGiven names SAMPLE\n${extra}\nP<UGATESTPERSON<<SAMPLE<<<<<<<<<<<<<<<<<<<<<\n${line2}`;

test("MRZ check digits (ICAO specimens)", () => {
    const p = O.parseMrz(TD3);
    assert.deepEqual([p.format, p.kind, p.expiry, p.expiryChecked, p.number, p.numberChecked], ["TD3", "passport", "2012-04-15", true, "L898902C3", true]);
    const i = O.parseMrz(TD1);
    assert.deepEqual([i.format, i.kind, i.expiry, i.expiryChecked, i.number, i.numberChecked], ["TD1", "national_id", "2012-04-15", true, "D23145890", true]);
});

test("expired document is rejected from the MRZ", () => {
    const r = O.analyze("PASSPORT\nSURNAME ERIKSSON GIVEN NAMES ANNA MARIA\n" + TD3, 85, { kind: "passport", number: "L898902C3", expires: "2030-01-01" }, NOW);
    assert.equal(r.ok, false); assert.equal(r.errors[0].code, "expired");
    assert.match(r.message, /This document has expired/);
});

test("valid passport: everything matches, no notes", () => {
    const r = O.analyze(passportText(td3Line2("A1234567", "900101", "310101")), 88, { kind: "passport", number: "A1234567", expires: "2031-01-01" }, NOW);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.warnings, []);
    assert.equal(r.summary.expiry_from, "machine-readable zone"); assert.equal(r.summary.number_found, true);
});

test("MRZ expiry that disagrees with the typed date must be corrected", () => {
    const r = O.analyze(passportText(td3Line2("A1234567", "900101", "310101")), 88, { kind: "passport", number: "A1234567", expires: "2032-05-05" }, NOW);
    assert.equal(r.errors[0].code, "expiry_wrong");
    assert.match(r.message, /doesn't match the document \(2031-01-01\)/);
});

test("a misread MRZ digit fails its check and is not trusted", () => {
    const good = td3Line2("A1234567", "900101", "310101");
    const bad = good.slice(0, 21) + "2" + good.slice(22);      // 310101 -> 210101 (would look expired)
    const r = O.analyze(passportText(bad), 70, { kind: "passport", number: "A1234567", expires: "2031-01-01" }, NOW);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.summary.expiry_from, null);
    assert.ok(r.warnings.some(w => w.code === "expiry_unread"));
});

test("labelled expiry date on cards without an MRZ", () => {
    const card = "REPUBLIC OF UGANDA\nDRIVING PERMIT\nSURNAME TESTPERSON\nDATE OF BIRTH 01.01.1990\nDATE OF EXPIRY 14/03/2029\nPERMIT NO. DP123456";
    let r = O.analyze(card, 80, { kind: "driving_license", number: "DP123456", expires: "2029-03-14" }, NOW);
    assert.equal(r.ok, true); assert.equal(r.summary.kind_detected, "driving_license"); assert.equal(r.summary.expiry_read, "2029-03-14");
    r = O.analyze(card.replace("14/03/2029", "14 MAR 2025"), 80, { kind: "driving_license", number: "DP123456", expires: "2029-03-14" }, NOW);
    assert.equal(r.errors[0].code, "expired");
    // Label date that differs: flagged for admin, not blocked (OCR may misread)
    r = O.analyze(card, 80, { kind: "driving_license", number: "DP123456", expires: "2029-03-15" }, NOW);
    assert.equal(r.ok, true); assert.ok(r.warnings.some(w => w.code === "expiry_mismatch"));
    // date of birth alone is never taken as the expiry
    r = O.analyze(card.replace("DATE OF EXPIRY 14/03/2029\n", ""), 80, { kind: "driving_license", number: "DP123456", expires: "2029-03-14" }, NOW);
    assert.equal(r.summary.expiry_read, null);
});

test("not an ID, and unreadable photos, are rejected", () => {
    const receipt = "SUPERMARKET RECEIPT\nSUGAR 2KG 9000\nMILK 500ML 2500\nBREAD LOAF 4000\nTOTAL 15500 CASH 20000 CHANGE 4500\nTHANK YOU FOR SHOPPING";
    let r = O.analyze(receipt, 90, { kind: "national_id", number: "CM1234567", expires: "2030-01-01" }, NOW);
    assert.equal(r.errors[0].code, "not_id"); assert.match(r.message, /does not appear to be a National ID/);
    r = O.analyze("~ ;; ,, ||", 20, { kind: "passport" }, NOW);
    assert.equal(r.errors[0].code, "not_id"); assert.match(r.message, /can't be read/);
});

test("typed number and type are cross-checked (notes for admin)", () => {
    const r = O.analyze(passportText(td3Line2("A1234567", "900101", "310101")), 88, { kind: "national_id", number: "B7654321", expires: "2031-01-01" }, NOW);
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some(w => w.code === "number_mismatch"));
    assert.ok(r.warnings.some(w => w.code === "kind_mismatch" && /looks like a Passport/.test(w.text)));
    assert.equal(O.numberFound("DOC No. CM12345678TEST", "cm 1234 5678 test"), true);
    assert.equal(O.numberFound("NIN CM0I234567", "CM01234567"), true);   // O/I read as 0/1
});

test("partial MRZ lines from phone photos: expiry kept only when its check digit adds up", () => {
    // Real Tesseract output from a tilted phone-style photo (start of line lost, 9 read as 0 in the birth date)
    const r = O.readMrz("UTOTESTPERSON<<SAMPLE<DEMOSSC\n534567<6UT00001011F3101012<<<<ESEETTTID");
    assert.equal(r.expiry, "2031-01-01"); assert.equal(r.expiryChecked, true);
    // Expiry digit misread (2012-04-15 check 9 read as 0): not trusted
    const bad = O.readMrz("UTOTESTPERSON<<SAMPLE<DEMOSS\n5902036UT07408122F12041502E184220B<<<<ID");
    assert.ok(!bad || !bad.expiryChecked);
});
