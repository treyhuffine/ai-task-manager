/**
 * How the heartbeat describes itself, in one place so the deck chip and the
 * settings panel never disagree. Pure: takes the config and "now", returns
 * copy. UI copy rules apply: no em dashes, no semicolons.
 */

import type { HeartbeatConfig } from './types';

export type HeartbeatTone = 'off' | 'idle' | 'active' | 'attention' | 'error';

export interface HeartbeatStatus {
  /** The deck chip's text after "Heartbeat". */
  chip: string;
  tone: HeartbeatTone;
  /** One sentence for the settings panel. */
  detail: string;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2:00 PM" today, "yesterday 2:00 PM", "tomorrow 9:00 AM", else "Sep 21, 2:00 PM". */
export function formatCheckInTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(at, now)) return time;
  const dayMs = 24 * 60 * 60 * 1000;
  if (sameLocalDay(at, new Date(now.getTime() - dayMs))) return `yesterday ${time}`;
  if (sameLocalDay(at, new Date(now.getTime() + dayMs))) return `tomorrow ${time}`;
  const date = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function describeHeartbeat(config: HeartbeatConfig, now: Date = new Date()): HeartbeatStatus {
  const last = config.lastCheckIn;

  if (config.running) {
    return { chip: 'checking in', tone: 'active', detail: 'Checking in now.' };
  }

  if (!config.enabled) {
    const detail =
      config.disabledReason === 'budget_exceeded'
        ? 'Off. It was paused because the monthly budget ran out.'
        : 'Off. Turn it on to check in on a schedule, or check in once now.';
    return { chip: 'off', tone: 'off', detail };
  }

  const next = config.nextCheckInAt ? ` Next check-in ${formatCheckInTime(config.nextCheckInAt, now)}.` : '';

  if (!last) {
    return {
      chip: config.nextCheckInAt ? `next ${formatCheckInTime(config.nextCheckInAt, now)}` : 'on',
      tone: 'idle',
      detail: `No check-ins yet.${next}`,
    };
  }

  const when = formatCheckInTime(last.at, now);

  if (last.status === 'failed') {
    const why = last.errorMessage ? `: ${last.errorMessage}` : '';
    return { chip: 'failed', tone: 'error', detail: `The last check-in (${when}) failed${why}.${next}` };
  }
  if (last.status === 'cancelled') {
    return { chip: when, tone: 'idle', detail: `The last check-in (${when}) was stopped.${next}` };
  }
  if (last.quiet) {
    return { chip: when, tone: 'idle', detail: `Last check-in ${when}. Nothing needed.${next}` };
  }

  const changed = last.changedCount > 0 ? ` Changed ${plural(last.changedCount, 'item', 'items')}.` : '';
  if (last.unread) {
    return { chip: '1 for you', tone: 'attention', detail: `Last check-in ${when} left a report.${changed}${next}` };
  }
  return { chip: when, tone: 'idle', detail: `Last check-in ${when}.${changed}${next}` };
}
