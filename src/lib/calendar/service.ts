/**
 * The day-shape service — one normalized calendar read for every consumer:
 * `GET /api/calendar` (UI surfaces), the `get_day_shape` orchestrator action
 * (agents), and the deck's provider seam (generation + reconcile, via
 * `src/lib/deck/calendar-integration.ts`).
 *
 * Reads every calendar checked in Google Calendar on every connected Google
 * account, and the default calendar of every Outlook account, on demand (no
 * background polling) behind a short in-process TTL cache. A calendar two
 * accounts can both see is read once, and the copies of a meeting merge into
 * one event (`mergeCopies`, docs/calendar-view-spec.md "Calendars and
 * colors").
 * Server-only. The integrations runtime is imported lazily inside the fetch so
 * this module never drags it into the CLI boot graph (see smoke:boot).
 */
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { availableMinutes, computeFreeGaps, parseHhMm } from '@/lib/deck/calendar';
import { todayLocalDate } from '@/lib/deck/date';
import { getWorkdayBounds } from '@/lib/db/queries';
import {
  calendarCountsTime,
  eventOverlapsDay,
  eventToBlock,
  hexColor,
  mergeCopies,
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
  CalendarSource,
} from './types';

const TTL_MS = 60_000;
const MAX_DAYS = 14;
/** Which calendars a connection has changes when you check one in Google: a few minutes is soon enough. */
const CALENDARS_TTL_MS = 5 * 60_000;

const cache = new Map<string, { result: CalendarRangeResult; fetchedAt: number }>();
const calendarLists = new Map<string, { calendars: ReadCalendar[]; fetchedAt: number }>();

/** Test hook — the caches are module-global and would leak across cases. */
export function clearCalendarRangeCache(): void {
  cache.clear();
  calendarLists.clear();
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

/** A calendar to read on a connection: the id to ask for, and what it is (null when unnamed). */
interface ReadCalendar {
  readId: string;
  source: CalendarSource | null;
}

interface CalendarRead {
  conn: { id: string; providerId: string };
  calendar: ReadCalendar;
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
    console.warn(`[calendar] ${INTEGRATION_LABELS.plural.toLowerCase()} runtime unavailable`, err);
    return finalize('error', [], []);
  }

  if (connections.length === 0) return finalize('no_providers', [], []);

  const windowStart = new Date(`${start}T00:00:00`);
  const windowEnd = new Date(`${addDays(start, days)}T00:00:00`);

  const lists = await Promise.all(connections.map((conn) => listCalendars(runtime, ownerId, conn)));
  const reads = planReads(connections.map((conn, i) => ({ conn, calendars: lists[i]! })));
  const results = await Promise.all(
    reads.map((read) => fetchCalendar(runtime, ownerId, read, windowStart, windowEnd)),
  );

  const providers = connections.map((conn) =>
    connectionStatus(
      conn,
      reads.map((read, i) => ({ read, result: results[i]! })).filter((r) => r.read.conn.id === conn.id),
    ),
  );
  const okCount = providers.filter((p) => p.ok).length;
  const status = okCount === providers.length ? 'ok' : okCount > 0 ? 'degraded' : 'error';
  const events = mergeCopies(results.flatMap((r) => (r.ok ? r.events : []))).sort(
    (a, b) => eventEpoch(a) - eventEpoch(b),
  );

  return finalize(status, providers, events);
}

/**
 * The calendars to read on a connection. Google: the primary calendar, and
 * every other calendar checked in Google Calendar's sidebar and not hidden.
 * Outlook: its default calendar. When the list can't be read, the primary
 * calendar alone, unnamed, as before calendars were read at all.
 */
async function listCalendars(
  runtime: RuntimeLike,
  ownerId: string,
  conn: { id: string; providerId: string },
): Promise<ReadCalendar[]> {
  const hit = calendarLists.get(conn.id);
  if (hit && Date.now() - hit.fetchedAt < CALENDARS_TTL_MS) return hit.calendars;
  const ctx = { ownerId, connectionId: conn.id, caller: { type: 'app' } };
  let calendars: ReadCalendar[] = [{ readId: conn.providerId === 'google' ? 'primary' : 'default', source: null }];
  try {
    if (conn.providerId === 'google') {
      const outcome = (await runtime.runAction('google_calendar.list_calendars', {}, ctx)) as ActionOutcome<{
        calendars: RawGoogleCalendar[];
      }>;
      if (outcome.ok) {
        const shown = (outcome.result.calendars ?? []).filter((c) => c.id && (c.primary || (c.selected && !c.hidden)));
        const read: ReadCalendar[] = shown.map((c) => ({
          readId: c.id!,
          source: {
            id: c.id!,
            name: c.summary || c.id!,
            color: hexColor(c.backgroundColor),
            primary: !!c.primary,
            owned: c.accessRole === 'owner',
          },
        }));
        // The primary calendar is always read, as it always was.
        calendars = read.some((c) => c.source?.primary) ? read : [...calendars, ...read];
      }
    } else {
      const outcome = (await runtime.runAction('outlook_calendar.list_calendars', {}, ctx)) as ActionOutcome<{
        calendars: RawOutlookCalendar[];
      }>;
      const main = outcome.ok ? outcome.result.calendars?.find((c) => c.isDefault && c.id) : undefined;
      if (main) {
        calendars = [
          {
            readId: 'default',
            source: { id: main.id!, name: main.name || 'Calendar', color: hexColor(main.hexColor), primary: true, owned: true },
          },
        ];
      }
    }
  } catch (err) {
    console.warn('[calendar] could not list calendars', conn.providerId, String(err));
  }
  calendarLists.set(conn.id, { calendars, fetchedAt: Date.now() });
  return calendars;
}

interface RawGoogleCalendar {
  id?: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

interface RawOutlookCalendar {
  id?: string;
  name?: string;
  hexColor?: string;
  isDefault?: boolean;
}

/**
 * Each calendar read once. A calendar shared with another of your accounts
 * shows up on both, and Google calendar ids are global, so the read goes
 * through the connection that owns it (else the first that lists it).
 */
export function planReads(
  lists: ReadonlyArray<{ conn: { id: string; providerId: string }; calendars: readonly ReadCalendar[] }>,
): CalendarRead[] {
  const reads: CalendarRead[] = [];
  const byCalendar = new Map<string, number>();
  for (const { conn, calendars } of lists) {
    for (const calendar of calendars) {
      const key = calendar.source ? `${conn.providerId}:${calendar.source.id}` : null;
      const seen = key ? byCalendar.get(key) : undefined;
      if (seen === undefined) {
        if (key) byCalendar.set(key, reads.length);
        reads.push({ conn, calendar });
      } else if (calendar.source?.owned && !reads[seen]!.calendar.source?.owned) {
        reads[seen] = { conn, calendar };
      }
    }
  }
  return reads;
}

type CalendarResult = { ok: true; events: CalendarEvent[] } | { ok: false; detail: string };

/**
 * A connection is ok when every calendar that takes your time was read. A
 * shared calendar failing is named in the detail but doesn't mark the
 * connection down.
 */
function connectionStatus(
  conn: { id: string; providerId: string },
  reads: ReadonlyArray<{ read: CalendarRead; result: CalendarResult }>,
): CalendarProviderStatus {
  const failed = reads.filter((r) => !r.result.ok);
  const ok = !failed.some((r) => calendarCountsTime(r.read.calendar.source)) && failed.length < reads.length;
  const why = (r: (typeof reads)[number]) => (r.result.ok ? '' : r.result.detail);
  const detail =
    reads.length === 1
      ? failed.map(why).join('')
      : failed.map((r) => `${r.read.calendar.source?.name ?? r.read.calendar.readId}: ${why(r)}`).join('; ');
  return { providerId: conn.providerId, connectionId: conn.id, ok, ...(detail ? { detail } : {}) };
}

async function importRuntime() {
  // Lazy: the integrations runtime is heavy and ESM-leaning — only load it when
  // a calendar read actually fires, never at module-eval (CLI boot stays clean).
  const { getIntegrationRuntime, getIntegrationOwnerId } = await import('@/lib/integrations/runtime');
  return { runtime: await getIntegrationRuntime(), ownerId: getIntegrationOwnerId() };
}

interface RuntimeLike {
  // Method syntax (bivariant) so the real IntegrationRuntime stays assignable.
  runAction(action: string, input: unknown, ctx: unknown): Promise<unknown>;
}

async function fetchCalendar(
  runtime: RuntimeLike,
  ownerId: string,
  { conn, calendar }: CalendarRead,
  windowStart: Date,
  windowEnd: Date,
): Promise<CalendarResult> {
  const ctx = { ownerId, connectionId: conn.id, caller: { type: 'app' } };
  try {
    if (conn.providerId === 'google') {
      const outcome = (await runtime.runAction(
        'google_calendar.list_events',
        {
          calendarId: calendar.readId,
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          maxResults: 250,
        },
        ctx,
      )) as ActionOutcome<{ events: RawGoogleEvent[] }>;
      if (!outcome.ok) return { ok: false, detail: outcomeDetail(outcome) };
      const events = (outcome.result.events ?? [])
        .map((e) => normalizeGoogleEvent(e, conn.id, calendar.source))
        .filter((e): e is CalendarEvent => e != null);
      return { ok: true, events };
    }

    // Outlook reads its default calendar through calendarView.
    const outcome = (await runtime.runAction(
      'outlook_calendar.list_events',
      {
        top: 500,
        startDateTime: windowStart.toISOString(),
        endDateTime: windowEnd.toISOString(),
      },
      ctx,
    )) as ActionOutcome<{ events: RawOutlookEvent[] }>;
    if (!outcome.ok) return { ok: false, detail: outcomeDetail(outcome) };
    const events = (outcome.result.events ?? [])
      .map((e) => normalizeOutlookEvent(e, conn.id, calendar.source))
      .filter((e): e is CalendarEvent => e != null);
    return { ok: true, events };
  } catch (err) {
    return { ok: false, detail: String(err) };
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
