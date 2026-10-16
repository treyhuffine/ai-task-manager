/**
 * Regression tests for three scope leaks found in review of b8e90a75. Each
 * reproduces the reported failure. All data is fictional.
 *
 * 1. A cached write replayed after the caller's scope narrowed.
 * 2. Generated preparation prose shown by the sources it chose to cite.
 * 3. Contacts and domains learned from an account a reader may not see.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseGmailMessage } from '@ri/app-kit/sources';
import { setup, call, owner, chat, job, mailAccount } from './helpers.js';
import { fakeProvider, rawMessage, type FakeMessage } from './fakes.js';
import { ingestMessage } from '../src/server/ingest.js';
import { app } from '../src/server/state.js';

const NOW = '2026-10-15T15:00:00Z';
const PRIVATE = 'acct-private';
const WORK = 'acct-work';
const accounts = [mailAccount(PRIVATE), mailAccount(WORK)];
const deliver = (message: FakeMessage, account: string) => ingestMessage(parseGmailMessage(rawMessage(message)), { account, ownAddress: 'you@example.test' });
const save = async (fields: Record<string, unknown>) => (await call('save_opportunity', fields, owner())).record as { id: string; revision: number };
const scopeFor = async (actor: string, sources: string[], operations: ('read' | 'write')[] = ['read']) =>
  (await call('create_scope', { actorId: `chat:${actor}`, sources, operations }, owner({ accounts }))).scopeRef as string;
const receipts = () => (app().db.prepare('SELECT COUNT(*) AS count FROM app_invocations').get() as { count: number }).count;

async function start() {
  await setup({ now: NOW });
  // Accounts are registered as a sync would register them.
  app().accounts.setup({ account: PRIVATE, kind: 'mail', historyDays: 90, label: 'Private Gmail' });
  app().accounts.setup({ account: WORK, kind: 'mail', historyDays: 90, label: 'Work Gmail' });
}

describe('replay of a cached write after the caller\'s scope narrows', () => {
  async function scenario() {
    await start();
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    deliver({ id: 'p-ack', threadId: 'pt-1', from: 'Lumen Recruiting <jobs@lumen.example>', subject: 'Thank you for applying', text: 'Thank you for applying for the Staff designer role at Lumen.', date: '2026-10-12T10:00:00Z' }, PRIVATE);
    const scopeRef = await scopeFor('c-1', ['manual', `account:${PRIVATE}`], ['read', 'write']);
    const seen = (await call('get_opportunity', { id: record.id }, chat('c-1', scopeRef))).opportunity;
    const invocationId = randomUUID();
    const input = { id: record.id, expectedRevision: seen.revision, notes: 'Ask about the team' };
    const first = await call('save_opportunity', input, chat('c-1', scopeRef, { id: invocationId }));
    // The write's result carries data from the private account.
    expect(first.record).toMatchObject({ stage: 'applied', lastActivity: { label: expect.stringMatching(/Application received/) } });
    return { record, scopeRef, invocationId, input, first };
  }

  it('a replay under the same scope returns the saved result without writing again', async () => {
    const { record, scopeRef, invocationId, input, first } = await scenario();
    const revision = (await call('get_opportunity', { id: record.id }, owner())).opportunity.revision;
    const count = receipts();
    expect(await call('save_opportunity', input, chat('c-1', scopeRef, { id: invocationId }))).toEqual(first);
    expect((await call('get_opportunity', { id: record.id }, owner())).opportunity.revision).toBe(revision);
    expect(receipts()).toBe(count);
  });

  it('a replay after the scope narrows in place, when the owner deletes that account\'s data, is a conflict and writes nothing', async () => {
    const { record, scopeRef, invocationId, input } = await scenario();
    await call('delete_source_data', { source: `account:${PRIVATE}`, confirm: 'delete' }, owner({ accounts }));
    expect((await call('list_scopes', {}, owner())).scopes.find((scope: { id: string }) => scope.id === scopeRef).sources).toEqual(['manual']);
    const before = (await call('get_opportunity', { id: record.id }, owner())).opportunity;
    const count = receipts();
    await expect(call('save_opportunity', input, chat('c-1', scopeRef, { id: invocationId }))).rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/Your access changed/) });
    const after = (await call('get_opportunity', { id: record.id }, owner())).opportunity;
    expect(after.revision).toBe(before.revision);
    expect(after.notes).toBe('Ask about the team');
    expect(receipts()).toBe(count);
  });

  it('a replay after the chat\'s grant is replaced by a narrower scope is a conflict and writes nothing', async () => {
    const { record, scopeRef, invocationId, input } = await scenario();
    await call('revoke_scope', { scopeRef }, owner());
    const narrower = await scopeFor('c-1', ['manual'], ['read', 'write']);
    const revision = (await call('get_opportunity', { id: record.id }, owner())).opportunity.revision;
    await expect(call('save_opportunity', input, chat('c-1', narrower, { id: invocationId }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(call('save_opportunity', input, chat('c-1', scopeRef, { id: invocationId }))).rejects.toMatchObject({ code: 'revoked' });
    expect((await call('get_opportunity', { id: record.id }, owner())).opportunity.revision).toBe(revision);
  });

  it('a repeated preparation suggestion request returns its own earlier result only for the same input', async () => {
    await start();
    const record = await save({ company: 'Northstar', role: 'Product designer', description: 'Product designer at Northstar\n\nRequirements\n- Partner with research.' });
    const prep = await call('get_preparation', { opportunityId: record.id }, owner());
    const saved = await call('save_preparation', { opportunityId: record.id, expectedRevision: 0, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [], questions: [], notes: '' }, owner());
    const other = await save({ company: 'Cedar', role: 'Design lead', description: 'Design lead at Cedar\n\nRequirements\n- Lead critiques.' });
    const otherPrep = await call('get_preparation', { opportunityId: other.id }, owner());
    const otherSaved = await call('save_preparation', { opportunityId: other.id, expectedRevision: 0, postingSnapshotId: otherPrep.postingSnapshotId, requirements: otherPrep.requirements, examples: [], questions: [], notes: '' }, owner());
    const id = randomUUID();
    const first = await call('suggest_preparation', { preparationId: saved.record.id }, owner({ id }));
    expect(await call('suggest_preparation', { preparationId: saved.record.id }, owner({ id }))).toEqual(first);
    await expect(call('suggest_preparation', { preparationId: otherSaved.record.id }, owner({ id }))).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('generated preparation prose is shown only to readers of every source supplied to the model', () => {
  const CONFIDENTIAL = 'Confidential: the approved budget for this role is $212,000.';
  const posting = 'Product designer at Northstar\n\nRequirements\n- Partner with research and engineering throughout delivery.';

  async function prepared(options: { privateEmail: boolean }) {
    await start();
    const record = await save({ company: 'Northstar', role: 'Product designer', description: posting });
    if (options.privateEmail)
      deliver({ id: 'p-budget', threadId: 'pt-b', from: 'Maya Chen <maya.chen@northstar.example>', subject: 'Re: Product designer role', text: `Hi Sam, thanks for your time on the Product designer role. ${CONFIDENTIAL}`, date: '2026-10-13T10:00:00Z' }, PRIVATE);
    const interview = (await call('save_interview', { opportunityId: record.id, title: 'Portfolio discussion', status: 'scheduled', format: 'video', start: { local: '2026-10-16T10:00', zone: 'America/Denver' }, durationMinutes: 45 }, owner())).record;
    const prep = await call('get_preparation', { opportunityId: record.id, interviewId: interview.id }, owner());
    const saved = await call('save_preparation', { opportunityId: record.id, interviewId: interview.id, expectedRevision: 0, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [], questions: [], notes: '' }, owner());
    // The model cites only the posting, while its text uses the private amount.
    const text = options.privateEmail ? 'Ask whether the $212,000 budget covers research partnership.' : 'Ask how research and engineering partner throughout delivery.';
    const ai = () => JSON.stringify({ suggestions: [{ kind: 'question', text, evidence: [{ source: 'S1', quote: 'Partner with research and engineering throughout delivery.' }] }] });
    const result = await call('suggest_preparation', { preparationId: saved.record.id }, owner({ capability: fakeProvider({ ai }).capability }));
    expect(result.preparation.suggestions.map((item: { text: string }) => item.text)).toEqual([text]);
    expect(result.preparation.suggestions[0].evidence.map((entry: { sourceKey: string }) => entry.sourceKey)).toEqual(['manual']);
    return { record, interview, preparation: result.preparation, text };
  }

  it('a suggestion the owner generated with private email is hidden from a manual-only chat, wherever preparation appears', async () => {
    const { record, interview, preparation, text } = await prepared({ privateEmail: true });
    const plain = chat('c-plain', await scopeFor('c-plain', ['manual'], ['read', 'write']));
    const read = await call('get_preparation', { interviewId: interview.id }, plain);
    expect(read.suggestions).toEqual([]);
    expect(read.suggestionsState).toMatchObject({ status: 'none', message: null });
    expect(JSON.stringify(read)).not.toContain('212,000');
    const context = await call('describe_view_context', { path: `/interviews/${interview.id}`, query: {}, state: { section: 'preparation', selected: [{ type: 'interview', id: interview.id }] } }, plain);
    expect(context.modelContent).not.toContain('212,000');
    // Its own save never returns the hidden suggestion and cannot decide it.
    const written = await call('save_preparation', { preparationId: preparation.id, opportunityId: record.id, interviewId: interview.id, expectedRevision: read.revision, postingSnapshotId: read.postingSnapshotId, requirements: read.requirements, examples: [], questions: [], notes: 'Mine', suggestionDecisions: [{ id: preparation.suggestions[0].id, status: 'dismissed' }] }, plain);
    expect(written.record.suggestions).toEqual([]);
    // A chat given the private account as well sees it, and the owner is unchanged.
    const both = chat('c-both', await scopeFor('c-both', ['manual', `account:${PRIVATE}`]));
    expect((await call('get_preparation', { interviewId: interview.id }, both)).suggestions.map((item: { text: string }) => item.text)).toEqual([text]);
    const forOwner = await call('get_preparation', { interviewId: interview.id }, owner());
    expect(forOwner.suggestions).toEqual([expect.objectContaining({ text, status: 'proposed' })]);
    expect(forOwner.suggestionsState.status).toBe('ready');
  });

  it('a suggestion generated only from saved jobs stays visible to a manual-only chat', async () => {
    const { interview, text } = await prepared({ privateEmail: false });
    const plain = chat('c-plain', await scopeFor('c-plain', ['manual']));
    const read = await call('get_preparation', { interviewId: interview.id }, plain);
    expect(read.suggestions.map((item: { text: string }) => item.text)).toEqual([text]);
    expect(read.suggestionsState.status).toBe('ready');
    expect(JSON.stringify(read)).not.toContain('supplied');
  });

  it('a stored suggestion without a record of its supplied sources is shown only to the owner', async () => {
    const { interview, preparation } = await prepared({ privateEmail: false });
    const legacy = [{ id: 'legacy-1', kind: 'question', text: 'Ask about the onboarding plan.', evidence: [{ source: 'posting', ref: preparation.postingSnapshotId, label: 'Saved posting', quote: 'Partner with research and engineering throughout delivery.', sourceKey: 'manual' }], status: 'proposed' }];
    app().db.prepare('UPDATE preparations SET suggestions = ?, suggestions_state = ? WHERE id = ?').run(JSON.stringify(legacy), JSON.stringify({ status: 'ready', at: NOW, message: '1 suggestion from your saved evidence.', rejected: 0 }), preparation.id);
    const plain = chat('c-plain', await scopeFor('c-plain', ['manual']));
    expect((await call('get_preparation', { interviewId: interview.id }, plain)).suggestions).toEqual([]);
    expect((await call('get_preparation', { interviewId: interview.id }, owner())).suggestions.map((item: { id: string }) => item.id)).toEqual(['legacy-1']);
  });
});

describe('contacts and domains learned from an account are shown only to readers of that account', () => {
  async function learned() {
    await start();
    const record = await save({ company: 'Lumen', role: 'Staff designer', contacts: [{ email: 'hiring@lumen.example', name: 'Lumen hiring team' }] });
    deliver({ id: 'p-recruiter', threadId: 'pt-r', from: 'Jordan Bell <jordan.bell@talentbridge.example>', subject: 'Staff designer at Lumen', text: 'I am reaching out about the Staff designer role at Lumen.', date: '2026-10-12T10:00:00Z' }, PRIVATE);
    const forOwner = (await call('get_opportunity', { id: record.id }, owner())).opportunity;
    expect(forOwner.contacts).toEqual([{ email: 'hiring@lumen.example', name: 'Lumen hiring team' }, { email: 'jordan.bell@talentbridge.example', name: 'Jordan Bell' }]);
    return { record, forOwner };
  }

  it('a manual-only chat never sees a recruiter learned from private email, in reads or in its own write results', async () => {
    const { record, forOwner } = await learned();
    const plain = chat('c-plain', await scopeFor('c-plain', ['manual'], ['read', 'write']));
    const read = (await call('get_opportunity', { id: record.id }, plain)).opportunity;
    expect(read.contacts).toEqual([{ email: 'hiring@lumen.example', name: 'Lumen hiring team' }]);
    const written = await call('save_opportunity', { id: record.id, expectedRevision: read.revision, nextAction: 'Prepare portfolio' }, plain);
    expect(written.record.contacts).toEqual([{ email: 'hiring@lumen.example', name: 'Lumen hiring team' }]);
    expect(JSON.stringify(await call('list_opportunities', { limit: 10, view: 'active', search: 'Lumen' }, plain))).not.toContain('talentbridge');
    const context = await call('describe_view_context', { path: '/opportunities', query: {}, state: { section: 'opportunities', selected: [{ type: 'opportunity', id: record.id }] } }, plain);
    expect(context.modelContent).not.toContain('talentbridge');
    // A chat with the private account sees it, and the owner is unchanged.
    const both = chat('c-both', await scopeFor('c-both', ['manual', `account:${PRIVATE}`]));
    expect((await call('get_opportunity', { id: record.id }, both)).opportunity.contacts).toEqual(forOwner.contacts);
    expect((await call('get_opportunity', { id: record.id }, owner())).opportunity.contacts).toEqual(forOwner.contacts);
    expect(JSON.parse((await call('export_records', {}, owner())).text).opportunities[0].contacts.map((contact: { email: string }) => contact.email)).toContain('jordan.bell@talentbridge.example');
  });

  it('a narrower chat editing contacts replaces only the ones it can see, and what it types becomes its own', async () => {
    const { record } = await learned();
    const plain = chat('c-plain', await scopeFor('c-plain', ['manual'], ['read', 'write']));
    const read = (await call('get_opportunity', { id: record.id }, plain)).opportunity;
    const written = await call('save_opportunity', { id: record.id, expectedRevision: read.revision, contacts: [{ email: 'maya.chen@lumen.example', name: 'Maya Chen' }] }, plain);
    expect(written.record.contacts).toEqual([{ email: 'maya.chen@lumen.example', name: 'Maya Chen' }]);
    expect((await call('get_opportunity', { id: record.id }, owner())).opportunity.contacts.map((contact: { email: string }) => contact.email).sort()).toEqual(['jordan.bell@talentbridge.example', 'maya.chen@lumen.example']);
  });

  it('a contact or domain learned from one account is not evidence for mail in another account', async () => {
    await learned();
    const workMail: Record<string, FakeMessage> = {
      'w-1': { id: 'w-1', threadId: 'wt-1', from: 'Jordan Bell <jordan.bell@talentbridge.example>', subject: 'Quick check-in', text: 'Do you have a few minutes this week?', date: '2026-10-14T10:00:00Z' },
    };
    const provider = fakeProvider({ mailbox: { [WORK]: { emailAddress: 'you@work.example.test', pages: [[]], messages: workMail } } });
    const drain = async () => {
      for (let index = 0; index < 12; index++) {
        app().db.exec("UPDATE app_jobs SET next_eligible_at = '2000-01-01T00:00:00.000Z' WHERE state = 'pending'");
        if ((await call('run_background_step', {}, job([mailAccount(WORK)], { capability: provider.capability }))).ran === null) return;
      }
    };
    await drain();
    // New work mail arrives through history, where headers alone decide whether a body is read.
    provider.mailbox[WORK].history = [[{ messagesAdded: [{ message: { id: 'w-1', threadId: 'wt-1' } }] }]];
    await drain();
    expect(provider.calls.filter((item) => item.name === 'gmail.get_message').map((item) => item.input.messageId)).toEqual(['w-1']);
    expect(provider.calls.filter((item) => item.name === 'gmail.read_message').map((item) => item.input.messageId)).toEqual([]);
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM correspondence WHERE account = ?').get(WORK)).toMatchObject({ count: 0 });

    // Delivered directly, the work message still finds no evidence from the private account.
    deliver({ id: 'w-3', threadId: 'wt-3', from: 'Jordan Bell <jordan.bell@talentbridge.example>', subject: 'Your candidacy', text: 'Following up with you.', date: '2026-10-14T12:00:00Z' }, WORK);
    const row = app().db.prepare("SELECT match_basis, review_id FROM correspondence WHERE account = ? AND message_id = 'w-3'").get(WORK) as { match_basis: string; review_id: string | null } | undefined;
    const reviewCandidates = row?.review_id ? String((app().db.prepare('SELECT candidates FROM review_items WHERE id = ?').get(row.review_id) as { candidates: string }).candidates) : '[]';
    for (const text of [row?.match_basis ?? '[]', reviewCandidates]) {
      expect(text).not.toContain('wrote about this role before');
      expect(text).not.toContain('Company domain talentbridge.example');
    }
  });

  it('a reply in one account is not linked through a message in another account', async () => {
    await start();
    const record = await save({ company: 'Fieldwork', role: 'Product lead' });
    deliver({ id: 'p-1', threadId: 'pt-1', from: 'Jordan Bell <jordan.bell@talentbridge.example>', subject: 'Product lead at Fieldwork', text: 'I am reaching out about the Product lead role at Fieldwork.', date: '2026-10-10T10:00:00Z', messageId: '<private-1@talentbridge.example>' }, PRIVATE);
    expect((await call('get_opportunity', { id: record.id }, owner())).correspondence).toHaveLength(1);
    deliver({ id: 'w-1', threadId: 'wt-1', from: 'Jordan Bell <jordan.bell@talentbridge.example>', subject: 'Re: hello', text: 'Following up on my last note.', date: '2026-10-11T10:00:00Z', inReplyTo: '<private-1@talentbridge.example>' }, WORK);
    const row = app().db.prepare("SELECT match_basis FROM correspondence WHERE account = ? AND message_id = 'w-1'").get(WORK) as { match_basis: string } | undefined;
    expect(row?.match_basis ?? '[]').not.toContain('Replies to a message already linked');
  });
});
