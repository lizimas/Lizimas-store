'use strict';

/**
 * Payment state machine.
 *
 * Deliberately dumb and side-effect free so it can be unit tested without a DB.
 * The only thing it knows is which moves are legal.
 */

const STATUS = Object.freeze({
  PENDING: 'pending',
  INITIATED: 'initiated',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]:   new Set([STATUS.INITIATED, STATUS.FAILED, STATUS.CANCELLED]),
  [STATUS.INITIATED]: new Set([STATUS.SUCCEEDED, STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED]),
  [STATUS.SUCCEEDED]: new Set([STATUS.REFUNDED]),
  [STATUS.FAILED]:    new Set(),
  [STATUS.EXPIRED]:   new Set(),
  [STATUS.CANCELLED]: new Set(),
  [STATUS.REFUNDED]:  new Set(),
});

// Statuses where we stop polling and stop accepting outcome events.
const SETTLED = new Set([
  STATUS.SUCCEEDED, STATUS.FAILED, STATUS.EXPIRED, STATUS.CANCELLED, STATUS.REFUNDED,
]);

// Statuses the reconciler should keep chasing.
const IN_FLIGHT = new Set([STATUS.PENDING, STATUS.INITIATED]);

function isSettled(status) {
  return SETTLED.has(status);
}

function isInFlight(status) {
  return IN_FLIGHT.has(status);
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 * Never throws. A late duplicate callback is normal traffic, not an exception.
 */
function canTransition(from, to) {
  if (!TRANSITIONS[from]) {
    return { ok: false, reason: `unknown_current_status:${from}` };
  }
  if (!TRANSITIONS[to] && to !== undefined) {
    // `to` must itself be a known status
    if (!Object.values(STATUS).includes(to)) {
      return { ok: false, reason: `unknown_target_status:${to}` };
    }
  }
  if (from === to) {
    return { ok: false, reason: 'already_in_status' };
  }
  if (!TRANSITIONS[from].has(to)) {
    return { ok: false, reason: `illegal_transition:${from}->${to}` };
  }
  return { ok: true };
}

module.exports = {
  STATUS,
  TRANSITIONS,
  isSettled,
  isInFlight,
  canTransition,
};
