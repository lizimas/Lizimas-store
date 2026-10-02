// Reading the details printed on a National ID (front and back), and the
// checks on what the vendor sends with it.
const test = require("node:test");
const assert = require("node:assert");
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
const Ocr = require("../client/js/lz-id-ocr.js");
const { readIdentityDetails } = require("../server/utils/identityDetails");

const FRONT = `REPUBLIC OF UGANDA
NATIONAL ID CARD
SURNAME
NSUBUGA GARFIELD
GIVEN NAME
DELANO SPENSE
NATIONALITY SEX DATE OF BIRTH
UGA M 11.01.1985
NIN CARD NO.
CM85016102PE1C 001298674
DATE OF EXPIRY
12.11.2034
HOLDERS SIGNATURE`;

test("the front of a National ID fills all eight boxes", () => {
    assert.deepEqual(Ocr.extractIdFields(FRONT), {
        surname: "NSUBUGA GARFIELD", given_names: "DELANO SPENSE", nationality: "UGA", sex: "M",
        date_of_birth: "1985-01-11", nin: "CM85016102PE1C", card_number: "001298674", expires_on: "2034-11-12"
    });
});

test("labels and values on the same line, or one per line, are both read", () => {
    const f = Ocr.extractIdFields("SURNAME: KATO\nGIVEN NAME  JOHN PAUL\nNATIONALITY\nUGA\nSEX\nF\nDATE OF BIRTH\n03.07.1990\nNIN\nCF9000310ABCDE\nCARD NO\n012345678\nDATE OF EXPIRY 01.02.2031");
    assert.equal(f.surname, "KATO");
    assert.equal(f.given_names, "JOHN PAUL");
    assert.equal(f.sex, "F");
    assert.equal(f.date_of_birth, "1990-07-03");
    assert.equal(f.nin, "CF9000310ABCDE");
    assert.equal(f.card_number, "012345678");
    assert.equal(f.expires_on, "2031-02-01");
});

test("sex comes from the NIN when its own box can't be read; unreadable text fills nothing", () => {
    assert.equal(Ocr.extractIdFields("SURNAME\nAKELLO\nNIN\nCF8801210XYZ12").sex, "F");
    const none = Ocr.extractIdFields("some unrelated words");
    assert.ok(Object.values(none).every((v) => v === ""));
});

test("the back of the card gives the address", () => {
    const b = Ocr.extractIdBack("VILLAGE: KISASI\nPARISH: KYANJA\nS.COUNTY: NAKAWA DIVISION\nCOUNTY: KAMPALA CAPITAL CITY\nDISTRICT: KAMPALA");
    assert.deepEqual([b.village, b.parish, b.sub_county, b.county, b.district], ["KISASI", "KYANJA", "NAKAWA DIVISION", "KAMPALA CAPITAL CITY", "KAMPALA"]);
});

test("details sent with the ID are cleaned and checked", () => {
    const ok = readIdentityDetails(JSON.stringify({ surname: " nsubuga  garfield ", given_names: "Delano", sex: "m", date_of_birth: "1985-01-11", nin: "cm85016102pe1c", card_number: "001298674", edited_fields: ["surname", "hack"], read: true }), "2026-10-02");
    assert.equal(ok.ok, true);
    assert.equal(ok.value.surname, "NSUBUGA GARFIELD");
    assert.equal(ok.value.sex, "M");
    assert.equal(ok.value.nin, "CM85016102PE1C");
    assert.deepEqual(ok.value.edited_fields, ["surname"]);
    assert.equal(readIdentityDetails({ sex: "X" }).ok, false);
    assert.equal(readIdentityDetails({ date_of_birth: "2030-01-01" }, "2026-10-02").ok, false);
    assert.match(readIdentityDetails({ date_of_birth: "2015-01-01" }, "2026-10-02").error, /18 or older/);
    assert.equal(readIdentityDetails({ nin: "CM 85-01!" }).ok, false);
    assert.equal(readIdentityDetails("not json").ok, false);
    assert.deepEqual(readIdentityDetails(null), { ok: true, value: {} });
});
