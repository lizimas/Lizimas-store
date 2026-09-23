import shutil, datetime, sys

path = "server/routes/sitemap.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''    const staticPages = [
      { url: '/', priority: '1.0', changefreq: 'daily' },
      { url: '/products.html', priority: '0.9', changefreq: 'daily' },
      { url: '/about.html', priority: '0.5', changefreq: 'monthly' },
      { url: '/contact.html', priority: '0.5', changefreq: 'monthly' },
    ];'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''    const staticPages = [
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
    // own generated loop the same way, not a bare static entry).'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
