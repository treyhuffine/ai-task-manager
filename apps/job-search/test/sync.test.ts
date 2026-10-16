/**
 * Bounded background sync with fake Gmail and Google Calendar capabilities.
 * Every mailbox, message and event is fictional.
 */
import { describe, it, expect } from 'vitest';
import { setup, call, owner, job, mailAccount, calendarAccount } from './helpers.js';
import { calendarEvent, fakeProvider, type FakeMessage } from './fakes.js';
import { MAIL_QUERY } from '../src/server/sync.js';
import { app } from '../src/server/state.js';

const NOW = '2026-10-15T15:00:00Z';
const msg = (id: string, threadId: string, from: string, subject: string, text: string, date: string, extra: Partial<FakeMessage> = {}): FakeMessage => ({ id, threadId, from, subject, text, date, ...extra });
/** Run scheduled steps until nothing is due, as the five-minute schedule would over time. */
const drain = async (accounts: ReturnType<typeof mailAccount>[], capability: (name: string, input: unknown, target?: { binding?: string; account?: string }) => Promise<unknown>) => {
  later();
  const results = [];
  for (let index = 0; index < 60; index++) {
    const result = await call('run_background_step', {}, job(accounts, { capability }));
    results.push(result);
    if (result.ran === null) return results;
  }
  throw new Error('The schedule never settled');
};
/** Time passes: idle jobs become due again, as at the next scheduled run. */
const later = () => app().db.exec("UPDATE app_jobs SET next_eligible_at = '2000-01-01T00:00:00.000Z' WHERE state = 'pending'");
const syncStep = (accounts: ReturnType<typeof mailAccount>[], capability: (name: string, input: unknown, target?: { binding?: string; account?: string }) => Promise<unknown>) => call('sync_step', {}, job(accounts, { capability }));
const save = async (fields: Record<string, unknown>) => (await call('save_opportunity', fields, owner())).record as { id: string; revision: number };
const detail = (id: string) => call('get_opportunity', { id }, owner());

describe('bounded Gmail sync', () => {
  it('reads application, recruiter, interview and offer mail received and sent, from two accounts in fair rotation', async () => {
    await setup({ now: NOW });
    const lumen = await save({ company: 'Lumen', role: 'Staff designer' });
    const cedar = await save({ company: 'Cedar', role: 'Design lead' });
    const provider = fakeProvider({ mailbox: {
      'acct-personal': { emailAddress: 'you@example.test', pages: [['sent-1', 'news-1']], messages: {
        'sent-1': msg('sent-1', 't-sent', 'Sam Rivera <you@example.test>', 'Application for the Staff designer role', 'Hello, attached is my résumé for the Staff designer role at Lumen.', '2026-10-12T09:00:00Z', { to: 'Lumen Jobs <jobs@lumen.example>', labels: ['SENT'] }),
        'news-1': msg('news-1', 't-news', 'Job Alerts <alerts@board.example.test>', 'Ten new jobs for you', 'Ten jobs that match your search.', '2026-10-12T08:00:00Z', { listUnsubscribe: true }),
      } },
      'acct-work': { emailAddress: 'you@work.example.test', pages: [['offer-1']], messages: {
        'offer-1': msg('offer-1', 't-offer', 'Priya Natarajan <priya@cedar.example>', 'Your offer', 'We are delighted to extend an offer for the Design lead role at Cedar.', '2026-10-14T15:30:00Z'),
      } },
    } });
    const accounts = [mailAccount('acct-personal'), mailAccount('acct-work')];
    const results = await drain(accounts, provider.capability);
    const sources = results.filter((result) => result.ran === 'sync_mail').map((result) => result.source);
    expect(sources.slice(0, 2).sort()).toEqual(['account:acct-personal', 'account:acct-work']);
    const search = provider.calls.find((item) => item.name === 'gmail.search_messages')!;
    expect(String(search.input.query)).toContain(MAIL_QUERY);
    expect(String(search.input.query)).not.toContain('-in:sent');
    expect(String(search.input.query)).toMatch(/after:\d+$/);
    const lumenDetail = await detail(lumen.id);
    expect(lumenDetail.correspondence).toEqual([expect.objectContaining({ sent: true, classification: 'sent_application' })]);
    expect((await detail(cedar.id)).opportunity.stage).toBe('offer');
    expect(app().db.prepare("SELECT outcome FROM app_mail_messages WHERE message_id = 'news-1'").get()).toMatchObject({ outcome: 'skipped' });
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM correspondence').get()).toMatchObject({ count: 2 });
    const sourcesList = (await call('list_sources', {}, owner({ accounts }))).sources;
    const personal = sourcesList.find((source: { key: string; kind: string }) => source.key === 'account:acct-personal' && source.kind === 'mail');
    expect(personal).toMatchObject({ granted: true, automatic: true, status: 'ready', historyDays: 90, label: 'you@example.test' });
    expect(personal.coverage.partial).toBe(false);
  });

  it('reads at most ten new bodies in one step and resumes without reading any twice after duplicate delivery', async () => {
    await setup({ now: NOW });
    await save({ company: 'Northstar', role: 'Product designer' });
    const messages: Record<string, FakeMessage> = {};
    for (let index = 0; index < 12; index++) messages[`m-${index}`] = msg(`m-${index}`, `t-${index}`, 'Northstar Talent <talent@northstar.example>', `Your application for the Product designer role ${index}`, `Update ${index} on your application for the Product designer role.`, `2026-10-0${1 + (index % 9)}T10:00:00Z`);
    const provider = fakeProvider({ mailbox: { acct: { emailAddress: 'you@example.test', pages: [Object.keys(messages), ['m-3', 'm-4']], messages, history: [[{ messagesAdded: [{ message: { id: 'm-1', threadId: 't-1' } }, { message: { id: 'm-2', threadId: 't-2' } }] }]] } } });
    const accounts = [mailAccount('acct')];
    const results = await drain(accounts, provider.capability);
    const reads = results.map((result) => result.read);
    expect(Math.max(...reads)).toBe(10);
    expect(results.some((result) => result.ran === 'sync_mail' && result.read === 10 && result.more)).toBe(true);
    const bodies = provider.calls.filter((item) => item.name === 'gmail.read_message').map((item) => item.input.messageId);
    expect(bodies).toHaveLength(12);
    expect(new Set(bodies).size).toBe(12);
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM correspondence').get()).toMatchObject({ count: 12 });
  });

  it('an interrupted page commits nothing partial and the next step reads the page again without duplicates', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const provider = fakeProvider({ mailbox: { acct: { emailAddress: 'you@example.test', pages: [['a', 'b', 'c']], messages: {
      a: msg('a', 'ta', 'Lumen <jobs@lumen.example>', 'Thank you for applying', 'Thank you for applying for the Staff designer role at Lumen.', '2026-10-10T10:00:00Z'),
      b: msg('b', 'tb', 'Lumen <jobs@lumen.example>', 'Staff designer next steps', 'Could you share your availability for the Staff designer interview?', '2026-10-11T10:00:00Z'),
      c: msg('c', 'tc', 'Lumen <jobs@lumen.example>', 'Re: Staff designer', 'One more note about the Staff designer role.', '2026-10-12T10:00:00Z'),
    } } } });
    const accounts = [mailAccount('acct')];
    await syncStep(accounts, provider.capability); // the mailbox position
    await syncStep(accounts, provider.capability); // current changes first
    const readsBefore = provider.calls.filter((item) => item.name === 'gmail.read_message').length;
    let failures = 0;
    const flaky = async (name: string, input: unknown, target?: { binding?: string; account?: string }) => {
      if (name === 'gmail.read_message' && (input as { messageId: string }).messageId === 'c' && failures++ === 0) throw Object.assign(new Error('The provider is busy'), { name: 'AppError', code: 'busy' });
      return provider.capability(name, input, target);
    };
    const failed = await syncStep(accounts, flaky);
    expect(failed).toMatchObject({ ran: 'sync_mail', more: true });
    expect(failed.message).toMatch(/busy/);
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM correspondence').get()).toMatchObject({ count: 0 });
    expect((await detail(record.id)).opportunity.stage).toBe('saved');
    // The job backs off. A person's Continue runs the same bounded step now.
    const resumed = await call('continue_import', { source: 'account:acct' }, owner({ accounts, capability: flaky }));
    expect(resumed).toMatchObject({ ran: 'sync_mail', read: 3 });
    const opened = await detail(record.id);
    expect(opened.correspondence).toHaveLength(3);
    expect(opened.stageHistory.filter((event: { toStage: string }) => event.toStage === 'applied')).toHaveLength(1);
    expect(opened.interviews).toHaveLength(1);
    expect(provider.calls.filter((item) => item.name === 'gmail.read_message').length - readsBefore).toBe(5);
  });

  it('an expired history cursor rescans only the configured window, with explicit coverage, and never duplicates records', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const ack = msg('a', 'ta', 'Lumen <jobs@lumen.example>', 'Thank you for applying', 'Thank you for applying for the Staff designer role at Lumen.', '2026-10-10T10:00:00Z');
    const provider = fakeProvider({ mailbox: { acct: { emailAddress: 'you@example.test', pages: [['a']], messages: { a: ack } } } });
    const accounts = [mailAccount('acct')];
    await drain(accounts, provider.capability);
    provider.mailbox.acct.expireHistoryOnce = true;
    await drain(accounts, provider.capability);
    const checkpoint = app().accounts.get('acct', 'mail')!.checkpoint as { rescans: number; windowDays: number };
    expect(checkpoint).toMatchObject({ rescans: 1, windowDays: 90 });
    const searches = provider.calls.filter((item) => item.name === 'gmail.search_messages');
    expect(searches.length).toBeGreaterThanOrEqual(2);
    for (const search of searches) expect(String(search.input.query)).toMatch(/after:\d+$/);
    expect(provider.calls.filter((item) => item.name === 'gmail.read_message')).toHaveLength(1);
    expect((await detail(record.id)).correspondence).toHaveLength(1);
    // Widening the window reads older mail for the new range only.
    await call('set_source', { account: 'acct', kind: 'mail', historyDays: 365 }, owner({ accounts }));
    expect(app().accounts.get('acct', 'mail')!.historyDays).toBe(365);
    expect((await call('list_sources', {}, owner({ accounts }))).sources.find((source: { key: string }) => source.key === 'account:acct').coverage.partial).toBe(true);
  });

  it('a message deleted upstream is labeled unavailable, its cached body is dropped, and nothing else is invented', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Cedar', role: 'Design lead' });
    const provider = fakeProvider({ mailbox: { acct: { emailAddress: 'you@example.test', pages: [['o']], messages: { o: msg('o', 'to', 'Priya <priya@cedar.example>', 'Your offer', 'We are delighted to extend an offer for the Design lead role at Cedar.', '2026-10-14T10:00:00Z') } } } });
    const accounts = [mailAccount('acct')];
    await drain(accounts, provider.capability);
    expect((await detail(record.id)).opportunity.stage).toBe('offer');
    provider.mailbox.acct.history = [[{ messagesDeleted: [{ message: { id: 'o' } }] }]];
    await drain(accounts, provider.capability);
    const opened = await detail(record.id);
    expect(opened.correspondence[0]).toMatchObject({ unavailable: true });
    expect(opened.opportunity.stage).toBe('offer');
    expect(opened.stageHistory).toHaveLength(2);
    const read = await call('get_correspondence', { id: opened.correspondence[0].id }, owner());
    expect(read.body).toBeNull();
  });

  it('a person\'s decision survives re-ingestion of the same message', async () => {
    await setup({ now: NOW });
    const designer = await save({ company: 'Northstar', role: 'Product designer' });
    const senior = await save({ company: 'Northstar', role: 'Senior product designer' });
    const message = msg('x', 'tx', 'Northstar Talent <talent@northstar.example>', 'Your candidacy', 'Thanks for your time yesterday.', '2026-10-10T10:00:00Z');
    const provider = fakeProvider({ mailbox: { acct: { emailAddress: 'you@example.test', pages: [['x']], messages: { x: message } } } });
    const accounts = [mailAccount('acct')];
    await drain(accounts, provider.capability);
    const review = (await call('list_review', { limit: 10 }, owner())).items[0];
    await call('resolve_match', { reviewId: review.id, expectedRevision: review.revision, decision: 'attach', opportunityId: senior.id }, owner());
    // The same message is delivered again by history, and again directly.
    provider.mailbox.acct.history = [[{ messagesAdded: [{ message: { id: 'x', threadId: 'tx' } }] }]];
    await drain(accounts, provider.capability);
    const { ingestMessage } = await import('../src/server/ingest.js');
    const { parseGmailMessage } = await import('@ri/app-kit/sources');
    const { rawMessage } = await import('./fakes.js');
    ingestMessage(parseGmailMessage(rawMessage({ ...message, text: 'Thanks for your time yesterday. Edited.' })), { account: 'acct', ownAddress: 'you@example.test' });
    expect((await detail(senior.id)).correspondence).toEqual([expect.objectContaining({ matchedBy: 'owner-ui:owner', matchLevel: 'exact' })]);
    expect((await detail(designer.id)).correspondence).toEqual([]);
    expect((await call('list_review', { limit: 10 }, owner())).items).toEqual([]);
  });

  it('a revoked connection stops updates, keeps records and labels coverage stale', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const provider = fakeProvider({ mailbox: { acct: { emailAddress: 'you@example.test', pages: [['a']], messages: { a: msg('a', 'ta', 'Lumen <jobs@lumen.example>', 'Thank you for applying', 'Thank you for applying for the Staff designer role at Lumen.', '2026-10-10T10:00:00Z') } } } });
    const accounts = [mailAccount('acct')];
    await drain(accounts, provider.capability);
    provider.revoked.add('acct');
    later();
    const result = await syncStep(accounts, provider.capability);
    expect(result.message).toMatch(/reconnected in Ri/);
    const source = (await call('list_sources', {}, owner({ accounts }))).sources.find((item: { key: string }) => item.key === 'account:acct');
    expect(source).toMatchObject({ status: 'reconnect', failed: 1 });
    expect((await detail(record.id)).correspondence).toHaveLength(1);
    const list = await call('list_opportunities', { limit: 10, view: 'active' }, owner({ accounts }));
    expect(list.coverage.partial).toBe(true);
    // Disconnected in Ri: the account leaves access, records stay, and the schedule no longer reads it.
    const before = provider.calls.length;
    await drain([], provider.capability);
    expect(provider.calls.length).toBe(before);
    expect((await call('list_sources', {}, owner())).sources.find((item: { key: string }) => item.key === 'account:acct')).toMatchObject({ granted: false, status: 'disconnected', records: 1 });
  });

  it('pause stops an account and Delete imported data removes its records while keeping what the person wrote', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Cedar', role: 'Design lead', notes: 'Met Priya at a meetup.' });
    const provider = fakeProvider({
      mailbox: { acct: { emailAddress: 'you@example.test', pages: [['o']], messages: { o: msg('o', 'to', 'Priya <priya@cedar.example>', 'Your offer', 'We are delighted to extend an offer for the Design lead role at Cedar.', '2026-10-14T10:00:00Z') } } },
      calendar: { cal: { pages: [[calendarEvent({ id: 'ev', summary: 'Interview: Design lead at Cedar', start: '2026-10-20T09:00:00-04:00', end: '2026-10-20T10:00:00-04:00', zone: 'America/New_York', organizer: 'priya@cedar.example', attendees: [{ email: 'priya@cedar.example', name: 'Priya Natarajan' }] })]] } },
    });
    const accounts = [mailAccount('acct'), calendarAccount('cal')];
    await drain(accounts, provider.capability);
    let opened = await detail(record.id);
    expect(opened.opportunity.stage).toBe('offer');
    const interview = opened.interviews[0];
    expect(interview).toMatchObject({ zone: 'America/New_York', origin: 'calendar' });
    await call('save_interview', { id: interview.id, expectedRevision: interview.revision, notes: 'Ask about the team size.' }, owner());
    const prep = await call('get_preparation', { opportunityId: record.id, interviewId: interview.id }, owner());
    await call('save_preparation', { opportunityId: record.id, interviewId: interview.id, expectedRevision: prep.revision, requirements: [], examples: [{ id: 'e', text: 'My example.', requirementIds: [] }], questions: [], notes: 'Prep notes.' }, owner());
    const scope = await call('create_scope', { actorId: 'chat:c-1', sources: ['manual', 'account:acct'], operations: ['read'] }, owner({ accounts }));

    await call('set_source', { account: 'acct', kind: 'mail', paused: true }, owner({ accounts }));
    const before = provider.calls.filter((item) => item.account === 'acct').length;
    await drain(accounts, provider.capability);
    expect(provider.calls.filter((item) => item.account === 'acct').length).toBe(before);
    await expect(call('continue_import', { source: 'account:acct' }, owner({ accounts, capability: provider.capability }))).rejects.toThrow(/paused/);

    const removed = await call('delete_source_data', { source: 'account:acct', confirm: 'delete' }, owner({ accounts }));
    expect(removed).toMatchObject({ removedMessages: 1, restoredStages: 1 });
    await call('delete_source_data', { source: 'account:cal', confirm: 'delete' }, owner({ accounts }));
    opened = await detail(record.id);
    expect(opened.opportunity.stage).toBe('saved');
    expect(opened.correspondence).toEqual([]);
    expect(opened.interviews).toEqual([]);
    expect(opened.opportunity.notes).toContain('Met Priya at a meetup.');
    expect(opened.opportunity.notes).toContain('Ask about the team size.');
    expect(opened.stageHistory.every((event: { source: string }) => event.source === 'manual')).toBe(true);
    const keptPrep = await call('get_preparation', { opportunityId: record.id }, owner());
    expect(keptPrep).toMatchObject({ notes: 'Prep notes.', interviewId: null });
    expect((await call('list_scopes', {}, owner())).scopes.find((item: { id: string }) => item.id === scope.scopeRef).sources).toEqual(['manual']);
    expect(app().mail.seen('acct', 'o')).toBe(false);
  });
});

describe('bounded Calendar sync', () => {
  it('pages the window, keeps recurring occurrences distinct, recovers from an expired sync token without duplicates and keeps a corrected time', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    const attendees = [{ email: 'maya.chen@northstar.example', name: 'Maya Chen' }];
    const base = { summary: 'Interview loop: Product designer', organizer: 'maya.chen@northstar.example', attendees, zone: 'America/Denver' };
    const provider = fakeProvider({ calendar: { cal: {
      pages: [
        [calendarEvent({ ...base, id: 'loop_1', recurringEventId: 'loop', originalStart: '2026-10-16T10:00:00-06:00', start: '2026-10-16T10:00:00-06:00', end: '2026-10-16T11:00:00-06:00' })],
        [calendarEvent({ ...base, id: 'loop_2', recurringEventId: 'loop', originalStart: '2026-10-17T10:00:00-06:00', start: '2026-10-17T10:00:00-06:00', end: '2026-10-17T11:00:00-06:00' }), calendarEvent({ id: 'dentist', summary: 'Dentist', start: '2026-10-18T09:00:00-06:00', end: '2026-10-18T10:00:00-06:00' })],
      ],
    } } });
    const accounts = [calendarAccount('cal')];
    await drain(accounts, provider.capability);
    let interviews = (await detail(record.id)).interviews;
    expect(interviews).toHaveLength(2);
    expect(interviews.map((item: { startAt: string }) => item.startAt).sort()).toEqual(['2026-10-16T16:00:00.000Z', '2026-10-17T16:00:00.000Z']);
    expect(app().db.prepare("SELECT COUNT(*) AS count FROM interviews WHERE title = 'Dentist'").get()).toMatchObject({ count: 0 });

    // The person corrects one interview's time. A later calendar change is recorded, and the correction stays.
    const first = interviews.find((item: { startAt: string }) => item.startAt === '2026-10-16T16:00:00.000Z');
    await call('save_interview', { id: first.id, expectedRevision: first.revision, start: { local: '2026-10-16T09:30', zone: 'America/Denver' } }, owner());
    provider.calendar.cal.incremental = [[calendarEvent({ ...base, id: 'loop_1', recurringEventId: 'loop', originalStart: '2026-10-16T10:00:00-06:00', start: '2026-10-16T13:00:00-06:00', end: '2026-10-16T14:00:00-06:00', updated: '2026-10-14T10:00:00.000Z' })]];
    await drain(accounts, provider.capability);
    interviews = (await detail(record.id)).interviews;
    const corrected = interviews.find((item: { id: string }) => item.id === first.id);
    expect(corrected).toMatchObject({ startAt: '2026-10-16T15:30:00.000Z', corrected: expect.arrayContaining(['startAt']) });
    expect(corrected.history.at(-1).summary).toMatch(/Your corrected time is kept/);

    // An expired sync token restarts the window without creating second copies.
    provider.calendar.cal.expireTokenOnce = true;
    await drain(accounts, provider.capability);
    expect((await detail(record.id)).interviews).toHaveLength(2);
    expect((app().accounts.get('cal', 'calendar')!.checkpoint as Record<string, { resets: number }>).primary.resets).toBe(1);
  });
});

describe('AI enrichment', () => {
  const unclear = (provider: ReturnType<typeof fakeProvider>) => {
    provider.mailbox.acct = { emailAddress: 'you@example.test', pages: [['u']], messages: { u: msg('u', 'tu', 'Maya Chen <maya.chen@northstar.example>', 'Product designer update', 'Hi Sam, a quick note about the Product designer process. Our panel met today and the team would love to bring you on board. Formal paperwork will follow.', '2026-10-14T10:00:00Z') } };
  };

  it('when AI is unavailable, emails stay linked and reviewable and the step reports Extraction unavailable', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    const provider = fakeProvider();
    unclear(provider);
    const accounts = [mailAccount('acct')];
    const results = await drain(accounts, provider.capability);
    expect(results.some((result) => result.ran === 'enrich_mail' && /Extraction unavailable/.test(result.message))).toBe(true);
    const opened = await detail(record.id);
    expect(opened.correspondence).toEqual([expect.objectContaining({ classification: 'other', aiLabel: null })]);
    expect(opened.opportunity.stage).toBe('saved');
    expect(app().db.prepare("SELECT enrich_state FROM correspondence WHERE message_id = 'u'").get()).toMatchObject({ enrich_state: 'unavailable' });
  });

  it('an AI reading needs an exact quote, only suggests a stage, and invalid output changes nothing', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    const reply = '{"category":"offer","quote":"the team would love to bring you on board"}';
    const provider = fakeProvider({ ai: () => reply });
    unclear(provider);
    const accounts = [mailAccount('acct')];
    await drain(accounts, provider.capability);
    const prompt = provider.calls.find((item) => item.name === 'ai_text')!.input.prompt as string;
    expect(prompt).toContain('untrusted data');
    expect(prompt).toContain('never "rejection"');
    const opened = await detail(record.id);
    expect(opened.correspondence[0]).toMatchObject({ classification: 'offer', aiLabel: 'AI reading. Check the quoted passage' });
    expect(opened.opportunity.stage).toBe('saved');
    const suggestion = (await call('list_review', { limit: 10 }, owner())).items.find((item: { kind: string }) => item.kind === 'stage');
    expect(suggestion.proposal).toMatchObject({ stage: 'offer' });
    void reply;
  });

  it('an AI reply quoting words that are not in the email changes nothing', async () => {
    await setup({ now: NOW });
    const accounts = [mailAccount('acct')];
    const second = await save({ company: 'Northstar', role: 'Product designer' });
    const reply = '{"category":"rejection","quote":"we regret to inform you"}';
    const other = fakeProvider({ ai: () => reply });
    unclear(other);
    await drain(accounts, other.capability);
    const opened = await detail(second.id);
    expect(opened.correspondence[0].classification).toBe('other');
    expect(opened.opportunity.stage).toBe('saved');
    expect(app().db.prepare("SELECT enrich_state FROM correspondence WHERE message_id = 'u'").get()).toMatchObject({ enrich_state: 'invalid' });
  });
});

describe('source setup', () => {
  it('previews matching mail by subject and sender without storing anything, and lets the person choose calendars', async () => {
    await setup({ now: NOW });
    const provider = fakeProvider({
      mailbox: { acct: { emailAddress: 'you@example.test', pages: [['a', 'b']], messages: {
        a: msg('a', 'ta', 'Lumen Recruiting <jobs@lumen.example>', 'Thank you for applying to Lumen', 'Thank you for applying for the Staff designer role.', '2026-10-12T10:00:00Z'),
        b: msg('b', 'tb', 'Priya <priya@cedar.example>', 'Your offer from Cedar', 'We are delighted to extend an offer.', '2026-10-14T10:00:00Z'),
      } } },
      calendar: { cal: { calendars: [{ id: 'primary', summary: 'you@example.test', primary: true }, { id: 'interviews', summary: 'Interviews' }], pages: [[]] } },
    });
    const accounts = [mailAccount('acct'), calendarAccount('cal')];
    const preview = await call('preview_source', { account: 'acct', historyDays: 90 }, owner({ accounts, capability: provider.capability }));
    expect(preview.matches).toEqual([
      { subject: 'Thank you for applying to Lumen', from: 'Lumen Recruiting', date: '2026-10-12', label: 'Application received' },
      { subject: 'Your offer from Cedar', from: 'Priya', date: '2026-10-14', label: 'Offer' },
    ]);
    expect(provider.calls.some((item) => item.name === 'gmail.read_message')).toBe(false);
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM correspondence').get()).toMatchObject({ count: 0 });
    await expect(call('preview_source', { account: 'not-granted', historyDays: 90 }, owner({ accounts, capability: provider.capability }))).rejects.toThrow(/Give this app access/);

    const calendars = await call('list_source_calendars', { account: 'cal' }, owner({ accounts, capability: provider.capability }));
    expect(calendars.calendars.map((item: { id: string }) => item.id)).toEqual(['primary', 'interviews']);
    const saved = await call('set_source', { account: 'cal', kind: 'calendar', calendars: ['interviews'] }, owner({ accounts }));
    expect(saved.source).toMatchObject({ kind: 'calendar', calendars: ['interviews'], granted: true });
    await drain(accounts, provider.capability);
    const synced = provider.calls.filter((item) => item.name === 'google_calendar.sync_events').map((item) => item.input.calendarId);
    expect(new Set(synced)).toEqual(new Set(['interviews']));
  });
});
