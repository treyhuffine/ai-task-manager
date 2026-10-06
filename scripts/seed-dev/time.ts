/**
 * Time helpers for the dev seed. Every date in the seed is relative to the
 * moment it runs, so a reseed always looks current: "due tomorrow" is
 * tomorrow, a chat from "two hours ago" is two hours ago.
 *
 * Two shapes, matching the schema:
 *   - Instants (`createdAt`, `reminderAt`, `completedAt`, chat events): ISO
 *     strings with a time, from `daysAgo` / `daysFromNow` / `hoursAgo` /
 *     `minutesAgo`.
 *   - Calendar dates (`hardDeadline`, `resurfaceAfter`): bare `YYYY-MM-DD` on
 *     the local calendar, from `dateIn`. A date carries no time or zone (see
 *     `src/lib/dates.ts`).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The seed's "now", fixed once so every relative date agrees. */
export const SEED_NOW = new Date();

function localAt(dayOffset: number, hour: number, minute: number): Date {
  const d = new Date(SEED_NOW);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** An instant `n` days ago at a local wall-clock time (default 10:00). */
export function daysAgo(n: number, hour = 10, minute = 0): string {
  return localAt(-n, hour, minute).toISOString();
}

/** An instant `n` days ahead at a local wall-clock time (default 9:00). */
export function daysFromNow(n: number, hour = 9, minute = 0): string {
  return localAt(n, hour, minute).toISOString();
}

/** An instant `n` hours before the seed ran. */
export function hoursAgo(n: number): string {
  return new Date(SEED_NOW.getTime() - n * HOUR).toISOString();
}

/** An instant `n` minutes before the seed ran. */
export function minutesAgo(n: number): string {
  return new Date(SEED_NOW.getTime() - n * MINUTE).toISOString();
}

/** A local calendar date `n` days from today (negative for the past), `YYYY-MM-DD`. */
export function dateIn(n: number): string {
  const d = localAt(n, 12, 0);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local calendar date, `YYYY-MM-DD`. */
export function today(): string {
  return dateIn(0);
}

/** Shift an ISO instant by `ms` milliseconds. */
export function plus(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export const ms = { minute: MINUTE, hour: HOUR, second: 1000 };
