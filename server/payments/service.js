'use strict';

const crypto = require('crypto');
const { STATUS, canTransition, isSettled } = require('./stateMachine');
const { getProvider } = require('./providers');

// Your existing helpers — adjust paths to match the repo.
const { assignReceiptNumber } = require('../utils/receiptNumber');
const { sendOrderConfirmationEmail } = require('../utils/mailer');
const { logActivity } = require('../utils/activityLog');
const { sign: signReceipt } = require('../routes/receipt');

// Base URL for links that leave the app (emails, receipts). Hardcoding the
// production domain makes locally generated links unusable, since they resolve
// against production where the local order does not exist.
const PUBLIC_BASE_URL =
    String(process.env.PUBLIC_BASE_URL || "https://lizimasstore.com").replace(/\/+$/, "");

/**
 * Backoff for the reconciler, in seconds after initiation.
 * MTN's request-to-pay prompt sits on the customer's handset for a couple of
 * minutes; past that they've walked away.
 */
/**
 * Human-readable rail name for the receipt and admin views. Falls back to the
 * raw provider key so a new adapter shows something recognisable before anyone
 * remembers to add it here.
 */
const PROVIDER_LABELS = {
  mtn_momo: 'MTN MoMo',
  airtel_money: 'Airtel Money',
  flutterwave: 'Flutterwave',
};

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || String(provider || 'Unknown');
}

const POLL_SCHEDULE_SECONDS = [5, 10, 20, 35, 60, 90, 120, 180, 240];
const MAX_IN_FLIGHT_SECONDS = 300;

function nextPollDelay(attempts) {
  return POLL_SCHEDULE_SECONDS[Math.min(attempts, POLL_SCHEDULE_SECONDS.length - 1)];
}

/* ------------------------------------------------------------------ */
/* Initiation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Creates the payment row FIRST, then calls the provider. If the process dies
 * mid-request, the reconciler still finds the row and can query its status.
 * Doing it the other way round loses money.
 *
 * @param {import('pg').PoolClient} client - inside a transaction
 */
async function initiatePayment(client, { orderId, providerName, amountMinor, currency, msisdn, payerMessage }) {
  const provider = getProvider(providerName);
  const externalRef = crypto.randomUUID();

  const { rows } = await client.query(
    `INSERT INTO payments
       (order_id, provider, external_ref, status, amount_minor, currency,
        payer_msisdn, payer_message, next_poll_at)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7, NOW() + ($8 || ' seconds')::interval)
     RETURNING *`,
    [orderId, provider.name, externalRef, amountMinor, currency,
     msisdn, payerMessage || null, String(nextPollDelay(0))]
  );
  const payment = rows[0];

  let result;
  try {
    result = await provider.initiate({
      externalRef,
      amountMinor,
      currency,
      msisdn,
      payerMessage,
      orderId,
    });
  } catch (err) {
    // Network failure is NOT a payment failure — the prompt may well have gone
    // out. Leave it 'pending' for the reconciler rather than marking it failed.
    await client.query(
      `UPDATE payments SET last_status_body = $2, updated_at = NOW() WHERE id = $1`,
      [payment.id, JSON.stringify({ initiate_error: String(err && err.message) })]
    );
    return { payment, accepted: false, deferred: true };
  }

  const { rows: updated } = await client.query(
    `UPDATE payments
        SET status        = 'initiated',
            provider_ref  = COALESCE($2, provider_ref),
            initiated_at  = NOW(),
            request_payload = $3,
            updated_at    = NOW()
      WHERE id = $1
      RETURNING *`,
    [payment.id, result.providerRef || null, JSON.stringify(result.raw || {})]
  );

  return { payment: updated[0], accepted: true, deferred: false };
}

/* ------------------------------------------------------------------ */
/* Outcome application — the single funnel                             */
/* ------------------------------------------------------------------ */

/**
 * The ONLY place a payment changes state. Called by the webhook route (after it
 * has re-queried the provider) and by the reconciler. Never called with a
 * callback body's unverified claims.
 *
 * Returns after-commit effects instead of running them, so a rollback can't
 * leave a customer holding a confirmation email for a payment that didn't stick.
 *
 * @returns {{ applied: boolean, reason?: string, effects: Function[] }}
 */
async function recordPaymentOutcome(client, { paymentId, outcome, source, eventKey, body, headers }) {
  const { rows } = await client.query(
    `SELECT * FROM payments WHERE id = $1 FOR UPDATE`,
    [paymentId]
  );
  const payment = rows[0];
  if (!payment) return { applied: false, reason: 'payment_not_found', effects: [] };

  const from = payment.status;
  const to = outcome.status;

  const record = (applied, ignoredReason) =>
    client.query(
      `INSERT INTO payment_events
         (payment_id, provider, event_key, source, from_status, to_status,
          applied, ignored_reason, headers, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (provider, event_key) DO NOTHING`,
      [payment.id, payment.provider, eventKey, source, from, to,
       applied, ignoredReason || null,
       JSON.stringify(headers || {}), JSON.stringify(body || outcome.raw || {})]
    );

  // Guard 1: legal move?
  const move = canTransition(from, to);
  if (!move.ok) {
    await record(false, move.reason);
    return { applied: false, reason: move.reason, effects: [] };
  }

  // Guard 2: did they charge what we asked for?
  // Only meaningful on success — a failure doesn't need to match anything.
  if (to === STATUS.SUCCEEDED) {
    const amountOk = outcome.amountMinor != null
      && String(outcome.amountMinor) === String(payment.amount_minor);
    const currencyOk = !outcome.currency
      || outcome.currency.toUpperCase() === payment.currency.toUpperCase();

    if (!amountOk || !currencyOk) {
      await record(false, 'amount_mismatch');
      await logActivity({
        action: 'payment.amount_mismatch',
        targetType: 'payment',
        targetId: payment.id,
        after: {
          expected: { amount: payment.amount_minor, currency: payment.currency },
          received: { amount: outcome.amountMinor, currency: outcome.currency },
        },
      });
      // Deliberately do not settle. A human looks at this one.
      return { applied: false, reason: 'amount_mismatch', effects: [] };
    }
  }

  const settled = isSettled(to);

  await client.query(
    `UPDATE payments
        SET status           = $2,
            provider_ref     = COALESCE($3, provider_ref),
            failure_code     = $4,
            failure_reason   = $5,
            last_status_body = $6,
            settled_at       = CASE WHEN $7 THEN NOW() ELSE settled_at END,
            next_poll_at     = CASE WHEN $7 THEN NULL ELSE next_poll_at END,
            updated_at       = NOW()
      WHERE id = $1`,
    [payment.id, to, outcome.providerRef || null,
     outcome.failureCode || null, outcome.failureReason || null,
     JSON.stringify(outcome.raw || {}), settled]
  );

  await record(true, null);

  const effects = [];

  if (to === STATUS.SUCCEEDED) {
    const orderEffects = await onPaymentSucceeded(client, payment);
    effects.push(...orderEffects);
  }

  await logActivity({
    action: `payment.${to}`,
    targetType: 'payment',
    targetId: payment.id,
    before: { status: from },
    after: { status: to, source },
  });

  return { applied: true, effects };
}

/**
 * Everything that happens once money is confirmed. All inside the caller's
 * transaction. Anything touching the outside world is returned, not run.
 */
async function onPaymentSucceeded(client, payment) {
  const { rows } = await client.query(
    `UPDATE orders
        SET amount_paid = COALESCE(amount_paid, 0) + $2,
            paid_at     = COALESCE(paid_at, NOW()),
            status      = CASE WHEN status = 'pending' THEN 'paid' ELSE status END,
            payment_method = $3
        WHERE id = $1
      RETURNING *`,
    [payment.order_id, payment.amount_minor, providerLabel(payment.provider)]
  );
  const order = rows[0];

  // Existing helper already guards against double assignment.
  const receiptNumber = await assignReceiptNumber(client, payment.order_id);

  // The UPDATE above returned the row BEFORE the receipt number was
  // assigned, so order.receipt_number is stale. The email reads it.
  order.receipt_number = receiptNumber;

  // Line items for the email body. Read on the caller's client so this
  // sees the same transaction snapshot as everything above.
  const { rows: items } = await client.query(
    `SELECT product_name, quantity, price
       FROM order_items
      WHERE order_id = $1
      ORDER BY id`,
    [payment.order_id]
  );

  const receiptUrl =
    `${PUBLIC_BASE_URL}/receipt/${order.id}?t=${signReceipt(order.id)}`;

  return [
    // Runs after commit. sendOrderConfirmationEmail returns early when the
    // address is null, which is the guest-checkout-without-email case.
    async () => {
      await sendOrderConfirmationEmail(order.customer_email, order, items, receiptUrl, 'paid');
    },
  ];
}

/* ------------------------------------------------------------------ */

module.exports = {
  initiatePayment,
  recordPaymentOutcome,
  nextPollDelay,
  POLL_SCHEDULE_SECONDS,
  MAX_IN_FLIGHT_SECONDS,
};
