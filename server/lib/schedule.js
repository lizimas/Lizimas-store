'use strict';

/**
 * Uganda is EAT, UTC+3, no daylight saving — support_shifts times are
 * entered in local Kampala time (matches how a person types "08:00" without
 * thinking about UTC), so `now` needs converting before comparing.
 */
const EAT_OFFSET_MINUTES = 3 * 60;

function toLocal(now) {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let localMinutes = utcMinutes + EAT_OFFSET_MINUTES;
  let dayOfWeek = now.getUTCDay();
  if (localMinutes >= 24 * 60) {
    localMinutes -= 24 * 60;
    dayOfWeek = (dayOfWeek + 1) % 7;
  }
  return { dayOfWeek, minutesSinceMidnight: localMinutes };
}

function timeToMinutes(timeStr) {
  // Postgres TIME columns come back as 'HH:MM:SS'
  const [h, m] = String(timeStr).split(':').map(Number);
  return h * 60 + m;
}

/**
 * @param {Array} shifts - one agent's support_shifts rows: { day_of_week, start_time, end_time }
 * @param {Date} now
 * @returns {boolean} true if the agent is inside a configured shift, OR if
 *   they have no shifts configured at all — an agent with nothing set is
 *   treated as always eligible (opt-in restriction, not opt-out), so turning
 *   on shift-aware routing doesn't silently strand every unconfigured agent.
 */
function isWithinShift(shifts, now) {
  if (!shifts || shifts.length === 0) return true;
  const { dayOfWeek, minutesSinceMidnight } = toLocal(now);
  return shifts.some((s) => {
    if (Number(s.day_of_week) !== dayOfWeek) return false;
    const start = timeToMinutes(s.start_time);
    const end = timeToMinutes(s.end_time);
    if (end > start) {
      return minutesSinceMidnight >= start && minutesSinceMidnight < end;
    }
    // Overnight shift wrapping past midnight, e.g. 22:00-06:00
    return minutesSinceMidnight >= start || minutesSinceMidnight < end;
  });
}

module.exports = { isWithinShift, toLocal, timeToMinutes };
