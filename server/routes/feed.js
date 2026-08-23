const express = require("express");
const router = express.Router();
const pool = require("../config/database");

const BASE_URL = "https://lizimasstore.com";

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "") || "product";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function plain(s, limit) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

router.get("/feed.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.description, p.price, p.stock,
              COALESCE(NULLIF(p.image, ''), i.image_path) AS img,
              p.material, p.color, p.public_code, p.brand, p.gtin, p.mpn
         FROM products p
         LEFT JOIN LATERAL (
           SELECT image_path FROM product_images
            WHERE product_id = p.id
            ORDER BY display_order NULLS LAST, id
            LIMIT 1
         ) i ON TRUE
        WHERE p.status = 'approved'
          AND p.deleted_at IS NULL
          AND p.price > 0
        ORDER BY p.id`
    );

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n`;
    xml += `<channel>\n`;
    xml += `<title>Lizimas Store</title>\n`;
    xml += `<link>${BASE_URL}</link>\n`;
    xml += `<description>Product feed for Lizimas Store</description>\n`;

    for (const p of rows) {
      if (!p.img) continue;
      const link = `${BASE_URL}/product/${slugify(p.name)}-${p.id}`;
      const title = plain(p.name, 150);
      const desc = plain(p.description, 5000) || title;
      const avail = Number(p.stock) > 0 ? "in_stock" : "out_of_stock";

      xml += `<item>\n`;
      xml += `  <g:id>${p.public_code || p.id}</g:id>\n`;
      xml += `  <g:title>${esc(title)}</g:title>\n`;
      xml += `  <g:description>${esc(desc)}</g:description>\n`;
      xml += `  <g:link>${esc(link)}</g:link>\n`;
      xml += `  <g:image_link>${esc(p.img)}</g:image_link>\n`;
      xml += `  <g:price>${Number(p.price).toFixed(2)} UGX</g:price>\n`;
      xml += `  <g:availability>${avail}</g:availability>\n`;
      xml += `  <g:condition>new</g:condition>\n`;
      if (p.brand) xml += `  <g:brand>${esc(p.brand)}</g:brand>\n`;
      if (p.gtin)  xml += `  <g:gtin>${esc(p.gtin)}</g:gtin>\n`;
      if (p.mpn)   xml += `  <g:mpn>${esc(p.mpn)}</g:mpn>\n`;
      if (!p.gtin && !p.mpn) {
        xml += `  <g:identifier_exists>no</g:identifier_exists>\n`;
      }
      if (p.material) xml += `  <g:material>${esc(p.material)}</g:material>\n`;
      if (p.color) xml += `  <g:color>${esc(p.color)}</g:color>\n`;
      xml += `</item>\n`;
    }

    xml += `</channel>\n</rss>`;

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).send("Error generating feed");
  }
});

module.exports = router;
