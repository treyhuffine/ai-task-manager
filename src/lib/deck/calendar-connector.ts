/**
 * Wires the deck's calendar seam (`src/lib/deck/calendar.ts`) to the live
 * Google Calendar connector (`packages/connectors`).
 *
 * `ensureCalendarProvider()` registers a provider that fetches the user's busy
 * blocks for a given local day. It's idempotent and only registers when no
 * provider is set, so it never clobbers an explicitly-injected provider (e.g. a
 * test mock). Call it at each entry point that can generate/reconcile a deck —
 * server boot (instrumentation) covers the web/API paths; the orchestrator
 * action handlers cover the CLI subprocess path.
 *
 * Degrades to "an open day" whenever there's no Google connection or the
 * connector errors, so deck generation is never blocked by calendar state.
 */

import { setCalendarProvider, hasCalendarProvider, type CalendarBlock } from '@/lib/deck/calendar';

const GOOGLE_PROVIDER_ID = 'google';

/** Shape returned by `google_calendar.list_events` (see packages/connectors). */
interface CalendarEventSummary {
  id?: string;
  summary?: string;
  /** ISO datetime for timed events, or date-only ('YYYY-MM-DD') for all-day. */
  start?: string;
  end?: string;
  status?: string;
}

/** All-day events come back date-only (no time component). */
function isAllDay(value: string | undefined): boolean {
  return !!value && !value.includes('T');
}

async function fetchGoogleCalendarDay(date: string): Promise<CalendarBlock[]> {
  try {
    // Lazy: the connectors runtime is heavy and ESM-leaning — only load it when
    // a calendar read actually fires, never at module-eval (keeps the tsx CLI
    // boot graph clean, matching the lazy-import convention elsewhere).
    const { getConnectorRuntime, getConnectorOwnerId } = await import('@/lib/connectors/runtime');
    const ownerId = getConnectorOwnerId();
    const runtime = await getConnectorRuntime();

    const connections = await runtime.listConnections({ ownerId });
    const conn = connections.find((c) => c.providerId === GOOGLE_PROVIDER_ID);
    if (!conn) return []; // no calendar connected → treat the day as open

    // Query the *local* day, expressed as UTC instants so the window matches the
    // user's day regardless of timezone; the seam's gap math clamps each event
    // back to the local day.
    const dayStart = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) return [];
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const outcome = await runtime.runAction<{ events: CalendarEventSummary[] }>(
      'google_calendar.list_events',
      {
        calendarId: 'primary',
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        maxResults: 100,
      },
      { ownerId, connectionId: conn.id, caller: { type: 'app' } },
    );

    if (!outcome.ok) {
      const detail =
        outcome.reason === 'error' ? `${outcome.reason}: ${outcome.code} — ${outcome.message}` : outcome.reason;
      console.warn(`[calendar] list_events not ok (${detail}) — treating day as open`);
      return [];
    }

    const blocks: CalendarBlock[] = [];
    for (const e of outcome.result.events ?? []) {
      if (!e.start || !e.end) continue;
      if (e.status === 'cancelled') continue;
      // All-day events (birthdays, multi-day OOO) aren't time blocks that consume
      // work hours — skip them so they don't zero out the whole day.
      if (isAllDay(e.start)) continue;
      blocks.push({
        start: e.start,
        end: e.end,
        title: e.summary ?? 'Busy',
        source: GOOGLE_PROVIDER_ID,
      });
    }
    return blocks;
    // NOTE (v1): the connector's event summary doesn't expose attendee response
    // status or transparency, so declined / "free" events still count as busy.
    // Refine when those fields surface.
  } catch (err) {
    console.warn('[calendar] connector read failed — treating day as open', err);
    return [];
  }
}

/**
 * Register the live Google Calendar provider into the deck's calendar seam,
 * unless one is already registered. Idempotent and cheap (the connector itself
 * isn't imported until the provider actually runs).
 */
export function ensureCalendarProvider(): void {
  if (hasCalendarProvider()) return;
  setCalendarProvider((date) => fetchGoogleCalendarDay(date));
}
