/**
 * Assigns a receipt number to an order, once.
 *
 * Receipt numbers are financial identifiers, so they are issued only when
 * payment is confirmed - never at order creation. The receipt_number IS NULL
 * guard makes this idempotent: a retried webhook or a double-verified payment
 * cannot burn a second number on the same order.
 *
 * @param {object} q  A pg client or pool - whichever the caller is using.
 * @param {number} orderId
 * @returns {Promise<string|null>} The number assigned, or null if it already had one.
 */
async function assignReceiptNumber(q, orderId) {
  const { rows } = await q.query(
    `UPDATE orders
        SET receipt_number = 'RCP-' || LPAD(nextval('receipt_number_seq')::text, 5, '0'),
            paid_at = COALESCE(paid_at, NOW()),
            amount_paid = total
      WHERE id = $1
        AND receipt_number IS NULL
      RETURNING receipt_number`,
    [orderId]
  );
  return rows.length ? rows[0].receipt_number : null;
}

module.exports = { assignReceiptNumber };
