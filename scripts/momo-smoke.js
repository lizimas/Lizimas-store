#!/usr/bin/env node
'use strict';

/**
 * scripts/momo-smoke.js
 *
 * Round-trips the adapter against MTN's sandbox without touching your database:
 * token -> requesttopay -> poll status. Run this before wiring the route, so
 * that when something breaks later you know whether it's MTN or your code.
 *
 *   node scripts/momo-smoke.js
 *   node scripts/momo-smoke.js --msisdn 46733123450 --amount 250
 *
 * IMPORTANT: in the sandbox, any MSISDN that is NOT one of MTN's reserved test
 * numbers returns SUCCESSFUL every time. A green run here proves your
 * credentials and plumbing work — it does NOT prove your failure handling
 * works. For that you need the reserved numbers listed at
 * momodeveloper.mtn.com/api-documentation/testing/, which force PENDING,
 * FAILED and REJECTED outcomes. Pull them from that page and run this script
 * once per number; the exact values change, so I'm not hardcoding them here.
 */

require('dotenv').config();

const crypto = require('crypto');
const provider = require('../server/payments/providers/mtnMomo');
const { normaliseUgandanMsisdn } = require('../server/payments/msisdn');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const RAW_MSISDN = arg('msisdn', '0772123456');
const SHOW_RAW = process.argv.includes('--raw');
const AMOUNT = Number(arg('amount', '100'));
const CURRENCY = process.env.MOMO_CURRENCY || 'EUR';
const POLL_TIMES = [3, 5, 8, 12, 20];

function check() {
  const required = [
    'MOMO_BASE_URL',
    'MOMO_TARGET_ENVIRONMENT',
    'MOMO_COLLECTION_SUBSCRIPTION_KEY',
    'MOMO_API_USER',
    'MOMO_API_KEY',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '));
    console.error('Run scripts/momo-provision.js first.');
    process.exit(1);
  }

  if (process.env.MOMO_TARGET_ENVIRONMENT !== 'sandbox') {
    console.error(`\nRefusing to run: MOMO_TARGET_ENVIRONMENT is "${process.env.MOMO_TARGET_ENVIRONMENT}".`);
    console.error('This script moves real money outside the sandbox.\n');
    process.exit(1);
  }
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  check();

  // Sandbox test numbers aren't valid Ugandan MSISDNs, so allow them through
  // raw while still exercising the normaliser on realistic input.
  const msisdn = normaliseUgandanMsisdn(RAW_MSISDN) || RAW_MSISDN.replace(/\D/g, '');
  const externalRef = crypto.randomUUID();
  const orderId = `smoke-${Date.now()}`;

  console.log('MTN MoMo sandbox smoke test');
  console.log('---------------------------');
  console.log(`payer        ${msisdn}${msisdn === RAW_MSISDN ? ' (raw — assuming reserved test number)' : ''}`);
  console.log(`amount       ${AMOUNT} ${CURRENCY}`);
  console.log(`external_ref ${externalRef}`);
  console.log('');

  // --- 1. requesttopay -----------------------------------------------------
  process.stdout.write('1. requesttopay ... ');
  try {
    await provider.initiate({
      externalRef,
      amountMinor: AMOUNT,
      currency: CURRENCY,
      msisdn,
      payerMessage: 'Lizimas smoke test',
      orderId,
    });
    console.log('202 Accepted');
  } catch (err) {
    console.log('FAILED');
    console.error(`   ${err.message}\n`);
    diagnose(err.message);
    process.exit(1);
  }

  // --- 2. poll -------------------------------------------------------------
  console.log('2. polling status');
  let final = null;

  for (const wait of POLL_TIMES) {
    await sleep(wait);
    let status;
    try {
      status = await provider.fetchStatus({ externalRef });
    } catch (err) {
      console.log(`   +${wait}s  error: ${err.message}`);
      continue;
    }

    console.log(`   +${wait}s  ${status.rawStatus} -> ${status.status}` +
      (status.failureReason ? `  (${status.failureReason})` : ''));

    if (SHOW_RAW) {
      console.log('        raw: ' + JSON.stringify(status.raw));
    }

    if (status.status && status.status !== 'initiated') {
      final = status;
      break;
    }
  }

  console.log('');

  if (!final) {
    console.log('Result: still PENDING after all polls.');
    console.log('That is a valid outcome if you used a reserved PENDING test number.');
    console.log('Your reconciler would keep chasing this until the 5-minute expiry.');
    return;
  }

  // --- 3. assertions -------------------------------------------------------
  console.log(`Result: ${final.status}`);

  const amountOk = Number(final.amountMinor) === AMOUNT;
  const currencyOk = String(final.currency).toUpperCase() === CURRENCY.toUpperCase();

  console.log(`  amount echoed back   ${final.amountMinor} ${amountOk ? 'OK' : 'MISMATCH'}`);
  console.log(`  currency echoed back ${final.currency} ${currencyOk ? 'OK' : 'MISMATCH'}`);
  console.log(`  financialTxnId       ${final.providerRef || '(none)'}`);
  console.log(`  failureCode          ${final.failureCode || '(none)'}`);
  console.log(`  failureReason        ${final.failureReason || '(none)'}`);

  if (SHOW_RAW) {
    console.log('\nFull status payload from MTN:');
    console.log(JSON.stringify(final.raw, null, 2));
    console.log('\nKeys present: ' + Object.keys(final.raw || {}).join(', '));
  }

  if (final.status === 'succeeded' && (!amountOk || !currencyOk)) {
    console.log('\nNote: recordPaymentOutcome() would REFUSE to settle this —');
    console.log('the amount guard fires and a human gets to look at it.');
  }

  if (final.status === 'succeeded' && amountOk && currencyOk) {
    console.log('\nAdapter is wired correctly. Next: exercise the reserved test');
    console.log('numbers for FAILED and PENDING before trusting the failure paths.');
  }
}

function diagnose(message) {
  if (message.includes('401')) {
    console.error('   401 — token rejected. Usually a stale MOMO_API_KEY, or the');
    console.error('   subscription key belongs to a product you did not subscribe to.');
  } else if (message.includes('400')) {
    console.error('   400 — check: currency must be EUR in sandbox; amount must be a');
    console.error('   string; partyId must have no leading + or 0.');
  } else if (message.includes('409')) {
    console.error('   409 — that X-Reference-Id was already used. It is the idempotency');
    console.error('   key, so generate a fresh UUID per attempt.');
  }
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
