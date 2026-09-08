'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { STATUS } = require('../server/payments/stateMachine');
const { _mapStatus: mapStatus, _toLocalMsisdn: toLocalMsisdn } =
  require('../server/payments/providers/airtel');

/* Status mapping — TS/TIP/TA/TF per Airtel's public collection API docs. */

test('TS maps to succeeded', () => {
  assert.equal(mapStatus('TS'), STATUS.SUCCEEDED);
});

test('TIP maps to initiated so the reconciler keeps chasing it', () => {
  assert.equal(mapStatus('TIP'), STATUS.INITIATED);
});

test('TF maps to failed', () => {
  assert.equal(mapStatus('TF'), STATUS.FAILED);
});

test('TA (ambiguous) maps to null, not failed', () => {
  // Airtel's own documentation describes TA as "could not determine the
  // outcome" — treating it as a hard failure would refuse a payment that
  // might still succeed. Leaving it null means the reconciler keeps polling
  // until either a definite answer arrives or the in-flight expiry kicks in.
  assert.equal(mapStatus('TA'), null);
});

test('an unknown status returns null so the payment is left alone', () => {
  for (const junk of ['ONGOING', 'REJECTED', '', null, undefined, 'null']) {
    assert.equal(mapStatus(junk), null, `${junk} should not map`);
  }
});

test('status matching is case insensitive', () => {
  assert.equal(mapStatus('ts'), STATUS.SUCCEEDED);
  assert.equal(mapStatus('tf'), STATUS.FAILED);
  assert.equal(mapStatus('Tip'), STATUS.INITIATED);
});

/* MSISDN conversion — our normalised 256XXXXXXXXX vs Airtel's local form. */

test('strips the 256 country code for Airtel\'s subscriber.msisdn field', () => {
  assert.equal(toLocalMsisdn('256701234567'), '701234567');
  assert.equal(toLocalMsisdn('256751234567'), '751234567');
});
