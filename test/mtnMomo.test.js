'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { STATUS } = require('../server/payments/stateMachine');
const { _mapStatus: mapStatus, _parseReason: parseReason } =
  require('../server/payments/providers/mtnMomo');

/* Reason parsing — MTN uses two shapes across environments. */

test('a bare string reason yields both a code and customer-facing text', () => {
  const r = parseReason('APPROVAL_REJECTED');
  assert.equal(r.code, 'APPROVAL_REJECTED');
  assert.equal(r.message, 'You declined the payment request.');
});

test('an object reason keeps its own message', () => {
  const r = parseReason({ code: 'EXPIRED', message: 'Custom text from MTN' });
  assert.equal(r.code, 'EXPIRED');
  assert.equal(r.message, 'Custom text from MTN');
});

test('an object reason without a message falls back to our map', () => {
  const r = parseReason({ code: 'NOT_ENOUGH_FUNDS' });
  assert.equal(r.message, 'There was not enough money in the account.');
});

test('an unmapped code degrades to the raw code, never to null', () => {
  // MTN adding a new reason must not produce a blank failure screen.
  const r = parseReason('SOME_NEW_MTN_CODE');
  assert.equal(r.code, 'SOME_NEW_MTN_CODE');
  assert.equal(r.message, 'SOME_NEW_MTN_CODE');
});

test('a missing reason is null, not undefined', () => {
  for (const junk of [null, undefined, '']) {
    const r = parseReason(junk);
    assert.equal(r.code, null);
    assert.equal(r.message, null);
  }
});

/* Status mapping — verified against live sandbox responses. */

test('SUCCESSFUL maps to succeeded', () => {
  assert.equal(mapStatus('SUCCESSFUL'), STATUS.SUCCEEDED);
});

test('PENDING maps to initiated so the reconciler keeps chasing it', () => {
  assert.equal(mapStatus('PENDING'), STATUS.INITIATED);
});

test('FAILED with reason EXPIRED is promoted to our expired state', () => {
  // Observed live: test number 46733123452 returns FAILED / EXPIRED.
  assert.equal(mapStatus('FAILED', 'EXPIRED'), STATUS.EXPIRED);
});

test('FAILED with a rejection reason stays failed', () => {
  // Observed live: test number 46733123451 returns FAILED / APPROVAL_REJECTED.
  assert.equal(mapStatus('FAILED', 'APPROVAL_REJECTED'), STATUS.FAILED);
});

test('FAILED with no reason stays failed', () => {
  assert.equal(mapStatus('FAILED'), STATUS.FAILED);
  assert.equal(mapStatus('FAILED', null), STATUS.FAILED);
});

test('an unknown status returns null so the payment is left alone', () => {
  // The important guard: a status we do not recognise must not settle
  // anything. The reconciler keeps polling instead of guessing.
  for (const junk of ['ONGOING', 'REJECTED', 'TIMEOUT', '', null, undefined, 'null']) {
    assert.equal(mapStatus(junk), null, `${junk} should not map`);
  }
});

test('status matching is case insensitive', () => {
  assert.equal(mapStatus('successful'), STATUS.SUCCEEDED);
  assert.equal(mapStatus('failed', 'expired'), STATUS.FAILED); // reason is case sensitive
  assert.equal(mapStatus('failed', 'EXPIRED'), STATUS.EXPIRED);
});
