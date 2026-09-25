const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../client/js/lz-spec-tools.js");
const T = require("../client/js/lz-table.js");
test("alternating lines pair up (copy from a web page)", () => {
  const r = S.parseSpecText("Os\niOS\nNfc\nNFC with reader mode\nOther Information\nIP68 Splash, Water, and Dust Resistant, Crash Detection\n");
  assert.deepEqual(r, [{ label: "Os", value: "iOS" }, { label: "Nfc", value: "NFC with reader mode" }, { label: "Other Information", value: "IP68 Splash, Water, and Dust Resistant, Crash Detection" }]);
});
test("aspect ratio value with a colon still pairs", () => {
  assert.deepEqual(S.parseSpecText("Aspect Ratio\n16:9\nBrand\nApple"), [{ label: "Aspect Ratio", value: "16:9" }, { label: "Brand", value: "Apple" }]);
});
test("tab and colon rows", () => {
  assert.deepEqual(S.parseSpecText("Brand\tApple\nColour\tBlue\tMatte"), [{ label: "Brand", value: "Apple" }, { label: "Colour", value: "Blue Matte" }]);
  assert.deepEqual(S.parseSpecText("Brand: Apple\nColour: Blue"), [{ label: "Brand", value: "Apple" }, { label: "Colour", value: "Blue" }]);
});
test("table -> specs skips header row, merged values used once", () => {
  const m = T.create(4, 2, { header_row: true });
  T.pasteGrid(m, 0, 0, "Spec\tValue\nCamera\t12 MP\nFlash\tTrue Tone\nBattery\tLi-ion");
  T.merge(m, T.anchorAt(m, 2, 1), "down");
  assert.deepEqual(S.tableToSpecs(m), [{ label: "Camera", value: "12 MP" }, { label: "Flash", value: "True Tone Li-ion" }, { label: "Battery", value: "" }]);
});
