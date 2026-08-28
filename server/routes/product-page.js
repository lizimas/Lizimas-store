const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const pool = require("../config/database");

const HTML_PATH = path.join(__dirname, "../../client/product-detail.html");
const BASE_URL = "https://lizimasstore.com";

const { slugify } = require("../utils/slugify");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

router.get("/product-detail.html", async (req, res, next) => {
  const id = parseInt(req.query.id, 10);
  if (!id) return next();
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM products
        WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL
        LIMIT 1`,
      [id]
    );
    if (!rows.length) return next();
    return res.redirect(301, `/product/${slugify(rows[0].name)}-${rows[0].id}`);
  } catch (err) {
    return next(err);
  }
});

router.get("/product/:slugid", async (req, res, next) => {
  const raw = String(req.params.slugid);
  const m = raw.match(/-(\d+)$/) || raw.match(/^(\d+)$/);
  if (!m) return next();
  const id = parseInt(m[1], 10);

  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, price, image, public_code
         FROM products
        WHERE id = $1
          AND status = 'approved'
          AND deleted_at IS NULL
        LIMIT 1`,
      [id]
    );
    if (!rows.length) return next();
    const p = rows[0];

    const canonicalSlug = `${slugify(p.name)}-${p.id}`;
    if (raw !== canonicalSlug) {
      return res.redirect(301, `/product/${canonicalSlug}`);
    }

    const url = `${BASE_URL}/product/${canonicalSlug}`;
    const title = `${p.name} | Lizimas Store`;
    const desc = String(p.description || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 155) || `Buy ${p.name} at Lizimas Store. Delivery across Uganda, Mobile Money accepted.`;

    const jsonld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      description: desc,
      sku: p.public_code || String(p.id),
      url,
    };
    if (p.image) jsonld.image = [p.image];
    if (p.price != null) {
      jsonld.offers = {
        "@type": "Offer",
        price: String(p.price),
        priceCurrency: "UGX",
        availability: "https://schema.org/InStock",
        url,
      };
    }

    const head = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<link rel="canonical" href="${url}">`,
      `<meta property="og:type" content="product">`,
      `<meta property="og:title" content="${esc(p.name)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${url}">`,
      p.image ? `<meta property="og:image" content="${esc(p.image)}">` : "",
      `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`,
    ].filter(Boolean).join("\n");

    let html = fs.readFileSync(HTML_PATH, "utf8");
    html = html.replace(/<meta name="description"[^>]*>\s*/i, "");
    html = html.replace(/<title>[\s\S]*?<\/title>/i, head);

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
