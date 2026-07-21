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
 * Degrades to "an open day" whenever nothing is connected or the read errors,
 * so deck generation is never blocked by calendar state.
 */

import { setCalendarProvider, hasCalendarProvider, type CalendarBlock } from '@/lib/deck/calendar';

async function fetchCalendarDay(date: string): Promise<CalendarBlock[]> {
  try {
    // Lazy: the service pulls the connectors runtime, which is heavy and
    // ESM-leaning — only load it when a calendar read actually fires, never
    // at module-eval (keeps the tsx CLI boot graph clean).
    const [{ getCalendarRange }, { eventToBlock }] = await Promise.all([
      import('@/lib/calendar/service'),
      import('@/lib/calendar/events'),
    ]);
    const range = await getCalendarRange({ start: date, days: 1 });
    const day = range.days[0];
    if (!day) return [];
    return day.events.filter((e) => e.countsAsBusy).map(eventToBlock);
  } catch (err) {
    console.warn('[calendar] day-shape read failed — treating day as open', err);
    return [];
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
