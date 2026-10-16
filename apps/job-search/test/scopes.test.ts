/**
 * App data scopes. The owner sees everything, a chat sees only the
 * collections and accounts its scope names, with derived values (stage,
 * counts, last activity, review, context) computed from those sources only.
 * Revoked, missing and foreign scopes are refused. A job sees only its
 * automatically updated accounts. All data is fictional.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parseGmailMessage } from '@ri/app-kit/sources';
import { setup, call, owner, chat, job, mailAccount, caller } from './helpers.js';
import { fakeProvider, rawMessage, type FakeMessage } from './fakes.js';
import { ingestMessage } from '../src/server/ingest.js';
import { app } from '../src/server/state.js';

const deliver = (message: FakeMessage, account: string) => ingestMessage(parseGmailMessage(rawMessage(message)), { account, ownAddress: 'you@example.test' });

let ids: { lumen: string; cedar: string; atlas: string; material: string };
let scopes: { mailChat: string; plainChat: string; materialsChat: string };

beforeEach(async () => {
  await setup({ now: '2026-10-15T15:00:00Z' });
  const save = async (fields: Record<string, unknown>) => (await call('save_opportunity', fields, owner())).record.id as string;
  ids = {
    lumen: await save({ company: 'Lumen', role: 'Staff designer', description: 'Staff designer at Lumen\n\nRequirements\n- Lead design critiques.' }),
    cedar: await save({ company: 'Cedar', role: 'Design lead' }),
    atlas: await save({ company: 'Atlas Studio', role: 'Senior product designer' }),
    material: (await call('save_material_version', { kind: 'resume', title: 'Product design résumé', text: 'Sam Rivera\nFictional résumé' }, owner())).record.material.id,
  };
  // Accounts are registered as a sync would register them.
  app().accounts.setup({ account: 'acct-personal', kind: 'mail', historyDays: 90, label: 'Personal Gmail' });
  app().accounts.setup({ account: 'acct-work', kind: 'mail', historyDays: 90, label: 'Work Gmail' });
  // Personal mail: Lumen acknowledgment. Work mail: Cedar offer, and an ambiguous message for review.
  deliver({ id: 'p-1', threadId: 'pt-1', from: 'Lumen Recruiting <jobs@lumen.example>', subject: 'Thank you for applying', text: 'Thank you for applying for the Staff designer role at Lumen.', date: '2026-10-12T10:00:00Z' }, 'acct-personal');
  deliver({ id: 'w-1', threadId: 'wt-1', from: 'Priya <priya@cedar.example>', subject: 'Your offer', text: 'We are delighted to extend an offer for the Design lead role at Cedar.', date: '2026-10-14T10:00:00Z' }, 'acct-work');
  deliver({ id: 'w-2', threadId: 'wt-2', from: 'Atlas Studio <careers@atlasstudio.example>', subject: 'Thanks for applying to Atlas Studio', text: 'Thanks for applying to Atlas Studio.', date: '2026-10-14T11:00:00Z' }, 'acct-work');
  const create = async (actor: string, sources: string[], operations: ('read' | 'write')[]) => (await call('create_scope', { actorId: actor, sources, operations }, owner({ accounts: [mailAccount('acct-personal'), mailAccount('acct-work')] }))).scopeRef as string;
  scopes = {
    mailChat: await create('chat:c-mail', ['manual', 'account:acct-personal'], ['read', 'write']),
    plainChat: await create('chat:c-plain', ['manual'], ['read']),
    materialsChat: await create('chat:c-materials', ['materials'], ['read']),
  };
});

describe('app data scopes', () => {
  it('the owner sees every record, stage and correspondence', async () => {
    const list = await call('list_opportunities', { limit: 50, view: 'active' }, owner());
    expect(list.items.map((item: { company: string; stage: string }) => [item.company, item.stage]).sort()).toEqual([['Atlas Studio', 'saved'], ['Cedar', 'offer'], ['Lumen', 'applied']]);
    expect((await call('get_opportunity', { id: ids.cedar }, owner())).correspondence).toHaveLength(1);
    expect((await call('list_review', { limit: 10 }, owner())).items).toHaveLength(1);
  });

  it('two chats with different scopes see only their own sources in lists, search, counts, details, review and context', async () => {
    const mailChat = chat('c-mail', scopes.mailChat);
    const plainChat = chat('c-plain', scopes.plainChat);

    // The chat with personal mail sees Lumen applied (personal evidence) but Cedar still saved (work evidence is hidden).
    const mailList = await call('list_opportunities', { limit: 50, view: 'active' }, mailChat);
    expect(Object.fromEntries(mailList.items.map((item: { company: string; stage: string }) => [item.company, item.stage]))).toEqual({ Lumen: 'applied', Cedar: 'saved', 'Atlas Studio': 'saved' });
    expect(mailList.counts).toMatchObject({ saved: 2, applied: 1, offer: 0 });
    expect(mailList.coverage.sources.map((source: { key: string }) => source.key)).toEqual(['manual', 'account:acct-personal']);
    const plainList = await call('list_opportunities', { limit: 50, view: 'active' }, plainChat);
    expect(plainList.items.every((item: { stage: string }) => item.stage === 'saved')).toBe(true);
    expect(plainList.counts).toMatchObject({ saved: 3, applied: 0, offer: 0 });
    for (const item of plainList.items) expect(item.lastActivity?.label ?? '').not.toMatch(/Application received|Offer/);
    expect(plainList.items.every((item: { openReviews: number }) => item.openReviews === 0)).toBe(true);

    // Search and the stage filter use the projected values.
    expect((await call('list_opportunities', { limit: 50, view: 'active', stage: 'offer' }, plainChat)).items).toEqual([]);
    expect((await call('list_opportunities', { limit: 50, view: 'active', stage: 'offer' }, owner())).items).toHaveLength(1);
    expect((await call('list_opportunities', { limit: 50, view: 'active', search: 'ced' }, plainChat)).items.map((item: { stage: string }) => item.stage)).toEqual(['saved']);

    // Details: correspondence and stage history from hidden accounts are not assembled.
    const cedarForMail = await call('get_opportunity', { id: ids.cedar }, mailChat);
    expect(cedarForMail.correspondence).toEqual([]);
    expect(cedarForMail.stageHistory.map((event: { source: string }) => event.source)).toEqual(['manual']);
    expect(cedarForMail.opportunity.stage).toBe('saved');
    const lumenForMail = await call('get_opportunity', { id: ids.lumen }, mailChat);
    expect(lumenForMail.correspondence.map((item: { account: string }) => item.account)).toEqual(['acct-personal']);
    expect((await call('get_opportunity', { id: ids.lumen }, plainChat)).correspondence).toEqual([]);

    // Review items from a hidden account are not shown, and their email cannot be read.
    expect((await call('list_review', { limit: 10 }, mailChat)).items).toEqual([]);
    const workMessage = (await call('get_opportunity', { id: ids.cedar }, owner())).correspondence[0].id;
    await expect(call('get_correspondence', { id: workMessage }, mailChat)).rejects.toThrow(/not available/);

    // Today, context and suggestions never mention the hidden sources.
    const today = await call('get_today', { zone: 'America/Denver' }, plainChat);
    expect(today.responses).toEqual([]);
    expect(JSON.stringify(today)).not.toContain('Offer');
    const state = { section: 'opportunities', selected: [{ type: 'opportunity', id: ids.cedar }] };
    const ownerContext = await call('describe_view_context', { path: '/opportunities', query: {}, state }, owner());
    expect(ownerContext.modelContent).toContain('delighted to extend an offer');
    const chatContext = await call('describe_view_context', { path: '/opportunities', query: {}, state }, mailChat);
    expect(chatContext.modelContent).not.toContain('offer');
    expect(chatContext.modelContent).toContain('Stage: Saved');

    // Materials are their own collection.
    expect((await call('list_materials', { limit: 50, archived: false }, plainChat)).items).toEqual([]);
    await expect(call('get_material', { id: ids.material }, plainChat)).rejects.toThrow(/not given your materials/);
    const materialsChat = chat('c-materials', scopes.materialsChat);
    expect((await call('list_materials', { limit: 50, archived: false }, materialsChat)).items.map((item: { title: string }) => item.title)).toEqual(['Product design résumé']);
    expect((await call('list_opportunities', { limit: 50, view: 'active' }, materialsChat)).items).toEqual([]);
  });

  it('chats cannot export or manage sources, and a read-only scope cannot write', async () => {
    const plainChat = chat('c-plain', scopes.plainChat);
    await expect(call('export_records', {}, plainChat)).rejects.toThrow(/unavailable to this caller/);
    await expect(call('list_sources', {}, plainChat)).rejects.toThrow(/unavailable to this caller/);
    await expect(call('delete_source_data', { source: 'account:acct-work', confirm: 'delete' }, plainChat)).rejects.toThrow(/unavailable to this caller/);
    await expect(call('save_opportunity', { company: 'Pinecrest', role: 'Platform designer' }, plainChat)).rejects.toThrow(/may read but not change/);
    const mailChat = chat('c-mail', scopes.mailChat);
    const created = await call('save_opportunity', { company: 'Pinecrest', role: 'Platform designer' }, mailChat);
    expect(created.record.company).toBe('Pinecrest');
    const exported = await call('export_records', {}, owner());
    const document = JSON.parse(exported.text);
    expect(document.opportunities).toHaveLength(4);
    expect(exported.text).not.toContain('Fictional résumé'.repeat(2));
  });

  it('a revoked scope, a chat with no scope and a chat using another chat\'s scope are refused', async () => {
    await call('revoke_scope', { scopeRef: scopes.plainChat }, owner());
    await expect(call('list_opportunities', { limit: 10, view: 'active' }, chat('c-plain', scopes.plainChat))).rejects.toThrow(/removed this caller's access/);
    await expect(call('list_opportunities', { limit: 10, view: 'active' }, chat('c-new', null))).rejects.toThrow(/not chosen which records/);
    await expect(call('list_opportunities', { limit: 10, view: 'active' }, chat('c-other', scopes.mailChat))).rejects.toThrow(/different caller/);
    await expect(call('describe_view_context', { path: '/', query: {}, state: {} }, chat('c-new', null))).rejects.toThrow(/not chosen which records/);
    const listed = await call('list_scopes', {}, owner());
    expect(listed.scopes.find((scope: { id: string }) => scope.id === scopes.plainChat).revokedAt).toBeTruthy();
  });

  it('only the owner creates scopes, from the access view that binds the host-chosen caller', async () => {
    const access = await call('open_view', { path: '/access', query: { hostActor: 'chat:c-new' } }, owner({ accounts: [mailAccount('acct-personal')] }));
    expect(access.scope).toEqual({ actions: ['create_scope'], bindings: { actorId: 'chat:c-new' } });
    expect(access.data.sources.map((source: { key: string }) => source.key)).toEqual(['manual', 'materials', 'account:acct-personal', 'account:acct-work']);
    await expect(call('open_view', { path: '/access', query: { hostActor: 'owner-ui:x' } }, owner())).rejects.toThrow(/Choose a chat or agent/);
    await expect(call('create_scope', { actorId: 'chat:c-new', sources: ['manual'], operations: ['read'] }, caller('fixture'))).rejects.toThrow(/Only the person who owns this app/);
    await expect(call('create_scope', { actorId: 'chat:c-new', sources: ['account:someone-else'], operations: ['read'] }, owner())).rejects.toThrow(/Choose sources from this app/);
  });

  it('a job sees only the accounts its schedule updates automatically', async () => {
    const provider = fakeProvider({ mailbox: {
      'acct-personal': { emailAddress: 'you@example.test', pages: [[]], messages: {} },
      'acct-work': { emailAddress: 'you@work.example.test', pages: [[]], messages: {} },
      'acct-manual': { emailAddress: 'side@example.test', pages: [[]], messages: {} },
    } });
    const accounts = [mailAccount('acct-personal'), mailAccount('acct-manual', false)];
    for (let index = 0; index < 6; index++) await call('run_background_step', {}, job(accounts, { capability: provider.capability }));
    const touched = new Set(provider.calls.map((item) => item.account));
    expect(touched).toEqual(new Set(['acct-personal']));
    await expect(call('list_opportunities', { limit: 10, view: 'active' }, job(accounts))).rejects.toThrow(/unavailable to this caller/);
    await expect(call('run_background_step', {}, owner())).rejects.toThrow(/unavailable to this caller/);
    await expect(call('sync_step', { source: 'account:acct-work' }, job(accounts, { capability: provider.capability }))).resolves.toMatchObject({ ran: null });
  });
});
