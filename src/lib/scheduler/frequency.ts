/**
 * Friendly-frequency compiler — the bridge between the simplified
 * "Create scheduled task" UI (Manual / One time / Hourly / Daily / Weekly /
 * Monthly / Interval / Webhook / Custom cron) and the trigger row's
 * `kind` + cadence fields.
 *
 * Two directions:
 *   - `frequencyToTrigger(...)` — compile a friendly choice to the
 *     fields a `create_trigger` action needs.
 *   - `triggerToFrequency(...)` — inverse, used by edit views to
 *     reconstruct the friendly choice from a stored row. Returns
 *     `{ kind: 'custom' }` when the stored cron doesn't match any
 *     preset, so power users editing custom expressions don't lose
 *     them.
 *
 * Recurring presets keep cronExpression populated. One-time and interval
 * choices use the scheduler's existing `at` and `every` kinds.
 */

import { CronDate } from 'croner';
import type { TriggerRecord } from '@/db/types';

export type FrequencyKind =
  | 'manual'
  | 'once'
  | 'every'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'webhook'
  | 'custom';

/** 0=Sun, 1=Mon, …, 6=Sat — matches cron's day-of-week numbering. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FrequencyChoice {
  kind: FrequencyKind;
  /** HH:MM in 24h, for once/daily/weekly/monthly. */
  time?: string;
  /** Weekday for `weekly`. Default Monday (1). */
  weekday?: Weekday;
  /** Day-of-month for `monthly` (1–28; we cap so all months are valid). */
  dayOfMonth?: number;
  /** Raw cron expression for `custom`. */
  cronExpression?: string;
  /** Calendar date in the schedule's timezone, for `once`. */
  date?: string;
  /** Stored instant, preserved while its local date and time stay unchanged. */
  runAt?: string;
  timezone?: string;
  intervalSeconds?: number;
}

export type CompiledTrigger = Pick<TriggerRecord, 'kind' | 'cronExpression'> &
  Partial<Pick<TriggerRecord, 'runAt' | 'intervalSeconds'>>;

/**
 * Compile a friendly choice into the fields `create_trigger` needs.
 * Throws on shapes the friendly UI shouldn't produce (e.g. daily with
 * a malformed time); UI validation catches these first.
 */
export function frequencyToTrigger(choice: FrequencyChoice): CompiledTrigger {
  switch (choice.kind) {
    case 'manual':
      return { kind: 'manual', cronExpression: null };
    case 'webhook':
      return { kind: 'webhook', cronExpression: null };
    case 'once': {
      if (!choice.date || !/^\d{4}-\d{2}-\d{2}$/.test(choice.date)) {
        throw new Error('Choose a date for the one-time run.');
      }
      const { hour, minute } = parseHHMM(choice.time ?? '09:00');
      const time = formatHHMM(hour, minute);
      const timezone = choice.timezone ?? 'UTC';
      const original = choice.runAt ? new Date(choice.runAt) : null;
      const originalLocal = original && Number.isFinite(original.getTime())
        ? dateTimeInTimezone(original, timezone) : null;
      // Keep seconds and the original offset in a repeated daylight saving
      // hour when the calendar controls still describe the same instant.
      const at = originalLocal?.date === choice.date && originalLocal.time === time
        ? original! : new CronDate(`${choice.date}T${time}:00`, timezone).getDate();
      const local = dateTimeInTimezone(at, timezone);
      // Reject impossible dates and times skipped by daylight saving changes.
      if (local.date !== choice.date || local.time !== time) {
        throw new Error('This date and time does not exist in the selected timezone.');
      }
      return { kind: 'at', cronExpression: null, runAt: at.toISOString() };
    }
    case 'every': {
      const seconds = choice.intervalSeconds;
      if (!seconds || !Number.isSafeInteger(seconds) || seconds <= 0) {
        throw new Error('Enter a positive whole number of seconds.');
      }
      return { kind: 'every', cronExpression: null, intervalSeconds: seconds };
    }
    case 'hourly':
      return { kind: 'cron', cronExpression: '0 * * * *' };
    case 'daily': {
      const { minute, hour } = parseHHMM(choice.time ?? '09:00');
      return { kind: 'cron', cronExpression: `${minute} ${hour} * * *` };
    }
    case 'weekly': {
      const { minute, hour } = parseHHMM(choice.time ?? '09:00');
      const dow = choice.weekday ?? 1;
      return { kind: 'cron', cronExpression: `${minute} ${hour} * * ${dow}` };
    }
    case 'monthly': {
      const { minute, hour } = parseHHMM(choice.time ?? '09:00');
      const dom = clampDay(choice.dayOfMonth ?? 1);
      return { kind: 'cron', cronExpression: `${minute} ${hour} ${dom} * *` };
    }
    case 'custom': {
      const expr = (choice.cronExpression ?? '').trim();
      if (!expr) throw new Error('custom cron requires a non-empty expression');
      return { kind: 'cron', cronExpression: expr };
    }
  }
}

/**
 * Inverse: derive a friendly choice from a stored trigger row. Used by
 * the detail view's "Edit" form so it shows e.g. "Daily at 9:00 AM"
 * instead of `0 9 * * *`. Falls through to `custom` when the stored
 * expression doesn't match any preset shape (we never lose the user's
 * original cron).
 */
export function triggerToFrequency(row: Pick<TriggerRecord, 'kind' | 'cronExpression'> &
  Partial<Pick<TriggerRecord, 'runAt' | 'intervalSeconds' | 'timezone'>>): FrequencyChoice {
  if (row.kind === 'manual') return { kind: 'manual' };
  if (row.kind === 'webhook') return { kind: 'webhook' };
  if (row.kind === 'at') {
    const timezone = row.timezone ?? 'UTC';
    return { kind: 'once', timezone, ...(row.runAt
      ? { runAt: row.runAt, ...dateTimeInTimezone(new Date(row.runAt), timezone) }
      : {}) };
  }
  if (row.kind === 'every') return { kind: 'every', intervalSeconds: row.intervalSeconds ?? undefined };

  const expr = (row.cronExpression ?? '').trim();
  if (!expr) return { kind: 'custom', cronExpression: '' };
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { kind: 'custom', cronExpression: expr };
  const [m, h, dom, month, dow] = parts;

  const minuteNum = Number(m);
  const hourNum = Number(h);
  const isInt = Number.isInteger(minuteNum) && Number.isInteger(hourNum);

  if (m === '0' && h === '*' && dom === '*' && month === '*' && dow === '*') {
    return { kind: 'hourly' };
  }
  if (isInt && dom === '*' && month === '*' && dow === '*') {
    return { kind: 'daily', time: formatHHMM(hourNum, minuteNum) };
  }
  const dowNum = Number(dow);
  if (
    isInt &&
    dom === '*' &&
    month === '*' &&
    Number.isInteger(dowNum) &&
    dowNum >= 0 &&
    dowNum <= 6
  ) {
    return {
      kind: 'weekly',
      time: formatHHMM(hourNum, minuteNum),
      weekday: dowNum as Weekday,
    };
  }
  const domNum = Number(dom);
  if (
    isInt &&
    month === '*' &&
    dow === '*' &&
    Number.isInteger(domNum) &&
    domNum >= 1 &&
    domNum <= 28
  ) {
    return {
      kind: 'monthly',
      time: formatHHMM(hourNum, minuteNum),
      dayOfMonth: domNum,
    };
  }
  return { kind: 'custom', cronExpression: expr };
}

/**
 * Human-readable summary of a stored trigger's cadence — used by the
 * list view + the detail header so the user sees "Daily at 9:00 AM"
 * not `0 9 * * *`.
 */
export function describeFrequency(row: {
  kind: 'manual' | 'at' | 'every' | 'cron' | 'webhook';
  cronExpression: string | null;
  intervalSeconds: number | null;
  runAt: string | null;
  timezone: string | null;
}): string {
  if (row.kind === 'manual') return 'Manual (Run now only)';
  if (row.kind === 'webhook') return 'Webhook';
  if (row.kind === 'every') return `every ${row.intervalSeconds ?? '?'}s`;
  if (row.kind === 'at') {
    return row.runAt ? `Once at ${formatIso(row.runAt, row.timezone ?? 'UTC')}` : 'Once (no time)';
  }
  // Cron — try to humanize via the friendly compiler's reverse map.
  const choice = triggerToFrequency(row);
  switch (choice.kind) {
    case 'hourly':
      return 'Hourly';
    case 'daily':
      return `Daily at ${humanTime(choice.time!)}`;
    case 'weekly':
      return `Weekly on ${weekdayName(choice.weekday!)} at ${humanTime(choice.time!)}`;
    case 'monthly':
      return `Monthly on the ${ordinal(choice.dayOfMonth!)} at ${humanTime(choice.time!)}`;
    case 'custom':
      return `cron \`${row.cronExpression}\` (${row.timezone ?? 'UTC'})`;
    default:
      return row.cronExpression ?? '-';
  }
}

// ── helpers ──────────────────────────────────────────────────

function parseHHMM(s: string): { hour: number; minute: number } {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid time "${s}", expected HH:MM`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Time "${s}" out of range`);
  }
  return { hour, minute };
}

function formatHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function humanTime(hhmm: string): string {
  const { hour, minute } = parseHHMM(hhmm);
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function weekdayName(d: Weekday): string {
  return WEEKDAYS[d] ?? 'Monday';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Cap day-of-month at 28 so the trigger fires every month including February. */
function clampDay(n: number): number {
  if (!Number.isInteger(n) || n < 1) return 1;
  if (n > 28) return 28;
  return n;
}

export function dateTimeInTimezone(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

function formatIso(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short',
  });
}
