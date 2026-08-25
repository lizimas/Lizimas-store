'use strict';

const crypto = require('crypto');
const { STATUS } = require('../stateMachine');

/**
 * Flutterwave adapter — here mainly to prove the contract holds for an
 * aggregator. Same five functions, nothing above it changes.
 *
 * Differences from MTN worth noting:
 *  - Webhooks ARE authenticated, via a static `verif-hash` header you set in
 *    the dashboard. Static, so compare in constant time and still re-query.
 *  - One integration covers MTN MoMo, Airtel Money and cards.
 *  - `tx_ref` is our external_ref; `id` is their transaction id for verify.
 */

const BASE_URL = 'https://api.flutterwave.com/v3';
const SECRET_KEY = process.env.FLW_SECRET_KEY;
const SECRET_HASH = process.env.FLW_SECRET_HASH;

function mapStatus(raw) {
  switch (String(raw || '').toLowerCase()) {
    case 'successful': return STATUS.SUCCEEDED;
    case 'failed':     return STATUS.FAILED;
    case 'cancelled':  return STATUS.CANCELLED;
    case 'pending':    return STATUS.INITIATED;
    default:           return null;
  }
}

async function initiate({ externalRef, amountMinor, currency, msisdn, payerMessage, orderId }) {
  const network = /^2567(6|7|8)/.test(String(msisdn)) ? 'MTN' : 'AIRTEL';

  const res = await fetch(`${BASE_URL}/charges?type=mobile_money_uganda`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tx_ref: externalRef,
      amount: String(amountMinor),      // UGX, whole shillings
      currency,
      network,
      phone_number: String(msisdn).replace(/^\+/, ''),
      email: process.env.STORE_FALLBACK_EMAIL,
      meta: { order_id: orderId },
      narration: payerMessage || 'Lizimas Store order',
    }),
  });

  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(`flw_charge_failed:${res.status}:${data?.message || ''}`);
  }

  return {
    providerRef: data.data?.id ? String(data.data.id) : null,
    accepted: true,
    raw: data,
  };
}

async function fetchStatus({ externalRef, providerRef }) {
  const url = providerRef
    ? `${BASE_URL}/transactions/${providerRef}/verify`
    : `${BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(externalRef)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${SECRET_KEY}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`flw_verify_failed:${res.status}`);

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
  if (id) return `flw:${id}:${status}`;
  return `flw:sha:${crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex')}`;
}

function locatePayment(body) {
  return {
    externalRef: body?.data?.tx_ref || body?.txRef || null,
    providerRef: body?.data?.id ? String(body.data.id) : null,
  };
}

module.exports = {
  name: 'flutterwave',
  supportsSignedWebhooks: true,
  initiate,
  fetchStatus,
  verifyWebhook,
  extractEventKey,
  locatePayment,
};
