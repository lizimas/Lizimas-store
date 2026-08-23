const express = require('express');
const router = express.Router();
const pool = require('../config/database');

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

router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = 'https://lizimasstore.com';

    const staticPages = [
      { url: '/', priority: '1.0', changefreq: 'daily' },
      { url: '/products.html', priority: '0.9', changefreq: 'daily' },
      { url: '/about.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/contact.html', priority: '0.5', changefreq: 'monthly' },
    ];

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
