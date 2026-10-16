import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, job, owner, setup, teardown, chat } from './helpers.js';
import { fakeHost, mail, OWNER, OWNER_WORK, type FakeAccount } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });

const recent = (daysAgo: number, hour = 15) => new Date(Date.now() - daysAgo * 864e5 + hour * 0).toISOString();

function world(): Record<string, FakeAccount> {
  return {
    personal: {
      email: OWNER,
      mail: [
        mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio', body: 'I would be happy to introduce you to the research lead.', sent: true, date: recent(5), messageId: '<p1@personal.example>' }),
        mail('p2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Portfolio', body: 'Thank you!\n\nBest,\nMaya Chen\nDesign lead, Northstar\nmaya.chen@northstar.example', date: recent(4), inReplyTo: '<p1@personal.example>' }),
        mail('p3', { from: 'Design Weekly <news@designweekly.example>', to: [OWNER], subject: 'This week in design', body: 'Read more', date: recent(3), headers: { 'List-Unsubscribe': '<https://designweekly.example/u>', 'List-Id': 'weekly.designweekly.example' } }),
        mail('p4', { from: 'Stranger <stranger@unknown.example>', to: [OWNER], subject: 'Hello', body: 'We have never met.', date: recent(2) }),
        mail('p5', { from: 'Bookings <no-reply@hotel.example>', to: [OWNER], subject: 'Your stay', body: 'Confirmation', date: recent(2) }),
      ],
      events: [
        { id: 'e-small', summary: 'Portfolio discussion', start: new Date(Date.now() + 864e5).toISOString(), end: new Date(Date.now() + 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true, organizer: true }, { email: 'maya@northstar.example', displayName: 'Maya Chen' }, { email: 'kai@northstar.example', displayName: 'Kai Moreno' }] },
        { id: 'e-webinar', summary: 'Design systems webinar', start: new Date(Date.now() - 2 * 864e5).toISOString(), end: new Date(Date.now() - 2 * 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true }, ...Array.from({ length: 100 }, (_, index) => ({ email: `attendee${index}@webinar.example` }))] },
        { id: 'e-room', summary: 'Planning', start: new Date(Date.now() - 864e5).toISOString(), end: new Date(Date.now() - 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true }, { email: 'room-4@resource.calendar.google.com', resource: true }, { email: 'lee@fieldwork.example', displayName: 'Lee Park' }] },
      ],
    },
    work: {
      email: OWNER_WORK,
      mail: [
        mail('w1', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>'], cc: ['Priya Shah <priya@fieldwork.example>'], subject: 'Scope', body: 'I will send the revised proposal by Friday.', sent: true, date: recent(6), threadId: 'tw', messageId: '<w1@studio.example>' }),
        mail('w2', { from: 'Jordan Bell <jordan@fieldwork.example>', to: [OWNER_WORK], subject: 'Re: Scope', body: 'Sounds good.', date: recent(5), threadId: 'tw', inReplyTo: '<w1@studio.example>' }),
        mail('w3', { from: 'Support <support@fieldwork.example>', to: [OWNER_WORK], subject: 'Ticket', body: 'Your ticket was updated', date: recent(4) }),
      ],
    },
  };
}

async function drain(caller: Parameters<typeof call>[2], max = 40) {
  const summaries: { kind: string; source: string }[] = [];
  for (let index = 0; index < max; index++) {
    const result = await call('run_background_step', {}, caller);
    if (!result.ran) break;
    summaries.push(result.ran);
  }
  return summaries;
}
const names = async (caller = owner()) => (await call('list_people', { limit: 100 }, caller)).items.map((item: { name: string }) => item.name).sort();

describe('bounded Gmail and Calendar sync', () => {
  it('creates people only from sent mail, confirmed direct replies and small meetings with the owner, and leaves out bulk, no-reply, list and large-event senders', async () => {
    const host = fakeHost(world());
    const scheduled = job([{ account: 'personal' }, { account: 'personal', binding: 'calendar' }, { account: 'work' }], host.capability);
    await drain(scheduled);
    expect(await names()).toEqual(['Jordan Bell', 'Kai Moreno', 'Lee Park', 'Maya Chen', 'Priya Shah']);
    const sources = await call('list_sources', {}, owner(['personal', 'work']));
    expect(sources.exclusions.bulk).toBeGreaterThanOrEqual(2);
    expect(sources.largeEvents).toBe(1);
    expect(sources.incomingOnly).toBe(1);
    // A shared inbox is never one person.
    expect((await call('search_people', { text: 'support', limit: 10 }, owner())).items).toEqual([]);
    // Every connector call carried the job's own account.
    expect(host.calls.filter((item) => item.name.startsWith('gmail.') || item.name.startsWith('google_calendar.')).every((item) => ['personal', 'work'].includes(item.account!))).toBe(true);
  });

  it('two accounts sync independently, and one account\'s backfill cannot starve the other', async () => {
    const big = world();
    big.personal.mail.push(...Array.from({ length: 60 }, (_, index) => mail(`bulk-sent-${index}`, { from: OWNER, to: [`friend${index}@friends.example`], body: `Note ${index}`, sent: true, date: recent(10 + index / 10) })));
    const host = fakeHost(big, { pageSize: 10 });
    const scheduled = job([{ account: 'personal' }, { account: 'work' }], host.capability);
    const ran = await drain(scheduled, 6);
    const sources = ran.map((item) => item.source);
    expect(sources.slice(0, 4)).toContain('account:work');
    expect(new Set(sources.slice(0, 2)).size).toBe(2);
  });

  it('reads each message once across duplicate delivery and resumes an interrupted page without duplicates', async () => {
    const accounts = world();
    accounts.personal.history = [{ added: ['p1', 'p2'] }];
    const host = fakeHost(accounts, { failReadOnce: 'p2' });
    const scheduled = job([{ account: 'personal' }], host.capability);
    await drain(scheduled);
    // The failed step rolled back. Continue retries it from the last committed checkpoint.
    expect(ctx!.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM interactions WHERE external_id = 'p2'")!.count).toBe(0);
    for (let index = 0; index < 6; index++) await call('continue_import', { source: 'account:personal' }, owner(['personal'], host.capability));
    const interactions = ctx!.db.all<{ external_id: string }>("SELECT external_id FROM interactions WHERE source_key = 'account:personal'");
    expect(interactions.filter((row) => row.external_id === 'p2').length).toBe(1);
    expect(ctx!.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM interactions WHERE external_id = 'p1'")!.count).toBe(1);
    expect(await names()).toContain('Maya Chen');
    const failedOnce = host.calls.filter((item) => item.name === 'gmail.read_message' && item.input.messageId === 'p2').length;
    expect(failedOnce).toBeGreaterThanOrEqual(2);
  });

  it('restarts a bounded rescan of the history window when the history cursor expires', async () => {
    const accounts = world();
    accounts.personal.history = [{ added: [] }];
    const host = fakeHost(accounts, { expireHistoryOnce: true });
    const scheduled = job([{ account: 'personal' }], host.capability);
    await drain(scheduled);
    for (let index = 0; index < 4; index++) await call('continue_import', { source: 'account:personal' }, owner(['personal'], host.capability));
    const account = ctx!.accounts.get('personal', 'mail')!;
    expect((account.checkpoint as { rescans: number }).rescans).toBe(1);
    expect(ctx!.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM interactions WHERE source_key = 'account:personal' AND external_id = 'p1'")!.count).toBe(1);
    expect(host.calls.filter((item) => item.name === 'gmail.search_messages').every((item) => /after:\d+/.test(String(item.input.query)))).toBe(true);
  });

  it('marks a message deleted upstream as unavailable without inventing anything else', async () => {
    const accounts = world();
    const host = fakeHost(accounts);
    const scheduled = job([{ account: 'personal' }], host.capability);
    await drain(scheduled);
    accounts.personal.history = [{ deleted: ['p2'] }];
    for (let index = 0; index < 3; index++) await call('continue_import', { source: 'account:personal' }, owner(['personal'], host.capability));
    const row = ctx!.db.get<{ status: string; subject: string | null; evidence_id: string }>("SELECT status, subject, evidence_id FROM interactions WHERE external_id = 'p2'")!;
    expect(row.status).toBe('unavailable');
    expect(row.subject).toBeNull();
    const evidence = ctx!.db.get<{ status: string; blob_digest: string | null; excerpt: string | null }>('SELECT status, blob_digest, excerpt FROM evidence WHERE id = ?', row.evidence_id)!;
    expect(evidence).toEqual({ status: 'unavailable', blob_digest: null, excerpt: null });
    const maya = (await call('list_people', { limit: 10, filters: { text: 'Maya' } }, owner())).items[0];
    const timeline = await call('list_interactions', { subjectKind: 'person', subjectId: maya.id, limit: 10, include: ['email'] }, owner());
    const removed = timeline.items.find((item: { label: string }) => item.label === 'Email no longer available');
    expect(removed.title).toBe('Removed from the mailbox');
    expect(removed.evidenceId).toBeNull();
    expect(timeline.items.length).toBe(2);
  });

  it('keeps a user correction when the same address is ingested again', async () => {
    const accounts = world();
    const host = fakeHost(accounts);
    const scheduled = job([{ account: 'personal' }, { account: 'work' }], host.capability);
    await drain(scheduled);
    const jordan = (await call('list_people', { limit: 10, filters: { text: 'Jordan' } }, owner())).items[0];
    await call('save_person', { id: jordan.id, expectedRevision: jordan.revision, name: 'Jordan B. Bell' }, owner());
    const priya = (await call('list_people', { limit: 10, filters: { text: 'Priya' } }, owner())).items[0];
    const detail = await call('get_person', { id: priya.id }, owner());
    await call('save_person', { id: priya.id, expectedRevision: detail.person.revision, detachKeyIds: [detail.identities[0].keyId] }, owner());
    accounts.work.mail.push(
      mail('w4', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>', 'Priya Shah <priya@fieldwork.example>'], body: 'Following up', sent: true, date: recent(1) }),
    );
    accounts.work.history = [{ added: ['w4'] }];
    for (let index = 0; index < 4; index++) await call('continue_import', { source: 'account:work' }, owner(['work'], host.capability));
    expect(await names()).toContain('Jordan B. Bell');
    // The detached address is not reattached and no duplicate person is created for it.
    const priyaNow = await call('list_people', { limit: 10, filters: { text: 'priya' } }, owner());
    expect(priyaNow.items.map((item: { name: string }) => item.name)).toEqual(['Priya Shah']);
    const key = ctx!.db.get<{ owner_kind: string; decision: string }>("SELECT owner_kind, decision FROM identity_keys WHERE normalized = 'priya@fieldwork.example'")!;
    expect(key).toEqual({ owner_kind: 'none', decision: 'user' });
  });

  it('records calendar events as scheduled or past without implying attendance, and keeps canceled events as canceled', async () => {
    const accounts = world();
    accounts.personal.eventChanges = [[{ ...accounts.personal.events![0], cancelled: true }]];
    const host = fakeHost(accounts);
    const scheduled = job([{ account: 'personal', binding: 'calendar' }], host.capability);
    await drain(scheduled);
    const lee = (await call('list_people', { limit: 10, filters: { text: 'Lee' } }, owner())).items[0];
    const timeline = await call('list_interactions', { subjectKind: 'person', subjectId: lee.id, limit: 10 }, owner());
    expect(timeline.items[0].label).toBe('Past calendar event');
    expect(timeline.items[0].detail).toBe('Calendar entry. Attendance not inferred');
    const maya = (await call('list_people', { limit: 10, filters: { text: 'Maya' } }, owner())).items[0];
    expect(maya.nextMeeting.title).toBe('Portfolio discussion');
    expect((await call('list_interactions', { subjectKind: 'person', subjectId: maya.id, limit: 10 }, owner())).items[0].label).toBe('Meeting scheduled');
    // Co-attendance never creates an affiliation or relationship between attendees.
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM affiliations')!.count).toBe(0);
    await call('continue_import', { source: 'account:personal' }, owner(['personal'], host.capability));
    await call('continue_import', { source: 'account:personal' }, owner(['personal'], host.capability));
    const after = await call('list_interactions', { subjectKind: 'person', subjectId: maya.id, limit: 10 }, owner());
    expect(after.items[0].label).toBe('Canceled calendar event');
    expect((await call('get_person', { id: maya.id }, owner())).header.nextMeeting).toBeNull();
  });

  it('a revoked account needs reconnecting while the other account keeps syncing', async () => {
    const host = fakeHost(world(), { revoked: new Set(['work']) });
    const scheduled = job([{ account: 'personal' }, { account: 'work' }], host.capability);
    await drain(scheduled);
    const sources = await call('list_sources', {}, owner(['personal', 'work']));
    const work = sources.accounts.find((item: { account: string; kind: string }) => item.account === 'work' && item.kind === 'mail');
    expect(work.status).toBe('reconnect');
    expect(work.lastError).toMatch(/Reconnect/);
    expect(await names()).toContain('Maya Chen');
  });

  it('a job sees only its own accounts and the schedule action is not callable by a chat', async () => {
    const host = fakeHost(world());
    await drain(job([{ account: 'personal' }], host.capability));
    expect(host.calls.every((item) => !item.account || item.account === 'personal')).toBe(true);
    expect(await names()).not.toContain('Jordan Bell');
    await expect(call('run_background_step', {}, chat('c-1', null))).rejects.toThrow(/unavailable/);
  });
});
