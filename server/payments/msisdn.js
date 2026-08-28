'use strict';

/**
 * Ugandan mobile number handling.
 *
 * MTN's Collection API wants bare international format: 256772123456.
 * No plus, no leading zero, no spaces. Customers will type all three.
 * Getting this wrong produces a 400 from MTN that reads like a credentials
 * problem, so it's worth its own module and its own tests.
 *
 * Validation is derived from the prefix lists rather than a hand-written
 * regex. Adding a newly allocated block means editing one array, and a
 * number that normalises is guaranteed to have a network — no gap where a
 * syntactically fine number gets charged to a rail that can't receive it.
 *
 * Worth re-checking against UCC's current numbering plan before go-live;
 * operators get allocated new blocks and this list will drift.
 */

// Mobile prefixes, without the leading 0.
// Deliberately conservative: only ranges that actually carry mobile money.
// Ranges like 020, 031 and 041 exist in Uganda but are not MoMo-capable.
const MTN_PREFIXES    = ['77', '78', '76', '79', '39'];
const AIRTEL_PREFIXES = ['70', '75', '74'];

const ALL_PREFIXES = [...MTN_PREFIXES, ...AIRTEL_PREFIXES];

// 256 + 2-digit prefix + 7 subscriber digits = 12
const MSISDN_RE = new RegExp(`^256(${ALL_PREFIXES.join('|')})\\d{7}$`);

/**
 * @returns {string|null} 12-digit MSISDN (256XXXXXXXXX), or null if unusable.
 */
function normaliseUgandanMsisdn(input) {
  if (input == null) return null;

  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  // 00256... international dialling prefix
  if (digits.startsWith('00256')) digits = digits.slice(2);

  let candidate = null;
  if (digits.length === 12 && digits.startsWith('256')) candidate = digits;
  else if (digits.length === 10 && digits.startsWith('0')) candidate = `256${digits.slice(1)}`;
  else if (digits.length === 9) candidate = `256${digits}`;

  if (!candidate) return null;
  return MSISDN_RE.test(candidate) ? candidate : null;
}

/**
 * Which rail a number belongs to. Aggregators need this at charge time;
 * direct MTN integration uses it to reject Airtel numbers early rather than
 * letting the customer wait for a prompt that never arrives.
 *
 * @returns {'MTN'|'AIRTEL'|null}
 */
function detectNetwork(msisdn) {
  const n = normaliseUgandanMsisdn(msisdn);
  if (!n) return null;

  const prefix = n.slice(3, 5);
  if (MTN_PREFIXES.includes(prefix)) return 'MTN';
  if (AIRTEL_PREFIXES.includes(prefix)) return 'AIRTEL';
  return null;   // unreachable while the regex is prefix-derived, kept as a belt
}

/** 0772 123 456 — for receipts and confirmation screens. */
function formatForDisplay(msisdn) {
  const n = normaliseUgandanMsisdn(msisdn);
  if (!n) return String(msisdn == null ? '' : msisdn);
  const local = `0${n.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

module.exports = {
  normaliseUgandanMsisdn,
  detectNetwork,
  formatForDisplay,
  MTN_PREFIXES,
  AIRTEL_PREFIXES,
  ALL_PREFIXES,
};
