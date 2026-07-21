/**
 * Normalized calendar read model — the viewing layer.
 *
 * `CalendarEvent` is what surfaces render (identity, attribution, join links,
 * RSVP state). The deck's planning layer keeps consuming derived busy blocks
 * (`CalendarBlock`) via `eventToBlock` in `./events`. No table backs these
 * types: events are fetched live from the connectors and cached briefly in
 * memory (`./service`), so this file stays client-safe and dependency-free.
 */

export type CalendarProviderId = 'google' | 'microsoft';

export interface CalendarEvent {
  /** Provider event id (best-effort synthetic fallback when absent). */
  id: string;
  providerId: CalendarProviderId;
  connectionId: string;
  title: string;
  /** ISO 8601 instant for timed events; YYYY-MM-DD for all-day events. */
  start: string;
  /** All-day ends are exclusive (a one-day event ends on the next date). */
  end: string;
  allDay: boolean;
  location: string | null;
  /** Video-call link (Meet / Teams) when the event has one. */
  joinUrl: string | null;
  /** Deep link to the event in the provider's own UI. */
  sourceUrl: string | null;
  rsvp: 'accepted' | 'declined' | 'tentative' | 'needs_action' | null;
  transparency: 'busy' | 'free';
  /** Whether this event consumes work time — the input to all gap math. */
  countsAsBusy: boolean;
}

export type CalendarReadStatus = 'ok' | 'no_providers' | 'degraded' | 'error';

export interface CalendarProviderStatus {
  providerId: string;
  connectionId: string;
  ok: boolean;
  detail?: string;
}

/**
 * A free stretch within the workday, minutes from local midnight.
 * Shape-identical to the deck seam's `CalendarGap` (`src/lib/deck/calendar.ts`)
 * so service output assigns cleanly without a client → server import.
 */
export interface CalendarGap {
  startMinute: number;
  endMinute: number;
  minutes: number;
}

export interface CalendarDay {
  /** YYYY-MM-DD, server-local (local-first: server and user share a machine). */
  date: string;
  allDay: CalendarEvent[];
  /** Timed events overlapping this day, sorted by start. Includes non-busy
   *  (declined / free) events — filter on `countsAsBusy` for planning math. */
  events: CalendarEvent[];
  gaps: CalendarGap[];
  freeMinutes: number;
  largestGapMinutes: number;
  /** Busy minutes within workday bounds (workday span minus free minutes). */
  busyMinutes: number;
}

export interface CalendarRangeResult {
  status: CalendarReadStatus;
  /** Wall-clock ISO timestamp of the fetch this result came from. */
  asOf: string;
  /** Local HH:MM workday bounds the gap math ran against. */
  workday: { start: string; end: string };
  providers: CalendarProviderStatus[];
  days: CalendarDay[];
}
