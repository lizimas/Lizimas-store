'use strict';

const express = require('express');
const crypto = require('crypto');
const pool = require('../config/database');
const { initiatePayment, recordPaymentOutcome } = require('../payments/service');
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

  let provider;
  if (providerName) {
    provider = getProvider(providerName);
  } else {
    // No explicit provider: this is the plain "Mobile Money" checkout choice,
    // which covers both MTN and Airtel from one phone-number field rather
    // than asking the customer which telco they're on. Detect the network
    // from the number itself and route to the matching adapter. Falls back
    // to the env-configured default when the number can't be classified —
    // the phone validation below still rejects an invalid number either way.
    const network = detectNetwork(normaliseUgandanMsisdn(phone));
    provider = network === 'AIRTEL' ? getProvider('airtel_money')
      : network === 'MTN' ? getProvider('mtn_momo')
      : defaultProvider();
  }

  // Mobile money providers need a phone; hosted-checkout card payments don't
  // collect one at all (Flutterwave's own page takes the card details), so
  // the requirement is per-provider rather than blanket. Adapters that don't
  // set `requiresMsisdn` are assumed to need one, same as MTN/Airtel today.
  const needsMsisdn = provider.requiresMsisdn !== false;

  let msisdn = null;
  if (needsMsisdn) {
    msisdn = normaliseUgandanMsisdn(phone);
    if (!msisdn) {
      return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid Ugandan mobile number.' });
    }

    // Direct MTN/Airtel can only charge their own network's numbers. Failing
    // here with a clear message beats letting the customer stare at a prompt
    // that will never arrive.
    if (provider.name === 'mtn_momo' && detectNetwork(msisdn) !== 'MTN') {
      return res.status(400).json({
        error: 'unsupported_network',
        message: 'This number is not an MTN Mobile Money number. Please use an MTN line.',
      });
    }
    if (provider.name === 'airtel_money' && detectNetwork(msisdn) !== 'AIRTEL') {
      return res.status(400).json({
        error: 'unsupported_network',
        message: 'This number is not an Airtel Money number. Please use an Airtel line.',
      });
    }
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
      // The one-live-attempt-per-order guard is provider-agnostic (it's an
      // order-level DB constraint), so the live attempt being reused might be
      // a card payment from an earlier request. Its hosted-checkout link was
      // persisted verbatim in request_payload at initiate time — surface it
      // again so the frontend can still redirect rather than falling into
      // the poll loop with nothing to poll productively toward.
      const reusedCheckoutUrl = live[0].provider === 'flutterwave_card'
        ? live[0].request_payload?.data?.link || null
        : null;
      return res.status(200).json({
        paymentId: live[0].id,
        status: live[0].status,
        pollToken: issuePollToken(live[0].id),
        reused: true,
        checkoutUrl: reusedCheckoutUrl || undefined,
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

    // Card checkout has no phone at all, so it needs the order's own contact
    // details instead — Flutterwave's hosted page requires an email.
    let customerEmail = null;
    let customerName = null;
    if (!needsMsisdn) {
      customerEmail = order.customer_email || null;
      customerName = order.customer_name || null;
      if (!customerEmail) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'email_required',
          message: 'An email address is needed to pay by card. Please add one to your order.',
        });
      }
    }

    const { payment, accepted, deferred, result } = await initiatePayment(client, {
      orderId: order.id,
      providerName: provider.name,
      amountMinor,
      currency,
      msisdn,
      customerEmail,
      customerName,
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
      // Only the hosted-checkout card provider sets this — its presence is
      // what tells the frontend to redirect instead of polling.
      checkoutUrl: result?.checkoutUrl || undefined,
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
/* GET /api/payments/by-ref/:externalRef/confirm                       */
/* Redirect-back landing point for hosted checkout (Flutterwave cards). */
/* Unauthenticated by necessity — the customer's browser lands here     */
/* straight from Flutterwave with no session. Safe for the same reason  */
/* the webhook path is: external_ref is a server-generated, unguessable */
/* UUID, already used the same way as the sole lookup key there.        */
/* ------------------------------------------------------------------ */

const EXTERNAL_REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/by-ref/:externalRef/confirm', async (req, res) => {
  const externalRef = req.params.externalRef;
  if (!EXTERNAL_REF_RE.test(externalRef)) {
    return res.status(400).json({ error: 'bad_ref' });
  }

  res.set('Cache-Control', 'no-store');

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT p.*, o.receipt_number
         FROM payments p
         JOIN orders o ON o.id = p.order_id
        WHERE p.external_ref = $1`,
      [externalRef]
    );
    const payment = rows[0];
    if (!payment) return res.status(404).json({ error: 'not_found' });

    // Already settled — a webhook or an earlier hit on this same page beat us
    // to it. Just report it, same short-circuit the webhook route uses.
    if (payment.settled_at) {
      return res.json(statusPayload(payment));
    }

    // Never trust the redirect's own query string (?status=successful is a
    // customer-controlled URL parameter, not proof of anything) — re-query
    // the provider directly, identical to the webhook handler's security
    // model: nothing settles a payment except a fresh fetchStatus() call.
    const provider = getProvider(payment.provider);
    const outcome = await provider.fetchStatus({
      externalRef: payment.external_ref,
      providerRef: payment.provider_ref,
    });

    if (!outcome.status) {
      return res.json(statusPayload(payment));
    }

    await client.query('BEGIN');
    const result = await recordPaymentOutcome(client, {
      paymentId: payment.id,
      outcome,
      source: 'redirect',
      eventKey: `redirect:${payment.provider}:${payment.external_ref}:${outcome.rawStatus || outcome.status}`,
      body: outcome.raw,
      headers: {},
    });
    await client.query('COMMIT');

    for (const effect of result.effects) {
      effect().catch((err) => console.error('[payments] post-commit effect failed', err));
    }

    const { rows: fresh } = await client.query(
      `SELECT p.*, o.receipt_number
         FROM payments p
         JOIN orders o ON o.id = p.order_id
        WHERE p.id = $1`,
      [payment.id]
    );
    return res.json(statusPayload(fresh[0] || payment));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[payments] confirm failed', err);
    return res.status(500).json({ error: 'confirm_failed' });
  } finally {
    client.release();
  }
});

/** Same response shape as GET /:id/status — the frontend's redirect-return
 *  page reuses that endpoint's rendering logic, so the two must match. */
function statusPayload(row) {
  const done = isSettled(row.status);
  return {
    paymentId: row.id,
    orderId: row.order_id,
    status: row.status,
    done,
    failureReason: done && row.status !== 'succeeded' ? row.failure_reason : null,
    receiptNumber: row.status === 'succeeded' ? row.receipt_number : null,
    receiptUrl: row.status === 'succeeded' && row.receipt_number
      ? `/receipt/${row.order_id}`
      : null,
    ...STATUS_COPY[row.status],
  };
}

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
