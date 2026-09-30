import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRegistry } from '../core/registry';
import { createConnectorRuntime } from '../core/runtime';
import { staticAuthConfigs } from '../auth-configs';
import type { ApprovalCheckInput, ActionRunEvent, Connection } from '../core/types';
import { ingestMcpServers, type IngestMcpOptions, type McpToolDef } from '../mcp';
import { inMemoryStore, plaintextSecretBox } from '../testing';

const identity = { providerId: 'official', displayName: 'Official' };
const read: McpToolDef = { name: 'read', annotations: { readOnlyHint: true } };
const write: McpToolDef = { name: 'write', annotations: { destructiveHint: false } };

function setup() {
  const registry = createRegistry();
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  const events: ActionRunEvent[] = [];
  const approval = vi.fn(async (input: ApprovalCheckInput) => input.mutating ? 'ask' as const : 'allow' as const);
  const authorize = vi.fn(() => 'https://app.example/connect');
  const runtime = createConnectorRuntime({ registry, store, secretBox, authRequests: store,
    authConfigs: staticAuthConfigs([]),
    approval: { check: approval }, authorizationRequired: authorize, onActionRun: event => events.push(event) });
  const account = (id: string, tools: McpToolDef[] = [read, write], overrides: Partial<IngestMcpOptions> = {}) => {
    const call = vi.fn(async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => ({
      content: [{ type: 'text', text: `${id}:${name}` }], structuredContent: { account: id, args },
    }));
    const current = { value: true };
    const options: IngestMcpOptions = {
      name: `official-${id}`, connectionId: id, identity: { ...identity, accountId: `account-${id}`, label: id },
      sessionToken: `secret-${id}-credential`, trustToolAnnotations: true,
      isCurrentTransport: () => current.value,
      client: { listTools: async () => ({ tools }), callTool: call }, ...overrides,
    };
    return { options, call, current };
  };
  const ingest = (...accounts: ReturnType<typeof account>[]) => ingestMcpServers(registry, store, secretBox, accounts.map(account => account.options));
  return { registry, store, secretBox, runtime, approval, authorize, events, account, ingest };
}

describe('MCP account groups', () => {
  it('shares canonical actions while routing explicit, hinted and scoped calls to the selected client', async () => {
    const s = setup();
    const personal = s.account('Personal');
    const work = s.account('Work');
    const results = await s.ingest(personal, work);
    expect(s.registry.providers()).toHaveLength(1);
    expect(s.registry.toolkits()).toHaveLength(1);
    expect(s.registry.getToolkit('official')?.actions.map(action => action.id)).toEqual(['official.read', 'official.write']);
    expect(results.map(result => result.connectionId)).toEqual(['Personal', 'Work']);
    expect(await s.runtime.runAction('official.read', {})).toMatchObject({ reason: 'needs_account', choices: [
      { connectionId: 'Personal', label: 'Personal' }, { connectionId: 'Work', label: 'Work' },
    ] });
    expect(await s.runtime.runAction('official.read', {}, { account: 'Work' })).toMatchObject({ ok: true, result: { server: 'official-Work', structuredContent: { account: 'Work' } } });
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Personal' })).toMatchObject({ ok: true, result: { structuredContent: { account: 'Personal' } } });
    expect(await s.runtime.runAction('official.read', {}, { allowedConnectionIds: ['Work'] })).toMatchObject({ ok: true, result: { structuredContent: { account: 'Work' } } });
    expect(personal.call).toHaveBeenCalledTimes(1);
    expect(work.call).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(s.registry.getProvider('official'))).not.toContain('secret-');
  });

  it('enforces allowed accounts and ownership without silently using a sibling client', async () => {
    const s = setup();
    const personal = s.account('Personal');
    const work = s.account('Work');
    await s.ingest(personal, work);
    for (const options of [{ connectionId: 'Personal' }, { account: 'Personal' }]) {
      expect(await s.runtime.runAction('official.read', {}, { ...options, allowedConnectionIds: ['Work'] })).toMatchObject({ code: 'account_not_allowed' });
    }
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Work', ownerId: 'another-owner' })).toMatchObject({ code: 'connection_not_found' });
    expect(personal.call).not.toHaveBeenCalled();
    expect(work.call).not.toHaveBeenCalled();
    expect(s.approval).not.toHaveBeenCalled();
  });

  it('unions tool names but rejects account-missing and account-disabled tools before approval', async () => {
    const s = setup();
    const personal = s.account('Personal', [read, write], { toolOverrides: { write: { enabled: false } } });
    const work = s.account('Work', [read, write, { name: 'admin' }]);
    const result = await s.ingest(personal, work);
    expect(result.map(account => account.toolCount)).toEqual([1, 3]);
    expect(result[0]?.tools.map(tool => tool.name)).toEqual(['read', 'write']);
    for (const tool of ['write', 'admin']) {
      expect(await s.runtime.runAction(`official.${tool}`, {}, { connectionId: 'Personal' })).toMatchObject({ code: 'denied', message: expect.stringContaining('selected account') });
    }
    expect(s.approval).not.toHaveBeenCalled();
    expect(personal.call).not.toHaveBeenCalled();
    expect(work.call).not.toHaveBeenCalled();
    expect(await s.runtime.runAction('official.write', {}, { connectionId: 'Work' })).toMatchObject({ reason: 'approval_required' });
  });

  it('validates each account schema after permissive union projection and before approval', async () => {
    const s = setup();
    const personal = s.account('Personal', [{ ...read, inputSchema: {
      type: 'object', properties: { reference: { type: 'string' }, folder: { enum: ['inbox', 'archive'] } }, required: ['reference', 'folder'],
    } }]);
    const work = s.account('Work', [{ ...read, inputSchema: {
      type: 'object', properties: { reference: { type: 'number' }, team: { type: 'string' } }, required: ['reference', 'team'],
    } }]);
    await s.ingest(personal, work);
    const projected = s.registry.getAction('official.read')!.action.input;
    expect(projected.safeParse({ reference: 'task', folder: 'inbox' }).success).toBe(true);
    expect(projected.safeParse({ reference: 42, team: 'Engineering' }).success).toBe(true);
    for (const [connectionId, input] of [
      ['Personal', { reference: 42, folder: 'inbox' }], ['Personal', { reference: 'task', folder: 'invalid' }],
      ['Work', { reference: 'task', team: 'Engineering' }], ['Work', { reference: 42 }],
    ] as const) {
      expect(await s.runtime.runAction('official.read', input, { connectionId })).toMatchObject({ code: 'invalid_input' });
    }
    expect(s.approval).not.toHaveBeenCalled();
    expect(personal.call).not.toHaveBeenCalled();
    expect(work.call).not.toHaveBeenCalled();
    expect(await s.runtime.runAction('official.read', { reference: 'task', folder: 'inbox' }, { connectionId: 'Personal' })).toMatchObject({ ok: true });
    expect(await s.runtime.runAction('official.read', { reference: 42, team: 'Engineering' }, { connectionId: 'Work' })).toMatchObject({ ok: true });
    expect(personal.call).toHaveBeenCalledWith({ name: 'read', arguments: { reference: 'task', folder: 'inbox' } });
    expect(work.call).toHaveBeenCalledWith({ name: 'read', arguments: { reference: 42, team: 'Engineering' } });
  });

  it('uses the most conservative classification without upgrading read failures to indeterminate writes', async () => {
    const s = setup();
    const personal = s.account('Personal', [read]);
    const work = s.account('Work', [{ name: 'read', annotations: { readOnlyHint: false, destructiveHint: true } }]);
    await s.ingest(personal, work);
    expect(s.registry.getAction('official.read')?.action).toMatchObject({ mutating: true, risk: 'high' });
    for (const connectionId of ['Personal', 'Work']) {
      expect(await s.runtime.runAction('official.read', {}, { connectionId })).toMatchObject({ reason: 'approval_required', risk: 'high' });
    }
    s.approval.mockResolvedValue('allow');
    personal.call.mockRejectedValue(new Error('Lost response'));
    work.call.mockRejectedValue(new Error('Lost response'));
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Personal' })).toMatchObject({ code: 'provider_unavailable' });
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Personal' })).not.toHaveProperty('indeterminate');
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Work' })).toMatchObject({ code: 'provider_unavailable', indeterminate: true });
  });

  it.each(['rotated credential', 'disabled authority', 'needs_reauth', 'removed row'])('blocks the stale account after %s while its sibling remains usable', async (condition) => {
    const s = setup();
    const personal = s.account('Personal');
    const work = s.account('Work');
    await s.ingest(personal, work);
    const saved = (await s.store.get('Personal'))!;
    if (condition === 'rotated credential') await s.store.save(saved.connection, await s.secretBox.seal({ type: 'bearer', token: 'replacement-credential' }));
    else if (condition === 'disabled authority') personal.current.value = false;
    else if (condition === 'needs_reauth') await s.store.setStatus('Personal', 'needs_reauth');
    else await s.store.delete('Personal');
    const failure = await s.runtime.runAction('official.read', {}, { connectionId: 'Personal' });
    expect(failure).toMatchObject(condition === 'removed row' ? { code: 'connection_not_found' } : { reason: 'auth_required' });
    expect(personal.call).not.toHaveBeenCalled();
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Work' })).toMatchObject({ ok: true });
    expect(work.call).toHaveBeenCalledOnce();
  });

  it('rejects reused row ids whose account or OAuth-app identity changed', async () => {
    const s = setup();
    const personal = s.account('Personal');
    const work = s.account('Work');
    await s.ingest(personal, work);
    const saved = (await s.store.get('Personal'))!;
    for (const patch of [{ accountId: 'another-account' }, { authConfigId: 'another-app' }]) {
      await s.store.save({ ...saved.connection, ...patch }, saved.sealed);
      expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Personal' })).toMatchObject({ code: 'connection_not_found' });
    }
    expect(personal.call).not.toHaveBeenCalled();
    expect(s.approval).not.toHaveBeenCalled();
  });

  it('rejects an unbound saved account even if its credential matches a captured transport', async () => {
    const s = setup();
    const personal = s.account('Personal');
    const work = s.account('Work');
    await s.ingest(personal, work);
    const saved = (await s.store.get('Personal'))!;
    await s.store.save({ ...saved.connection, id: 'Unbound' }, saved.sealed);
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Unbound' })).toMatchObject({ code: 'connection_not_found' });
    expect(personal.call).not.toHaveBeenCalled();
    expect(work.call).not.toHaveBeenCalled();
  });

  it('preserves account scopes and auth pins and checks scopes against only the chosen account', async () => {
    const s = setup();
    for (const id of ['Personal', 'Work']) {
      const connection: Connection = { id, ...identity, ownerId: 'local', accountId: `account-${id}`, authConfigId: `app-${id}`,
        scopes: id === 'Work' ? ['read', 'admin'] : ['read'], status: 'active', createdAt: 'then', updatedAt: 'then' };
      await s.store.save(connection, await s.secretBox.seal({ type: 'bearer', token: `old-${id}` }));
    }
    const personal = s.account('Personal');
    const work = s.account('Work');
    await s.ingest(personal, work);
    s.registry.addToolkit({ id: 'scope-probe', providerId: 'official', displayName: 'Scope probe', actions: [{
      id: 'official.scope-probe', description: 'Test host scope boundary', input: z.object({}), scopes: ['admin'],
      execute: async ctx => ({ account: ctx.connection.accountId }),
    }] });
    expect(await s.runtime.runAction('official.scope-probe', {}, { connectionId: 'Personal' })).toMatchObject({ reason: 'needs_consent', missingScopes: ['admin'], connectionId: 'Personal' });
    expect(s.authorize).toHaveBeenCalledWith({ providerId: 'official', scopes: ['read', 'admin'], existingConnectionId: 'Personal', authConfigId: 'app-Personal' });
    expect(await s.runtime.runAction('official.scope-probe', {}, { connectionId: 'Work' })).toMatchObject({ ok: true, result: { account: 'account-Work' } });
    expect((await s.store.get('Personal'))?.connection).toMatchObject({ scopes: ['read'], authConfigId: 'app-Personal', label: 'Personal' });
  });

  it('rechecks the selected authority immediately before network dispatch', async () => {
    const s = setup();
    let reads = 0;
    const personal = s.account('Personal', [read], { isCurrentTransport: () => ++reads === 1 });
    const work = s.account('Work');
    await s.ingest(personal, work);
    expect(await s.runtime.runAction('official.read', {}, { connectionId: 'Personal' })).toMatchObject({ reason: 'auth_required' });
    expect(personal.call).not.toHaveBeenCalled();
    expect(work.call).not.toHaveBeenCalled();
  });

  it('returns complete per-account discovery including disabled tools for host monitoring', async () => {
    const s = setup();
    const tool: McpToolDef = { ...read, description: 'Find records', inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { found: { type: 'boolean' } } }, annotations: { readOnlyHint: true, destructiveHint: false, title: 'Find' } };
    const personal = s.account('Personal', [tool], { toolOverrides: { read: { enabled: false } } });
    const work = s.account('Work', [read]);
    const result = await s.ingest(personal, work);
    expect(result[0]?.tools).toEqual([tool]);
    expect(result[0]?.toolCount).toBe(0);
    expect(result[1]?.toolCount).toBe(1);
  });

  it.each(['different provider', 'duplicate connection', 'duplicate remote tool'])('rejects an invalid group without registering or saving it: %s', async (condition) => {
    const s = setup();
    const personal = s.account('Personal');
    const work = s.account('Work');
    if (condition === 'different provider') work.options.identity = { providerId: 'another', displayName: 'Another' };
    else if (condition === 'duplicate connection') work.options.connectionId = personal.options.connectionId;
    else work.options.client.listTools = async () => ({ tools: [read, read] });
    await expect(s.ingest(personal, work)).rejects.toHaveProperty('code', condition === 'duplicate remote tool' ? 'provider_error' : 'conflict');
    expect(s.registry.providers()).toHaveLength(0);
    expect(await s.store.list({})).toHaveLength(0);
  });
});
