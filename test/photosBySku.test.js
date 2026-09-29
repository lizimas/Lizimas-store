const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { parsePhotoName, photosBySku } = require("../server/controllers/adminPhotosBySkuController");

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, fn) {
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const rows = []; for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const v = fn(x, y); r[1 + x * 3] = v[0]; r[2 + x * 3] = v[1]; r[3 + x * 3] = v[2]; } rows.push(r); }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const sharpPreview = (seed) => png(128, 128, (x, y) => { const inside = x > 32 && x < 96 && y > 26 && y < 102; const v = inside ? (((x >> 2) + (y >> 2) + seed) % 2 ? 40 : 170) : 255; return [v, v, v]; });
const photo = (w, tag) => ({ originalname: `p${tag}.png`, buffer: png(w, w, () => [tag, tag, tag]) });

// Tiny in-memory stand-in for the three tables the endpoint touches.
function fakeDb(products, images) {
    let nextId = 100;
    const q = async (sql, p) => {
        sql = sql.replace(/\s+/g, " ").trim();
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || /FOR UPDATE/.test(sql) || /UPDATE product_colors/.test(sql)) return { rows: [] };
        if (/FROM products WHERE LOWER\(sku\)/.test(sql)) return { rows: products.filter((r) => !r.deleted_at && r.sku.toLowerCase() === p[0].toLowerCase()).sort((a, b) => (a.vendor_id ? 1 : 0) - (b.vendor_id ? 1 : 0)) };
        if (/^DELETE FROM product_images/.test(sql)) { const gone = images.filter((i) => i.product_id === p[0]); gone.forEach((g) => images.splice(images.indexOf(g), 1)); return { rows: gone }; }
        if (/MAX\(display_order\)/.test(sql)) { const o = images.filter((i) => i.product_id === p[0]).map((i) => i.display_order); return { rows: [{ m: o.length ? Math.max(...o) : -1 }] }; }
        if (/^INSERT INTO product_images/.test(sql)) { images.push({ id: nextId++, product_id: p[0], image_path: p[1], display_order: p[2], phash: p[3] }); return { rows: [] }; }
        if (/ORDER BY COALESCE\(display_order/.test(sql)) return { rows: images.filter((i) => i.product_id === p[0]).sort((a, b) => a.display_order - b.display_order).slice(0, 1) };
        if (/^UPDATE products SET image/.test(sql)) { products.find((r) => r.id === p[1]).image = p[0]; return { rows: [] }; }
        if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: images.filter((i) => i.product_id === p[0]).length }] };
        throw new Error("unexpected SQL: " + sql);
    };
    return { query: q, connect: async () => ({ query: q, release() {} }) };
}
function deps(db) {
    let n = 0;
    const log = { uploads: 0, destroyed: [] };
    return { log, query: db.query, connect: db.connect,
        upload: async (buf) => { n++; log.uploads++; const w = buf.readUInt32BE(16); return { url: `https://cdn.test/p${n}.png`, publicId: `p${n}`, width: w, height: w, bytes: buf.length, previewUrl: `prev${n}` }; },
        destroy: async (id) => { log.destroyed.push(id); },
        fetchBuffer: async (u) => sharpPreview(Number(u.slice(4))) };
}

test("SKU and photo number come from the file name", () => {
    assert.deepEqual(parsePhotoName("YD-8981_1_800x800.jpg"), { sku: "YD-8981", n: 1 });
    assert.deepEqual(parsePhotoName("YD-8981_3_TOO-SMALL_640x640.png"), { sku: "YD-8981", n: 3 });
    assert.deepEqual(parsePhotoName("photos/YD-8981/YD-8981_12.webp"), { sku: "YD-8981", n: 12 });
    assert.deepEqual(parsePhotoName("YD-8981 (2).jpg"), { sku: "YD-8981", n: 2 });
    assert.deepEqual(parsePhotoName("KF-2024-500.jpeg"), { sku: "KF-2024-500", n: 1 });
});

test("replace mode swaps the photos of Lizimas' own product, photo 1 is the main one", async () => {
    const products = [{ id: 1, sku: "YD-1", name: "Flask", vendor_id: null }];
    const images = [{ id: 1, product_id: 1, image_path: "old.jpg", display_order: 0 }];
    const d = deps(fakeDb(products, images));
    const out = await photosBySku({ sku: "yd-1", files: [photo(900, 10), photo(900, 20), photo(900, 30)] }, d);
    assert.equal(out.status, 200);
    assert.equal(out.body.added, 3);
    assert.equal(out.body.replaced, 1);
    assert.equal(out.body.total, 3);
    assert.deepEqual(images.map((i) => i.display_order), [0, 1, 2]);
    assert.equal(products[0].image, images[0].image_path);
    assert.ok(!images.some((i) => i.image_path === "old.jpg"));
});

test("add mode appends after existing photos", async () => {
    const products = [{ id: 1, sku: "YD-1", name: "Flask", vendor_id: null, image: "old.jpg" }];
    const images = [{ id: 1, product_id: 1, image_path: "old.jpg", display_order: 0 }];
    const out = await photosBySku({ sku: "YD-1", mode: "add", files: [photo(900, 10)] }, deps(fakeDb(products, images)));
    assert.equal(out.body.total, 2);
    assert.equal(images[1].display_order, 1);
    assert.equal(products[0].image, "old.jpg");
});

test("a vendor's product with the same SKU is never touched", async () => {
    const products = [{ id: 5, sku: "YD-1", name: "Vendor flask", vendor_id: 9 }];
    const d = deps(fakeDb(products, []));
    const out = await photosBySku({ sku: "YD-1", files: [photo(900, 10)] }, d);
    assert.equal(out.status, 404);
    assert.equal(out.body.error, "vendor_product");
    assert.equal(d.log.uploads, 0);
});

test("own product is chosen when a vendor shares the SKU", async () => {
    const products = [{ id: 5, sku: "YD-1", vendor_id: 9 }, { id: 6, sku: "YD-1", vendor_id: null }];
    const images = [];
    const out = await photosBySku({ sku: "YD-1", files: [photo(900, 10)] }, deps(fakeDb(products, images)));
    assert.equal(out.body.product_id, 6);
    assert.equal(images[0].product_id, 6);
});

test("unknown SKU is reported and nothing is uploaded", async () => {
    const d = deps(fakeDb([], []));
    const out = await photosBySku({ sku: "NOPE", files: [photo(900, 10)] }, d);
    assert.equal(out.body.error, "sku_not_found");
    assert.equal(d.log.uploads, 0);
});

test("small photos are kept with a note; exact copies are stored once", async () => {
    const products = [{ id: 1, sku: "YD-1", vendor_id: null }];
    const images = [];
    const a = photo(900, 10), copy = { originalname: "copy.png", buffer: a.buffer };
    const out = await photosBySku({ sku: "YD-1", files: [a, copy, photo(400, 40)] }, deps(fakeDb(products, images)));
    assert.equal(out.body.added, 2);
    assert.equal(out.body.skipped.length, 1);
    assert.match(out.body.skipped[0].reason, /same photo/);
    const small = out.body.notes.find((n) => n.name === "p40.png");
    assert.ok(small && small.notes.some((t) => /800/.test(t)), JSON.stringify(out.body.notes));
});

test("database failure removes the uploaded photos again", async () => {
    const products = [{ id: 1, sku: "YD-1", vendor_id: null }];
    const db = fakeDb(products, []);
    const failing = { query: db.query, connect: async () => ({ release() {}, query: async (sql, p) => { if (/^INSERT/.test(sql.trim())) throw new Error("db down"); return db.query(sql, p); } }) };
    const d = deps(failing);
    await assert.rejects(photosBySku({ sku: "YD-1", files: [photo(900, 10), photo(900, 20)] }, d), /db down/);
    assert.deepEqual(d.log.destroyed.sort(), ["p1", "p2"]);
});
