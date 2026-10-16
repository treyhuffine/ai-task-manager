import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from '@ri/app-kit/contract';
import {
  calendarCoverage, calendarSyncStep, changeMailWindow, createAccountStore, createMailIndex, decodeMimeWords, emailDomain, gmailSyncStep, htmlToText,
  isNoReply, isPersonalMailDomain, isRoleAddress, mailCoverage, newCalendarCheckpoint, normalizeEmail, occurrenceKey, parseAddressList, parseCalendarInvite,
  parseGmailMessage, withoutQuotedReply, type MailCheckpoint,
} from '@ri/app-kit/sources';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const open = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-app-sources-')); temporary.push(dir); return new DatabaseSync(path.join(dir, 'records.db')); };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

describe('addresses', () => {
  it('normalizes only the domain and parses quoted names, comments and groups', () => {
    expect(normalizeEmail('  Maya.Chen+work@NorthStar.Example ')).toBe('Maya.Chen+work@northstar.example');
    expect(parseAddressList('"Chen, Maya" <maya@northstar.example>, jordan@fieldwork.example (Jordan), Team: a@x.example, b@x.example;')).toEqual([
      { name: 'Chen, Maya', address: 'maya@northstar.example', normalized: 'maya@northstar.example' },
      { name: null, address: 'jordan@fieldwork.example', normalized: 'jordan@fieldwork.example' },
      { name: null, address: 'a@x.example', normalized: 'a@x.example' },
      { name: null, address: 'b@x.example', normalized: 'b@x.example' },
    ]);
    expect(parseAddressList('=?UTF-8?B?Sm9zw6kgw4FsdmFyZXo=?= <jose@ejemplo.example>')[0].name).toBe('José Álvarez');
    expect(decodeMimeWords('=?ISO-8859-1?Q?Caf=E9_r=E9sum=E9?=')).toBe('Café résumé');
    expect(parseAddressList('not an address, <>')).toEqual([]);
    expect(isNoReply('no-reply@airline.example')).toBe(true);
    expect(isNoReply('noreply.bookings@hotel.example')).toBe(true);
    expect(isNoReply('maya@northstar.example')).toBe(false);
    expect(isRoleAddress('support@northstar.example')).toBe(true);
    expect(isRoleAddress('maya@northstar.example')).toBe(false);
    expect(emailDomain('maya@NorthStar.example')).toBe('northstar.example');
    expect(isPersonalMailDomain('gmail.com')).toBe(true);
    expect(isPersonalMailDomain('northstar.example')).toBe(false);
  });
});

describe('message parsing', () => {
  const raw = {
    id: 'm1', threadId: 't1', historyId: '501', internalDate: String(Date.parse('2026-10-12T15:04:00Z')), labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], snippet: 'Your stay',
    payload: { mimeType: 'multipart/mixed', headers: [
      { name: 'From', value: 'Riverside House <no-reply@riverside.example>' }, { name: 'To', value: 'owner@example.test' },
      { name: 'Subject', value: '=?UTF-8?Q?Confirmation_RH-4821_=E2=80=94_Riverside?=' }, { name: 'Message-ID', value: '<abc@riverside.example>' },
      { name: 'List-Unsubscribe', value: '<https://riverside.example/u>' }, { name: 'References', value: '<x@a> <y@b>' },
    ], parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: { data: b64('<html><head><style>p{}</style></head><body><p>Check-in&nbsp;Nov 10</p><table><tr><td>Ref</td><td>RH-4821</td></tr></table><script>x()</script></body></html>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'confirmation.pdf', body: { attachmentId: 'att-1', size: 2048 } },
      { mimeType: 'text/calendar', body: { data: b64('BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:evt-7@northstar.example\r\nSUMMARY:Portfolio discussion\r\nDTSTART;TZID=America/Denver:20261016T100000\r\nDTEND;TZID=America/Denver:20261016T110000\r\nSEQUENCE:2\r\nSTATUS:CONFIRMED\r\nORGANIZER;CN=Maya:mailto:maya@northstar.example\r\nATTENDEE;CN=Owner:mailto:owner@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR') } },
    ] },
  };
  it('reads HTML-only bodies, attachments, invitations and bulk signals', () => {
    const message = parseGmailMessage(raw);
    expect(message.subject).toBe('Confirmation RH-4821 — Riverside');
    expect(message.text).toContain('Check-in Nov 10');
    expect(message.text).toContain('RH-4821');
    expect(message.text).not.toContain('x()');
    expect(message.fromHtml).toBe(true);
    expect(message.from?.address).toBe('no-reply@riverside.example');
    expect(message.receivedAt).toBe('2026-10-12T15:04:00.000Z');
    expect(message.attachments).toEqual([{ attachmentId: 'att-1', filename: 'confirmation.pdf', mimeType: 'application/pdf', size: 2048, partId: null }]);
    expect(message.invite).toMatchObject({ method: 'REQUEST', uid: 'evt-7@northstar.example', start: '2026-10-16T10:00:00[America/Denver]', sequence: 2, organizer: 'maya@northstar.example', attendees: ['owner@example.test'] });
    expect(message.bulkReasons).toEqual(['unsubscribe link', 'no-reply sender', 'promotions']);
    expect(message.references).toEqual(['<x@a>', '<y@b>']);
    expect(parseGmailMessage(raw).digest).toBe(message.digest);
    expect(parseGmailMessage({ ...raw, id: 'm2' }).digest).not.toBe(message.digest);
  });
  it('bounds text, marks sent mail and trims quoted replies for evidence', () => {
    const sent = parseGmailMessage({ id: 's1', labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'owner@example.test' }, { name: 'To', value: 'Jordan Bell <jordan@fieldwork.example>' }], body: { data: b64('I will send the revised proposal by Friday.\n\nOn Tue, Oct 11, 2026 at 9:00 AM Jordan wrote:\n> Could you send it?') } } }, { maxText: 20 });
    expect(sent.sent).toBe(true);
    expect(sent.bulkReasons).toEqual([]);
    expect(sent.text.length).toBe(20);
    expect(sent.textTruncated).toBe(true);
    expect(withoutQuotedReply('I will send it.\n\nOn Tue, Oct 11, 2026 at 9:00 AM Jordan wrote:\n> Could you?')).toBe('I will send it.');
    expect(htmlToText('<p>A&amp;B &#8364;5 &unknown;</p>')).toBe('A&B €5 &unknown;');
    expect(parseCalendarInvite('nothing')).toBeNull();
  });
});

type Call = { name: string; input: Record<string, unknown>; account?: string };
function fakeGmail(options: { pages: string[][]; history?: Record<string, unknown>[]; expireHistoryOnce?: boolean }) {
  const calls: Call[] = [];
  let expired = false;
  const capability = async (name: string, input: unknown, target?: unknown) => {
    const call = { name, input: input as Record<string, unknown>, account: (target as { account?: string })?.account };
    calls.push(call);
    if (name === 'gmail.get_profile') return { emailAddress: 'owner@example.test', historyId: '100' };
    if (name === 'gmail.search_messages') {
      const index = call.input.pageToken ? Number(String(call.input.pageToken).slice(1)) : 0;
      return { messages: options.pages[index].map(id => ({ id, threadId: `t-${id}` })), ...(index + 1 < options.pages.length ? { nextPageToken: `p${index + 1}` } : {}) };
    }
    if (name === 'gmail.list_history') {
      if (options.expireHistoryOnce && !expired) { expired = true; throw new AppError('not_found', 'expired'); }
      const index = call.input.pageToken ? Number(String(call.input.pageToken).slice(1)) : 0;
      const history = options.history ?? [];
      return { historyId: '120', history: history[index] ? [history[index]] : [], ...(index + 1 < history.length ? { nextPageToken: `h${index + 1}` } : {}) };
    }
    if (name === 'gmail.get_message') return { id: call.input.messageId, threadId: 't', labelIds: [], headers: { Subject: String(call.input.messageId).startsWith('news') ? 'Weekly news' : 'Hello', From: 'maya@northstar.example' } };
    if (name === 'gmail.read_message') return { id: call.input.messageId, threadId: `t-${call.input.messageId}`, internalDate: String(Date.parse('2026-10-01T00:00:00Z') + Number(String(call.input.messageId).replace(/\D/g, '') || 0) * 1000), labelIds: [], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'maya@northstar.example' }], body: { data: b64(`Body ${call.input.messageId}`) } } };
    throw new Error(`Unexpected ${name}`);
  };
  return { calls, invocation: { capability, signal: new AbortController().signal } };
}

describe('bounded Gmail sync', () => {
  it('captures the mailbox position, alternates current changes with backfill, yields at ten bodies and resumes without rereading', async () => {
    const seen = new Set<string>(), ingested: string[] = [], skipped: string[] = [], removed: string[] = [];
    const gmail = fakeGmail({ pages: [Array.from({ length: 12 }, (_, i) => `a${i}`), ['b0', 'a3']], history: [{ messagesAdded: [{ message: { id: 'new1' } }, { message: { id: 'news9' } }], messagesDeleted: [{ message: { id: 'a5' } }] }] });
    let checkpoint: MailCheckpoint | null = null;
    const step = async () => {
      const result = await gmailSyncStep({
        invocation: gmail.invocation, account: 'acct-1', binding: 'mail', checkpoint, windowDays: 90, query: 'in:sent OR to:me', deadline: Date.now() + 20000,
        now: () => new Date('2026-10-15T12:00:00Z'),
        seen: id => seen.has(id),
        relevant: headers => !headers.subject.includes('news'),
        ingest: message => { seen.add(message.id); ingested.push(message.id); },
        skip: id => { seen.add(id); skipped.push(id); },
        removed: id => removed.push(id),
      });
      checkpoint = result.checkpoint;
      return result;
    };
    expect((await step()).lane).toBe('profile');
    expect(checkpoint!.history.historyId).toBe('100');
    const history = await step();
    expect(history.lane).toBe('history');
    expect(ingested).toEqual(['new1']);
    expect(skipped).toEqual(['news9']);
    expect(removed).toEqual(['a5']);
    expect(checkpoint!.history.historyId).toBe('120');
    const first = await step();
    expect(first).toMatchObject({ lane: 'backfill', read: 10, yielded: true, more: true });
    expect(checkpoint!.backfill.pageToken).toBeNull();
    const query = gmail.calls.find(call => call.name === 'gmail.search_messages')!.input.query as string;
    expect(query).toBe(`(in:sent OR to:me) after:${Math.floor(Date.parse('2026-07-17T12:00:00Z') / 1000)}`);
    expect(gmail.calls.every(call => call.account === 'acct-1')).toBe(true);
    await step(); // history lane in between keeps current changes first
    const second = await step();
    expect(second).toMatchObject({ lane: 'backfill', read: 2, yielded: false });
    expect(checkpoint!.backfill.pageToken).toBe('p1');
    await step();
    const third = await step();
    expect(third.read).toBe(1); // a3 was already read on the first page
    expect(checkpoint!.backfill.complete).toBe(true);
    expect(mailCoverage(checkpoint).partial).toBe(false);
    expect(gmail.calls.filter(call => call.name === 'gmail.read_message').length).toBe(new Set(gmail.calls.filter(call => call.name === 'gmail.read_message').map(call => call.input.messageId)).size);
    const idle = await step();
    expect(idle).toMatchObject({ lane: 'history', more: false });
  });

  it('restarts a bounded rescan when the history checkpoint expires, and widening the window resumes older backfill only', async () => {
    const gmail = fakeGmail({ pages: [[]], expireHistoryOnce: true });
    const base: MailCheckpoint = { version: 1, emailAddress: 'owner@example.test', windowDays: 30, windowStart: '2026-09-15T12:00:00.000Z', backfill: { pageToken: null, pages: 3, complete: true, completedAt: '2026-10-01T00:00:00.000Z', oldestAt: null }, history: { historyId: '50', pageToken: null, checkedAt: null }, lane: 'history', rescans: 0, lastSuccessAt: '2026-10-14T00:00:00.000Z' };
    const result = await gmailSyncStep({ invocation: gmail.invocation, account: 'a', binding: 'mail', checkpoint: base, windowDays: 30, query: 'in:sent', deadline: Date.now() + 1000, seen: () => false, ingest: () => {}, skip: () => {}, removed: () => {} });
    expect(result.checkpoint.rescans).toBe(1);
    expect(result.checkpoint.history.historyId).toBeNull();
    expect(result.checkpoint.backfill.complete).toBe(false);
    expect(result.checkpoint.lastSuccessAt).toBe(base.lastSuccessAt);
    const wider = changeMailWindow(base, 365, new Date('2026-10-15T12:00:00Z'));
    expect(wider.backfill).toMatchObject({ complete: false, pageToken: null });
    expect(wider.history.historyId).toBe('50');
    expect(changeMailWindow(base, 7).backfill.complete).toBe(true);
  });

  it('stops at a record boundary when the deadline passes', async () => {
    const gmail = fakeGmail({ pages: [['a1', 'a2']] });
    const checkpoint: MailCheckpoint = { version: 1, emailAddress: null, windowDays: 30, windowStart: '2026-09-15T00:00:00.000Z', backfill: { pageToken: null, pages: 0, complete: false, completedAt: null, oldestAt: null }, history: { historyId: '1', pageToken: null, checkedAt: null }, lane: 'history', rescans: 0, lastSuccessAt: null };
    const result = await gmailSyncStep({ invocation: gmail.invocation, account: 'a', binding: 'mail', checkpoint, windowDays: 30, query: 'x', deadline: Date.now() - 1, seen: () => false, ingest: () => {}, skip: () => {}, removed: () => {} });
    expect(result).toMatchObject({ read: 0, yielded: true, more: true });
    expect(result.checkpoint.backfill.pageToken).toBeNull();
  });
});

describe('bounded Calendar sync', () => {
  it('pages the window, switches to the sync token, reports cancellations and resets on an expired token', async () => {
    const calls: Record<string, unknown>[] = [];
    let expire = false;
    const event = (id: string, extra: object = {}) => ({ id, allDay: false, attendees: [], attendeesOmitted: false, cancelled: false, ...extra });
    const invocation = { signal: new AbortController().signal, capability: async (_name: string, input: unknown) => {
      const value = input as Record<string, unknown>; calls.push(value);
      if (value.syncToken && expire) throw new AppError('not_found', 'expired');
      if (value.syncToken) return { events: [event('e1', { cancelled: true, status: 'cancelled' })], nextSyncToken: 'sync-2' };
      if (!value.pageToken) return { events: [event('e1'), event('e2_20261016', { recurringEventId: 'e2', originalStartTime: { dateTime: '2026-10-16T10:00:00-06:00' } })], nextPageToken: 'pg2', calendarTimeZone: 'America/Denver' };
      return { events: [event('e3')], nextSyncToken: 'sync-1' };
    } };
    const ingested: string[] = [];
    let checkpoint = newCalendarCheckpoint('primary', 90, 180, new Date('2026-10-15T12:00:00Z'));
    const run = async (now = '2026-10-15T12:05:00Z') => {
      const result = await calendarSyncStep({ invocation, account: 'a', binding: 'calendar', checkpoint, now: () => new Date(now), ingest: e => { ingested.push(`${occurrenceKey(e)}${e.cancelled ? ':cancelled' : ''}`); } });
      checkpoint = result.checkpoint; return result;
    };
    expect((await run()).more).toBe(true);
    expect(calls[0]).toMatchObject({ calendarId: 'primary', timeMin: '2026-07-17T12:00:00.000Z', timeMax: '2027-04-13T12:00:00.000Z' });
    expect((await run()).more).toBe(false);
    expect(checkpoint).toMatchObject({ phase: 'incremental', syncToken: 'sync-1', timeZone: 'America/Denver' });
    expect(calendarCoverage(checkpoint).partial).toBe(false);
    await run();
    expect(calls[2]).toEqual({ calendarId: 'primary', syncToken: 'sync-1', maxResults: 250 });
    expect(ingested).toEqual(['e1', 'e2@2026-10-16T10:00:00-06:00', 'e3', 'e1:cancelled']);
    expect(checkpoint.syncToken).toBe('sync-2');
    expire = true;
    const reset = await run();
    expect(reset.checkpoint).toMatchObject({ phase: 'full', syncToken: null, resets: 1 });
    expire = false;
    // Halfway through the future window a fresh full scan moves the window forward.
    checkpoint = { ...checkpoint, phase: 'incremental', syncToken: 'sync-2', completedAt: '2026-10-15T12:00:00.000Z' };
    await run('2027-01-20T00:00:00Z');
    expect(calls.at(-1)).toMatchObject({ timeMin: '2026-10-22T00:00:00.000Z' });
  });
});

describe('source accounts and the message index', () => {
  it('remembers setup and checkpoints per account and makes delivery idempotent', () => {
    const db = open(), accounts = createAccountStore(db), index = createMailIndex(db);
    accounts.setup({ account: 'acct-1', kind: 'mail', historyDays: 90, label: 'owner@example.test' });
    accounts.setup({ account: 'acct-1', kind: 'calendar', historyDays: 90, calendars: ['primary'] });
    expect(accounts.list().map(item => [item.kind, item.status])).toEqual([['calendar', 'not_started'], ['mail', 'not_started']]);
    accounts.commit('acct-1', 'mail', { version: 1 }, 'importing');
    expect(accounts.get('acct-1', 'mail')).toMatchObject({ status: 'importing', checkpoint: { version: 1 } });
    accounts.pause('acct-1', true);
    accounts.commit('acct-1', 'mail', { version: 1 }, 'ready');
    expect(accounts.get('acct-1', 'mail')!.status).toBe('paused');
    accounts.failed('acct-1', 'mail', 'reconnect', 'needs reconnect');
    expect(accounts.get('acct-1', 'mail')!.status).toBe('paused');
    accounts.pause('acct-1', false);
    expect(accounts.get('acct-1', 'mail')!.status).toBe('ready');
    index.record('acct-1', 'm1', 't1', 'kept', { receivedAt: '2026-10-12T00:00:00Z', digest: 'd' });
    index.record('acct-1', 'm1', 't1', 'kept');
    index.record('acct-1', 'm2', 't1', 'skipped');
    expect(index.seen('acct-1', 'm1')).toBe(true);
    expect(index.seen('acct-2', 'm1')).toBe(false);
    expect(index.counts('acct-1')).toEqual({ kept: 1, skipped: 1, removed: 0 });
    index.record('acct-1', 'm1', 't1', 'removed');
    expect(index.outcome('acct-1', 'm1')).toBe('removed');
    index.forget('acct-1');
    accounts.remove('acct-1');
    expect(index.seen('acct-1', 'm2')).toBe(false);
    expect(accounts.list()).toEqual([]);
  });
});
