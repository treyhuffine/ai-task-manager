import { describe, it, expect } from 'vitest';
import {
  actionLabel,
  approvalNote,
  formatWhen,
  subjectFromRecord,
  subjectLookupActionId,
  summarizeCall,
  toolNameFor,
} from './approval-describe';

describe('actionLabel / toolNameFor', () => {
  it('humanizes the method of an action id', () => {
    expect(actionLabel('google_calendar.delete_event')).toBe('Delete event');
    expect(actionLabel('gmail.send_email')).toBe('Send email');
    expect(actionLabel('mcp.linear.createIssue')).toBe('Create issue');
    expect(actionLabel('mcp.my_server.post-update')).toBe('Post update');
  });

  it('matches the MCP tool name the agent called', () => {
    expect(toolNameFor('google_calendar.delete_event')).toBe('google_calendar__delete_event');
    expect(toolNameFor('mcp.linear.createIssue')).toBe('mcp__linear__createIssue');
  });
});

describe('formatWhen', () => {
  it('formats date-times and all-day dates in host time, and leaves other text alone', () => {
    const dt = '2026-09-30T13:00:00Z';
    expect(formatWhen(dt)).toBe(
      new Date(dt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    );
    expect(formatWhen('2026-09-30')).toBe('Wed, Sep 30');
    expect(formatWhen('next week')).toBe('next week');
  });
});

describe('summarizeCall', () => {
  it('leads with the looked-up subject for an id-only delete', () => {
    const { summary, details } = summarizeCall(
      { calendarId: 'primary', eventId: 'evt_123' },
      'Team standup · Wed, Sep 30, 9:00 AM',
    );
    expect(summary).toBe('Team standup · Wed, Sep 30, 9:00 AM');
    expect(details).toEqual([
      { label: 'Calendar id', value: 'primary' },
      { label: 'Event id', value: 'evt_123' },
    ]);
  });

  it('falls back to the id when nothing names the target', () => {
    expect(summarizeCall({ calendarId: 'primary', eventId: 'evt_123' }).summary).toBe('Event id evt_123');
    expect(summarizeCall({ eventId: 'evt_123' }).summary).toBe('Event id evt_123');
  });

  it('names the recipient and subject of a send', () => {
    const { summary, details } = summarizeCall({
      to: ['ana@example.com', 'bo@example.com'],
      subject: 'Quarterly numbers',
      body: 'Hi both,\n\nAttached are the numbers.',
      account: 'me@example.com',
    });
    expect(summary).toBe('To ana@example.com, bo@example.com · Quarterly numbers');
    // Salient fields first, and the account routing field is never an argument.
    expect(details.map((d) => d.label)).toEqual(['To', 'Subject', 'Body']);
    expect(details[2]!.value).toBe('Hi both, Attached are the numbers.');
  });

  it('quotes the text of a post when there is no title', () => {
    expect(summarizeCall({ channel: '#general', text: 'Ship it' }).summary).toBe('To #general · “Ship it”');
  });

  it('adds the start time of a created event', () => {
    const start = '2026-10-01T15:00:00Z';
    expect(summarizeCall({ summary: 'Dentist', start }).summary).toBe(`Dentist · ${formatWhen(start)}`);
  });

  it('copes with empty and odd input', () => {
    expect(summarizeCall(undefined).summary).toBe('No arguments');
    expect(summarizeCall({ flags: { dryRun: false } }).summary).toBe('Flags: {"dryRun":false}');
    expect(summarizeCall({ items: [{ a: 1 }, { b: 2 }] }).details).toEqual([{ label: 'Items', value: '2 items' }]);
  });

  it('truncates long values', () => {
    const { summary } = summarizeCall({ title: 'x'.repeat(400) });
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('subjectFromRecord', () => {
  it('names a calendar event by title and time', () => {
    const start = '2026-09-30T13:00:00Z';
    expect(subjectFromRecord({ id: 'e1', summary: 'Team standup', start })).toBe(`Team standup · ${formatWhen(start)}`);
  });

  it('names a message by subject and sender', () => {
    expect(subjectFromRecord({ subject: 'Invoice', from: 'billing@example.com' })).toBe('Invoice · from billing@example.com');
  });

  it('unwraps an ingested MCP tool result', () => {
    const start = '2026-09-30T13:00:00Z';
    const mcp = (text: string, extra: Record<string, unknown> = {}) => ({
      server: 'team_calendar',
      tool: 'get_event',
      isError: false,
      content: [{ type: 'text', text }],
      ...extra,
    });
    expect(subjectFromRecord(mcp(JSON.stringify({ id: 'e1', summary: 'Team standup', start })))).toBe(
      `Team standup · ${formatWhen(start)}`,
    );
    expect(subjectFromRecord(mcp('not json'))).toBeNull();
    expect(subjectFromRecord(mcp(JSON.stringify({ summary: 'x' }), { isError: true }))).toBeNull();
    expect(subjectFromRecord(mcp('ignored', { structuredContent: { title: 'Roadmap' } }))).toBe('Roadmap');
  });

  it('returns null when nothing is nameable', () => {
    expect(subjectFromRecord({ id: 'x' })).toBeNull();
    expect(subjectFromRecord(null)).toBeNull();
    expect(subjectFromRecord(['a'])).toBeNull();
  });
});

describe('subjectLookupActionId', () => {
  const reads = new Set(['google_calendar.get_event', 'google_calendar.list_events', 'calendly.get_event']);

  it('pairs a destructive action with its toolkit’s get read', () => {
    expect(subjectLookupActionId('google_calendar.delete_event', reads)).toBe('google_calendar.get_event');
    expect(subjectLookupActionId('google_calendar.update_event', reads)).toBe('google_calendar.get_event');
    expect(subjectLookupActionId('calendly.cancel_event', reads)).toBe('calendly.get_event');
  });

  it('never pairs a send or a toolkit without the read', () => {
    expect(subjectLookupActionId('gmail.send_email', reads)).toBeNull();
    expect(subjectLookupActionId('outlook_calendar.delete_event', reads)).toBeNull();
    expect(subjectLookupActionId('nodot', reads)).toBeNull();
  });
});

describe('approvalNote', () => {
  const calls = [
    { toolName: 'google_calendar__delete_event', account: 'me@example.com', preview: { calendarId: 'primary', eventId: 'a' } },
    { toolName: 'google_calendar__delete_event', account: 'me@example.com', preview: { calendarId: 'primary', eventId: 'b' } },
  ];

  it('tells the agent to retry exactly the approved calls, listing their arguments', () => {
    const note = approvalNote('approve', calls, 5);
    expect(note).toMatch(/^\[Connector approval, from the app on the user's behalf\]/);
    expect(note).toContain('The user approved 2 pending google_calendar__delete_event calls (account me@example.com).');
    expect(note).toContain('Retry exactly those calls now with the same arguments.');
    expect(note).toContain('for the next 5 minutes');
    expect(note).toContain('- {"calendarId":"primary","eventId":"a"}');
    expect(note).toContain('- {"calendarId":"primary","eventId":"b"}');
  });

  it('reads naturally for a single call', () => {
    const note = approvalNote('approve', calls.slice(0, 1), 5);
    expect(note).toContain('The user approved your pending google_calendar__delete_event call');
    expect(note).toContain('Retry that exact call now');
  });

  it('says the action no longer asks when always allowed', () => {
    expect(approvalNote('always', calls, 5)).toContain(
      'The user set google_calendar__delete_event to run without asking from now on and approved 2 pending',
    );
  });

  it('tells the agent to stand down on denial', () => {
    const note = approvalNote('deny', calls, 5);
    expect(note).toContain('The user denied 2 pending google_calendar__delete_event calls');
    expect(note).toContain('Do not retry them.');
  });

  it('groups by tool and caps a long list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ toolName: 'gmail__send_email', account: null, preview: { i } }));
    const note = approvalNote('approve', [...many, calls[0]!], 5);
    expect(note).toContain('The user approved 30 pending gmail__send_email calls. Retry');
    expect(note).toContain('- …and 5 more');
    expect(note).toContain('The user approved your pending google_calendar__delete_event call (account me@example.com).');
  });
});
