/**
 * Builders for fictional provider payloads in the shapes the connector
 * capabilities return. Used by the preview dataset and tests. No real account
 * data ever passes through here.
 */
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

export interface FakeMail {
  id: string;
  threadId?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  date: string;
  sent?: boolean;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  labels?: string[];
  headers?: Record<string, string>;
}

export function gmailRaw(mail: FakeMail) {
  const headers = [
    { name: 'From', value: mail.from },
    { name: 'To', value: mail.to.join(', ') },
    ...(mail.cc?.length ? [{ name: 'Cc', value: mail.cc.join(', ') }] : []),
    { name: 'Subject', value: mail.subject },
    { name: 'Date', value: new Date(mail.date).toUTCString() },
    { name: 'Message-ID', value: mail.messageId ?? `<${mail.id}@mail.example>` },
    ...(mail.inReplyTo ? [{ name: 'In-Reply-To', value: mail.inReplyTo }] : []),
    ...(mail.references?.length ? [{ name: 'References', value: mail.references.join(' ') }] : []),
    ...Object.entries(mail.headers ?? {}).map(([name, value]) => ({ name, value })),
  ];
  return {
    id: mail.id,
    threadId: mail.threadId ?? mail.id,
    historyId: '1',
    internalDate: String(Date.parse(mail.date)),
    labelIds: mail.labels ?? (mail.sent ? ['SENT'] : ['INBOX']),
    snippet: mail.body.slice(0, 120),
    payload: { mimeType: 'text/plain', headers, body: { data: b64(mail.body) } },
  };
}

export function gmailMetadata(mail: FakeMail) {
  return {
    id: mail.id,
    threadId: mail.threadId ?? mail.id,
    labelIds: mail.labels ?? (mail.sent ? ['SENT'] : ['INBOX']),
    snippet: mail.body.slice(0, 120),
    headers: { From: mail.from, To: mail.to.join(', '), Subject: mail.subject, ...(mail.cc?.length ? { Cc: mail.cc.join(', ') } : {}) },
  };
}

export interface FakeEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: { email: string; displayName?: string; self?: boolean; organizer?: boolean; resource?: boolean; responseStatus?: string }[];
  organizerSelf?: boolean;
  cancelled?: boolean;
  recurringEventId?: string;
  originalStartTime?: string;
  description?: string;
  updated?: string;
}
export function calendarEvent(event: FakeEvent) {
  return {
    id: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
    status: event.cancelled ? 'cancelled' : 'confirmed',
    htmlLink: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(event.id)}`,
    allDay: false,
    startTimeZone: 'America/Denver',
    ...(event.recurringEventId ? { recurringEventId: event.recurringEventId, originalStartTime: { dateTime: event.originalStartTime ?? event.start } } : {}),
    organizer: { email: event.attendees.find((attendee) => attendee.organizer)?.email ?? 'owner@example.test', self: !!event.organizerSelf },
    attendees: event.attendees.map((attendee) => ({ email: attendee.email, displayName: attendee.displayName, self: !!attendee.self, organizer: !!attendee.organizer, resource: !!attendee.resource, optional: false, responseStatus: attendee.responseStatus ?? 'accepted' })),
    attendeesOmitted: false,
    description: event.description,
    updated: event.updated ?? event.start,
    cancelled: !!event.cancelled,
  };
}
