// Shared discount-code resolution, used by checkoutController inside its
// own transaction (so the usage-limit increment commits or rolls back with
// the rest of the order) and by the standalone validate-only endpoint the
// checkout page calls as the customer types a code in.
//
// Throws a DiscountError with a customer-facing message on any invalid
// state; returns { id, code, amount } on success. amount is never more than
// subtotal, so a total can never go negative.

class DiscountError extends Error {}

async function resolveDiscountCode(client, rawCode, subtotal) {
    const code = String(rawCode || "").trim();
    if (!code) return { id: null, code: null, amount: 0 };

    // FOR UPDATE: two checkouts racing on the same near-limit code must not
    // both read "under the limit" and both succeed past it.
    const result = await client.query(
        "SELECT * FROM discount_codes WHERE UPPER(code) = UPPER($1) FOR UPDATE",
        [code]
    );

    if (result.rows.length === 0) {
        throw new DiscountError("That discount code doesn't exist.");
    }

    const row = result.rows[0];

    if (!row.is_active) {
        throw new DiscountError("This discount code is no longer active.");
    }
    if (row.starts_at && new Date(row.starts_at) > new Date()) {
        throw new DiscountError("This discount code isn't active yet.");
    }
    if (row.ends_at && new Date(row.ends_at) < new Date()) {
        throw new DiscountError("This discount code has expired.");
    }
    if (row.usage_limit != null && row.times_used >= row.usage_limit) {
        throw new DiscountError("This discount code has reached its usage limit.");
    }
    const minOrder = row.min_order_amount != null ? Number(row.min_order_amount) : null;
    if (minOrder != null && Number(subtotal) < minOrder) {
        throw new DiscountError(
            `This code needs an order of at least UGX ${minOrder.toLocaleString()}.`
        );
    }

    const value = Number(row.value);
    let amount = row.discount_type === "percent"
        ? Number(subtotal) * (value / 100)
        : value;
    // Never exceed the subtotal - a discount cannot make an order free-plus-cash.
    amount = Math.min(amount, Number(subtotal));
    amount = Math.round(amount * 100) / 100;

    return { id: row.id, code: row.code, amount };
}

async function recordDiscountCodeUsage(client, discountCodeId) {
    if (!discountCodeId) return;
    await client.query(
        "UPDATE discount_codes SET times_used = times_used + 1 WHERE id = $1",
        [discountCodeId]
    );
}

module.exports = { DiscountError, resolveDiscountCode, recordDiscountCodeUsage };
