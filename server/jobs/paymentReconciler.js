'use strict';

const pool = require('../config/database');
const { getProvider } = require('../payments/providers');
const {
  recordPaymentOutcome,
  nextPollDelay,
  MAX_IN_FLIGHT_SECONDS,
} = require('../payments/service');
const { STATUS } = require('../payments/stateMachine');

/**
 * The reconciler, not the webhook, is what actually guarantees your orders are
 * correct. MTN drops callbacks routinely; Render restarts drop in-flight
 * requests; phones go flat mid-PIN. This loop closes every one of those gaps.
 *
 * Run it on the same web dyno with setInterval — a separate worker on Render
 * costs money you don't need to spend at this volume. FOR UPDATE SKIP LOCKED
 * means it stays correct if you do split it out later.
 */

const TICK_MS = 5000;
const BATCH_SIZE = 20;

async function claimDueBatch(client) {
  const { rows } = await client.query(
    `SELECT * FROM payments
      WHERE status IN ('pending','initiated')
        AND next_poll_at IS NOT NULL
        AND next_poll_at <= NOW()
      ORDER BY next_poll_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE]
  );
  return rows;
}

async function reconcileOne(client, payment) {
  const ageSeconds = (Date.now() - new Date(payment.created_at).getTime()) / 1000;

  // Give up on a prompt nobody answered. Expire rather than fail: it's a
  // different customer story ("you didn't confirm in time") and a different
  // retry policy.
  if (ageSeconds > MAX_IN_FLIGHT_SECONDS) {
    const result = await recordPaymentOutcome(client, {
      paymentId: payment.id,
      outcome: {
        status: STATUS.EXPIRED,
        failureCode: 'timeout',
        failureReason: `no confirmation after ${Math.round(ageSeconds)}s`,
        raw: {},
      },
      source: 'poll',
      eventKey: `expire:${payment.provider}:${payment.external_ref}`,
    });
    return result.effects;
  }

  const provider = getProvider(payment.provider);

  let outcome;
  try {
    outcome = await provider.fetchStatus({
      externalRef: payment.external_ref,
      providerRef: payment.provider_ref,
    });
  } catch (err) {
    // Provider down or rate-limiting us. Back off, don't settle.
    await scheduleNextPoll(client, payment);
    console.warn('[reconciler] status fetch failed', payment.id, err.message);
    return [];
  }

  if (!outcome.status || outcome.status === payment.status) {
    await scheduleNextPoll(client, payment);
    return [];
  }

  const result = await recordPaymentOutcome(client, {
    paymentId: payment.id,
    outcome,
    source: 'poll',
    // Include the raw status so a PENDING->SUCCESSFUL sequence produces two
    // distinct event keys rather than colliding on the dedupe index.
    eventKey: `poll:${payment.provider}:${payment.external_ref}:${outcome.rawStatus}`,
  });

  if (!result.applied) await scheduleNextPoll(client, payment);
  return result.effects;
}

async function scheduleNextPoll(client, payment) {
  const delay = nextPollDelay(payment.poll_attempts + 1);
  await client.query(
    `UPDATE payments
        SET poll_attempts  = poll_attempts + 1,
            last_polled_at = NOW(),
            next_poll_at   = NOW() + ($2 || ' seconds')::interval,
            updated_at     = NOW()
      WHERE id = $1`,
    [payment.id, String(delay)]
  );
}

async function tick() {
  const pendingEffects = [];

  // Acquiring the client is itself failable - the pool can be exhausted or
  // the database briefly unreachable. Previously this sat outside the try,
  // so a failed connect rejected tick() before any handler could see it.
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error('[reconciler] could not acquire a database client', err);
    return;
  }

  try {
    await client.query('BEGIN');
    const batch = await claimDueBatch(client);

    for (const payment of batch) {
      try {
        const effects = await reconcileOne(client, payment);
        pendingEffects.push(...effects);
      } catch (err) {
        console.error('[reconciler] payment failed', payment.id, err);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[reconciler] tick failed', err);
  } finally {
    client.release();
  }

  for (const effect of pendingEffects) {
    effect().catch((err) => console.error('[reconciler] effect failed', err));
  }
}

let timer = null;
let consecutiveFailures = 0;

// Back off when ticks keep failing so an outage doesn't hammer the database
// every 5 seconds. The ceiling stays low: this loop is how payments settle,
// so it has to recover quickly once the problem clears.
const MAX_BACKOFF_MS = 60000;

function backoffFor(failures) {
  if (failures === 0) return TICK_MS;
  return Math.min(TICK_MS * Math.pow(2, failures), MAX_BACKOFF_MS);
}

function start() {
  if (timer) return;

  // The reschedule is in finally deliberately. Without it a single rejected
  // tick ends the loop for the life of the process, and payments stop
  // settling with no further signal. An occasional failed tick is expected;
  // a stopped reconciler needs a redeploy to notice.
  const loop = async () => {
    try {
      await tick();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      console.error(
        `[reconciler] tick threw (${consecutiveFailures} consecutive)`,
        err
      );
    } finally {
      // timer is nulled by stop(); don't resurrect a loop that was stopped
      // while a tick was in flight.
      if (timer !== null) {
        timer = setTimeout(loop, backoffFor(consecutiveFailures));
      }
    }
  };

  timer = setTimeout(loop, TICK_MS);
  console.log('[reconciler] started');
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  consecutiveFailures = 0;
}

module.exports = { start, stop, tick };
