'use strict';

const express = require('express');
const crypto = require('crypto');
const pool = require('../config/database');
const { initiatePayment } = require('../payments/service');
const { getProvider, defaultProvider } = require('../payments/providers');
const { isSettled } = require('../payments/stateMachine');
const { normaliseUgandanMsisdn, detectNetwork } = require('../payments/msisdn');

const router = express.Router();

const POLL_TOKEN_SECRET = process.env.PAYMENT_POLL_SECRET;
const POLL_TOKEN_TTL_SECONDS = 15 * 60;

/* ------------------------------------------------------------------ */
/* Poll tokens                                                         */
/* ------------------------------------------------------------------ */

/**
 * Guests check out without an account, so the status endpoint can't rely on a
 * JWT alone. We issue a short-lived HMAC token scoped to one payment id —
 * same pattern as the signed receipt URLs.
 */
function issuePollToken(paymentId) {
  const exp = Math.floor(Date.now() / 1000) + POLL_TOKEN_TTL_SECONDS;
  const payload = `${paymentId}.${exp}`;
  const sig = crypto.createHmac('sha256', POLL_TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyPollToken(token, paymentId) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;

  const [id, exp, sig] = parts;
  if (String(id) !== String(paymentId)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;

  const expected = crypto
    .createHmac('sha256', POLL_TOKEN_SECRET)
    .update(`${id}.${exp}`)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

// Normalisation lives in server/payments/msisdn.js and is unit tested there.

/** Customer-facing copy per state. Kept server-side so the two stay in sync. */
const STATUS_COPY = {
  pending:   { headline: 'Starting payment…',        detail: 'Hold on a moment.' },
  initiated: { headline: 'Check your phone',         detail: 'Enter your Mobile Money PIN to approve the payment.' },
  succeeded: { headline: 'Payment received',         detail: 'Your order is confirmed. A receipt is on its way.' },
  failed:    { headline: 'Payment failed',           detail: 'The payment did not go through. You can try again.' },
  expired:   { headline: 'Payment request expired',  detail: 'The prompt timed out. Start again when you are ready.' },
  cancelled: { headline: 'Payment cancelled',        detail: 'No money was taken.' },
  refunded:  { headline: 'Payment refunded',         detail: 'This payment has been refunded.' },
};

/* ------------------------------------------------------------------ */
/* POST /api/payments  — start a payment for an order                  */
/* ------------------------------------------------------------------ */

router.post('/', async (req, res) => {
  const { orderId, phone, provider: providerName } = req.body || {};

  const msisdn = normaliseUgandanMsisdn(phone);
  if (!msisdn) {
    return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid Ugandan mobile number.' });
  }

  const provider = providerName ? getProvider(providerName) : defaultProvider();

  // Direct MTN can only charge MTN numbers. Failing here with a clear message
  // beats letting the customer stare at a prompt that will never arrive.
  if (provider.name === 'mtn_momo' && detectNetwork(msisdn) !== 'MTN') {
    return res.status(400).json({
      error: 'unsupported_network',
      message: 'This number is not an MTN Mobile Money number. Please use an MTN line.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the order so two taps on "Pay" can't both get through.
    const { rows: orderRows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = orderRows[0];

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'order_not_found' });
    }

    // Ownership: logged-in customers must own it; guests must present the
    // order's own guest token. Never trust orderId alone.
    if (!ownsOrder(req, order)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    if (order.paid_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_paid', receiptNumber: order.receipt_number });
    }

    // Reuse a live attempt rather than firing a second prompt at the customer.
    const { rows: live } = await client.query(
      `SELECT * FROM payments
        WHERE order_id = $1 AND status IN ('pending','initiated')
        ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    if (live[0]) {
      await client.query('COMMIT');
      return res.status(200).json({
        paymentId: live[0].id,
        status: live[0].status,
        pollToken: issuePollToken(live[0].id),
        reused: true,
        ...STATUS_COPY[live[0].status],
      });
    }

    // Amount comes from the order, never from the request body. The client
    // does not get a say in what it is charged.
    const amountMinor = Number(order.total);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'invalid_order_total' });
    }

    const currency = process.env.MOMO_CURRENCY || 'UGX';

    const { payment, accepted, deferred } = await initiatePayment(client, {
      orderId: order.id,
      providerName: provider.name,
      amountMinor,
      currency,
      msisdn,
      payerMessage: `Lizimas Store order #${order.id}`,
    });

    await client.query('COMMIT');

    return res.status(202).json({
      paymentId: payment.id,
      status: payment.status,
      pollToken: issuePollToken(payment.id),
      accepted,
      // deferred = the provider call failed but the prompt may still have gone
      // out. The reconciler decides. Don't tell the customer it failed.
      deferred,
      ...STATUS_COPY[payment.status],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[payments] initiate failed', err);
    return res.status(500).json({ error: 'payment_start_failed' });
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/payments/:id/status  — polled by the checkout page         */
/* ------------------------------------------------------------------ */

router.get('/:id/status', async (req, res) => {
  const paymentId = Number(req.params.id);
  if (!Number.isInteger(paymentId)) return res.status(400).json({ error: 'bad_id' });

  const token = req.query.t || req.get('X-Payment-Poll-Token');
  if (!verifyPollToken(token, paymentId)) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.status, p.failure_reason, p.created_at,
              o.id AS order_id, o.receipt_number, o.paid_at
         FROM payments p
         JOIN orders o ON o.id = p.order_id
        WHERE p.id = $1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'not_found' });

    const done = isSettled(row.status);

    // Cache-Control matters: Cloudflare will happily serve a stale 'initiated'
    // for the whole poll window otherwise.
    res.set('Cache-Control', 'no-store');

    return res.json({
      paymentId: row.id,
      orderId: row.order_id,
      status: row.status,
      done,
      // Only surface a reason on terminal failure — mid-flight noise confuses people.
      failureReason: done && row.status !== 'succeeded' ? row.failure_reason : null,
      receiptNumber: row.status === 'succeeded' ? row.receipt_number : null,
      receiptUrl: row.status === 'succeeded' && row.receipt_number
        ? `/receipt/${row.order_id}`
        : null,
      ...STATUS_COPY[row.status],
    });
  } catch (err) {
    console.error('[payments] status failed', err);
    return res.status(500).json({ error: 'status_failed' });
  }
});

/* ------------------------------------------------------------------ */

function ownsOrder(req, order) {
  // Logged-in customer: orders.user_id is the owning column. There is no
  // customer_id on this table - reading one silently produced NaN and made
  // this branch unreachable.
  if (req.user && req.user.id && order.user_id != null
      && Number(order.user_id) === Number(req.user.id)) {
    return true;
  }

  // Guest: prove possession of the number the order was placed with. Both
  // sides go through the same normaliser, so stored '+256...' matches a
  // submitted '0...' or bare 9-digit.
  const claimed = normaliseUgandanMsisdn(req.get('X-Guest-Phone') || (req.body && req.body.phone));
  const onOrder = normaliseUgandanMsisdn(order.phone);
  if (claimed && onOrder && claimed === onOrder) return true;
  return false;
}

module.exports = router;
module.exports.issuePollToken = issuePollToken;
module.exports.verifyPollToken = verifyPollToken;
