import shutil, datetime, sys

path = "server/controllers/productController.js"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''        const result = await pool.query(
            `SELECT products.*, vendors.business_name AS vendor_business_name, vendors.slug AS vendor_slug,
                    vp.proposed_sale_price AS sale_price, vp.original_price AS original_price
             FROM products
             LEFT JOIN vendors ON vendors.id = products.vendor_id AND vendors.status = 'approved'
             LEFT JOIN LATERAL (
                 SELECT proposed_sale_price, original_price
                 FROM vendor_promotions
                 WHERE vendor_promotions.product_id = products.id
                   AND vendor_promotions.status = 'approved'
                   AND now() BETWEEN vendor_promotions.starts_at AND vendor_promotions.ends_at
                 ORDER BY vendor_promotions.starts_at DESC
                 LIMIT 1
             ) vp ON true
             WHERE products.id = $1 AND products.deleted_at IS NULL AND products.status = 'approved' AND products.is_active = true AND products.admin_restricted = false
               AND (products.vendor_id IS NULL OR (
                    vendors.shop_active = true
                    AND (vendors.holiday_mode_active = false
                         OR CURRENT_DATE < vendors.holiday_mode_start_date
                         OR CURRENT_DATE > vendors.holiday_mode_end_date)
               ))`,
            [id]
        );'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''        // Two independent discount sources exist: flash_sale_items (an
        // admin creates a time-boxed campaign directly, via
        // flashSaleController.js - product_id + sale_price, nothing to do
        // with vendor_promotions) and vendor_promotions (a vendor proposes
        // a sale price on their own product, admin approves). Real usage
        // showed flash_sale_items is the one actually driving today's live
        // discounts, so it's checked first and preferred when both exist;
        // "original price" for a flash-sale match is the product's current
        // listed price (flash_sale_items doesn't snapshot one), vs.
        // vendor_promotions' own snapshotted original_price.
        const result = await pool.query(
            `SELECT products.*, vendors.business_name AS vendor_business_name, vendors.slug AS vendor_slug,
                    COALESCE(fsi.sale_price, vp.proposed_sale_price) AS sale_price,
                    CASE WHEN fsi.sale_price IS NOT NULL THEN products.price ELSE vp.original_price END AS original_price
             FROM products
             LEFT JOIN vendors ON vendors.id = products.vendor_id AND vendors.status = 'approved'
             LEFT JOIN LATERAL (
                 SELECT fsi_inner.sale_price
                 FROM flash_sale_items fsi_inner
                 JOIN flash_sales fs ON fs.id = fsi_inner.flash_sale_id
                 WHERE fsi_inner.product_id = products.id
                   AND fs.is_active = true
                   AND fs.ends_at >= now()
                   AND (fs.starts_at IS NULL OR fs.starts_at <= now())
                 ORDER BY fs.ends_at ASC
                 LIMIT 1
             ) fsi ON true
             LEFT JOIN LATERAL (
                 SELECT proposed_sale_price, original_price
                 FROM vendor_promotions
                 WHERE vendor_promotions.product_id = products.id
                   AND vendor_promotions.status = 'approved'
                   AND now() BETWEEN vendor_promotions.starts_at AND vendor_promotions.ends_at
                 ORDER BY vendor_promotions.starts_at DESC
                 LIMIT 1
             ) vp ON true
             WHERE products.id = $1 AND products.deleted_at IS NULL AND products.status = 'approved' AND products.is_active = true AND products.admin_restricted = false
               AND (products.vendor_id IS NULL OR (
                    vendors.shop_active = true
                    AND (vendors.holiday_mode_active = false
                         OR CURRENT_DATE < vendors.holiday_mode_start_date
                         OR CURRENT_DATE > vendors.holiday_mode_end_date)
               ))`,
            [id]
        );'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
