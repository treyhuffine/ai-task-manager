/**
 * Friendly-frequency compiler — the bridge between the simplified
 * "Create scheduled task" UI (Manual / Hourly / Daily-at / Weekly-on-X-at /
 * Monthly-on-N-at / Webhook / Custom cron) and the trigger row's
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
 * The friendly UI never lets you express anything you couldn't also
 * write as a 5-field cron expression. We keep the raw `cronExpression`
 * column populated even for friendly choices so the tick path stays
 * uniform.
 */

export type FrequencyKind =
  | 'manual'
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
  /** HH:MM in 24h, for daily/weekly/monthly. */
  time?: string;
  /** Weekday for `weekly`. Default Monday (1). */
  weekday?: Weekday;
  /** Day-of-month for `monthly` (1–28; we cap so all months are valid). */
  dayOfMonth?: number;
  /** Raw cron expression for `custom`. */
  cronExpression?: string;
}

export interface CompiledTrigger {
  /** Maps to triggers.kind. Manual → 'manual'; webhook → 'webhook';
   *  everything else maps to 'cron'. */
  kind: 'manual' | 'cron' | 'webhook';
  /** Set when kind='cron'. */
  cronExpression: string | null;
}

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
export function triggerToFrequency(row: {
  kind: 'manual' | 'at' | 'every' | 'cron' | 'webhook';
  cronExpression: string | null;
}): FrequencyChoice {
  if (row.kind === 'manual') return { kind: 'manual' };
  if (row.kind === 'webhook') return { kind: 'webhook' };
  // `at` and `every` aren't expressible in the friendly menu — treat as
  // custom so the edit view shows the raw cron we couldn't reverse, or
  // (for `at`) the next-fire timestamp the user originally entered.
  if (row.kind !== 'cron') return { kind: 'custom', cronExpression: row.cronExpression ?? '' };

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
    return row.runAt ? `once at ${formatIso(row.runAt)}` : 'once (no time)';
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

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
