// Flash sale auto-rerun (migration 136, Ryan Sept 2026).
//
// A campaign with recurs_every_hours set starts again by itself once its end
// time passes: its start and end move forward by whole periods until the
// end is in the future again. The countdown length stays the same
// (end - start); with no start time the countdown simply runs the full
// period. Works whether or not the background timer ran - the public and
// admin endpoints call rollForwardDue() before reading, so a campaign is
// never shown as over when it should have restarted.

const HOUR_MS = 3600 * 1000;

// Pure: where a recurring campaign should be at `now`.
function nextWindow({ starts_at, ends_at, recurs_every_hours }, now = new Date()) {
    const period = Number(recurs_every_hours);
    if (!period || !ends_at) return null;
    const end = new Date(ends_at).getTime();
    const t = now.getTime();
    if (end >= t) return null; // still running / upcoming
    const step = period * HOUR_MS;
    const k = Math.ceil((t - end) / step) || 1;
    return {
        starts_at: starts_at ? new Date(new Date(starts_at).getTime() + k * step) : null,
        ends_at: new Date(end + k * step),
        periods: k
    };
}

// Moves every due recurring campaign forward in one statement.
async function rollForwardDue(db) {
    const r = await db.query(
        `UPDATE flash_sales
            SET starts_at = CASE WHEN starts_at IS NULL THEN NULL
                                 ELSE starts_at + make_interval(hours => recurs_every_hours *
                                      CEIL(EXTRACT(EPOCH FROM (now() - ends_at)) / (recurs_every_hours * 3600.0))::int) END,
                ends_at = ends_at + make_interval(hours => recurs_every_hours *
                          CEIL(EXTRACT(EPOCH FROM (now() - ends_at)) / (recurs_every_hours * 3600.0))::int)
          WHERE is_active = true
            AND recurs_every_hours IS NOT NULL
            AND ends_at < now()
          RETURNING id`
    );
    return r.rowCount;
}

let timer = null;
function start(pool, everyMs = 5 * 60 * 1000) {
    if (timer) return;
    const tick = () => rollForwardDue(pool).catch((e) => console.error("Flash sale rerun tick failed:", e.message));
    timer = setInterval(tick, everyMs);
    if (timer.unref) timer.unref();
    tick();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { nextWindow, rollForwardDue, start, stop };
