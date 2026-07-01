/**
 * Compact running-duration labels for execution timers.
 *
 * Live counters (the "agent is working" elapsed time, worktree setup, etc.)
 * step up through s → m → h → d so a long run reads as "1h 5m" instead of a
 * giant seconds count. Two units of precision once past a minute: the smaller
 * unit keeps the readout moving, the larger unit gives scale.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Format a whole-second elapsed count for a live counter (loader). Seconds
 * are ALWAYS the trailing unit so the readout visibly ticks every second —
 * this is the agent's "working" feedback, so movement matters more than
 * brevity. Larger units fill in as they accrue.
 *
 *   45      -> "45s"
 *   134     -> "2m 14s"
 *   3920    -> "1h 5m 20s"
 *   180120  -> "2d 2h 2m 0s"
 */
export function formatElapsed(totalSeconds: number): string {
  const total = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const d = Math.floor(total / DAY);
  const h = Math.floor((total % DAY) / HOUR);
  const m = Math.floor((total % HOUR) / MINUTE);
  const s = total % MINUTE;

  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (d || h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Format a completed span given in seconds. Like {@link formatElapsed} but
 * keeps sub-second precision for short spans ("7.4s") and drops a trailing
 * zero lower unit ("2m" rather than "2m 0s") since the value is static.
 */
export function formatSpanSeconds(secs: number): string | null {
  if (!Number.isFinite(secs) || secs < 0) return null;
  if (secs < 1) return null;
  if (secs < MINUTE) return `${secs < 10 ? secs.toFixed(1) : Math.round(secs)}s`;

  const whole = Math.round(secs);
  if (whole < HOUR) {
    const m = Math.floor(whole / MINUTE);
    const s = whole % MINUTE;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  if (whole < DAY) {
    const h = Math.floor(whole / HOUR);
    const m = Math.floor((whole % HOUR) / MINUTE);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(whole / DAY);
  const h = Math.floor((whole % DAY) / HOUR);
  return h ? `${d}d ${h}h` : `${d}d`;
}
