/**
 * The event catalog — the SINGLE source of truth for notification event types (spec §2.4). The
 * `NotificationEventType` union derives from this array, the settings UI maps over it, `render()`
 * keys off `type`, and emission sites use the constants. Adding an event = one entry here.
 *
 * `routing` is how an event reaches channels:
 *   - 'matrix'  → the per-channel `events[]` toggles (ambient lifecycle events);
 *   - 'binding' → the schedule's `deliverResultTo[]` (digests — `notify(event, { deliverTo })`).
 */
export interface EventCatalogEntry {
  type: string;
  label: string;
  description: string;
  routing: 'matrix' | 'binding';
  /** Default state for a NEW channel's toggle (matrix events only). */
  defaultOn: boolean;
}

export const EVENT_CATALOG = [
  {
    type: 'execution.needs_input',
    label: 'Agent needs input',
    description: 'An execution is blocked waiting on you (a permission or question request).',
    routing: 'matrix',
    defaultOn: true,
  },
  {
    type: 'execution.finished',
    label: 'Execution finished',
    description: 'An execution completed (done or failed), with a summary.',
    routing: 'matrix',
    defaultOn: true,
  },
  {
    type: 'connector.approval_required',
    label: 'Approval needed',
    description: 'A connector action needs your approval before it runs.',
    routing: 'matrix',
    defaultOn: true,
  },
  {
    type: 'deck.surfaced',
    label: 'Deck surfaced something',
    description: 'Your proactive deck surfaced a new item. (Inert until the deck emission point lands.)',
    routing: 'matrix',
    defaultOn: true,
  },
  {
    type: 'schedule.run_completed',
    label: 'Scheduled run result',
    description: "A scheduled job's result, delivered to the channels you bound it to.",
    routing: 'binding',
    defaultOn: false,
  },
] as const satisfies readonly EventCatalogEntry[];

export type NotificationEventType = (typeof EVENT_CATALOG)[number]['type'];

/** Catalog entry by type, or undefined for an unknown type. */
export function eventCatalogEntry(type: string): EventCatalogEntry | undefined {
  return EVENT_CATALOG.find((e) => e.type === type);
}

/** Matrix-routed event types — the ones the per-channel toggle UI offers. */
export const MATRIX_EVENT_TYPES: readonly NotificationEventType[] = EVENT_CATALOG.filter(
  (e) => e.routing === 'matrix',
).map((e) => e.type);

/** Default `events[]` for a newly created channel (the on-by-default matrix events). */
export function defaultChannelEvents(): NotificationEventType[] {
  return EVENT_CATALOG.filter((e) => e.routing === 'matrix' && e.defaultOn).map((e) => e.type);
}
