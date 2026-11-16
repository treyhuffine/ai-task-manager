/**
 * Task recurrence: how a repeating task's cadence is written, read and advanced.
 *
 * A task's `recurrence` is a cadence, an interval counted in days, weeks,
 * months or years. Ri stores it as text so agents and people can write it the
 * way they say it. The app itself writes the short canonical form
 * (`daily`, `weekly`, `monthly`, `yearly`, or `<n>d|w|m|y` like `2w`), and every
 * reader goes through {@link parseRecurrence}, which also understands the
 * phrasings people and agents actually use ("every 2 weeks", "Quarterly",
 * "Yearly, only if applicable", `FREQ=WEEKLY;INTERVAL=2`). A cadence on
 * particular weekdays ("every Monday and Thursday") is not something Ri can
 * follow, so it reads as no cadence at all and a write of it is refused.
 *
 * `nextRecurrenceAt` is the next occurrence, a calendar date (`YYYY-MM-DD`,
 * like `hardDeadline`, see `src/lib/dates.ts`). The task is Ready from the
 * start of that local day. Null means the occurrence is due now and the first
 * completion sets the rhythm. Older rows may carry a full ISO instant: every
 * reader takes only its leading date.
 *
 * Pure: no DB, no React. The server (completion, write validation, Ready) and
 * the client (the Repeat editor, labels, the deck) share it so they agree.
 */

import { toDateOnly } from '@/lib/dates';
import { todayLocalDate } from '@/lib/deck/date';

export const RECURRENCE_UNITS = ['day', 'week', 'month', 'year'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export interface RecurrenceRule {
  /** Whole units between occurrences, 1 or more. */
  every: number;
  unit: RecurrenceUnit;
}

/** The longest interval Ri accepts, in any unit. Past it a typo is likelier than a plan. */
export const MAX_RECURRENCE_EVERY = 999;

const UNIT_WORDS: Record<string, RecurrenceUnit> = {
  d: 'day', day: 'day', days: 'day',
  w: 'week', wk: 'week', wks: 'week', week: 'week', weeks: 'week',
  m: 'month', mo: 'month', mos: 'month', month: 'month', months: 'month',
  y: 'year', yr: 'year', yrs: 'year', year: 'year', years: 'year',
};
const UNIT_PATTERN = 'days?|weeks?|wks?|months?|mos?|years?|yrs?';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUMBER_PATTERN = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`;

const RRULE_FREQ: Record<string, RecurrenceUnit> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

/** One-word cadences, checked after any "every N" phrase so "every 2 weeks" wins over a stray word. */
const KEYWORDS: [RegExp, RecurrenceRule][] = [
  [/\b(?:bi-?weekly|fortnightly)\b/, { every: 2, unit: 'week' }],
  [/\bquarterly\b/, { every: 3, unit: 'month' }],
  [/\b(?:semi-?annual(?:ly)?|half-?yearly|twice a year)\b/, { every: 6, unit: 'month' }],
  [/\bdaily\b/, { every: 1, unit: 'day' }],
  [/\bweekly\b/, { every: 1, unit: 'week' }],
  [/\bmonthly\b/, { every: 1, unit: 'month' }],
  [/\b(?:yearly|annual(?:ly)?)\b/, { every: 1, unit: 'year' }],
];

function rule(every: number, unit: RecurrenceUnit): RecurrenceRule | null {
  return Number.isInteger(every) && every >= 1 && every <= MAX_RECURRENCE_EVERY ? { every, unit } : null;
}

function count(word: string): number {
  return NUMBER_WORDS[word] ?? Number(word);
}

/**
 * The cadence in a stored or typed recurrence, or null when there is none Ri
 * can follow (empty, a weekday schedule, nonsense).
 */
export function parseRecurrence(text: string | null | undefined): RecurrenceRule | null {
  const lower = (text ?? '').toLowerCase().trim();
  if (!lower) return null;

  // Compact and bare forms: "3d", "2w", "21 days", "6 months".
  const compact = new RegExp(`^(\\d+)\\s*(d|w|m|y|${UNIT_PATTERN})$`).exec(lower);
  if (compact) return rule(Number(compact[1]), UNIT_WORDS[compact[2]]);

  // iCalendar RRULE. Any BY* part pins particular days, which Ri can't follow.
  const freq = /\bfreq=(daily|weekly|monthly|yearly)\b/.exec(lower);
  if (freq) {
    if (/\bby[a-z]+=/.test(lower)) return null;
    const interval = /\binterval=(\d+)\b/.exec(lower);
    return rule(interval ? Number(interval[1]) : 1, RRULE_FREQ[freq[1]]);
  }

  const everyN = new RegExp(`\\bevery\\s+(${NUMBER_PATTERN})\\s+(${UNIT_PATTERN})\\b`).exec(lower);
  if (everyN) return rule(count(everyN[1]), UNIT_WORDS[everyN[2]]);
  const everyOther = new RegExp(`\\bevery\\s+other\\s+(${UNIT_PATTERN})\\b`).exec(lower);
  if (everyOther) return rule(2, UNIT_WORDS[everyOther[1]]);

  for (const [pattern, cadence] of KEYWORDS) if (pattern.test(lower)) return cadence;

  const everyOne = new RegExp(`\\b(?:every|each)\\s+(${UNIT_PATTERN})\\b`).exec(lower);
  if (everyOne) return rule(1, UNIT_WORDS[everyOne[1]]);
  return null;
}

const SINGLE: Record<RecurrenceUnit, { value: string; label: string }> = {
  day: { value: 'daily', label: 'Daily' },
  week: { value: 'weekly', label: 'Weekly' },
  month: { value: 'monthly', label: 'Monthly' },
  year: { value: 'yearly', label: 'Yearly' },
};

/** The canonical stored form of a cadence: `weekly`, `2w`, `3m`. */
export function recurrenceValue(cadence: RecurrenceRule): string {
  return cadence.every === 1 ? SINGLE[cadence.unit].value : `${cadence.every}${cadence.unit[0]}`;
}

/** A cadence in words: "Weekly", "Every 2 weeks". */
export function describeRecurrence(cadence: RecurrenceRule): string {
  return cadence.every === 1 ? SINGLE[cadence.unit].label : `Every ${cadence.every} ${cadence.unit}s`;
}

/**
 * How a stored recurrence reads in the app: its cadence in words, or the text
 * as written when Ri can't read a cadence from it. Null when there is none.
 */
export function recurrenceLabel(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const cadence = parseRecurrence(trimmed);
  return cadence ? describeRecurrence(cadence) : trimmed;
}

/**
 * True when the stored text says more than its cadence ("Yearly, only if
 * applicable"), so a surface showing only the cadence should offer the rest.
 */
export function recurrenceHasDetail(text: string | null | undefined): boolean {
  const trimmed = text?.trim().toLowerCase();
  if (!trimmed) return false;
  const cadence = parseRecurrence(trimmed);
  if (!cadence) return false;
  if (trimmed === recurrenceValue(cadence) || trimmed === describeRecurrence(cadence).toLowerCase()) return false;
  // A lone cadence word ("Quarterly") says nothing more than its cadence.
  return !KEYWORDS.some(([pattern]) => new RegExp(`^(?:${pattern.source})$`).test(trimmed));
}

/** Why a recurrence can't be saved, as an actionable sentence, or null when it can. */
export function recurrenceProblem(text: string): string | null {
  if (parseRecurrence(text)) return null;
  return `Ri can't follow the repeat "${text.trim()}". Use daily, weekly, monthly, yearly, or an interval like "every 3 days", "2w" or "every 6 months". `
    + 'Repeats count from the next date, so for a particular weekday use weekly and set the next date (nextRecurrenceAt) to that day. Put any condition in the task body.';
}

/** The common cadences, in the order the Repeat editor offers them. */
export const RECURRENCE_PRESETS: RecurrenceRule[] = [
  { every: 1, unit: 'day' },
  { every: 1, unit: 'week' },
  { every: 2, unit: 'week' },
  { every: 1, unit: 'month' },
  { every: 3, unit: 'month' },
  { every: 1, unit: 'year' },
];

// ─── Calendar math ────────────────────────────────────────────

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m - 1, d];
}

function format(utc: Date): string {
  return utc.toISOString().slice(0, 10);
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * One interval after a calendar date. Day math only, so no timezone or DST
 * can move it. Month and year steps clamp into short months, and an
 * end-of-month date stays end-of-month (Jan 31, Feb 28, Mar 31).
 */
export function addRecurrence(date: string, cadence: RecurrenceRule): string {
  const [y, m, d] = ymd(date);
  if (cadence.unit === 'day' || cadence.unit === 'week') {
    return format(new Date(Date.UTC(y, m, d + cadence.every * (cadence.unit === 'week' ? 7 : 1))));
  }
  const months = cadence.every * (cadence.unit === 'year' ? 12 : 1);
  const target = new Date(Date.UTC(y, m + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const day = d === lastDayOf(y, m) ? lastDayOf(ty, tm) : Math.min(d, lastDayOf(ty, tm));
  return format(new Date(Date.UTC(ty, tm, day)));
}

/**
 * The first scheduled date after `today`, stepping from `anchor` in whole
 * intervals. At least one step is always taken, since the anchor is the
 * occurrence being finished: done early, the next one is still a full
 * interval on, and done late, missed occurrences are skipped and the rhythm
 * holds (a daily task three days late comes back tomorrow).
 */
export function nextOccurrence(cadence: RecurrenceRule, anchor: string, today: string): string {
  let next = addRecurrence(anchor, cadence);
  // Bounded so a corrupt anchor can never spin. 100k daily steps is 270 years.
  for (let guard = 0; next <= today && guard < 100_000; guard += 1) next = addRecurrence(next, cadence);
  return next;
}

/** The calendar date of a stored or typed date or instant, or null. */
export function occurrenceDate(value: string | null | undefined): string | null {
  const date = toDateOnly(value);
  if (!date) return null;
  const [y, m, d] = ymd(date);
  const check = new Date(Date.UTC(y, m, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m && check.getUTCDate() === d ? date : null;
}

/**
 * True while a repeating task rests until a later day: done for now, and not
 * Ready until its next occurrence. False for a task that doesn't repeat.
 */
export function isRestingUntilNext(
  task: { recurrence?: string | null; nextRecurrenceAt?: string | null },
  now: Date = new Date(),
): boolean {
  if (!task.recurrence) return false;
  const next = toDateOnly(task.nextRecurrenceAt);
  return !!next && next > todayLocalDate(now);
}
