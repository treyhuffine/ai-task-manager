/**
 * Cron + cadence helpers. Computes a schedule's `next_run_at` and
 * validates user-supplied cron strings. All time math goes through
 * `croner` (5-field, classic Unix cron with timezone-aware parsing).
 *
 * Why 5-field and not 6-field: 6-field cron exposes seconds. Our tick
 * runs once every 60s — sub-minute precision is meaningless and would
 * just trip users up. We reject 6-field input rather than silently
 * truncating.
 *
 * Active-hours skip is computed here too, in the schedule's timezone,
 * so the tick can check "should this fire even though next_run_at is
 * due?" without re-parsing time zones at the call site.
 */

import { Cron } from 'croner';
import type { ScheduleRecord } from '@/db/types';

export interface CronValidationResult {
  valid: boolean;
  /** Human-readable reason when invalid. */
  error?: string;
  /** Next 3 wall-clock fires (ISO strings) — handy preview for the UI. */
  preview?: string[];
}

/**
 * Validate a 5-field cron expression in a timezone. Returns a 3-fire
 * preview when valid so the UI doesn't have to re-parse.
 */
export function validateCronExpression(
  expression: string,
  timezone: string = 'UTC',
): CronValidationResult {
  const trimmed = expression.trim();
  if (!trimmed) return { valid: false, error: 'Cron expression is empty' };

  // 5-field check — split on whitespace runs so multi-space input works.
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day month weekday), got ${fields.length}`,
    };
  }

  try {
    const cron = new Cron(trimmed, { timezone });
    const previews: string[] = [];
    let cursor: Date | null = null;
    for (let i = 0; i < 3; i++) {
      cursor = cron.nextRun(cursor ?? undefined);
      if (!cursor) break;
      previews.push(cursor.toISOString());
    }
    if (previews.length === 0) {
      return { valid: false, error: 'Expression does not produce any future fires' };
    }
    return { valid: true, preview: previews };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid cron expression',
    };
  }
}

/**
 * Compute when this schedule should next fire. Returns null for kinds
 * that don't have a time-based fire (webhook), for one-offs that have
 * already run, and for misconfigured rows the validator would have
 * caught at create-time. Always advances strictly past `from` — a
 * schedule that just fired won't immediately re-fire.
 *
 * The tick reads this value back into `schedules.next_run_at` BEFORE
 * dispatching. That's the at-most-once guarantee.
 */
export function computeNextRun(
  schedule: Pick<
    ScheduleRecord,
    'kind' | 'cronExpression' | 'intervalSeconds' | 'runAt' | 'timezone' | 'lastFiredAt'
  >,
  from: Date = new Date(),
): string | null {
  switch (schedule.kind) {
    case 'manual':
    case 'webhook':
      return null;
    case 'at': {
      if (!schedule.runAt) return null;
      // One-off has already fired if lastFiredAt is set.
      if (schedule.lastFiredAt) return null;
      const at = new Date(schedule.runAt);
      if (Number.isNaN(at.getTime())) return null;
      // Even one-offs whose `runAt` is in the past need a non-null
      // next_run_at so the tick picks them up on the next sweep.
      return at.toISOString();
    }
    case 'every': {
      if (!schedule.intervalSeconds || schedule.intervalSeconds <= 0) return null;
      const base = schedule.lastFiredAt ? new Date(schedule.lastFiredAt) : from;
      // Advance strictly past `from` so a long-running tick can't
      // immediately re-fire on its own dispatch.
      let next = new Date(base.getTime() + schedule.intervalSeconds * 1000);
      while (next.getTime() <= from.getTime()) {
        next = new Date(next.getTime() + schedule.intervalSeconds * 1000);
      }
      return next.toISOString();
    }
    case 'cron': {
      if (!schedule.cronExpression) return null;
      try {
        const cron = new Cron(schedule.cronExpression, {
          timezone: schedule.timezone ?? 'UTC',
        });
        const next = cron.nextRun(from);
        return next ? next.toISOString() : null;
      } catch {
        return null;
      }
    }
  }
}

/**
 * True when the given instant falls inside the schedule's active-hours
 * window. Returns true (allow) when no window is configured. Used by
 * the tick to skip dispatch on schedules whose `next_run_at` matured
 * outside business hours.
 *
 * The window is evaluated in the schedule's timezone — "9–5" means
 * 9am–5pm wherever the schedule's user lives, not UTC. The window can
 * cross midnight (`22:00`–`06:00`) and is half-open: equals start fires,
 * equals end skips.
 */
export function isWithinActiveHours(
  schedule: Pick<ScheduleRecord, 'activeHoursStart' | 'activeHoursEnd' | 'timezone'>,
  at: Date = new Date(),
): boolean {
  if (!schedule.activeHoursStart || !schedule.activeHoursEnd) return true;
  const tz = schedule.timezone ?? 'UTC';
  const local = formatHHMMInTz(at, tz);
  const start = schedule.activeHoursStart;
  const end = schedule.activeHoursEnd;
  if (start === end) return false; // zero-width window
  if (start < end) {
    // Simple window — e.g. 09:00..17:00
    return local >= start && local < end;
  }
  // Crosses midnight — e.g. 22:00..06:00 means [22:00, 24:00) ∪ [00:00, 06:00)
  return local >= start || local < end;
}

/**
 * Render an HH:MM string for the wall-clock time of `date` in the given
 * IANA timezone. Used by `isWithinActiveHours`. Intl is the canonical
 * way to do this off-process without bundling a TZDB.
 */
function formatHHMMInTz(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // en-GB renders 'HH:MM' (24h). en-US would use '12:00 AM' suffixes.
  return fmt.format(date);
}
