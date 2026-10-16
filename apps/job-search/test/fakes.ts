/**
 * Fake Gmail and Google Calendar capabilities with fictional data. They speak
 * the same shapes the kit's sync steps read: profile, search pages, metadata,
 * full messages, history pages (with expiry) and calendar sync pages.
 */
import { AppError } from '@ri/app-kit/contract';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

export interface FakeMessage {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  text: string;
  date: string;
  labels?: string[];
  messageId?: string;
  inReplyTo?: string;
  ics?: string;
  listUnsubscribe?: boolean;
}

export function rawMessage(message: FakeMessage) {
  const headers = [
    { name: 'From', value: message.from },
    { name: 'To', value: message.to ?? 'Sam Rivera <you@example.test>' },
    { name: 'Subject', value: message.subject },
    { name: 'Message-ID', value: message.messageId ?? `<${message.id}@mail.example.test>` },
    ...(message.inReplyTo ? [{ name: 'In-Reply-To', value: message.inReplyTo }, { name: 'References', value: message.inReplyTo }] : []),
    ...(message.listUnsubscribe ? [{ name: 'List-Unsubscribe', value: '<https://news.example.test/u>' }] : []),
  ];
  const parts: unknown[] = [{ mimeType: 'text/plain', body: { data: b64(message.text) } }];
  if (message.ics) parts.push({ mimeType: 'text/calendar', body: { data: b64(message.ics) } });
  return {
    id: message.id, threadId: message.threadId, historyId: '1', internalDate: String(Date.parse(message.date)), labelIds: message.labels ?? ['INBOX'], snippet: message.text.slice(0, 100),
    payload: { mimeType: 'multipart/mixed', headers, parts },
  };
}

export function ics(options: { uid: string; method?: string; sequence?: number; start: string; end: string; zone: string; summary: string; status?: string; organizer: string; attendees: string[] }) {
  return [
    'BEGIN:VCALENDAR', `METHOD:${options.method ?? 'REQUEST'}`, 'BEGIN:VEVENT', `UID:${options.uid}`, `SUMMARY:${options.summary}`,
    `DTSTART;TZID=${options.zone}:${options.start}`, `DTEND;TZID=${options.zone}:${options.end}`, `SEQUENCE:${options.sequence ?? 0}`, `STATUS:${options.status ?? 'CONFIRMED'}`,
    `ORGANIZER;CN=Organizer:mailto:${options.organizer}`, ...options.attendees.map((email) => `ATTENDEE:mailto:${email}`), 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export interface MailboxOptions {
  emailAddress: string;
  /** Backfill search pages of message IDs. */
  pages: string[][];
  messages: Record<string, FakeMessage>;
  /** History pages, each a list of history records. */
  history?: Record<string, unknown>[][];
  expireHistoryOnce?: boolean;
}

export interface CalendarOptions {
  calendars?: { id: string; summary: string; primary?: boolean }[];
  /** Full-scan pages, then incremental pages served one per sync call. */
  pages: unknown[][];
  incremental?: unknown[][];
  expireTokenOnce?: boolean;
  timeZone?: string;
}

export interface FakeProvider {
  calls: { name: string; account?: string; input: Record<string, unknown> }[];
  mailbox: Record<string, MailboxOptions>;
  calendar: Record<string, CalendarOptions>;
  revoked: Set<string>;
  /** Fail the next call of this capability once, as an interrupted page would. */
  failOnce: Set<string>;
  capability: (name: string, input: unknown, target?: { binding?: string; account?: string }) => Promise<unknown>;
  ai?: (prompt: string) => string;
  tasks: Map<string, { id: string; title: string; status: string; dueAt?: string }>;
}

export function fakeProvider(options: { mailbox?: Record<string, MailboxOptions>; calendar?: Record<string, CalendarOptions>; ai?: (prompt: string) => string } = {}): FakeProvider {
  const provider: FakeProvider = {
    calls: [], mailbox: options.mailbox ?? {}, calendar: options.calendar ?? {}, revoked: new Set(), failOnce: new Set(), ai: options.ai, tasks: new Map(),
    async capability(name, rawInput, target) {
      const input = (rawInput ?? {}) as Record<string, unknown>;
      const account = target?.account;
      provider.calls.push({ name, account, input });
      if (account && provider.revoked.has(account)) throw new AppError('revoked', 'The connection needs to be reconnected');
      if (provider.failOnce.has(name)) { provider.failOnce.delete(name); throw new AppError('busy', 'The provider is busy'); }
      if (name === 'create_task') {
        const id = `task-${String(input.operationId).slice(-12)}`;
        const task = provider.tasks.get(id) ?? { id, title: String(input.title), status: 'todo', ...(input.dueAt ? { dueAt: String(input.dueAt) } : {}) };
        provider.tasks.set(id, task);
        return task;
      }
      if (name === 'get_task') {
        const task = provider.tasks.get(String(input.id));
        if (!task) throw new AppError('not_found', 'That Ri record is no longer available');
        return task;
      }
      if (name === 'ai_text') {
        if (!provider.ai) throw new AppError('unsupported', 'Bounded app AI is not available');
        return { text: provider.ai(String(input.prompt)) };
      }
      if (name === 'extract_text') {
        if (!String(input.mimeType).startsWith('text/')) throw new AppError('unsupported', 'Reading PDF and Word files is available once the app is in use');
        const text = Buffer.from(String(input.base64), 'base64').toString('utf8');
        return { text, truncated: false, characters: text.length };
      }
      if (name.startsWith('gmail.')) {
        const box = account ? provider.mailbox[account] : undefined;
        if (!box) throw new AppError('forbidden', 'Not granted');
        if (name === 'gmail.get_profile') return { emailAddress: box.emailAddress, historyId: '100' };
        if (name === 'gmail.search_messages') {
          const index = input.pageToken ? Number(String(input.pageToken).slice(1)) : 0;
          const page = box.pages[index] ?? [];
          return { messages: page.map((id) => ({ id, threadId: box.messages[id]?.threadId ?? id })), ...(index + 1 < box.pages.length ? { nextPageToken: `p${index + 1}` } : {}) };
        }
        if (name === 'gmail.get_message') {
          const message = box.messages[String(input.messageId)];
          if (!message) throw new AppError('not_found', 'Message not found');
          return { id: message.id, threadId: message.threadId, labelIds: message.labels ?? ['INBOX'], snippet: message.text.slice(0, 100), headers: { Subject: message.subject, From: message.from, To: message.to ?? 'you@example.test', Date: new Date(message.date).toUTCString() } };
        }
        if (name === 'gmail.read_message') {
          const message = box.messages[String(input.messageId)];
          if (!message) throw new AppError('not_found', 'Message not found');
          return rawMessage(message);
        }
        if (name === 'gmail.list_history') {
          if (box.expireHistoryOnce) { box.expireHistoryOnce = false; throw new AppError('not_found', 'History expired'); }
          const pages = box.history ?? [];
          const index = input.pageToken ? Number(String(input.pageToken).slice(1)) : 0;
          const records = pages.shift() ?? [];
          void index;
          return { historyId: String(200 + provider.calls.length), history: records };
        }
      }
      if (name.startsWith('google_calendar.')) {
        const calendar = account ? provider.calendar[account] : undefined;
        if (!calendar) throw new AppError('forbidden', 'Not granted');
        if (name === 'google_calendar.list_calendars') return { calendars: (calendar.calendars ?? [{ id: 'primary', summary: 'you@example.test', primary: true }]).map((item) => ({ ...item, accessRole: 'owner' })) };
        if (name === 'google_calendar.sync_events') {
          if (input.syncToken) {
            if (calendar.expireTokenOnce) { calendar.expireTokenOnce = false; throw new AppError('not_found', 'Sync token expired'); }
            const events = calendar.incremental?.shift() ?? [];
            return { events, nextSyncToken: `sync-${provider.calls.length}`, calendarTimeZone: calendar.timeZone ?? 'America/Denver' };
          }
          const index = input.pageToken ? Number(String(input.pageToken).slice(1)) : 0;
          const events = calendar.pages[index] ?? [];
          return { events, ...(index + 1 < calendar.pages.length ? { nextPageToken: `c${index + 1}` } : { nextSyncToken: 'sync-0' }), calendarTimeZone: calendar.timeZone ?? 'America/Denver' };
        }
      }
      throw new AppError('unsupported', `No fake for ${name}`);
    },
  };
  return provider;
}

/** A calendar event in the shape the kit's calendar sync reads. */
export function calendarEvent(options: { id: string; summary: string; start: string; end: string; zone?: string; organizer?: string; attendees?: { email: string; name?: string; self?: boolean }[]; uid?: string; cancelled?: boolean; description?: string; joinUrl?: string; recurringEventId?: string; originalStart?: string; updated?: string }) {
  return {
    id: options.id, iCalUID: options.uid ?? `${options.id}@calendar.example.test`, summary: options.summary, start: options.start, end: options.end, status: options.cancelled ? 'cancelled' : 'confirmed',
    allDay: false, startTimeZone: options.zone ?? 'America/Denver', endTimeZone: options.zone ?? 'America/Denver', joinUrl: options.joinUrl,
    organizer: options.organizer ? { email: options.organizer, displayName: undefined, self: false } : undefined,
    attendees: (options.attendees ?? []).map((attendee) => ({ email: attendee.email, displayName: attendee.name, self: !!attendee.self, organizer: attendee.email === options.organizer, resource: false, optional: false, responseStatus: 'accepted' })),
    attendeesOmitted: false, description: options.description, updated: options.updated ?? '2026-10-12T15:10:00.000Z', cancelled: !!options.cancelled,
    ...(options.recurringEventId ? { recurringEventId: options.recurringEventId, originalStartTime: { dateTime: options.originalStart } } : {}),
  };
}
