/**
 * Timestamps in the DB come in two formats, both UTC:
 *
 *   - SQLite column defaults (`datetime('now')`) → "YYYY-MM-DD HH:MM:SS"
 *     (space separator, no zone, second precision). Used for `startedAt`,
 *     `createdAt`, etc.
 *   - App writes (`new Date().toISOString()`)     → "YYYY-MM-DDTHH:MM:SS.sssZ"
 *     (T separator, fractional seconds, explicit Z). Used for
 *     `lastOutcomeEventAt`, `unreadMarkerAt`, `lastViewedAt`, etc.
 *
 * Mixing the two springs two traps:
 *
 *   1. Lexicographic comparison across formats is invalid: ' ' (0x20)
 *      sorts before 'T' (0x54), so a same-day space-format value always
 *      sorts BEFORE a same-day ISO value even when it is actually later in
 *      real time. This is why a brand-new session (which has only the
 *      space-format `startedAt`) sank below the day's already-active
 *      sessions in the rail instead of rising to the top.
 *   2. `new Date("YYYY-MM-DD HH:MM:SS")` parses as LOCAL time, skewing the
 *      instant by the viewer's UTC offset — even though SQLite's `now` is
 *      UTC. So relative-time display of a space-format value is wrong by
 *      the offset.
 *
 * Normalizing the space form to explicit-UTC ISO closes both: the strings
 * then sort identically and parse to the same instant. Compare via
 * {@link timestampEpoch} rather than raw strings whenever a space-format
 * column (e.g. `startedAt`) can meet an ISO column in the same comparison.
 */

// Exactly the SQLite `datetime('now')` shape (optionally with a fractional
// part, in case a column ever uses `strftime` with `%f`). Anything already
// carrying a 'T' (ISO) or not matching this shape is left untouched.
const SQLITE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * Coerce a SQLite space-format timestamp to explicit-UTC ISO 8601 so it
 * parses and sorts identically to `toISOString()` output. ISO strings and
 * any non-matching input pass through unchanged.
 */
export function normalizeTimestamp(ts: string): string {
  const m = SQLITE_DATETIME.exec(ts);
  return m ? `${m[1]}T${m[2]}Z` : ts;
}

/**
 * UTC epoch milliseconds for a stored timestamp in either format. Returns
 * -Infinity for null/undefined/unparseable so it can act as a floor in
 * `Math.max` and sort such rows to the bottom of a descending list.
 */
export function timestampEpoch(ts: string | null | undefined): number {
  if (!ts) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(normalizeTimestamp(ts));
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
