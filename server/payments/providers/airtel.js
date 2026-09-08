'use strict';

const crypto = require('crypto');
const { STATUS } = require('../stateMachine');

/**
 * Airtel Money Collection adapter (Uganda).
 *
 * PLACEHOLDER / NOT YET LIVE: written against Airtel Africa's public API
 * documentation and third-party integration write-ups, not against a live
 * sandbox — Ryan has not yet registered for Airtel Africa developer
 * credentials. Set AIRTEL_CLIENT_ID / AIRTEL_CLIENT_SECRET / AIRTEL_BASE_URL
 * once they exist and smoke-test against the staging environment before
 * relying on this in production. Two things specifically could not be
 * confirmed from public sources and need verifying against real sandbox
 * responses:
 *
 *  1. Whether the status-enquiry response includes amount/currency fields.
 *     Every public sample response body found (community SDKs, integration
 *     write-ups) shows only
 *       { data: { transaction: { airtel_money_id, id, message, status } },
 *         status: { code, message, result_code, success } }
 *     — no amount, no currency. This adapter reads amount/currency
 *     defensively from a few plausible locations, but if Airtel's real
 *     response genuinely omits them, `fetchStatus()` returns
 *     amountMinor: null, and service.js's recordPaymentOutcome() will
 *     refuse to settle ANY Airtel payment as succeeded (it requires
 *     outcome.amountMinor to match, same guard that protects every other
 *     provider from a charged-the-wrong-amount bug). That refusal is the
 *     safe failure mode — it shows up as a payment stuck pending with an
 *     'amount_mismatch' activity-log entry rather than silently crediting
 *     an order for an unconfirmed amount. Don't work around it here; once
 *     real responses are visible, either the field is found and mapped
 *     properly, or a deliberate, reviewed exception is added the same way
 *     the MTN sandbox currency-skip exists.
 *
 *  2. Whether/how Airtel signs its callback. Every sample callback body
 *     found includes a `hash` field alongside the transaction, e.g.
 *       { transaction: { id, message, status_code, airtel_money_id }, hash }
 *     but no source found documents the hashing algorithm or the key used
 *     to compute it. Treating an unverifiable "signature" as verified would
 *     be worse than not checking it — a wrong implementation gives false
 *     confidence. So, same as MTN, this adapter reports
 *     supportsSignedWebhooks: false and verifies nothing; the webhook route
 *     never trusts the callback body regardless — it always re-queries
 *     fetchStatus() before ever calling recordPaymentOutcome() — so this is
 *     no less safe than the MTN integration already live in this codebase.
 *     If Airtel's real docs (visible after registering) document the hash
 *     scheme, add real verification and flip the flag.
 */

const BASE_URL = process.env.AIRTEL_BASE_URL;             // staging: https://openapiuat.airtel.africa | prod: https://openapi.airtel.africa
const CLIENT_ID = process.env.AIRTEL_CLIENT_ID;
const CLIENT_SECRET = process.env.AIRTEL_CLIENT_SECRET;
const COUNTRY = 'UG';
const CURRENCY = 'UGX';

let tokenCache = { value: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;

  const res = await fetch(`${BASE_URL}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`airtel_token_failed:${res.status}`);

  const data = await res.json();
  // Refresh a minute early rather than discovering expiry mid-checkout.
  tokenCache = {
    value: data.access_token,
    expiresAt: now + (Number(data.expires_in || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

/**
 * Airtel's status codes: TS (success), TIP (in progress), TF (failed),
 * TA (ambiguous — Airtel could not determine the outcome). TA deliberately
 * maps to null rather than to failed: it means "ask again later," not "it
 * didn't work," so treating it as an unknown status is correct — the
 * reconciler keeps polling until either a definite answer arrives or the
 * MAX_IN_FLIGHT_SECONDS expiry force-expires it, same as any other status
 * this adapter doesn't recognise.
 */
function mapStatus(raw) {
  switch (String(raw || '').toUpperCase()) {
    case 'TS':  return STATUS.SUCCEEDED;
    case 'TF':  return STATUS.FAILED;
    case 'TIP': return STATUS.INITIATED;
    default:    return null;   // includes TA (ambiguous) and anything unrecognised
  }
}

/** 256772123456 (our normalised form) -> 772123456 (Airtel's local subscriber form). */
function toLocalMsisdn(msisdn) {
  const digits = String(msisdn).replace(/^\+?256/, '');
  return digits;
}

async function initiate({ externalRef, amountMinor, msisdn, payerMessage, orderId }) {
  const token = await getToken();

  const body = {
    reference: (payerMessage || `Order ${orderId}`).slice(0, 100),
    subscriber: {
      country: COUNTRY,
      currency: CURRENCY,
      msisdn: toLocalMsisdn(msisdn),
    },
    transaction: {
      amount: Number(amountMinor),   // UGX is zero-decimal: whole shillings, same as MTN
      country: COUNTRY,
      currency: CURRENCY,
      id: externalRef,               // ours — this is the status-lookup key, same role as MTN's X-Reference-Id
    },
  };

  const res = await fetch(`${BASE_URL}/merchant/v1/payments/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      'X-Country': COUNTRY,
      'X-Currency': CURRENCY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status?.success !== true) {
    throw new Error(
      `airtel_payment_failed:${res.status}:${data?.status?.message || data?.error_description || ''}`
    );
  }

  return { providerRef: externalRef, accepted: true, raw: body };
}

async function fetchStatus({ externalRef }) {
  const token = await getToken();

  const res = await fetch(`${BASE_URL}/standard/v1/payments/${externalRef}`, {
    headers: {
      Accept: '*/*',
      'X-Country': COUNTRY,
      'X-Currency': CURRENCY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(`airtel_status_failed:${res.status}`);
  const data = await res.json();
  const txn = data?.data?.transaction || {};

  // Defensive extraction — see the file-header note on why these fields are
  // not confirmed to exist in Airtel's real response.
  const amountMinor = txn.amount != null ? Number(txn.amount)
    : data?.data?.amount != null ? Number(data.data.amount)
    : null;
  const currency = txn.currency || data?.data?.currency || null;

  const status = mapStatus(txn.status);

  return {
    status,
    rawStatus: txn.status,
    amountMinor,
    currency,
    providerRef: txn.airtel_money_id || null,
    failureCode: status === STATUS.FAILED ? (txn.status || 'TF') : null,
    failureReason: status === STATUS.FAILED ? (txn.message || null) : null,
    raw: data,
  };
}

/* --- webhook side --- */

// Airtel's callback includes a `hash` field, but no confirmed public source
// documents the algorithm or key used to compute it — see the file-header
// note. Reporting supportsSignedWebhooks: false means the route never even
// calls this; it's defined for parity with the other adapters and in case a
// verified scheme is added later.
function verifyWebhook() {
  return true;
}

function extractEventKey(body) {
  const id = body?.transaction?.id || '';
  const status = body?.transaction?.status_code || body?.transaction?.status || '';
  if (id && status) return `airtel:${id}:${status}`;
  return `airtel:sha:${crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex')}`;
}

function locatePayment(body) {
  // Airtel echoes back the id we generated (sent as transaction.id at
  // initiation), the same role MTN's X-Reference-Id plays.
  return {
    externalRef: body?.transaction?.id || null,
    providerRef: body?.transaction?.airtel_money_id || null,
  };
}

module.exports = {
  name: 'airtel_money',
  // exported for unit tests
  _mapStatus: mapStatus,
  _toLocalMsisdn: toLocalMsisdn,
  supportsSignedWebhooks: false,
  initiate,
  fetchStatus,
  verifyWebhook,
  extractEventKey,
  locatePayment,
};
