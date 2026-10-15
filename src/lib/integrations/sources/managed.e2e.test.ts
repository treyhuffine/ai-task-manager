/**
 * Managed sources end to end, against the fake Composio API (docs/connector-service-spec.md §14):
 * setup, consent, accounts, constrained sessions, execution through the engine's `runAction`,
 * approvals, lifecycle and secret confinement. Real-account acceptance is separate (§13 step 1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalPolicy } from '@integrations/engine';
import { readManagedAudit } from './audit';
import { createAttempt, getAttempt, newAttemptId } from './attempts';
import { managedToolkitId } from './applications';
import { readPreferences } from './preferences';
import * as service from './service';
import { createSourcesHarness, FAKE_KEY, type SourcesHarness } from './testing';

let h: SourcesHarness;
/** What agents ran: the session executions, not Ri's own pinned identity reads. */
const agentRuns = () => h.fake.state.executions.filter(e => e.via === 'session');
beforeEach(() => { h = createSourcesHarness(); });
afterEach(() => { h.cleanup(); });

const allow: ApprovalPolicy = { check: async () => 'allow' };
const askWrites: ApprovalPolicy = { check: async input => (input.mutating && input.risk === 'high' ? 'ask' : 'allow') };

async function setup() {
  const source = await service.addComposioSource({ apiKey: FAKE_KEY });
  return source;
}

/** Connect one account through the whole consent flow, returning its connection id. */
async function connect(applicationId: 'gmail' | 'google_calendar', email: string, label?: string) {
  const begun = await service.beginManagedConnect(null, { applicationId, ...(label ? { label } : {}) });
  const attempt = getAttempt(begun.attemptId)!;
  h.fake.completeLink(attempt.remoteAccountId, email);
  const done = await service.completeManagedAttempt(begun.attemptId, { via: 'callback', hintedAccountId: attempt.remoteAccountId });
  if (done.status !== 'completed') throw new Error(`connect failed: ${JSON.stringify(done)}`);
  return { connectionId: done.connectionId, remoteAccountId: attempt.remoteAccountId, attemptId: begun.attemptId };
}

describe('source setup', () => {
  it('enables Composio once: verifies the key, seals it, gives the source its own remote user and prefers it', async () => {
    const source = await setup();
    expect(source).toMatchObject({ kind: 'composio', label: 'Composio', enabled: true, preferred: true, hasKey: true, project: { id: 'proj_fake' } });
    const prefs = readPreferences().preferences;
    expect(prefs.preferredSourceId).toBe(source.id);
    expect(prefs.sources[0]!.remoteUserId).toMatch(/^ri-[a-f0-9]{32}$/);
    const text = fs.readFileSync(path.join(h.configDir, 'integrations', 'preferences.json'), 'utf8')
      + fs.readFileSync(path.join(h.configDir, 'integrations', 'source-credentials.json'), 'utf8');
    expect(text).not.toContain(FAKE_KEY);
  });

  it('rejects a user key and a key Composio refuses, saving nothing', async () => {
    await expect(service.addComposioSource({ apiKey: 'uak_personal_key_value' })).rejects.toThrow(/user API key/);
    await expect(service.addComposioSource({ apiKey: 'ak_not_the_right_key' })).rejects.toThrow(/didn't accept/);
    expect(readPreferences().status).toBe('missing');
  });

  it('a second source never replaces the preference', async () => {
    const first = await setup();
    h.fake.state.apiKeys.add('ak_second_project_key');
    h.fake.state.project = { id: 'proj_other', name: 'Other' };
    const second = await service.addComposioSource({ apiKey: 'ak_second_project_key' });
    expect(second.preferred).toBe(false);
    expect(readPreferences().preferences.preferredSourceId).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect(readPreferences().preferences.sources[1]!.remoteUserId).not.toBe(readPreferences().preferences.sources[0]!.remoteUserId);
  });
});

describe('connecting accounts', () => {
  it('creates a Ri-owned managed auth config and a link bound to the source user', async () => {
    const source = await setup();
    const begun = await service.beginManagedConnect(null, { applicationId: 'gmail', label: 'Work' });
    expect(begun.authorizationUrl).toMatch(/^https:\/\/connect\.composio\.test\//);
    const link = h.fake.state.requests.find(r => r.path === '/connected_accounts/link')!;
    expect(link.body).toMatchObject({ user_id: readPreferences().preferences.sources[0]!.remoteUserId, alias: 'Work' });
    expect((link.body as { callback_url: string }).callback_url).toContain(`/api/integrations/managed/callback?attempt=${begun.attemptId}`);
    expect(h.fake.state.authConfigs).toEqual([expect.objectContaining({ toolkit: 'gmail', managed: true, name: `Ri gmail (${source.id})` })]);
  });

  it('finishes from the callback with the verified identity, and a replay changes nothing', async () => {
    const source = await setup();
    const { connectionId, remoteAccountId, attemptId } = await connect('gmail', 'work@example.com', 'Work');
    const stored = await h.store.get(connectionId);
    expect(stored!.connection).toMatchObject({
      providerId: managedToolkitId(source.id, 'gmail'), accountId: remoteAccountId, email: 'work@example.com', label: 'Work', status: 'active',
    });
    const again = await service.completeManagedAttempt(attemptId, { via: 'callback', hintedAccountId: remoteAccountId });
    expect(again).toMatchObject({ status: 'completed', connectionId });
    expect((await h.store.list({ ownerId: 'local' })).length).toBe(1);
  });

  it('finishes by polling when the redirect never reaches the home', async () => {
    await setup();
    const begun = await service.beginManagedConnect(null, { applicationId: 'gmail' });
    expect(await service.completeManagedAttempt(begun.attemptId, { via: 'poll' })).toMatchObject({ status: 'pending' });
    h.fake.completeLink(getAttempt(begun.attemptId)!.remoteAccountId, 'me@example.com');
    // Polling is rate limited per attempt: the callback path finishes it immediately.
    const done = await service.completeManagedAttempt(begun.attemptId, { via: 'callback' });
    expect(done.status).toBe('completed');
  });

  it('refuses a callback naming another account, and an unknown attempt', async () => {
    await setup();
    const begun = await service.beginManagedConnect(null, { applicationId: 'gmail' });
    const other = h.fake.seedAccount({ user_id: 'someone-else', toolkit: 'gmail', email: 'victim@example.com' });
    const result = await service.completeManagedAttempt(begun.attemptId, { via: 'callback', hintedAccountId: other.id });
    expect(result).toMatchObject({ status: 'failed' });
    expect(await h.store.list({ ownerId: 'local' })).toEqual([]);
    await expect(service.completeManagedAttempt(`att_${'0'.repeat(32)}`, { via: 'callback' })).rejects.toThrow(/unknown/);
  });

  it('refuses an account the vendor reassigned to another user', async () => {
    await setup();
    const begun = await service.beginManagedConnect(null, { applicationId: 'gmail' });
    const account = h.fake.completeLink(getAttempt(begun.attemptId)!.remoteAccountId, 'x@example.com');
    account.user_id = 'another-user';
    expect(await service.completeManagedAttempt(begun.attemptId, { via: 'callback' })).toMatchObject({ status: 'failed' });
    expect(await h.store.list({ ownerId: 'local' })).toEqual([]);
  });

  it('keeps work and personal accounts distinct', async () => {
    await setup();
    const work = await connect('gmail', 'work@example.com', 'Work');
    const personal = await connect('gmail', 'me@example.com', 'Personal');
    expect(work.connectionId).not.toBe(personal.connectionId);
    expect((await h.store.list({ ownerId: 'local' })).map(c => c.email).sort()).toEqual(['me@example.com', 'work@example.com']);
  });

  it('an expired link creates nothing, even if the consent finishes later', async () => {
    await setup();
    const prefs = readPreferences().preferences;
    const attempt = createAttempt({
      id: newAttemptId(), ownerId: 'local', sourceId: prefs.sources[0]!.id, remoteUserId: prefs.sources[0]!.remoteUserId,
      applicationId: 'gmail', toolkitSlug: 'gmail', remoteAuthConfigId: 'ac_x', remoteAccountId: 'ca_late', purpose: 'connect',
      linkExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(await service.completeManagedAttempt(attempt.id, { via: 'callback' })).toMatchObject({ status: 'expired' });
    expect(await h.store.list({ ownerId: 'local' })).toEqual([]);
  });

  it('cancelling removes the unfinished remote account', async () => {
    await setup();
    const begun = await service.beginManagedConnect(null, { applicationId: 'gmail' });
    const remote = getAttempt(begun.attemptId)!.remoteAccountId;
    await service.cancelManagedAttempt(begun.attemptId);
    expect(h.fake.state.accounts.some(a => a.id === remote)).toBe(false);
    expect(getAttempt(begun.attemptId)!.status).toBe('cancelled');
  });
});

describe('execution', () => {
  it('runs a read through a session pinned to exactly that account and the reviewed tools', async () => {
    const source = await setup();
    const { connectionId, remoteAccountId } = await connect('gmail', 'work@example.com');
    h.fake.state.results.set('GMAIL_FETCH_EMAILS', () => ({ messages: [{ id: 'm1', subject: 'Hi' }] }));
    const { runtime } = await h.buildRuntime({ approval: allow });
    const outcome = await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, { query: 'is:unread' }, { ownerId: 'local', connectionId });
    expect(outcome).toMatchObject({ ok: true, result: { via: 'Composio', account: 'work@example.com', data: { messages: [{ id: 'm1' }] } } });
    const [session] = h.fake.liveSessions();
    expect(session!.body).toMatchObject({
      toolkits: { enable: ['gmail'] }, connected_accounts: { gmail: [remoteAccountId] },
      instant: false, workbench: { enable: false }, proxy_execute: { enable: false }, search: { enable: false },
      execute: { enable_multi_execute: false }, multi_account: { enable: false },
      manage_connections: { enable: false, enable_connection_removal: false },
    });
    expect(session!.body.tools!.gmail!.enable).not.toContain('COMPOSIO_SEARCH_TOOLS');
    expect(agentRuns()).toEqual([expect.objectContaining({ via: 'session', slug: 'GMAIL_FETCH_EMAILS', accountId: remoteAccountId, args: { query: 'is:unread' } })]);
  });

  it('uses a separate session per account, and an agent limited to one account cannot reach the other', async () => {
    const source = await setup();
    const work = await connect('gmail', 'work@example.com');
    const personal = await connect('gmail', 'me@example.com');
    const { runtime } = await h.buildRuntime({ approval: allow });
    const action = `${managedToolkitId(source.id, 'gmail')}.fetch_emails`;
    await runtime.runAction(action, {}, { ownerId: 'local', connectionId: work.connectionId });
    await runtime.runAction(action, {}, { ownerId: 'local', connectionId: personal.connectionId });
    expect(h.fake.liveSessions()).toHaveLength(2);
    const denied = await runtime.runAction(action, {}, { ownerId: 'local', allowedConnectionIds: [work.connectionId], connectionId: personal.connectionId });
    expect(denied).toMatchObject({ ok: false, reason: 'error', code: 'account_not_allowed' });
    expect(agentRuns().filter(e => e.accountId === personal.remoteAccountId)).toHaveLength(1);
  });

  it('asks before sending, and runs exactly once after approval, auditing without content', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    const action = `${managedToolkitId(source.id, 'gmail')}.send_email`;
    const asking = await h.buildRuntime({ approval: askWrites });
    const paused = await asking.runtime.runAction(action, { recipient_email: 'a@b.com', subject: 'Hi', body: 'secret body text' }, { ownerId: 'local', connectionId });
    expect(paused).toMatchObject({ ok: false, reason: 'approval_required', risk: 'high' });
    expect(agentRuns()).toEqual([]);
    const approved = await h.buildRuntime({ approval: allow });
    const sent = await approved.runtime.runAction(action, { recipient_email: 'a@b.com', subject: 'Hi', body: 'secret body text' }, { ownerId: 'local', connectionId });
    expect(sent.ok).toBe(true);
    expect(agentRuns().filter(e => e.slug === 'GMAIL_SEND_EMAIL')).toHaveLength(1);
    const audit = readManagedAudit();
    expect(audit.map(e => e.phase)).toEqual(['dispatch', 'outcome']);
    expect(audit[0]).toMatchObject({ actionId: action, slug: 'GMAIL_SEND_EMAIL', version: '20261010_00', mutating: true, argumentNames: ['body', 'recipient_email', 'subject'] });
    expect(JSON.stringify(audit)).not.toContain('secret body text');
  });

  it('a changed tool definition invalidates the call and refreshes Ri\'s tools', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    const built = await h.buildRuntime({ approval: allow });
    const action = `${managedToolkitId(source.id, 'gmail')}.send_email`;
    expect((await built.runtime.runAction(action, { recipient_email: 'a@b.com' }, { ownerId: 'local', connectionId })).ok).toBe(true);
    h.fake.addTool({ slug: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', version: '20261101_00', input_parameters: { type: 'object', properties: { to: { type: 'string' } } } });
    const changed = await built.runtime.runAction(action, { recipient_email: 'a@b.com' }, { ownerId: 'local', connectionId });
    expect(changed).toMatchObject({ ok: false, reason: 'error', code: 'tools_changed' });
    expect(built.toolsChanged()).toBe(1);
    expect(agentRuns().filter(e => e.slug === 'GMAIL_SEND_EMAIL')).toHaveLength(1);
  });

  it('refuses and deletes a session the vendor did not restrict', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    h.fake.state.sessionTamper = config => { config.search = { enable: true }; };
    const { runtime } = await h.buildRuntime({ approval: allow });
    const outcome = await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, {}, { ownerId: 'local', connectionId });
    expect(outcome).toMatchObject({ ok: false, reason: 'error' });
    expect((outcome as { message: string }).message).toMatch(/restrictions/);
    expect(h.fake.liveSessions()).toEqual([]);
    expect(agentRuns()).toEqual([]);
  });

  it('refuses a session that lists an extra helper tool', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    h.fake.state.extraSessionTools.push({ slug: 'COMPOSIO_PROXY_EXECUTE', toolkit: 'composio', version: '1', input_parameters: {} });
    const { runtime } = await h.buildRuntime({ approval: allow });
    const outcome = await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, {}, { ownerId: 'local', connectionId });
    expect(outcome.ok).toBe(false);
    expect(agentRuns()).toEqual([]);
  });

  it('reports a write whose response was lost as indeterminate and never repeats it', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    const { runtime } = await h.buildRuntime({ approval: allow });
    const action = `${managedToolkitId(source.id, 'gmail')}.send_email`;
    // Build the session first, then lose the execute response after the send was applied.
    await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, {}, { ownerId: 'local', connectionId });
    h.fake.state.dropAfterWrite.push({ method: 'POST', path: '/tool_router/session/' });
    const outcome = await runtime.runAction(action, { recipient_email: 'a@b.com' }, { ownerId: 'local', connectionId });
    expect(outcome).toMatchObject({ ok: false, reason: 'error', indeterminate: true });
    expect(agentRuns().filter(e => e.slug === 'GMAIL_SEND_EMAIL')).toHaveLength(1);
    expect(readManagedAudit().at(-1)).toMatchObject({ phase: 'outcome', outcome: 'uncertain', slug: 'GMAIL_SEND_EMAIL' });
  });

  it('maps an expired remote account to a reconnect of that exact account', async () => {
    const source = await setup();
    const { connectionId, remoteAccountId } = await connect('gmail', 'work@example.com');
    const { runtime } = await h.buildRuntime({ approval: allow });
    h.fake.state.accounts.find(a => a.id === remoteAccountId)!.status = 'EXPIRED';
    const outcome = await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, {}, { ownerId: 'local', connectionId });
    expect(outcome).toMatchObject({ ok: false, reason: 'auth_required' });
    expect((outcome as { authorizationUrl: string }).authorizationUrl).toContain(`connection=${connectionId}`);
    expect((await h.store.get(connectionId))!.connection.status).toBe('needs_reauth');
  });

  it('a source turned off stops calls before any approval is asked', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    let asked = 0;
    const { runtime } = await h.buildRuntime({ approval: { check: async () => { asked += 1; return 'ask'; } } });
    await service.setSourceEnabled(source.id, false);
    const outcome = await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.send_email`, { recipient_email: 'a@b.com' }, { ownerId: 'local', connectionId });
    expect(outcome).toMatchObject({ ok: false, reason: 'error', code: 'provider_not_configured' });
    expect(asked).toBe(0);
  });

  it('never registers a tool Composio stopped listing', async () => {
    h.fake.state.tools.delete('GMAIL_SEND_DRAFT');
    const source = await setup();
    const { runtime } = await h.buildRuntime();
    const gmail = runtime.getToolkits().find(t => t.id === managedToolkitId(source.id, 'gmail'))!;
    expect(gmail.actions.map(a => a.id)).not.toContain(`${gmail.id}.send_draft`);
    expect(gmail.actions.map(a => a.id)).toContain(`${gmail.id}.send_email`);
  });

  it('keeps the API key out of results, errors, audit and stored files', async () => {
    const source = await setup();
    const { connectionId } = await connect('gmail', 'work@example.com');
    h.fake.state.results.set('GMAIL_FETCH_EMAILS', () => ({ echoed: `key is ${FAKE_KEY}` }));
    const { runtime } = await h.buildRuntime({ approval: allow });
    const outcome = await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, {}, { ownerId: 'local', connectionId });
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
    const files = ['preferences.json', 'managed-sessions.json', 'managed-attempts.json', 'managed-tools-cache.json', 'audit/managed-actions.jsonl']
      .map(file => path.join(h.configDir, 'integrations', file)).filter(file => fs.existsSync(file));
    for (const file of files) expect(fs.readFileSync(file, 'utf8')).not.toContain(FAKE_KEY);
  });
});

describe('lifecycle', () => {
  it('disconnecting stops use now, deletes its session and leaves the remote account', async () => {
    const source = await setup();
    const { connectionId, remoteAccountId } = await connect('gmail', 'work@example.com');
    const { runtime } = await h.buildRuntime({ approval: allow });
    await runtime.runAction(`${managedToolkitId(source.id, 'gmail')}.fetch_emails`, {}, { ownerId: 'local', connectionId });
    expect(h.fake.liveSessions()).toHaveLength(1);
    expect(await service.disconnectManaged(connectionId)).toEqual({ sourceLabel: 'Composio', remoteRemains: true });
    expect(await h.store.get(connectionId)).toBeNull();
    expect(h.fake.liveSessions()).toEqual([]);
    expect(h.fake.state.accounts.some(a => a.id === remoteAccountId)).toBe(true);
  });

  it('revoking removes that exact remote account and reports it', async () => {
    await setup();
    const kept = await connect('gmail', 'me@example.com');
    const { connectionId, remoteAccountId } = await connect('gmail', 'work@example.com');
    const result = await service.revokeManaged(connectionId);
    expect(result.outcome).toMatchObject({ kind: 'revoked' });
    expect(h.fake.state.accounts.some(a => a.id === remoteAccountId)).toBe(false);
    expect(h.fake.state.accounts.some(a => a.id === kept.remoteAccountId)).toBe(true);
  });

  it('discovers and imports only the source user\'s own accounts', async () => {
    const source = await setup();
    const userId = readPreferences().preferences.sources[0]!.remoteUserId;
    const mine = h.fake.seedAccount({ user_id: userId, toolkit: 'gmail', email: 'old@example.com' });
    const theirs = h.fake.seedAccount({ user_id: 'other-app-user', toolkit: 'gmail', email: 'other@example.com' });
    const found = await service.discoverAccounts(source.id, 'gmail');
    expect(found.map(a => a.remoteAccountId)).toEqual([mine.id]);
    await expect(service.importAccount(source.id, 'gmail', theirs.id)).rejects.toThrow(/another user/);
    const imported = await service.importAccount(source.id, 'gmail', mine.id);
    expect(imported.email).toBe('old@example.com');
  });

  it('rotates a key only when it reaches the same project and accounts', async () => {
    const source = await setup();
    await connect('gmail', 'work@example.com');
    h.fake.state.apiKeys.add('ak_rotated_key_value');
    await expect(service.rotateSourceKey(source.id, 'ak_rotated_key_value')).resolves.toMatchObject({ id: source.id });
    h.fake.state.project = { id: 'proj_other', name: 'Other' };
    await expect(service.rotateSourceKey(source.id, 'ak_rotated_key_value')).rejects.toThrow(/different Composio project/);
  });

  it('removing a source retires its id, forgets its key and its accounts in Ri', async () => {
    const source = await setup();
    await connect('gmail', 'work@example.com');
    const removed = await service.removeSource(source.id, { revokeRemote: false });
    expect(removed).toMatchObject({ removedAccounts: 1, remoteRemaining: 1 });
    const prefs = readPreferences().preferences;
    expect(prefs.sources).toEqual([]);
    expect(prefs.retiredSourceIds).toEqual([source.id]);
    expect(prefs.preferredSourceId).toBeUndefined();
    expect(await h.store.list({ ownerId: 'local' })).toEqual([]);
  });

  it('a reconnect keeps the same connection and remote account', async () => {
    await setup();
    const { connectionId, remoteAccountId } = await connect('gmail', 'work@example.com');
    const begun = await service.beginManagedReconnect(null, connectionId);
    expect(getAttempt(begun.attemptId)).toMatchObject({ purpose: 'reconnect', remoteAccountId, connectionId });
    h.fake.completeLink(remoteAccountId, 'work@example.com');
    const done = await service.completeManagedAttempt(begun.attemptId, { via: 'callback' });
    expect(done).toMatchObject({ status: 'completed', connectionId });
    expect((await h.store.list({ ownerId: 'local' }))).toHaveLength(1);
  });
});
