'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normaliseUgandanMsisdn,
  detectNetwork,
  formatForDisplay,
} = require('../server/payments/msisdn');

test('accepts every shape a customer might actually type', () => {
  const expected = '256772123456';
  const inputs = [
    '0772123456',
    '+256772123456',
    '256772123456',
    '256 772 123 456',
    '0772 123 456',
    '+256 (772) 123-456',
    '00256772123456',
    '772123456',
  ];
  for (const input of inputs) {
    assert.equal(normaliseUgandanMsisdn(input), expected, `failed on: ${input}`);
  }
});

test('rejects things that are not Ugandan mobile numbers', () => {
  const bad = [
    '',
    null,
    undefined,
    '12345',
    '0412345678',        // Kampala landline, cannot receive MoMo
    '077212345',         // one digit short
    '07721234567',       // one digit long
    '+254712345678',     // Kenyan
    'abcdefghij',
    '0',
  ];
  for (const input of bad) {
    assert.equal(normaliseUgandanMsisdn(input), null, `should reject: ${input}`);
  }
});

test('normalisation is idempotent', () => {
  const once = normaliseUgandanMsisdn('0772123456');
  assert.equal(normaliseUgandanMsisdn(once), once);
});

test('output is always exactly 12 digits with no plus', () => {
  const n = normaliseUgandanMsisdn('+256 772 123 456');
  assert.equal(n.length, 12);
  assert.match(n, /^\d{12}$/);
  assert.equal(n.includes('+'), false);
});

test('identifies MTN numbers', () => {
  for (const p of ['77', '78', '76', '39']) {
    assert.equal(detectNetwork(`0${p}1234567`), 'MTN', `0${p} should be MTN`);
  }
});

test('identifies Airtel numbers', () => {
  for (const p of ['70', '75', '74']) {
    assert.equal(detectNetwork(`0${p}1234567`), 'AIRTEL', `0${p} should be Airtel`);
  }
});

test('non-MoMo ranges are rejected outright, not assigned to a network', () => {
  // 020 and 031 are real Ugandan ranges but do not carry mobile money.
  // Routing a charge to them produces a prompt that never arrives.
  for (const p of ['20', '31', '41']) {
    assert.equal(normaliseUgandanMsisdn(`0${p}1234567`), null, `0${p} should not normalise`);
    assert.equal(detectNetwork(`0${p}1234567`), null, `0${p} should have no network`);
  }
});

test('returns null network for unusable input rather than guessing', () => {
  assert.equal(detectNetwork('0412345678'), null);
  assert.equal(detectNetwork('nonsense'), null);
});

test('display format is the local form people recognise', () => {
  assert.equal(formatForDisplay('256772123456'), '0772 123 456');
  assert.equal(formatForDisplay('+256772123456'), '0772 123 456');
});

test('display format passes unusable input through untouched', () => {
  assert.equal(formatForDisplay('not a number'), 'not a number');
});

test('anything that normalises always has a known network', () => {
  // The invariant that makes the two functions safe to use together: there is
  // no number that passes validation but routes nowhere.
  const { ALL_PREFIXES } = require('../server/payments/msisdn');
  for (const p of ALL_PREFIXES) {
    const n = normaliseUgandanMsisdn(`0${p}1234567`);
    assert.ok(n, `0${p} should normalise`);
    assert.ok(detectNetwork(n), `0${p} normalised but has no network`);
  }
});
