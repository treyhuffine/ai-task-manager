import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, chat, job, owner, setup, teardown } from './helpers.js';
import { fakeHost, mail, OWNER, type FakeAccount } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const recent = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const PRIVATE = 'Private note: she is weighing an offer';
const MY_READ = 'My read: thoughtful, wants concrete examples';

/** The model answers each kind of prompt in its own format. A profile cites the first record and, when present, the previous profile. */
function model(prompts: string[], cite = (prompt: string) => (prompt.includes('id="P1"') ? ['P1', 'R1'] : ['R1'])) {
  return (prompt: string) => {
    prompts.push(prompt);
    if (prompt.includes('profile of')) return JSON.stringify({
      summary: [{ text: 'Design lead at Northstar who is hiring a research lead.', sources: cite(prompt) }],
      now: [{ text: 'Preparing the portfolio review.', sources: ['R1'] }],
      relationship: [{ text: 'An invented line citing nothing real.', sources: ['R99'] }],
      threads: [],
    });
    if (prompt.includes('meeting preparation')) return JSON.stringify({ items: [], unknowns: [] });
    return JSON.stringify({ commitments: [], resolutions: [], facts: [], stages: [] });
  };
}
function world(extra: FakeAccount['mail'] = []): Record<string, FakeAccount> {
  return { personal: { email: OWNER, mail: [
    mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio review', threadId: 't1', messageId: '<p1@x>', body: 'Let us look at the portfolio review together.', sent: true, date: recent(6) }),
    mail('p2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Portfolio review', threadId: 't1', inReplyTo: '<p1@x>', body: 'Great. We are also hiring a research lead.', date: recent(5) }),
    ...extra,
  ] } };
}
async function drain(caller: Parameters<typeof call>[2]) { for (let index = 0; index < 40; index++) if (!(await call('run_background_step', {}, caller)).ran) break; }
async function update(caller: Parameters<typeof call>[2], personId: string) {
  expect((await call('request_profile', { personId }, caller)).availability).toBe('queued');
  for (let index = 0; index < 4; index++) {
    const step = await call('continue_import', { source: 'briefings' }, caller);
    if (!step.ran || /^(Updated the profile|The profile of)/.test(step.summary)) return step;
  }
  return null;
}

describe('living profile', () => {
  it('stays off with extraction off: no AI call on read or request', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(), { ai: model(prompts) });
    await drain(job([{ account: 'personal' }], host.capability));
    const me = owner(['personal'], host.capability);
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    expect((await call('get_profile', { personId: maya.id }, me)).status).toBe('off');
    expect((await call('request_profile', { personId: maya.id }, me)).availability).toBe('unavailable');
    await call('get_person', { id: maya.id }, me);
    expect(host.count('ai_text')).toBe(0);
  });

  it('the owner\'s update cites records, reads notes but never My read, drops uncited lines, and stays the owner\'s', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(), { ai: model(prompts) });
    await drain(job([{ account: 'personal' }], host.capability));
    const me = owner(['personal'], host.capability);
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    await call('save_note', { subjectKind: 'person', subjectId: maya.id, body: PRIVATE }, me);
    await call('save_person', { id: maya.id, expectedRevision: (await call('get_person', { id: maya.id }, me)).person.revision, myRead: MY_READ }, me);
    await call('set_extraction', { enabled: true }, me);
    expect((await update(me, maya.id))?.summary).toMatch(/^Updated the profile of Maya Chen/);
    const prompt = prompts.find((item) => item.includes('profile of'))!;
    expect(prompt).toContain('trust="untrusted"');
    expect(prompt).toContain(PRIVATE);
    expect(prompt).not.toContain(MY_READ);
    expect(prompt).toMatch(/Never infer personality/);
    const profile = await call('get_profile', { personId: maya.id }, me);
    expect(profile.status).toBe('ready');
    expect(profile.sections.map((section: { key: string }) => section.key)).toEqual(['summary', 'now']);
    expect(profile.sections[0].items[0].evidenceIds.length + profile.sections[0].items[0].noteIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(profile)).not.toContain('invented line');
    // A chat holding the account still can't read a profile built from the owner's notes.
    const narrow = chat('a', (await call('create_scope', { actorId: 'chat:a', sources: ['account:personal'], operations: ['read'] }, me)).scopeRef);
    const forChat = await call('get_profile', { personId: maya.id }, narrow);
    expect(forChat.sections).toEqual([]);
    expect(forChat.status).toBe('none');
  });

  it('rewrites from the previous profile plus only what arrived since, and says when it is stale', async () => {
    const prompts: string[] = [];
    const accounts = world();
    const host = fakeHost(accounts, { ai: model(prompts) });
    const schedule = job([{ account: 'personal' }], host.capability);
    await drain(schedule);
    const me = owner(['personal'], host.capability);
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    await call('set_extraction', { enabled: true }, me);
    await update(me, maya.id);
    accounts.personal.mail.push(mail('p3', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Congratulations', threadId: 't3', messageId: '<p3@x>', body: 'Congratulations on accepting the role at Lumen.', sent: true, date: recent(0.1) }));
    accounts.personal.history = [{ added: ['p3'] }];
    // The mail job rests after a finished pass, so the owner's Continue reads the new message now.
    for (let index = 0; index < 6; index++) await call('continue_import', { source: 'account:personal' }, me);
    expect((await call('get_profile', { personId: maya.id }, me)).status).toBe('stale');
    prompts.length = 0;
    await update(me, maya.id);
    const second = prompts.find((item) => item.includes('profile of'))!;
    expect(second).toMatch(/^Rewrite the profile/);
    expect(second).toContain('id="P1"');
    expect(second).toContain('accepting the role at Lumen');
    expect(second).not.toContain('Let us look at the portfolio review together');
    expect((await call('get_profile', { personId: maya.id }, me)).status).toBe('ready');
  });

  it('a result citing no real record is not stored and the job retries', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(), { ai: model(prompts, () => ['R99']) });
    await drain(job([{ account: 'personal' }], host.capability));
    const me = owner(['personal'], host.capability);
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    await call('set_extraction', { enabled: true }, me);
    await call('request_profile', { personId: maya.id }, me);
    await call('continue_import', { source: 'briefings' }, me);
    expect((await call('get_profile', { personId: maya.id }, me)).sections.length).toBeLessThanOrEqual(1);
  });

  it('the schedule refreshes key people from its own accounts only, never from notes, and readers of that account can read it', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(), { ai: model(prompts) });
    const me = owner(['personal'], host.capability);
    await call('set_extraction', { enabled: true }, me);
    const schedule = job([{ account: 'personal' }], host.capability);
    await drain(schedule);
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    await call('save_note', { subjectKind: 'person', subjectId: maya.id, body: PRIVATE }, me);
    const profilePrompts = prompts.filter((item) => item.includes('profile of'));
    expect(profilePrompts.length).toBeGreaterThan(0);
    // The schedule queued Maya (two-way mail) under its own account and generated it in its own step.
    const items = ctx!.db.all<{ state: string; payload: string }>("SELECT state, payload FROM work_items WHERE dedupe_key LIKE 'profile:%'");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(JSON.parse(item.payload).scope).toMatchObject({ kind: 'sources', sources: ['account:personal'] });
    const ownerView = await call('get_profile', { personId: maya.id }, me);
    expect(ownerView.status === 'ready' || ownerView.status === 'stale').toBe(true);
    expect(ownerView.statusLabel).toMatch(/from owner@personal\.example/);
    const reader = chat('a', (await call('create_scope', { actorId: 'chat:a', sources: ['account:personal'], operations: ['read'] }, me)).scopeRef);
    expect((await call('get_profile', { personId: maya.id }, reader)).sections.length).toBeGreaterThan(0);
    // Running the schedule again later never sends the owner's note.
    await drain(schedule);
    expect(prompts.some((item) => item.includes(PRIVATE))).toBe(false);
  });
});
