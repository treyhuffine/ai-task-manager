/**
 * How the rate limits pill words a harness's limits. Pure and client-safe.
 *
 * Every bucket is its own row. Agentex's rule is that independent windows are
 * never added together or collapsed into one reset (docs/telemetry.md in
 * @agentex/agent), so a 5-hour window, a weekly window and a weekly Opus
 * window each show their own percentage and reset.
 */
import type { StoredRateLimitBucket } from './rate-limits';

export interface RateLimitRow {
  key: string;
  label: string;
  /** Measured use, 0 to 100 or above. Absent when unknown or reset since. */
  percent?: number;
  /** Short text in place of, or beside, the percentage. */
  detail?: string;
  /** When it resets, already worded ("resets 3:40 PM"). */
  reset?: string;
  /** The provider says this allowance is used up or blocking. */
  blocked: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Claude's live windows carry ids but no duration. Display names only; the
// ids stay opaque everywhere else.
const WINDOW_NAMES: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly',
  seven_day_sonnet: 'Weekly',
};

const BLOCKING = new Set(['exceeded', 'blocked', 'limited', 'throttled', 'rejected']);

function durationName(ms: number): string {
  if (ms < DAY) return `${Math.round(ms / HOUR)}-hour`;
  const days = Math.round(ms / DAY);
  if (days === 7) return 'Weekly';
  if (days >= 28 && days <= 31) return 'Monthly';
  return `${days}-day`;
}

function humanize(id: string): string {
  const words = decodeURIComponent(id).replace(/[_:]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "out_of_credits" → "Out of credits". */
function sentence(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A numeric balance to two decimals with separators. Anything else as given. */
function formatBalance(balance: string): string {
  const value = Number(balance);
  return Number.isFinite(value) ? value.toLocaleString([], { maximumFractionDigits: 2 }) : balance;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function poolOf(bucket: StoredRateLimitBucket): string | undefined {
  return bucket.applicability.kind === 'provider_pool' ? bucket.applicability.pool : undefined;
}

function windowLabel(bucket: StoredRateLimitBucket, prefixPool: boolean): string {
  if (bucket.credits) return 'Credits';
  if (bucket.overage && bucket.usedPercent === undefined) return 'Extra usage';
  const base = bucket.durationMs !== undefined
    ? durationName(bucket.durationMs)
    : WINDOW_NAMES[bucket.id] ?? bucket.label ?? humanize(bucket.id);
  const family = bucket.applicability.kind === 'model_family' ? ` ${capitalize(bucket.applicability.family)}` : '';
  const pool = prefixPool && bucket.durationMs !== undefined ? `${bucket.label ?? poolOf(bucket)} ` : '';
  return `${pool}${base}${family}`;
}

/** "resets 3:40 PM", "resets Mon 9 AM", "resets Oct 14". */
export function resetLabel(resetAt: string, now = new Date()): string {
  const at = new Date(resetAt);
  if (at.getTime() <= now.getTime()) return 'reset since';
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined });
  if (at.toDateString() === now.toDateString()) return `resets ${time}`;
  if (at.getTime() - now.getTime() < 6 * DAY) return `resets ${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `resets ${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

/** "just now", "4 min ago", "3 hr ago", "Oct 7". */
export function ageLabel(observedAt: string, now = new Date()): string {
  const ms = now.getTime() - new Date(observedAt).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} hr ago`;
  return new Date(observedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const KNOWN_DURATIONS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * DAY, seven_day_opus: 7 * DAY, seven_day_sonnet: 7 * DAY };

/** Shared windows, then model windows, then credits, then extra usage. Shortest first within each. */
function rank(bucket: StoredRateLimitBucket): [number, number] {
  const group = bucket.credits ? 2
    : bucket.overage && bucket.usedPercent === undefined ? 3
      : bucket.applicability.kind === 'model_family' || bucket.collectionId ? 1 : 0;
  return [group, bucket.durationMs ?? KNOWN_DURATIONS[bucket.id] ?? Number.MAX_SAFE_INTEGER];
}

/** The rows for one harness, shortest window first. */
export function rateLimitRows(buckets: StoredRateLimitBucket[], now = new Date()): RateLimitRow[] {
  const pools = new Set(buckets.filter((b) => b.durationMs !== undefined).map(poolOf).filter(Boolean));
  const rows: RateLimitRow[] = [];
  const sorted = [...buckets].sort((a, b) => {
    const [ga, da] = rank(a), [gb, db] = rank(b);
    return ga - gb || da - db;
  });
  for (const bucket of sorted) {
    const blocked = bucket.enforcement?.allowed === false || BLOCKING.has((bucket.enforcement?.status ?? '').toLowerCase());
    const expired = bucket.resetAt !== undefined && Date.parse(bucket.resetAt) <= now.getTime();
    const label = windowLabel(bucket, pools.size > 1);
    if (bucket.credits) {
      const { unlimited, balance, hasCredits } = bucket.credits;
      const detail = unlimited ? 'Unlimited' : balance !== undefined ? formatBalance(balance) : hasCredits === false ? 'None' : undefined;
      if (detail) rows.push({ key: bucket.id, label, detail, blocked: false });
      continue;
    }
    if (bucket.overage && bucket.usedPercent === undefined) {
      // Extra usage is what runs after a window fills. Its state is context,
      // never an alarm: "out of credits" while the windows have room is fine.
      const { reason, isUsing, enabled } = bucket.overage;
      const detail = isUsing ? 'In use' : reason ? sentence(reason) : enabled === false ? 'Off' : enabled ? 'On' : undefined;
      if (detail) rows.push({ key: bucket.id, label, detail, blocked: false });
      continue;
    }
    if (bucket.usedPercent === undefined) {
      // An allowance without a measurement shows only when the provider says it blocks.
      if (blocked) rows.push({ key: bucket.id, label, detail: 'Limit reached', blocked, ...(bucket.resetAt && !expired ? { reset: resetLabel(bucket.resetAt, now) } : {}) });
      continue;
    }
    rows.push(expired
      ? { key: bucket.id, label, detail: 'Reset since last report', blocked: false }
      : {
        key: bucket.id, label, percent: bucket.usedPercent, blocked,
        ...(bucket.resetAt ? { reset: resetLabel(bucket.resetAt, now) } : {}),
      });
  }
  return rows;
}
