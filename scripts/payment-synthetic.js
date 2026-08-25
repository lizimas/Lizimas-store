#!/usr/bin/env node
'use strict';

/**
 * scripts/payment-synthetic.js
 *
 * Exercises the payment success path without a provider.
 *
 * Sandbox cannot reach this code today, and the first real execution would
 * otherwise be a live customer whose money has already moved. This fabricates
 * an 'initiated' payment against a real order and feeds a SUCCEEDED outcome
 * through recordPaymentOutcome() - the same function a webhook and the
 * reconciler both call - then reports what actually happened.
 *
 * Defaults to ROLLBACK. Nothing is persisted and no effects run unless you
 * pass --commit.
 *
 *   node scripts/payment-synthetic.js --order=26
 *   node scripts/payment-synthetic.js --order=26 --email=you@gmail.com --commit
 *   node scripts/payment-synthetic.js --order=26 --commit --no-email
 *
 * Flags:
 *   --order=N     order id to attach the payment to (required)
 *   --email=ADDR  set orders.customer_email first, so the mailer does not
 *                 return early. Use your own address - this sends a real email.
 *   --commit      persist and run post-commit effects. Without it, everything
 *                 rolls back and effects are skipped.
 *   --no-email    commit, but do not run the effect closures.
 */

require('dotenv').config();

const crypto = require('crypto');
const pool = require('../server/config/database');
const { recordPaymentOutcome } = require('../server/payments/service');
const { STATUS } = require('../server/payments/stateMachine');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const orderId = Number(arg('order'));
const email = arg('email', null);
const COMMIT = flag('commit');
const RUN_EFFECTS = COMMIT && !flag('no-email');

if (!Number.isInteger(orderId) || orderId <= 0) {
  console.error('Usage: node scripts/payment-synthetic.js --order=N [--email=ADDR] [--commit] [--no-email]');
  process.exit(1);
}

function line() {
  console.log('-'.repeat(60));
}

(async () => {
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');

    // --- the order --------------------------------------------------------
    const { rows: orderRows } = await client.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );
    const order = orderRows[0];
    if (!order) throw new Error(`order ${orderId} not found`);

    const { rows: itemRows } = await client.query(
      'SELECT count(*)::int AS n FROM order_items WHERE order_id = $1',
      [orderId]
    );
    if (itemRows[0].n === 0) {
      console.warn(`WARN order ${orderId} has no order_items - the email table will be empty`);
    }

    console.log(`order ${order.id}  status=${order.status}  total=${order.total}  email=${order.customer_email || '(none)'}  items=${itemRows[0].n}`);

    if (email) {
      await client.query('UPDATE orders SET customer_email = $2 WHERE id = $1', [orderId, email]);
      console.log(`set customer_email = ${email}`);
    }

    // --- fabricate an in-flight payment ------------------------------------
    // Must be 'initiated': the state machine forbids pending -> succeeded.
    const amountMinor = Number(order.total);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error(`order total ${order.total} is not a whole number of shillings`);
    }

    const externalRef = crypto.randomUUID();
    const { rows: payRows } = await client.query(
      `INSERT INTO payments
         (order_id, provider, external_ref, provider_ref, status,
          amount_minor, currency, payer_msisdn, payer_message)
       VALUES ($1, $2, $3, $4, 'initiated', $5, 'UGX', $6, $7)
       RETURNING *`,
      [orderId, 'mtn_momo', externalRef, `synthetic-${externalRef.slice(0, 8)}`,
       amountMinor, '256770000000', 'Synthetic test']
    );
    const payment = payRows[0];
    console.log(`created payment ${payment.id}  status=${payment.status}  amount_minor=${payment.amount_minor}`);

    // --- the thing under test ----------------------------------------------
    line();
    const result = await recordPaymentOutcome(client, {
      paymentId: payment.id,
      outcome: {
        status: STATUS.SUCCEEDED,
        amountMinor,
        currency: 'UGX',
        providerRef: payment.provider_ref,
        raw: { synthetic: true },
      },
      source: 'manual',
      eventKey: `synthetic-${externalRef}`,
      body: { synthetic: true },
      headers: { 'user-agent': 'payment-synthetic.js' },
    });
    line();

    console.log('result:', JSON.stringify({ applied: result.applied, reason: result.reason, effects: result.effects.length }));

    if (!result.applied) {
      throw new Error(`outcome not applied: ${result.reason}`);
    }

    // --- what changed -------------------------------------------------------
    const { rows: after } = await client.query(
      `SELECT p.status AS payment_status, p.settled_at,
              o.status AS order_status, o.amount_paid, o.paid_at, o.receipt_number
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.id = $1`,
      [payment.id]
    );
    console.log('after:', JSON.stringify(after[0], null, 2));

    const { rows: events } = await client.query(
      `SELECT source, from_status, to_status, applied, ignored_reason
         FROM payment_events WHERE payment_id = $1 ORDER BY id`,
      [payment.id]
    );
    console.log('payment_events:', JSON.stringify(events, null, 2));

    const { rows: acts } = await client.query(
      `SELECT action, target_type, target_id, actor_email
         FROM activity_log ORDER BY id DESC LIMIT 3`
    );
    console.log('activity_log (latest 3, written on its own pool connection):');
    console.log(JSON.stringify(acts, null, 2));

    if (COMMIT) {
      await client.query('COMMIT');
      committed = true;
      console.log('\nCOMMITTED');
    } else {
      await client.query('ROLLBACK');
      console.log('\nROLLED BACK - nothing persisted. Re-run with --commit to keep it.');
    }

    // --- post-commit effects ------------------------------------------------
    if (RUN_EFFECTS) {
      line();
      console.log(`running ${result.effects.length} effect(s)...`);
      for (const effect of result.effects) {
        try {
          await effect();
          console.log('effect OK');
        } catch (err) {
          console.error('EFFECT FAILED:', err.message);
          console.error(err.stack);
        }
      }
    } else if (committed) {
      console.log('\neffects skipped (--no-email)');
    } else {
      console.log('effects skipped (rollback mode)');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFAILED:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
