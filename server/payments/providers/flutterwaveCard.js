'use strict';

const crypto = require('crypto');
const { STATUS } = require('../stateMachine');

/**
 * Flutterwave card payments — hosted/Standard checkout.
 *
 * Unlike `flutterwave.js` (mobile money, a direct charge with no redirect),
 * cards go through Flutterwave's own hosted payment page: we ask for a
 * checkout link, send the customer there, and Flutterwave brings them back
 * to `redirect_url` with `tx_ref` + `status` in the query string. Flutterwave
 * handles card capture and 3D Secure entirely on their page — this app never
 * sees a card number, which is the whole point of choosing hosted checkout.
 *
 * Deliberately NOT sharing code with flutterwave.js: that adapter is already
 * live for mobile money, and duplicating ~40 lines here is a smaller risk
 * than refactoring a working payment path to share internals with a new one.
 * Reuses the same FLW_SECRET_KEY / FLW_SECRET_HASH env vars — one Flutterwave
 * account covers both.
 *
 * `initiate()` returns a `checkoutUrl` alongside the normal contract fields.
 * service.js's initiatePayment() passes the provider's raw initiate() result
 * back to its caller precisely so checkoutPayment.js can surface this to the
 * frontend, which redirects the browser instead of starting the poll loop.
 */

const BASE_URL = 'https://api.flutterwave.com/v3';
const SECRET_KEY = process.env.FLW_SECRET_KEY;
const SECRET_HASH = process.env.FLW_SECRET_HASH;

// Same duplicated-per-module read as service.js and checkoutController.js —
// see the note in docs/PAYMENTS.md about consolidating this.
const PUBLIC_BASE_URL =
  String(process.env.PUBLIC_BASE_URL || 'https://lizimasstore.com').replace(/\/+$/, '');

function mapStatus(raw) {
  switch (String(raw || '').toLowerCase()) {
    case 'successful': return STATUS.SUCCEEDED;
    case 'failed':     return STATUS.FAILED;
    case 'cancelled':  return STATUS.CANCELLED;
    case 'pending':    return STATUS.INITIATED;
    default:           return null;
  }
}

async function initiate({ externalRef, amountMinor, currency, orderId, customerEmail, customerName, payerMessage }) {
  if (!customerEmail) {
    // Flutterwave's hosted checkout requires an email; this should already be
    // caught by checkoutPayment.js before calling initiatePayment(), but a
    // provider adapter should never trust its caller silently got that right.
    throw new Error('flw_card_missing_email');
  }

  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: externalRef,
      amount: String(amountMinor),   // UGX, whole shillings
      currency,
      redirect_url: `${PUBLIC_BASE_URL}/payment-return.html`,
      customer: {
        email: customerEmail,
        name: customerName || undefined,
      },
      customizations: {
        title: 'Lizimas Store',
        description: payerMessage || `Order ${orderId}`,
      },
      // Without this, Flutterwave's hosted page shows every payment method
      // enabled on the merchant account (mobile money, bank transfer, USSD,
      // card...) — which would duplicate the separate Mobile Money flow this
      // store already has. This provider is specifically the card option, so
      // pin the hosted page to cards only.
      payment_options: 'card',
      meta: { order_id: orderId },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.status !== 'success' || !data.data?.link) {
    throw new Error(`flw_card_init_failed:${res.status}:${data?.message || ''}`);
  }

  return {
    providerRef: null,        // not known until the customer completes checkout
    accepted: true,
    checkoutUrl: data.data.link,
    raw: data,
  };
}

// Identical endpoint/shape to flutterwave.js's fetchStatus — both charge
// types verify through the same transactions API.
async function fetchStatus({ externalRef, providerRef }) {
  const url = providerRef
    ? `${BASE_URL}/transactions/${providerRef}/verify`
    : `${BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(externalRef)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${SECRET_KEY}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`flw_card_verify_failed:${res.status}`);

  const tx = data.data || {};
  return {
    status: mapStatus(tx.status),
    rawStatus: tx.status,
    amountMinor: tx.amount != null ? Number(tx.amount) : null,
    currency: tx.currency,
    providerRef: tx.id ? String(tx.id) : providerRef,
    failureCode: tx.processor_response ? 'processor_response' : null,
    failureReason: tx.processor_response || null,
    raw: data,
  };
}

// NOTE on reachability: Flutterwave sends every webhook for the account to
// one configured URL, so in practice the live webhook route resolves the
// URL-derived 'flutterwave' adapter (not this one) even for card events, and
// paymentWebhook.js aliases its payment lookup across both provider names to
// compensate (see PROVIDER_LOOKUP_ALIASES there). These three functions stay
// here to satisfy the adapter contract and for unit tests, and they'd become
// live if this ever runs behind its own dedicated webhook URL, but today the
// card flow's real-time confirmation path is the redirect-confirm endpoint
// (GET /api/payments/by-ref/:externalRef/confirm), not this webhook.
function verifyWebhook(rawBody, headers) {
  const given = headers['verif-hash'] || '';
  if (!SECRET_HASH || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(SECRET_HASH);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractEventKey(body) {
  const id = body?.data?.id || body?.id || '';
  const status = body?.data?.status || '';
  if (id) return `flw_card:${id}:${status}`;
  return `flw_card:sha:${crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex')}`;
}

function locatePayment(body) {
  return {
    externalRef: body?.data?.tx_ref || body?.txRef || null,
    providerRef: body?.data?.id ? String(body.data.id) : null,
  };
}

module.exports = {
  name: 'flutterwave_card',
  requiresMsisdn: false,
  // exported for unit tests
  _mapStatus: mapStatus,
  supportsSignedWebhooks: true,
  initiate,
  fetchStatus,
  verifyWebhook,
  extractEventKey,
  locatePayment,
};
