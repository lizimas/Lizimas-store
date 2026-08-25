'use strict';

/**
 * Run:  node --test test/
 *
 * Uses node:test so there's nothing to npm install — matters when you're
 * working from Termux.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATUS,
  TRANSITIONS,
  canTransition,
  isSettled,
  isInFlight,
} = require('../server/payments/stateMachine');

const ALL = Object.values(STATUS);

/* ------------------------------------------------------------------ */
/* Legal moves                                                         */
/* ------------------------------------------------------------------ */

test('the happy path is legal end to end', () => {
  assert.ok(canTransition(STATUS.PENDING, STATUS.INITIATED).ok);
  assert.ok(canTransition(STATUS.INITIATED, STATUS.SUCCEEDED).ok);
  assert.ok(canTransition(STATUS.SUCCEEDED, STATUS.REFUNDED).ok);
});

test('an initiated payment can end in any of the four unhappy ways', () => {
  for (const end of [STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED, STATUS.SUCCEEDED]) {
    assert.ok(canTransition(STATUS.INITIATED, end).ok, `initiated -> ${end} should be legal`);
  }
});

test('a pending payment can fail before it ever reaches the provider', () => {
  assert.ok(canTransition(STATUS.PENDING, STATUS.FAILED).ok);
  assert.ok(canTransition(STATUS.PENDING, STATUS.CANCELLED).ok);
});

/* ------------------------------------------------------------------ */
/* The guarantees that protect money                                   */
/* ------------------------------------------------------------------ */

test('pending cannot jump straight to succeeded', () => {
  // A provider that reports success on a payment we never sent is a bug or an
  // attack. Either way it does not settle.
  const r = canTransition(STATUS.PENDING, STATUS.SUCCEEDED);
  assert.equal(r.ok, false);
  assert.match(r.reason, /illegal_transition/);
});

test('a duplicate success callback is rejected as already_in_status', () => {
  // This is the one that stops a second receipt number and a second email.
  const r = canTransition(STATUS.SUCCEEDED, STATUS.SUCCEEDED);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'already_in_status');
});

test('a failed payment can never be resurrected', () => {
  for (const to of ALL) {
    assert.equal(canTransition(STATUS.FAILED, to).ok, false, `failed -> ${to} must be illegal`);
  }
});

test('expired and cancelled are equally final', () => {
  for (const from of [STATUS.EXPIRED, STATUS.CANCELLED]) {
    for (const to of ALL) {
      assert.equal(canTransition(from, to).ok, false, `${from} -> ${to} must be illegal`);
    }
  }
});

test('a late failure callback cannot reverse a confirmed payment', () => {
  // MTN's poll says SUCCESSFUL, then a stale callback arrives claiming FAILED.
  // The customer keeps their order.
  for (const to of [STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED]) {
    assert.equal(canTransition(STATUS.SUCCEEDED, to).ok, false);
  }
});

test('refund is the only exit from succeeded', () => {
  const allowed = [...TRANSITIONS[STATUS.SUCCEEDED]];
  assert.deepEqual(allowed, [STATUS.REFUNDED]);
});

test('a refund cannot be refunded twice', () => {
  assert.equal(canTransition(STATUS.REFUNDED, STATUS.REFUNDED).ok, false);
  assert.equal(canTransition(STATUS.REFUNDED, STATUS.SUCCEEDED).ok, false);
});

/* ------------------------------------------------------------------ */
/* Garbage in                                                          */
/* ------------------------------------------------------------------ */

test('unknown statuses are refused, not thrown on', () => {
  // Providers invent status strings. That must never crash a webhook handler.
  assert.doesNotThrow(() => canTransition('SUCCESSFUL', STATUS.SUCCEEDED));

  const bad = canTransition('SUCCESSFUL', STATUS.SUCCEEDED);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /unknown_current_status/);

  const badTarget = canTransition(STATUS.INITIATED, 'PROCESSING');
  assert.equal(badTarget.ok, false);
  assert.match(badTarget.reason, /unknown_target_status/);
});

test('null and undefined are refused', () => {
  for (const junk of [null, undefined, '', 0, {}]) {
    assert.equal(canTransition(junk, STATUS.SUCCEEDED).ok, false);
    assert.equal(canTransition(STATUS.INITIATED, junk).ok, false);
  }
});

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

test('every status is either in-flight or settled, never both, never neither', () => {
  for (const s of ALL) {
    assert.notEqual(isSettled(s), isInFlight(s), `${s} must be exactly one of the two`);
  }
});

test('only pending and initiated are polled', () => {
  const inFlight = ALL.filter(isInFlight).sort();
  assert.deepEqual(inFlight, [STATUS.INITIATED, STATUS.PENDING].sort());
});

test('settled statuses have no outgoing moves except succeeded', () => {
  for (const s of ALL) {
    if (!isSettled(s)) continue;
    if (s === STATUS.SUCCEEDED) continue;
    assert.equal(TRANSITIONS[s].size, 0, `${s} should be a dead end`);
  }
});

/* ------------------------------------------------------------------ */
/* Structural                                                          */
/* ------------------------------------------------------------------ */

test('every status has a transition entry and every target is a real status', () => {
  for (const s of ALL) {
    assert.ok(TRANSITIONS[s], `${s} missing from TRANSITIONS`);
    for (const target of TRANSITIONS[s]) {
      assert.ok(ALL.includes(target), `${s} -> ${target} points at an unknown status`);
    }
  }
});

test('no status can transition to itself', () => {
  for (const s of ALL) {
    assert.equal(TRANSITIONS[s].has(s), false, `${s} -> ${s} must not be in the table`);
  }
});

test('succeeded is reachable only from initiated', () => {
  const sources = ALL.filter((s) => TRANSITIONS[s].has(STATUS.SUCCEEDED));
  assert.deepEqual(sources, [STATUS.INITIATED]);
});
