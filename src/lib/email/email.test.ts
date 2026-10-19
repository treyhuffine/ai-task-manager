import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { ActionOutcome, Connection } from '@integrations/engine';
import * as q from '@/lib/db/queries';
import { resetDb, getRawDb } from '@/lib/db';
import { subscribe, sessionChannel, type SessionStreamMessage } from '@/lib/realtime/bus';
import { appApprovalPolicy, _resetApprovals, sessionCaller } from '@/lib/integrations/approval';
import { EMAIL_COMPOSER_CALLER } from './caller';
import { emailAccounts, sendEmailDraft } from './service';
import { emailDraftPatchSchema, emailSendProblem } from './validation';
import { dispatchEmailOperation, emailActions } from '@/lib/orchestrator/email-actions';
import { isNewerRevision } from '@/lib/api/dto/chat-event';

const fake = vi.hoisted(() => ({
  connections: vi.fn<() => Promise<Connection[]>>(),
  run: vi.fn<() => Promise<ActionOutcome>>(),
  filter: vi.fn(),
}));
vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationOwnerId: () => 'local',
  getIntegrationRuntime: async () => ({ listConnections: fake.connections, runAction: fake.run }),
  resolveWorkspaceIntegrationFilter: fake.filter,
}));

const account = (providerId = 'google'): Connection => ({ id: providerId, providerId, ownerId: 'local', accountId: 'me', email: 'me@example.com', status: 'active', scopes: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' });
const fields = { connectionId: 'google', to: 'one@example.com, two@example.com', cc: 'copy@example.com', bcc: 'private@example.com', subject: 'Café meeting', body: 'Hi there,\n\nCan we meet tomorrow?' };
const chat = () => q.createChatSession({ harness: 'codex', type: 'execution', userId: 'local' }).id;
const make = (sessionId = chat()) => q.createEmailDraft(sessionId, crypto.randomUUID(), fields);

beforeEach(() => {
  fake.connections.mockResolvedValue([account(), account('microsoft')]);
  fake.run.mockReset().mockResolvedValue({ ok: true, result: { id: 'message-1' } });
  fake.filter.mockResolvedValue({ toolkits: [], connectionPins: {}, allowedAccounts: {} });
  _resetApprovals();
});
afterAll(() => resetDb());

describe('durable inline email drafts', () => {
  it('creates once per chat/request, keeps current edits on retries, and survives reopening', () => {
    const sessionId = chat();
    const first = q.createEmailDraft(sessionId, 'same-intent', fields);
    const changed = q.updateEmailDraft(first.id, sessionId, 0, { subject: 'Human edit' });
    expect(q.createEmailDraft(sessionId, 'same-intent', fields)).toEqual(changed);
    expect(() => q.createEmailDraft(sessionId, 'same-intent', { ...fields, to: 'other@example.com' })).toThrow(/different/);
    resetDb();
    expect(q.getEmailDraft(first.id, sessionId)).toEqual(changed);
    expect(q.createEmailDraft(chat(), 'same-intent', fields).id).not.toBe(first.id);
  });

  it('merges partial patches, rejects stale edits, and makes identical retries harmless', () => {
    const first = make();
    const changed = q.updateEmailDraft(first.id, first.sessionId, 0, { body: 'Human body' });
    expect(changed.draft).toMatchObject({ ...fields, body: 'Human body', revision: 1 });
    expect(() => q.updateEmailDraft(first.id, first.sessionId, 0, { subject: 'Stale AI edit' })).toThrow(/changed/);
    expect(q.updateEmailDraft(first.id, first.sessionId, 0, { body: 'Human body' })).toEqual(changed);
    expect(() => q.getEmailDraft(first.id, chat())).toThrow(/not found/);
  });

  it('broadcasts revisions that replace existing transcript cards', () => {
    const sessionId = chat();
    const messages: SessionStreamMessage[] = [];
    const off = subscribe(sessionChannel(sessionId), event => messages.push(event));
    const first = make(sessionId);
    q.updateEmailDraft(first.id, sessionId, 0, { bcc: 'new@example.com' });
    off();
    const events = messages.filter(message => message.kind === 'chat_event').map(message => message.event);
    expect(events).toHaveLength(2);
    expect(events[1].id).toBe(events[0].id);
    expect(isNewerRevision(events[1], events[0])).toBe(true);
  });

  it('looks up drafts through the primary key without scanning a session', () => {
    const plan = getRawDb().prepare('EXPLAIN QUERY PLAN SELECT * FROM chat_events WHERE id = ? LIMIT 1').all('draft') as { detail: string }[];
    expect(plan.map(row => row.detail).join(' ')).toMatch(/SEARCH.*INDEX.*\(id=\?\)/);
  });

  it('allows incomplete saved input but validates recipient/header fields before sending', async () => {
    expect(emailDraftPatchSchema.safeParse({ subject: 'Hello\r\nBcc: other@example.com' }).success).toBe(false);
    expect(emailSendProblem({ ...fields, to: 'broken@' })).toMatch(/addresses/);
    expect(emailSendProblem({ ...fields, cc: 'broken' })).toMatch(/Cc/);
    expect(emailSendProblem({ ...fields, bcc: 'broken' })).toMatch(/Bcc/);
    expect(emailSendProblem({ ...fields, connectionId: null })).toMatch(/account/);
    const first = q.createEmailDraft(chat(), 'incomplete', { to: 'typing@' });
    await expect(sendEmailDraft(first.id, first.sessionId, 0)).rejects.toThrow(/account/);
    expect(fake.run).not.toHaveBeenCalled();
  });
});

describe('send the reviewed draft exactly once', () => {
  it.each(['google', 'microsoft'])('maps all editable fields to %s and makes a send retry read its receipt', async provider => {
    const first = q.createEmailDraft(chat(), crypto.randomUUID(), { ...fields, connectionId: provider });
    const result = await sendEmailDraft(first.id, first.sessionId, 0);
    expect(result.draft).toMatchObject({ status: 'sent', fromLabel: 'me@example.com', messageId: 'message-1' });
    expect(fake.run).toHaveBeenCalledWith(provider === 'google' ? 'gmail.send_email' : 'outlook_mail.send_mail', provider === 'google'
      ? { to: fields.to, cc: fields.cc, bcc: fields.bcc, subject: fields.subject, body: fields.body }
      : { to: ['one@example.com', 'two@example.com'], cc: ['copy@example.com'], bcc: ['private@example.com'], subject: fields.subject, content: fields.body },
    expect.objectContaining({ connectionId: provider, allowedConnectionIds: [provider], caller: EMAIL_COMPOSER_CALLER }));
    expect(await sendEmailDraft(first.id, first.sessionId, 0)).toEqual(result);
    expect(fake.run).toHaveBeenCalledTimes(1);
    expect(() => q.updateEmailDraft(first.id, first.sessionId, result.draft.revision, { subject: 'After send' })).toThrow(/no longer/);
  });

  it('claims before asynchronous work, rejecting concurrent sends and edits', async () => {
    let finish!: (value: ActionOutcome) => void;
    fake.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = make();
    const sending = sendEmailDraft(first.id, first.sessionId, 0);
    await vi.waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1));
    await expect(sendEmailDraft(first.id, first.sessionId, 0)).rejects.toThrow(/changed/);
    expect(() => q.updateEmailDraft(first.id, first.sessionId, 1, { body: 'Too late' })).toThrow(/no longer/);
    finish({ ok: true, result: { id: 'sent' } });
    expect((await sending).draft.status).toBe('sent');
  });

  it('refuses a stale revision and rechecks live account access', async () => {
    const first = make();
    q.updateEmailDraft(first.id, first.sessionId, 0, { subject: 'New draft' });
    await expect(sendEmailDraft(first.id, first.sessionId, 0)).rejects.toThrow(/changed/);
    fake.connections.mockResolvedValue([]);
    const failed = await sendEmailDraft(first.id, first.sessionId, 1);
    expect(failed.draft).toMatchObject({ status: 'draft', error: expect.stringMatching(/unavailable/) });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it('keeps known pre-dispatch failures editable and never claims they were sent', async () => {
    fake.run.mockResolvedValue({ ok: false, reason: 'needs_consent', providerId: 'google', connectionId: 'google', missingScopes: ['send'], authorizationUrl: 'https://example.com/oauth' });
    const first = make();
    expect((await sendEmailDraft(first.id, first.sessionId, 0)).draft).toMatchObject({ status: 'draft', error: expect.stringMatching(/Reconnect/) });
  });

  it.each(['indeterminate', 'unexpected', 'malformed'])('locks an uncertain %s send against retry, including after restart', async mode => {
    if (mode === 'unexpected') fake.run.mockRejectedValue(new Error('Connection lost'));
    else fake.run.mockResolvedValue({ ok: false, reason: 'error', code: 'provider_error', message: 'Lost confirmation', ...(mode === 'indeterminate' ? { indeterminate: true } : {}) });
    const first = make();
    const result = await sendEmailDraft(first.id, first.sessionId, 0);
    expect(result.draft.status).toBe('uncertain');
    resetDb();
    await expect(sendEmailDraft(first.id, first.sessionId, result.draft.revision)).rejects.toThrow(/changed/);
    expect(fake.run).toHaveBeenCalledTimes(1);
  });

  it('preserves a crash-time sending claim and refuses discarded drafts', async () => {
    const first = make();
    q.transitionEmailDraft(first.id, first.sessionId, 0, 'draft', { status: 'sending' });
    resetDb();
    await expect(sendEmailDraft(first.id, first.sessionId, 1)).rejects.toThrow(/changed/);
    const second = make();
    q.transitionEmailDraft(second.id, second.sessionId, 0, 'draft', { status: 'discarded' });
    await expect(sendEmailDraft(second.id, second.sessionId, 1)).rejects.toThrow(/changed/);
    expect(fake.run).not.toHaveBeenCalled();
  });

  it('keeps a successful Gmail response without a message receipt uncertain', async () => {
    fake.run.mockResolvedValue({ ok: true, result: {} });
    const first = make();
    expect((await sendEmailDraft(first.id, first.sessionId, 0)).draft.status).toBe('uncertain');
  });
});

describe('signed drafting tools and owner send boundary', () => {
  it('offers draft actions without a send action and binds all edits to the signed chat', async () => {
    expect(emailActions.map(action => action.name)).toEqual(['create_email_draft', 'get_email_draft', 'update_email_draft', 'list_email_accounts']);
    await expect(dispatchEmailOperation({ remote: true }, 'create', { request_id: 'r' })).rejects.toThrow(/signed/);
    const sessionId = chat();
    const first = await dispatchEmailOperation({ remote: true, actor: { sessionId } }, 'create', { request_id: 'r', body: 'AI text' }) as { id: string };
    await expect(dispatchEmailOperation({ remote: true, actor: { sessionId: chat() } }, 'get', { id: first.id })).rejects.toThrow(/not found/);
    await expect(dispatchEmailOperation({ remote: true, actor: { sessionId } }, 'update', { id: first.id, expected_revision: 0, patch: { status: 'sent' } })).rejects.toThrow();
  });

  it('lists only live native accounts and respects an agent’s authorized account scope', async () => {
    fake.connections.mockResolvedValue([account(), account('microsoft'), { ...account('slack') }, { ...account(), id: 'revoked', status: 'needs_reauth' }]);
    expect((await emailAccounts()).map(item => item.id)).toEqual(['google', 'microsoft']);
    const workspace = q.createWorkspace({ name: 'Email scope', cwd: '/tmp/email-test', isGit: false });
    const sessionId = q.createChatSession({ harness: 'codex', type: 'execution', userId: 'local', workspaceId: workspace.id }).id;
    expect(await dispatchEmailOperation({ remote: true, actor: { sessionId } }, 'accounts', {})).toEqual([]);
    fake.filter.mockResolvedValue({ toolkits: ['gmail'], connectionPins: { gmail: 'google' }, allowedAccounts: {} });
    expect(await dispatchEmailOperation({ remote: true, actor: { sessionId } }, 'accounts', {})).toEqual([expect.objectContaining({ id: 'google' })]);
  });

  it('allows only the viewer-stamped email send identity through the existing approval gate', async () => {
    const policy = appApprovalPolicy({ onRequested: async () => {}, onSettled: async () => {} });
    const check = { actionId: 'gmail.send_email', actionVersion: 'v1', risk: 'high' as const, mutating: true, inputDigest: 'digest', inputPreview: fields, connection: account(), caller: EMAIL_COMPOSER_CALLER };
    expect(await policy.check(check)).toBe('allow');
    expect(await policy.check({ ...check, caller: sessionCaller('some-agent') })).toBe('ask');
    expect(await policy.check({ ...check, caller: { type: 'agent', id: 'email-composer' } })).toBe('ask');
    expect(await policy.check({ ...check, actionId: 'google_calendar.delete_event' })).toBe('ask');
  });

  it('refuses session and worker credentials on the UI send procedure', async () => {
    const { emailRouter } = await import('./router');
    const first = make();
    for (const scope of ['session', 'worker'] as const) {
      const caller = emailRouter.createCaller({ request: new Request('http://localhost/api/trpc'), key: { apiKeyId: 'test', scope, location: 'home', workerDeviceId: null, sessionChatId: first.sessionId } });
      await expect(caller.send({ id: first.id, sessionId: first.sessionId, expectedRevision: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(fake.run).not.toHaveBeenCalled();
  });
});
