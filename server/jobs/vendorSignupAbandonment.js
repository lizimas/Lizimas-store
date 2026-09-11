'use strict';

const pool = require('../config/database');
const { sendVendorSignupAbandonedAlert } = require('../utils/mailer');

/**
 * Vendor registration is a multi-step wizard (verify email -> fill in
 * business details -> submit) and no users/vendors row exists until the
 * very last step, so there's nowhere on an actual account to notice someone
 * gave up partway through. vendor_registration_otp (migration 080) is the
 * only trace an abandoned attempt leaves - one row per email, created when
 * they request a code, deleted the moment registerVendor succeeds.
 *
 * So: any row that's been sitting there longer than ABANDONED_AFTER_MS,
 * with nothing sent for it yet, is by definition someone who started and
 * never finished. Alert Ryan once per attempt (alerted_at marks it done;
 * requesting a fresh code resets alerted_at so a second abandoned attempt
 * later still gets its own alert - see authController.js).
 *
 * Runs on the same web dyno as the reconciler, on a much slower tick - this
 * is a same-day follow-up nudge, not something that needs second-level
 * timing.
 */

const TICK_MS = 10 * 60 * 1000; // 10 minutes
const ABANDONED_AFTER_MS = 30 * 60 * 1000; // 30 minutes since the last code was sent
const BATCH_SIZE = 20;

async function claimAbandonedBatch(client) {
    const { rows } = await client.query(
        `SELECT email, verified_at, last_sent_at, created_at
           FROM vendor_registration_otp
          WHERE alerted_at IS NULL
            AND last_sent_at <= NOW() - ($1 || ' milliseconds')::interval
            AND NOT EXISTS (
                SELECT 1 FROM users JOIN vendors ON vendors.user_id = users.id
                 WHERE LOWER(users.email) = vendor_registration_otp.email
            )
          ORDER BY last_sent_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [String(ABANDONED_AFTER_MS), BATCH_SIZE]
    );
    return rows;
}

async function alertOne(client, row) {
    await sendVendorSignupAbandonedAlert({
        email: row.email,
        startedAt: new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Kampala' }),
        verified: !!row.verified_at
    });
    await client.query(
        'UPDATE vendor_registration_otp SET alerted_at = NOW() WHERE email = $1',
        [row.email]
    );
}

async function tick() {
    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        console.error('[vendor-signup-abandonment] could not acquire a database client', err);
        return;
    }

    try {
        await client.query('BEGIN');
        const batch = await claimAbandonedBatch(client);

        for (const row of batch) {
            try {
                await alertOne(client, row);
            } catch (err) {
                // One failed alert (e.g. a transient email-send error) must not
                // stop the rest of the batch, and must not mark alerted_at, so
                // it's retried on the next tick.
                console.error('[vendor-signup-abandonment] alert failed', row.email, err);
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[vendor-signup-abandonment] tick failed', err);
    } finally {
        client.release();
    }
}

let timer = null;

function start() {
    if (timer) return;
    // Fire once shortly after boot (not immediately - let the app settle),
    // then every TICK_MS. An occasional failed tick is fine; unlike the
    // payment reconciler this has no correctness deadline.
    timer = setInterval(() => {
        tick().catch((err) => console.error('[vendor-signup-abandonment] tick threw', err));
    }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
    console.log('[vendor-signup-abandonment] started');
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { start, stop, tick };
