/**
 * Calendar-date field helpers.
 *
 * Some fields are *calendar dates*, not instants: a task's `hardDeadline` or
 * `resurfaceAfter` of "Aug 25" means Aug 25 on the user's local calendar, with
 * no time and no zone. They are stored as bare `YYYY-MM-DD` strings.
 *
 * Never round-trip these through a timezone-aware `Date`. `new Date('2026-08-25')`
 * parses as UTC midnight, which renders as the *previous* day in any negative-offset
 * zone (all of the Americas) — the classic "I set today, it shows yesterday" bug.
 * These helpers read only the date part and build a *local* Date, so display and
 * comparison stay on the calendar the user actually typed.
 *
 * Legacy rows may still carry a `T00:00:00.000Z` suffix written before this fix;
 * every helper tolerates it by reading only the leading `YYYY-MM-DD`. Run
 * `pnpm tsx scripts/normalize-task-dates.ts` to collapse those rows to bare dates.
 */

/** The leading `YYYY-MM-DD` of a stored date value, or null. Ignores any time/zone. */
export function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : null;
}

/**
 * Normalize an `<input type="date">` value for storage: a bare `YYYY-MM-DD`
 * string, or null when empty. Use this instead of `new Date(val).toISOString()`,
 * which would pin the date to UTC midnight.
 */
export function dateInputToStored(value: string | null | undefined): string | null {
  return toDateOnly(value);
}

/** Parse a calendar-date field to a local `Date` at local midnight (no TZ shift). */
export function parseLocalDate(value: string | null | undefined): Date | null {
  const date = toDateOnly(value);
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Local midnight for the given moment. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days from local *today* to the given calendar date.
 * 0 = today, 1 = tomorrow, -1 = yesterday. Null when the field is unset.
 */
export function calendarDaysUntil(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const target = parseLocalDate(value);
  if (!target) return null;
  const today = startOfLocalDay(now);
  // Local-midnight to local-midnight; round absorbs the ±1h DST wobble.
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Format a calendar-date field for display in local time. Null when unset. */
export function formatLocalDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
  locale: string | string[] = 'en-US',
): string | null {
  const date = parseLocalDate(value);
  return date ? date.toLocaleDateString(locale, options) : null;
}

/** True when a calendar-date field is strictly before local today. */
export function isPastDate(value: string | null | undefined, now?: Date): boolean {
  const days = calendarDaysUntil(value, now);
  return days !== null && days < 0;
}
