'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { STATUS } = require('../server/payments/stateMachine');
const {
  _mapStatus: mapStatus,
  extractEventKey,
  locatePayment,
  verifyWebhook,
} = require('../server/payments/providers/flutterwaveCard');

/* Status mapping — identical vocabulary to the mobile-money adapter, since
 * both go through Flutterwave's same transaction-status field. */

test('successful maps to succeeded', () => {
  assert.equal(mapStatus('successful'), STATUS.SUCCEEDED);
});

test('failed maps to failed', () => {
  assert.equal(mapStatus('failed'), STATUS.FAILED);
});

test('cancelled maps to cancelled', () => {
  assert.equal(mapStatus('cancelled'), STATUS.CANCELLED);
});

test('pending maps to initiated', () => {
  assert.equal(mapStatus('pending'), STATUS.INITIATED);
});

test('an unrecognised status returns null', () => {
  for (const junk of ['ongoing', '', null, undefined]) {
    assert.equal(mapStatus(junk), null, `${junk} should not map`);
  }
});

/* Webhook plumbing */

test('extractEventKey is namespaced separately from mobile money (flw_card: vs flw:)', () => {
  const key = extractEventKey({ data: { id: 12345, status: 'successful' } });
  assert.equal(key, 'flw_card:12345:successful');
});

test('extractEventKey falls back to a body hash when nothing identifies the event', () => {
  const key = extractEventKey({});
  assert.ok(key.startsWith('flw_card:sha:'));
});

test('locatePayment reads tx_ref/id the same way the mobile money adapter does', () => {
  const loc = locatePayment({ data: { tx_ref: 'abc-123', id: 999 } });
  assert.deepEqual(loc, { externalRef: 'abc-123', providerRef: '999' });
});

// SECRET_HASH is read from process.env once, at module load — same as the
// live flutterwave.js adapter — so a test can't reassign it after require()
// and see the change. That means these tests can only exercise the two
// "definitely reject" paths that hold no matter what secret is configured,
// not a real accept/reject comparison (which would need FLW_SECRET_HASH set
// before Node even loads this module — covered instead by manual testing
// against a real Flutterwave webhook once credentials exist).

test('verifyWebhook rejects when there is no verif-hash header', () => {
  assert.equal(verifyWebhook(Buffer.from('{}'), {}), false);
});

test('verifyWebhook never throws on a present-but-wrong-length header', () => {
  // Guards the timingSafeEqual call: Buffer.from on mismatched lengths would
  // throw if the length check weren't guarding it first.
  assert.doesNotThrow(() => verifyWebhook(Buffer.from('{}'), { 'verif-hash': 'x' }));
});
