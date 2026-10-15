/**
 * Wires the deck's calendar seam (`src/lib/deck/calendar.ts`) to the
 * normalized day-shape service (`src/lib/calendar/service.ts`).
 *
 * `ensureCalendarProvider()` registers a provider that resolves a local day's
 * busy blocks through the service — so the deck sees every connected Google
 * and Microsoft calendar, with declined and free-marked events correctly not
 * counting as busy, and shares the service's short cache. It's idempotent and
 * only registers when no provider is set, so it never clobbers an
 * explicitly-injected provider (e.g. a test mock). Call it at each entry
 * point that can generate/reconcile a deck — server boot (instrumentation)
 * covers the web/API paths; the orchestrator action handlers cover the CLI
 * subprocess path.
 *
 * Nothing connected reads as an open day. A failed or cut-short read keeps the
 * busy blocks it has and says the rest is unknown, so deck generation goes on
 * without treating an outage as free time.
 */

import { setCalendarProvider, hasCalendarProvider, type CalendarDayRead } from '@/lib/deck/calendar';

async function fetchCalendarDay(date: string): Promise<CalendarDayRead> {
  try {
    // Lazy: the service pulls the integrations runtime, which is heavy and
    // ESM-leaning — only load it when a calendar read actually fires, never
    // at module-eval (keeps the tsx CLI boot graph clean).
    const [{ getCalendarRange }, { eventToBlock }] = await Promise.all([
      import('@/lib/calendar/service'),
      import('@/lib/calendar/events'),
    ]);
    const range = await getCalendarRange({ start: date, days: 1 });
    const day = range.days[0];
    const blocks = day ? day.events.filter((e) => e.countsAsBusy).map(eventToBlock) : [];
    // The known busy blocks always stand. An outage or a cut-short read leaves the rest of the
    // day unconfirmed, rather than reported as free.
    const detail = range.providers.filter((p) => !p.ok || p.partial).map((p) => p.detail).filter(Boolean).join(' ');
    if (range.status === 'error') return { blocks, availability: 'unknown', ...(detail ? { detail } : {}) };
    if (range.status === 'degraded' || (day && !day.complete)) return { blocks, availability: 'partial', ...(detail ? { detail } : {}) };
    return { blocks, availability: 'known' };
  } catch (err) {
    console.warn('[calendar] day-shape read failed — availability unknown', err);
    return { blocks: [], availability: 'unknown', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Register the live calendar provider into the deck's calendar seam, unless
 * one is already registered. Idempotent and cheap (nothing heavy is imported
 * until the provider actually runs).
 */
export function ensureCalendarProvider(): void {
  if (hasCalendarProvider()) return;
  setCalendarProvider((date) => fetchCalendarDay(date));
}
