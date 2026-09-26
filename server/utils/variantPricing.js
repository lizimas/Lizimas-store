// Per-variant prices (migration 138). A variant's customer price comes from
// its own vendor payout through the product's commission snapshot; a variant
// with no payout of its own sells at the product's price.
const { computePricing } = require("./commissionEngine");

function variantPriceFromPayout(product, payout) {
    const rate = product.commission_rate_applied;
    if (rate == null) return null;
    return computePricing({ vendorPayout: payout, rate: Number(rate), fixedFee: Number(product.fixed_fee_applied) || 0 }).customerPrice;
}

// Run after a product's price or commission snapshot changes.
async function repriceVariants(db, product) {
    await db.query(
        `UPDATE product_variants SET price = $2 WHERE product_id = $1 AND vendor_payout IS NULL`,
        [product.id, product.price]
    );
    if (product.commission_rate_applied == null) return;
    const own = await db.query(
        `SELECT id, vendor_payout FROM product_variants WHERE product_id = $1 AND vendor_payout IS NOT NULL`,
        [product.id]
    );
    for (const v of own.rows) {
        const price = variantPriceFromPayout(product, v.vendor_payout);
        if (price) await db.query(`UPDATE product_variants SET price = $1 WHERE id = $2`, [price, v.id]);
    }
}

module.exports = { variantPriceFromPayout, repriceVariants };
