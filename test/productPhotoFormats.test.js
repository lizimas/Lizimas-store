// AVIF / HEIC / GIF product photos are accepted and stored as JPG (Sept 2026).
const test = require("node:test");
const assert = require("node:assert");
const { productPhotoFilter } = require("../server/middleware/upload");

function filter(name, mimetype) {
    return new Promise((resolve) => productPhotoFilter({}, { originalname: name, mimetype }, (err, ok) => resolve(err ? err : ok)));
}

test("product photo filter takes web formats plus AVIF, HEIC and GIF", async () => {
    for (const [n, m] of [["a.jpg", "image/jpeg"], ["b.png", "image/png"], ["c.webp", "image/webp"],
        ["2d7e.jpg.avif", "image/avif"], ["IMG_1.HEIC", "image/heic"], ["d.gif", "image/gif"], ["noext", "image/avif"]]) {
        assert.strictEqual(await filter(n, m), true, n);
    }
});

test("product photo filter refuses other files and names them", async () => {
    const err = await filter("notes.pdf", "application/pdf");
    assert.ok(err instanceof Error);
    assert.strictEqual(err.code, "INVALID_FILE_TYPE");
    assert.match(err.message, /notes\.pdf/);
});

test("only non-web images are converted to JPG on upload", () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://x@localhost/x";
    const pc = require("../server/controllers/productController");
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
    const avif = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypavif"), Buffer.alloc(4)]);
    const gif = Buffer.from("GIF89a000000");
    for (const b of [jpeg, png, webp]) assert.strictEqual(pc._productUploadOptions(b).format, undefined);
    for (const b of [avif, gif]) assert.strictEqual(pc._productUploadOptions(b).format, "jpg");
    assert.strictEqual(pc._productUploadOptions(avif, { eager: [1] }).folder, "lizimas-store/products");
    assert.deepStrictEqual(pc._productUploadOptions(avif, { eager: [1] }).eager, [1]);
});
