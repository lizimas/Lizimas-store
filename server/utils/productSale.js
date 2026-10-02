// Sale Price on the product form (Oct 2026). The vendor types a sale price
// in their own terms plus a start and end date; Lizimas adds the commission
// and the sale runs as an approved vendor_promotions row with
// source = 'product_form' - the store, the % off badge and checkout already
// read those. See migrations/146_product_sale_and_certifications.sql.
const { calculatePricing } = require("./commissionEngine");

// A sale up to this % off goes live by itself; a bigger one waits for an
// admin to approve it in Promotions (Ryan, Oct 2026).
const AUTO_APPROVE_MAX_PERCENT = 30;

// "2026-10-05" (a day) or a full timestamp -> Date, or null.
function parseDay(value, endOfDay) {
    const t = String(value == null ? "" : value).trim();
    if (!t) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(t)
        ? new Date(t + (endOfDay ? "T23:59:59+03:00" : "T00:00:00+03:00"))   // Uganda time
        : new Date(t);
    return isNaN(d.getTime()) ? null : d;
}

// -> { ok, sent, sale: null | { vendorPrice, startsAt, endsAt } } | { ok: false, error }
// `sent` is false when the form didn't include the sale fields at all (older
// forms, admin edits) - then nothing about the sale is changed.
function readSaleFields(body, vendorPrice, now) {
    const b = body || {};
    if (b.sale_price === undefined && b.sale_start === undefined && b.sale_end === undefined) return { ok: true, sent: false, sale: null };
    const raw = String(b.sale_price == null ? "" : b.sale_price).trim();
    if (!raw) return { ok: true, sent: true, sale: null };
    const sale = Number(raw);
    if (!Number.isFinite(sale) || sale <= 0) return { ok: false, error: "The sale price must be a number above 0." };
    if (Number.isFinite(Number(vendorPrice)) && sale >= Number(vendorPrice)) return { ok: false, error: "The sale price must be lower than the price." };
    const startsAt = parseDay(b.sale_start, false) || new Date(now || Date.now());
    const endsAt = parseDay(b.sale_end, true);
    if (!endsAt) return { ok: false, error: "Choose the sale end date." };
    if (endsAt <= startsAt) return { ok: false, error: "The sale end date must be after the sale start date." };
    if (endsAt <= new Date(now || Date.now())) return { ok: false, error: "The sale end date has already passed." };
    return { ok: true, sent: true, sale: { vendorPrice: sale, startsAt, endsAt } };
}

// Saves (or removes) the product-form sale. db: pool or client.
// -> { note } - a short message for the vendor when the sale couldn't run.
async function syncProductSale(db, { productId, vendorId, categoryId, customerPrice, sale }, deps) {
    const price = (deps && deps.calculatePricing) || calculatePricing;
    await db.query(`DELETE FROM vendor_promotions WHERE product_id = $1 AND source = 'product_form'`, [productId]);
    if (!sale) {
        await db.query(`UPDATE products SET sale_vendor_price = NULL, sale_starts_at = NULL, sale_ends_at = NULL WHERE id = $1`, [productId]);
        return { note: null };
    }
    await db.query(`UPDATE products SET sale_vendor_price = $2, sale_starts_at = $3, sale_ends_at = $4 WHERE id = $1`,
        [productId, sale.vendorPrice, sale.startsAt, sale.endsAt]);
    const priced = await price({ vendorPayout: sale.vendorPrice, categoryId: categoryId ? Number(categoryId) : null });
    const customerSale = Number(priced.customerPrice);
    if (!(customerSale < Number(customerPrice))) {
        return { note: "The sale price is too close to the price to show a discount - lower it a little." };
    }
    const other = await db.query(
        `SELECT 1 FROM vendor_promotions WHERE product_id = $1 AND source <> 'product_form'
            AND (status = 'pending' OR (status = 'approved' AND ends_at > now())) LIMIT 1`, [productId]);
    if (other.rows.length) {
        return { note: "This product already has a promotion from the Promotions page, so the sale price was saved but is not running." };
    }
    const percentOff = Math.round((1 - customerSale / Number(customerPrice)) * 1000) / 10;
    const auto = percentOff <= AUTO_APPROVE_MAX_PERCENT;
    await db.query(
        `INSERT INTO vendor_promotions (vendor_id, product_id, original_price, proposed_sale_price, starts_at, ends_at, status, reviewed_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7::varchar, CASE WHEN $7::varchar = 'approved' THEN now() END, 'product_form')`,
        [vendorId, productId, customerPrice, customerSale, sale.startsAt, sale.endsAt, auto ? "approved" : "pending"]);
    return {
        note: auto ? null : `This sale is ${Math.round(percentOff)}% off. Sales above ${AUTO_APPROVE_MAX_PERCENT}% off are checked by Lizimas Store first - it will start once it is approved.`,
        customerSale, percentOff, status: auto ? "approved" : "pending"
    };
}

module.exports = { readSaleFields, syncProductSale, parseDay, AUTO_APPROVE_MAX_PERCENT };
