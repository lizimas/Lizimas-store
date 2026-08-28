/**
 * Canonical product slug. Used by the sitemap, the Google Shopping feed, the
 * /product/:slug-:id route and order emails - they must agree, so this lives
 * in one place rather than being redefined per module.
 */
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

module.exports = { slugify };
