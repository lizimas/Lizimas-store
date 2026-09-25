const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../client/js/lz-table.js");
const valid = (m) => assert.equal(T.normalize(m).ok, true, JSON.stringify(T.normalize(m)));
test("create/normalize", () => { const m = T.create(3, 2); valid(m); assert.equal(m.cells.length, 6); });
test("insert/delete rows and cols keep the grid valid", () => {
  const m = T.create(2, 2); T.insertRow(m, 1); T.insertCol(m, 0); valid(m); assert.deepEqual([m.rows, m.cols], [3, 3]);
  T.deleteRow(m, 0); T.deleteCol(m, 2); valid(m); assert.deepEqual([m.rows, m.cols], [2, 2]);
});
test("merge right/down/left/up", () => {
  const m = T.create(3, 3); m.cells[0].text = "A"; m.cells[1].text = "B";
  const a = T.anchorAt(m, 0, 0); const s = T.merge(m, a, "right"); valid(m);
  assert.equal(s.cs, 2); assert.equal(s.text, "A\nB");
  assert.equal(T.canMerge(m, s, "down"), false); // below is two separate cells
  const b = T.anchorAt(m, 1, 0); T.merge(m, b, "right"); valid(m);
  assert.equal(T.canMerge(m, T.anchorAt(m, 0, 0), "down"), true);
  T.merge(m, T.anchorAt(m, 1, 0), "up"); valid(m);
  const big = T.anchorAt(m, 0, 0); assert.deepEqual([big.rs, big.cs], [2, 2]);
  T.merge(m, T.anchorAt(m, 2, 2), "left"); valid(m);
  assert.equal(T.canMerge(m, T.anchorAt(m, 0, 0), "up"), false);
});
test("insert/delete through merged cells", () => {
  const m = T.create(3, 3); T.merge(m, T.anchorAt(m, 0, 0), "down"); // rs 2 at col 0
  T.insertRow(m, 1); valid(m); assert.equal(T.anchorAt(m, 0, 0).rs, 3);
  T.deleteRow(m, 0); valid(m); assert.equal(T.anchorAt(m, 0, 0).rs, 2);
  T.merge(m, T.anchorAt(m, 0, 1), "right"); T.insertCol(m, 2); valid(m); assert.equal(T.anchorAt(m, 0, 1).cs, 3);
  T.deleteCol(m, 1); valid(m);
});
test("split vertical/horizontal", () => {
  const m = T.create(2, 2); const a = T.anchorAt(m, 0, 0);
  T.splitVertical(m, a); valid(m); assert.equal(m.cols, 3); assert.equal(T.anchorAt(m, 1, 0).cs, 2);
  T.splitVertical(m, T.anchorAt(m, 1, 0)); valid(m); assert.equal(m.cols, 3);
  T.splitHorizontal(m, T.anchorAt(m, 0, 2)); valid(m); assert.equal(m.rows, 3);
});
test("normalize rejects overlaps, gaps and out-of-bounds", () => {
  assert.equal(T.normalize({ rows: 1, cols: 2, cells: [{ r: 0, c: 0, rs: 1, cs: 1 }] }).ok, false);
  assert.equal(T.normalize({ rows: 1, cols: 1, cells: [{ r: 0, c: 0, rs: 1, cs: 2 }] }).ok, false);
  assert.equal(T.normalize({ rows: 1, cols: 2, cells: [{ r: 0, c: 0, rs: 1, cs: 2 }, { r: 0, c: 1, rs: 1, cs: 1 }] }).ok, false);
  assert.equal(T.normalize({ rows: 99, cols: 1, cells: [] }).ok, false);
});
test("toHtml escapes text and marks headers", () => {
  const m = T.create(2, 2, { header_row: true }); m.cells[0].text = "<b>x</b>"; m.cells[3].text = "a\nb";
  const h = T.toHtml(m);
  assert.match(h, /<th scope="col">&lt;b&gt;x&lt;\/b&gt;<\/th>/); assert.match(h, /<td>a<br>b<\/td>/);
  m.header_col = true; assert.match(T.toHtml(m), /<th scope="row">a<br>b|<th scope="row">/);
});
test("pasteGrid grows the table", () => {
  const m = T.create(1, 1); T.pasteGrid(m, 0, 0, "Colour\tBlack\nWeight\t2kg\nSize\tL\n"); valid(m);
  assert.deepEqual([m.rows, m.cols], [3, 2]); assert.equal(T.anchorAt(m, 2, 1).text, "L");
});
