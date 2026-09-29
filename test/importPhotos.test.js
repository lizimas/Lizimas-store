const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { fetchRemoteImage, isPrivateAddress } = require("../server/utils/remoteImage");
const { splitLinks, importRowPhotos, mapLimit } = require("../server/utils/importPhotos");

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, fn) {
    const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
    const rows = []; for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const v = fn(x, y); r[1 + x * 3] = v[0]; r[2 + x * 3] = v[1]; r[3 + x * 3] = v[2]; } rows.push(r); }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const sharpPreview = (seed) => png(128, 128, (x, y) => { const inside = x > 32 && x < 96 && y > 26 && y < 102; const v = inside ? (((x >> 2) + (y >> 2) + seed) % 2 ? 40 : 170) : 255; return [v, v, v]; });
const blurPreview = png(128, 128, () => [150, 150, 150]);
const bigPhoto = (tag) => { const b = png(900, 900, () => [tag, tag, tag]); return b; };

function fakeFetch(map) {
    return async (url) => {
        const r = map[url];
        if (!r) return { ok: false, status: 404, headers: new Map(), body: null };
        if (r.redirect) return { ok: false, status: 302, headers: new Map([["location", r.redirect]]) };
        return { ok: true, status: 200, headers: new Map([["content-length", String(r.length)]]), arrayBuffer: async () => r, body: null };
    };
}
const publicDns = async () => [{ address: "93.184.216.34" }];

test("private and internal addresses are refused", async () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "192.168.1.9", "172.20.0.1", "169.254.169.254", "100.64.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
    const bad = ["http://localhost/a.jpg", "http://127.0.0.1/a.jpg", "http://169.254.169.254/latest/meta-data", "ftp://x.com/a.jpg", "http://u:p@x.com/a.jpg", "http://x.com:8080/a.jpg", "not a link"];
    for (const link of bad) await assert.rejects(fetchRemoteImage(link, { lookup: publicDns, fetch: fakeFetch({}) }), undefined, link);
    // a public name that resolves to a private address
    await assert.rejects(fetchRemoteImage("http://evil.example.com/a.jpg", { lookup: async () => [{ address: "10.0.0.5" }], fetch: fakeFetch({}) }), /private address/);
    // a redirect to an internal address is refused too
    await assert.rejects(fetchRemoteImage("http://shop.example.com/a.jpg", {
        lookup: async (h) => (h === "shop.example.com" ? [{ address: "93.184.216.34" }] : [{ address: "127.0.0.1" }]),
        fetch: fakeFetch({ "http://shop.example.com/a.jpg": { redirect: "http://internal.example.com/secret" } })
    }), /private address/);
});

test("downloads only real photos, within the size limit", async () => {
    const photo = bigPhoto(120);
    const ok = await fetchRemoteImage("https://cdn.example.com/p/shoe.png", { lookup: publicDns, fetch: fakeFetch({ "https://cdn.example.com/p/shoe.png": photo }) });
    assert.equal(ok.size, photo.length); assert.equal(ok.name, "shoe.png");
    await assert.rejects(fetchRemoteImage("https://cdn.example.com/page.html", { lookup: publicDns, fetch: fakeFetch({ "https://cdn.example.com/page.html": Buffer.from("<html>hello</html>".repeat(5)) }) }), /not a JPEG, PNG or WebP/);
    await assert.rejects(fetchRemoteImage("https://cdn.example.com/huge.png", { maxBytes: 1000, lookup: publicDns, fetch: fakeFetch({ "https://cdn.example.com/huge.png": photo }) }), /larger than/);
    await assert.rejects(fetchRemoteImage("https://cdn.example.com/missing.png", { lookup: publicDns, fetch: fakeFetch({}) }), /answered 404/);
});

test("photo links: | or new lines, old image column still read, duplicates dropped", () => {
    assert.deepEqual(splitLinks({ images: "https://a/1.jpg | https://a/2.jpg\nhttps://a/3.jpg", image: "https://a/1.jpg" }), ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"]);
    assert.deepEqual(splitLinks({ image: "https://res.cloudinary.com/x/image/upload/w_800,h_800/p.jpg" }), ["https://res.cloudinary.com/x/image/upload/w_800,h_800/p.jpg"]);
    assert.deepEqual(splitLinks({}), []);
});

test("row photos: good ones kept, bad ones reported and removed from storage", async () => {
    const files = { a: bigPhoto(10), b: bigPhoto(20), c: bigPhoto(30), blurry: bigPhoto(40), small: png(300, 300, () => [5, 5, 5]) };
    const previews = { 10: sharpPreview(0), 20: sharpPreview(1), 30: sharpPreview(2), 40: blurPreview };
    const destroyed = [];
    let n = 0;
    const deps = {
        fetchImage: async (link) => { const k = link.split("/").pop(); if (k === "dead") throw new Error("the website answered 404"); return { buffer: files[k], size: files[k].length, name: k }; },
        upload: async (buf) => { n++; const tag = buf === files.a ? 10 : buf === files.b ? 20 : buf === files.c ? 30 : 40; return { url: "https://cdn/" + tag, publicId: "p" + tag, width: 900, height: 900, previewUrl: String(tag) }; },
        destroy: async (id) => destroyed.push(id),
        fetchBuffer: async (u) => previews[u]
    };
    const r = await importRowPhotos(["h://x/a", "h://x/blurry", "h://x/small", "h://x/dead", "h://x/b", "h://x/a", "h://x/c"], [], deps);
    assert.deepEqual(r.kept.map(k => k.url), ["https://cdn/10", "https://cdn/20", "https://cdn/30"]);
    const why = Object.fromEntries(r.problems.map(p => [p.link.split("/").pop(), p.reasons.join(" ")]));
    assert.match(why.blurry, /blurry/); assert.match(why.small, /Resolution is too low/); assert.match(why.dead, /404/);
    assert.match(r.problems.find(p => /same photo/.test(p.reasons[0])).link, /\/a$/);
    assert.deepEqual(destroyed, ["p40"], "only the blurry upload is removed");
});

test("mapLimit keeps order and limits how many run at once", async () => {
    let running = 0, peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (v) => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, v)); running--; return v * 10; });
    assert.deepEqual(out, [50, 10, 30, 20, 40]); assert.equal(peak, 2);
});
