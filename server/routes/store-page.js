const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const pool = require("../config/database");

// Mirrors server/routes/product-page.js: injects per-page SEO meta into a
// static shell so a vendor's storefront link (lizimasstore.com/store/<slug>)
// shows the vendor's own name/banner when shared, instead of the generic
// site-wide title. The actual page content is rendered client-side by
// client/js/store.js, which reads the slug back out of the URL itself.
const HTML_PATH = path.join(__dirname, "../../client/store.html");
const BASE_URL = "https://lizimasstore.com";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

router.get("/store/:slug", async (req, res, next) => {
  const { slug } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT business_name, slug, logo_url, banner_url, about
         FROM vendors WHERE slug = $1 AND status = 'approved' LIMIT 1`,
      [slug]
    );
    // Unknown or unapproved slug: fall through to the client-rendered
    // "store not found" state rather than a hard 404 - the page still
    // loads normally and store.js shows the same message either way.
    if (!rows.length) return next();
    const v = rows[0];

    const url = `${BASE_URL}/store/${v.slug}`;
    const title = `${v.business_name} | Lizimas Store`;
    const desc = String(v.about || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 155) || `Shop ${v.business_name} on Lizimas Store. Delivery across Uganda, Mobile Money accepted.`;

    const head = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<link rel="canonical" href="${url}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${esc(v.business_name)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${url}">`,
      v.logo_url || v.banner_url ? `<meta property="og:image" content="${esc(v.banner_url || v.logo_url)}">` : "",
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
