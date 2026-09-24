import shutil, datetime, sys

# --- 1. Backend: getProductById joins the active approved vendor_promotion ---
ctrl_path = "server/controllers/productController.js"
with open(ctrl_path, encoding="utf-8") as f:
    ctrl_content = f.read()

ctrl_anchor = '''exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        // LEFT JOIN so a staff-listed product (vendor_id NULL) or a vendor
        // that somehow lost its approved status still returns the product
        // itself - vendor_business_name/vendor_slug just come back null and
        // the client's "Sold by" link stays hidden.
        const result = await pool.query(
            `SELECT products.*, vendors.business_name AS vendor_business_name, vendors.slug AS vendor_slug
             FROM products
             LEFT JOIN vendors ON vendors.id = products.vendor_id AND vendors.status = 'approved'
             WHERE products.id = $1 AND products.deleted_at IS NULL AND products.status = 'approved' AND products.is_active = true AND products.admin_restricted = false
               AND (products.vendor_id IS NULL OR (
                    vendors.shop_active = true
                    AND (vendors.holiday_mode_active = false
                         OR CURRENT_DATE < vendors.holiday_mode_start_date
                         OR CURRENT_DATE > vendors.holiday_mode_end_date)
               ))`,
            [id]
        );'''

n = ctrl_content.count(ctrl_anchor)
if n != 1:
    print(f"ABORT (controller): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

ctrl_replacement = '''exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        // LEFT JOIN so a staff-listed product (vendor_id NULL) or a vendor
        // that somehow lost its approved status still returns the product
        // itself - vendor_business_name/vendor_slug just come back null and
        // the client's "Sold by" link stays hidden.
        //
        // LEFT JOIN LATERAL vp: a currently-active APPROVED vendor_promotion
        // for this product, if any - independent of homepage_featured, per
        // migration 070's own comment ("an approved promotion still shows
        // its sale price on the product page even when not featured").
        // Only flash-sale-featured promotions were ever reaching a customer
        // anywhere before this (getActiveFlashSalePublic joins through
        // flash_sale_items, not vendor_promotions directly) - an approved
        // but unfeatured promotion showed no discount on any page, which is
        // the bug this closes. LIMIT 1 guards against overlapping approved
        // windows on the same product, which the schema doesn't forbid.
        const result = await pool.query(
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

ctrl_backup = ctrl_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(ctrl_path, ctrl_backup)
ctrl_content = ctrl_content.replace(ctrl_anchor, ctrl_replacement, 1)
with open(ctrl_path, "w", encoding="utf-8") as f:
    f.write(ctrl_content)
print("Patched controller. Backup at " + ctrl_backup)

# --- 2. HTML: add old-price and discount-badge elements to the price row ---
html_path = "client/product-detail.html"
with open(html_path, encoding="utf-8") as f:
    html_content = f.read()

html_anchor = '''    <div class="pd-price-row">
        <div id="pd-price" class="pd-price"></div>
        <div id="pd-warranty" class="pd-warranty hidden"></div>
    </div>'''

n = html_content.count(html_anchor)
if n != 1:
    print(f"ABORT (html): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

html_replacement = '''    <div class="pd-price-row">
        <div id="pd-price" class="pd-price"></div>
        <span id="pd-price-original" class="pd-price-original" hidden></span>
        <span id="pd-discount-badge" class="pd-discount-badge" hidden></span>
        <div id="pd-warranty" class="pd-warranty hidden"></div>
    </div>'''

html_backup = html_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(html_path, html_backup)
html_content = html_content.replace(html_anchor, html_replacement, 1)
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)
print("Patched html. Backup at " + html_backup)

# --- 3. JS: render sale price / old price / discount % when present ---
js_path = "client/js/product-detail.js"
with open(js_path, encoding="utf-8") as f:
    js_content = f.read()

js_anchor = '''        document.getElementById("pd-price").textContent = product.price
            ? `UGX ${Number(product.price).toLocaleString()}`
            : "";'''

n = js_content.count(js_anchor)
if n != 1:
    print(f"ABORT (js): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

js_replacement = '''        // Discount display (vendor_promotions, joined in getProductById) -
        // only applied to the base price shown on initial load. Selecting a
        // differently-priced variant (selectVariant()) intentionally shows
        // that variant's plain price with no discount math - promotions are
        // proposed against the product's base price, not any one variant,
        // and this system has no per-variant discount concept at all.
        var pdPriceEl = document.getElementById("pd-price");
        var pdOrigPriceEl = document.getElementById("pd-price-original");
        var pdDiscountBadgeEl = document.getElementById("pd-discount-badge");
        var pdSalePrice = product.sale_price ? Number(product.sale_price) : null;
        var pdOriginalPrice = product.original_price ? Number(product.original_price) : null;
        var pdHasDiscount = pdSalePrice && pdOriginalPrice && pdOriginalPrice > pdSalePrice;

        if (pdHasDiscount) {
            pdPriceEl.textContent = "UGX " + pdSalePrice.toLocaleString();
            if (pdOrigPriceEl) {
                pdOrigPriceEl.textContent = "UGX " + pdOriginalPrice.toLocaleString();
                pdOrigPriceEl.hidden = false;
            }
            if (pdDiscountBadgeEl) {
                var pdDiscountPct = Math.round((1 - pdSalePrice / pdOriginalPrice) * 100);
                pdDiscountBadgeEl.textContent = "-" + pdDiscountPct + "%";
                pdDiscountBadgeEl.hidden = false;
            }
        } else {
            pdPriceEl.textContent = product.price
                ? `UGX ${Number(product.price).toLocaleString()}`
                : "";
            if (pdOrigPriceEl) pdOrigPriceEl.hidden = true;
            if (pdDiscountBadgeEl) pdDiscountBadgeEl.hidden = true;
        }'''

js_backup = js_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(js_path, js_backup)
js_content = js_content.replace(js_anchor, js_replacement, 1)
with open(js_path, "w", encoding="utf-8") as f:
    f.write(js_content)
print("Patched js. Backup at " + js_backup)

# --- 4. CSS: self-contained styling, not reusing .product-badge.sale
# (which uses position:absolute for card-overlay context - wrong here) ---
css_path = "client/css/style.css"
with open(css_path, encoding="utf-8") as f:
    css_content = f.read()

css_anchor = '''.pd-warranty {'''

n = css_content.count(css_anchor)
if n != 1:
    print(f"ABORT (css): anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

css_replacement = '''.pd-price-original {
    color: #999;
    font-size: 14px;
    font-weight: 400;
    text-decoration: line-through;
    margin-left: 8px;
}

.pd-discount-badge {
    display: inline-block;
    background: #e02020;
    color: #fff;
    font-weight: 700;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: 8px;
    vertical-align: middle;
}

.pd-warranty {'''

css_backup = css_path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(css_path, css_backup)
css_content = css_content.replace(css_anchor, css_replacement, 1)
with open(css_path, "w", encoding="utf-8") as f:
    f.write(css_content)
print("Patched css. Backup at " + css_backup)
