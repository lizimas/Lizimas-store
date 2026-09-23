const express = require('express');
const router = express.Router();
const pool = require('../config/database');

const { slugify } = require("../utils/slugify");

router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = 'https://lizimasstore.com';

    const staticPages = [
      { url: '/', priority: '1.0', changefreq: 'daily' },
      { url: '/products.html', priority: '0.9', changefreq: 'daily' },
      { url: '/categories.html', priority: '0.8', changefreq: 'weekly' },
      { url: '/contact.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/faq.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/help.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/returns.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/vendor-register.html', priority: '0.8', changefreq: 'monthly' },
      { url: '/vendor-policies.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/report.html', priority: '0.3', changefreq: 'monthly' },
      { url: '/terms.html', priority: '0.3', changefreq: 'yearly' },
      { url: '/privacy.html', priority: '0.3', changefreq: 'yearly' },
    ];
    // Removed the old '/about.html' entry (Sept 2026) - that file doesn't
    // exist in client/, so Google was being pointed at a 404 on every
    // sitemap fetch. Added every genuinely public static page that was
    // missing entirely (confirmed against robots.txt's disallow list and
    // each page's own <title> before including it) - most notably
    // vendor-register.html, which had zero discovery path to Google at
    // all (Search Console: "URL is unknown to Google", no referring
    // sitemap, no referring page). product-detail.html and store.html
    // are deliberately left out - they're templates with no content of
    // their own (product-detail.html's real pages are already covered by
    // the per-product loop below using proper /product/{slug}-{id} URLs;
    // store.html is a per-vendor storefront template that would need its
    // own generated loop the same way, not a bare static entry).

    const productResult = await pool.query(
      `SELECT id, name, created_at
         FROM products
        WHERE status = 'approved'
          AND deleted_at IS NULL
        ORDER BY id`
    );
    const products = productResult.rows;

    let categories = [];
    try {
      const result = await pool.query('SELECT id FROM categories');
      categories = result.rows;
    } catch (e) {
      categories = [];
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of staticPages) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}${page.url}</loc>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    for (const p of products) {
      const lastmod = p.created_at
        ? new Date(p.created_at).toISOString().split('T')[0]
        : '';
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/product/${slugify(p.name)}-${p.id}</loc>\n`;
      if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.8</priority>\n`;
      xml += `  </url>\n`;
    }

    for (const c of categories) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/products.html?category=${c.id}</loc>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
    }

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap generation error:', err);
    res.status(500).send('Error generating sitemap');
  }
});

module.exports = router;
