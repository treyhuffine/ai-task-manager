/**
 * The day-shape service — one normalized calendar read for every consumer:
 * `GET /api/calendar` (UI surfaces), the `get_day_shape` orchestrator action
 * (agents), and the deck's provider seam (generation + reconcile, via
 * `src/lib/deck/calendar-connector.ts`).
 *
 * Reads the primary calendar of every connected Google + Microsoft connection
 * on demand — no background polling — behind a short in-process TTL cache.
 * Server-only. The connectors runtime is imported lazily inside the fetch so
 * this module never drags it into the CLI boot graph (see smoke:boot).
 */
import { availableMinutes, computeFreeGaps, parseHhMm } from '@/lib/deck/calendar';
import { todayLocalDate } from '@/lib/deck/date';
import { getWorkdayBounds } from '@/lib/db/queries';
import {
  eventOverlapsDay,
  eventToBlock,
  normalizeGoogleEvent,
  normalizeOutlookEvent,
  type RawGoogleEvent,
  type RawOutlookEvent,
} from './events';
import type {
  CalendarDay,
  CalendarEvent,
  CalendarProviderStatus,
  CalendarRangeResult,
} from './types';

const TTL_MS = 60_000;
const MAX_DAYS = 14;

const cache = new Map<string, { result: CalendarRangeResult; fetchedAt: number }>();

/** Test hook — the cache is module-global and would leak across cases. */
export function clearCalendarRangeCache(): void {
  cache.clear();
}

/** Local date arithmetic (YYYY-MM-DD), matching the deck's day-boundary rules. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayLocalDate(d);
}

function eventEpoch(e: CalendarEvent): number {
  const t = new Date(e.start.includes('T') ? e.start : `${e.start}T00:00:00`).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function getCalendarRange(
  opts: { start?: string; days?: number; fresh?: boolean } = {},
): Promise<CalendarRangeResult> {
  const start = opts.start ?? todayLocalDate();
  const days = Math.min(MAX_DAYS, Math.max(1, Math.trunc(opts.days ?? 1)));
  const key = `${start}:${days}`;
  const hit = cache.get(key);
  if (hit && !opts.fresh && Date.now() - hit.fetchedAt < TTL_MS) return hit.result;

  const result = await fetchRange(start, days);
  cache.set(key, { result, fetchedAt: Date.now() });
  return result;
}

interface ConnectionFetch {
  provider: CalendarProviderStatus;
  events: CalendarEvent[];
}

async function fetchRange(start: string, days: number): Promise<CalendarRangeResult> {
  const asOf = new Date().toISOString();
  const { workdayStart, workdayEnd } = getWorkdayBounds();
  const workday = { start: workdayStart, end: workdayEnd };

  const finalize = (
    status: CalendarRangeResult['status'],
    providers: CalendarProviderStatus[],
    events: CalendarEvent[],
  ): CalendarRangeResult => ({
    status,
    asOf,
    workday,
    providers,
    days: buildDays(start, days, events, workdayStart, workdayEnd),
  });

  let runtime: Awaited<ReturnType<typeof importRuntime>>['runtime'];
  let ownerId: string;
  let connections: Array<{ id: string; providerId: string }>;
  try {
    const loaded = await importRuntime();
    runtime = loaded.runtime;
    ownerId = loaded.ownerId;
    const all = await runtime.listConnections({ ownerId });
    connections = all.filter((c) => c.providerId === 'google' || c.providerId === 'microsoft');
  } catch (err) {
    console.warn('[calendar] connectors runtime unavailable', err);
    return finalize('error', [], []);
  }

  if (connections.length === 0) return finalize('no_providers', [], []);

  const windowStart = new Date(`${start}T00:00:00`);
  const windowEnd = new Date(`${addDays(start, days)}T00:00:00`);

  const fetched = await Promise.all(
    connections.map((conn) =>
      fetchConnection(runtime, ownerId, conn, windowStart, windowEnd),
    ),
  );

  const providers = fetched.map((f) => f.provider);
  const okCount = providers.filter((p) => p.ok).length;
  const status = okCount === providers.length ? 'ok' : okCount > 0 ? 'degraded' : 'error';
  const events = fetched
    .flatMap((f) => f.events)
    .sort((a, b) => eventEpoch(a) - eventEpoch(b));

  return finalize(status, providers, events);
}

async function importRuntime() {
  // Lazy: the connectors runtime is heavy and ESM-leaning — only load it when
  // a calendar read actually fires, never at module-eval (CLI boot stays clean).
  const { getConnectorRuntime, getConnectorOwnerId } = await import('@/lib/connectors/runtime');
  return { runtime: await getConnectorRuntime(), ownerId: getConnectorOwnerId() };
}

interface RuntimeLike {
  // Method syntax (bivariant) so the real ConnectorRuntime stays assignable.
  runAction(action: string, input: unknown, ctx: unknown): Promise<unknown>;
}

async function fetchConnection(
  runtime: RuntimeLike,
  ownerId: string,
  conn: { id: string; providerId: string },
  windowStart: Date,
  windowEnd: Date,
): Promise<ConnectionFetch> {
  const status = (ok: boolean, detail?: string): CalendarProviderStatus => ({
    providerId: conn.providerId,
    connectionId: conn.id,
    ok,
    ...(detail ? { detail } : {}),
  });

  try {
    if (conn.providerId === 'google') {
      const outcome = (await runtime.runAction(
        'google_calendar.list_events',
        {
          calendarId: 'primary',
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          maxResults: 250,
        },
        { ownerId, connectionId: conn.id, caller: { type: 'app' } },
      )) as ActionOutcome<{ events: RawGoogleEvent[] }>;
      if (!outcome.ok) return { provider: status(false, outcomeDetail(outcome)), events: [] };
      const events = (outcome.result.events ?? [])
        .map((e) => normalizeGoogleEvent(e, conn.id))
        .filter((e): e is CalendarEvent => e != null);
      return { provider: status(true), events };
    }

    const outcome = (await runtime.runAction(
      'outlook_calendar.list_events',
      {
        top: 500,
        startDateTime: windowStart.toISOString(),
        endDateTime: windowEnd.toISOString(),
      },
      { ownerId, connectionId: conn.id, caller: { type: 'app' } },
    )) as ActionOutcome<{ events: RawOutlookEvent[] }>;
    if (!outcome.ok) return { provider: status(false, outcomeDetail(outcome)), events: [] };
    const events = (outcome.result.events ?? [])
      .map((e) => normalizeOutlookEvent(e, conn.id))
      .filter((e): e is CalendarEvent => e != null);
    return { provider: status(true), events };
  } catch (err) {
    return { provider: status(false, String(err)), events: [] };
  }
}

type ActionOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; reason: string; code?: string; message?: string };

function outcomeDetail(outcome: { ok: false; reason: string; code?: string; message?: string }): string {
  return outcome.reason === 'error' ? `${outcome.code}: ${outcome.message}` : outcome.reason;
}

function buildDays(
  start: string,
  count: number,
  events: CalendarEvent[],
  workdayStart: string,
  workdayEnd: string,
): CalendarDay[] {
  const workdaySpan = Math.max(0, parseHhMm(workdayEnd) - parseHhMm(workdayStart));
  const days: CalendarDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(start, i);
    const overlapping = events.filter((e) => eventOverlapsDay(e, date));
    const allDay = overlapping.filter((e) => e.allDay);
    const timed = overlapping.filter((e) => !e.allDay);
    const blocks = timed.filter((e) => e.countsAsBusy).map(eventToBlock);
    const gaps = computeFreeGaps(blocks, { workdayStart, workdayEnd, date });
    const freeMinutes = availableMinutes(gaps);
    days.push({
      date,
      allDay,
      events: timed,
      gaps,
      freeMinutes,
      largestGapMinutes: gaps.reduce((m, g) => Math.max(m, g.minutes), 0),
      busyMinutes: Math.max(0, workdaySpan - freeMinutes),
    });
  }
  return days;
}
