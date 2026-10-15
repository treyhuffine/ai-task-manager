/**
 * Typed Calendar reads through a managed source (docs/connector-service-spec.md §4, "Calendar
 * view and deck"). Ri's Calendar view, `get_day_shape` and the deck read a Composio-connected
 * Google Calendar through here, in the same normalized shapes the direct Google route produces.
 *
 * These are app reads, not agent tools: they need the user's "show in Ri's Calendar" choice for
 * that exact account (independent of any agent's access), a live usable source and an active
 * connection, checked on every read. They run at the pinned toolkit version through Composio's
 * versioned execution path, because Ri parses the output. The output is validated, and a shape
 * Ri doesn't recognize is a failed read, never an empty calendar.
 */
import { z } from 'zod/v4';
import { CALENDAR_READS, PINNED_TOOLKIT_VERSIONS } from './composio/catalog';
import { isComposioApiError } from './composio/client';
import { listManagedConnections, managedConfig } from './managed-connections';
import { currentPreferences } from './preferences';
import { openSource, sourceUsable } from './source-runtime';
import type { Connection, ConnectionStore } from '@integrations/engine';

/** One page of events at most this many times per calendar and window, then the read is partial. */
const MAX_EVENT_PAGES = 8;
const MAX_CALENDAR_PAGES = 4;

export class ManagedReadError extends Error {
  constructor(message: string, readonly retired = false) {
    super(message);
    this.name = 'ManagedReadError';
  }
}

/** Managed calendars the user lets Ri's Calendar read, still connected and usable now. */
export async function calendarReadableConnections(store: ConnectionStore, ownerId: string): Promise<Connection[]> {
  const use = currentPreferences().calendarUse;
  const connections = await listManagedConnections(store, { ownerId, applicationId: 'google_calendar' });
  return connections.filter(connection => use[connection.id] === true && connection.status === 'active'
    && sourceUsable(managedConfig(connection)!.sourceId));
}

const calendarItem = z.object({
  id: z.string().min(1),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  primary: z.boolean().optional(),
  selected: z.boolean().optional(),
  hidden: z.boolean().optional(),
  accessRole: z.string().optional(),
  backgroundColor: z.string().optional(),
}).passthrough();

const time = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).passthrough();
const eventItem = z.object({
  id: z.string().optional(),
  iCalUID: z.string().optional(),
  summary: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  transparency: z.string().optional(),
  location: z.string().optional(),
  hangoutLink: z.string().optional(),
  colorId: z.string().optional(),
  start: time.optional(),
  end: time.optional(),
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() }).passthrough()).optional(),
  conferenceData: z.object({ entryPoints: z.array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() }).passthrough()).optional() }).passthrough().optional(),
}).passthrough();

/**
 * The list and page token in a tool's output. Composio returns Google's response as `data`,
 * sometimes one level deeper. Anything else is not recognized.
 */
function pageOf<T>(data: Record<string, unknown>, listKeys: string[], item: z.ZodType<T>): { items: T[]; next?: string } {
  const layers: Record<string, unknown>[] = [data];
  for (const wrapper of ['data', 'response_data', 'response']) {
    const inner = data[wrapper];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) layers.push(inner as Record<string, unknown>);
  }
  for (const layer of layers) {
    for (const key of listKeys) {
      const list = layer[key];
      if (!Array.isArray(list)) continue;
      const parsed = z.array(item).safeParse(list);
      if (!parsed.success) throw new ManagedReadError(`Composio returned ${key} in a shape Ri doesn't recognize.`);
      const next = layer.nextPageToken ?? layer.next_page_token;
      return { items: parsed.data, ...(typeof next === 'string' && next ? { next } : {}) };
    }
  }
  // An empty calendar still answers with an empty list: no list at all is not "no events".
  throw new ManagedReadError("Composio returned calendar data in a shape Ri doesn't recognize.");
}

async function pinnedRead(connection: Connection, slug: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = managedConfig(connection);
  if (!config) throw new ManagedReadError('That calendar is not a managed connection.');
  if (currentPreferences().calendarUse[connection.id] !== true) throw new ManagedReadError("This calendar isn't shown in Ri's Calendar.");
  const open = await openSource(config.sourceId);
  if (!open) throw new ManagedReadError('Its source is turned off or has no key.');
  const version = PINNED_TOOLKIT_VERSIONS[config.remoteToolkit];
  if (!version) throw new ManagedReadError('No tested version is pinned for this toolkit.');
  try {
    const result = await open.client.executePinned({
      toolSlug: slug, version, userId: open.source.remoteUserId, connectedAccountId: config.remoteAccountId, arguments: args, read: true,
    });
    if (!result.successful) throw new ManagedReadError(result.error ?? 'The calendar read failed.');
    return result.data;
  } catch (error) {
    if (error instanceof ManagedReadError) throw error;
    // A retired version is reported as unavailable, never silently replaced by `latest`.
    if (isComposioApiError(error) && error.status === 410) {
      throw new ManagedReadError(`The tested Calendar tool version (${version}) was retired by Composio. Ri needs an update to read this calendar.`, true);
    }
    throw new ManagedReadError(error instanceof Error ? error.message : String(error));
  }
}

export interface ManagedCalendar {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

/** The account's calendar list, every page. */
export async function listManagedCalendars(connection: Connection): Promise<ManagedCalendar[]> {
  const out: ManagedCalendar[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CALENDAR_PAGES; page += 1) {
    const data = await pinnedRead(connection, CALENDAR_READS.listCalendars, { max_results: 250, ...(pageToken ? { page_token: pageToken } : {}) });
    const { items, next } = pageOf(data, ['items', 'calendars'], calendarItem);
    out.push(...items.map(item => ({
      id: item.id, summary: item.summaryOverride ?? item.summary, primary: item.primary, selected: item.selected,
      hidden: item.hidden, accessRole: item.accessRole, backgroundColor: item.backgroundColor,
    })));
    if (!next) return out;
    pageToken = next;
  }
  return out;
}

/** The direct route's event summary shape (`RawGoogleEvent`), from a Google API event. */
export interface ManagedEvent {
  id?: string;
  iCalUID?: string;
  summary?: string;
  start?: string;
  end?: string;
  status?: string;
  htmlLink?: string;
  transparency?: string;
  location?: string;
  joinUrl?: string;
  colorId?: string;
  responseStatus?: string;
}

/**
 * Events overlapping the window, recurring series expanded into instances, every page up to a
 * bound. `complete` is false when the bound cut the list short.
 */
export async function listManagedEvents(connection: Connection, calendarId: string, timeMin: string, timeMax: string): Promise<{ events: ManagedEvent[]; complete: boolean }> {
  const events: ManagedEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const data = await pinnedRead(connection, CALENDAR_READS.listEvents, {
      calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 250, ...(pageToken ? { pageToken } : {}),
    });
    const { items, next } = pageOf(data, ['items', 'events'], eventItem);
    for (const e of items) {
      const self = e.attendees?.find(attendee => attendee.self);
      const video = e.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video');
      events.push({
        id: e.id, iCalUID: e.iCalUID, summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date,
        status: e.status, htmlLink: e.htmlLink, transparency: e.transparency, location: e.location,
        joinUrl: e.hangoutLink ?? video?.uri, colorId: e.colorId, responseStatus: self?.responseStatus,
      });
    }
    if (!next) return { events, complete: true };
    pageToken = next;
  }
  return { events, complete: false };
}
