import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { staticAuthConfigs, type AuthConfigInput } from '../auth-configs';
import { bearer } from '../auth/direct';
import { action, defineProvider, defineToolkit } from '../core/authoring';
import { NeedsReauthError } from '../core/errors';
import { createRegistry } from '../core/registry';
import { createConnectorRuntime } from '../core/runtime';
import type { Connection, Credentials } from '../core/types';
import { ingestMcpServer } from '../mcp/ingest';
import { inMemoryStore, plaintextSecretBox } from '../testing';

const nativeConfig: AuthConfigInput = {
  id: 'fixture-work-client', providerId: 'fixture', scheme: 'oauth2',
  scope: 'owner', ownerId: 'local', label: 'Work client', isDefault: true,
  status: 'active', allowedScopes: ['read'],
  oauth: { clientId: 'old-native-client', redirectUri: 'https://app.example/native-callback' },
  clientSecret: 'old-native-client-secret', baseUrl: 'https://native-api.example',
};
const original: Connection = {
  id: 'existing-fixture', providerId: 'fixture', ownerId: 'local',
  accountId: 'fixture-user-42', authConfigId: nativeConfig.id,
  email: 'work@example.com', label: 'My work', scopes: ['read'],
  baseUrl: 'https://tenant-native-api.example', config: { team: 'work-team' },
  status: 'needs_reauth', createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z', lastUsedAt: '2025-02-01T00:00:00.000Z',
};
const nativeCredentials: Credentials = {
  type: 'oauth2', accessToken: 'expired-native-access', refreshToken: 'native-refresh', expiresAt: 1,
};

async function migrated(options: { config?: AuthConfigInput | null; hostAuthorization?: boolean; isCurrentTransport?: () => boolean } = {}) {
  const registry = createRegistry();
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  await store.save(original, await secretBox.seal(nativeCredentials));
  const configs = staticAuthConfigs(options.config === null ? [] : [options.config ?? nativeConfig]);
  const authConfigs = {
    ...configs,
    getConfigForConnection: vi.fn(configs.getConfigForConnection),
    openConfigForConnection: vi.fn(configs.openConfigForConnection),
    listForConnect: vi.fn(configs.listForConnect),
  };
  const callTool = vi.fn(async ({ name }: { name: string; arguments?: Record<string, unknown> }) => ({
    content: [{ type: 'text', text: `ran ${name}` }], structuredContent: { name },
  }));
  const client = {
    listTools: async () => ({ tools: [
      { name: 'list-issues', annotations: { readOnlyHint: true } },
      { name: 'create-issue', annotations: { destructiveHint: false } },
    ] }),
    callTool,
  };
  const contextProbe = action({
    id: 'fixture.inspect_context', description: 'Test-only account context probe', input: z.object({}),
    scopes: ['read'], mutating: false,
    async execute(ctx) {
      return { accountId: ctx.connection.accountId, config: ctx.config };
    },
  });
  const restricted = action({
    id: 'fixture.admin_action', description: 'Needs additional consent', input: z.object({}),
    scopes: ['admin'], mutating: false,
    async execute() { return client.callTool({ name: 'admin' }); },
  });
  const rawHttp = action({
    id: 'fixture.raw_http', description: 'Test-only native HTTP access probe', input: z.object({}),
    mutating: false, async execute(ctx) { return ctx.http.get('https://native-api.example/viewer'); },
  });
  const rawToken = action({
    id: 'fixture.raw_token', description: 'Test-only raw token access probe', input: z.object({}),
    mutating: false, async execute(ctx) { return ctx.getToken(); },
  });
  await ingestMcpServer(registry, store, secretBox, {
    name: 'builtin_fixture', identity: { providerId: 'fixture', displayName: 'Fixture' },
    connectionId: original.id, sessionToken: 'mcp-transport-token', ownerId: 'local',
    trustToolAnnotations: true, client,
    ...(options.isCurrentTransport ? { isCurrentTransport: options.isCurrentTransport } : {}),
  });
  // These test-local probes exercise core account/scope/credential boundaries.
  // Production MCP ingestion exposes only the tools discovered from the server.
  registry.addToolkit(defineToolkit({ id: 'fixture_security_probes', providerId: 'fixture', displayName: 'Security probes',
    actions: [contextProbe, restricted, rawHttp, rawToken] }));
  const authorizationRequired = vi.fn(() => 'https://app.example/connect/fixture');
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('Native transport must not run'); });
  const approval = vi.fn(async (input: { mutating: boolean }) => input.mutating ? 'ask' as const : 'allow' as const);
  const runtime = createConnectorRuntime({
    registry, store, authRequests: store, secretBox, authConfigs, fetch,
    approval: { check: approval },
    ...(options.hostAuthorization === false ? {} : { authorizationRequired }),
  });
  return { registry, store, secretBox, authConfigs, callTool, runtime, fetch, approval, authorizationRequired };
}

describe('native OAuth identity retained by an MCP transport', () => {
  it.each(['active', 'disabled', 'archived'] as const)('preserves account/client pins and executes without using the %s native config', async (status) => {
    const s = await migrated({ config: { ...nativeConfig, status } });
    const stored = (await s.store.get(original.id))!;
    expect(stored.connection).toEqual({ ...original, status: 'active', updatedAt: expect.any(String) });
    expect(await s.secretBox.open(stored.sealed)).toEqual({ type: 'bearer', token: 'mcp-transport-token' });
    expect(s.registry.getProvider('fixture')?.externalAuth).toMatchObject({ connectionId: original.id });
    expect(JSON.stringify(s.registry.getProvider('fixture'))).not.toContain('mcp-transport-token');

    // The same account/client pin still resolves to the same engine connection.
    const pinned = (await s.runtime.listConnections()).filter(c =>
      c.accountId === original.accountId && c.authConfigId === original.authConfigId,
    );
    expect(pinned.map(c => c.id)).toEqual([original.id]);
    expect(await s.runtime.runAction('fixture.list-issues', {}, { allowedConnectionIds: pinned.map(c => c.id) })).toMatchObject({ ok: true });
    expect(await s.runtime.runAction('fixture.inspect_context', {}, { connectionId: original.id })).toEqual({
      ok: true, result: { accountId: original.accountId, config: original.config },
    });
    expect(s.authConfigs.getConfigForConnection).not.toHaveBeenCalled();
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();

    // The historical client remains useful for identity labels, not credentials.
    expect(await s.runtime.listAccountChoices('fixture')).toEqual([{
      connectionId: original.id, email: original.email, label: original.label, authConfigLabel: 'Work client',
    }]);
    expect(s.authConfigs.getConfigForConnection).toHaveBeenCalledWith('fixture', original.authConfigId);
  });

  it('does not depend on the old OAuth config still being installed', async () => {
    const s = await migrated({ config: null });
    expect(await s.runtime.runAction('fixture.list-issues', {})).toMatchObject({ ok: true });
    expect((await s.store.get(original.id))?.connection.authConfigId).toBe(original.authConfigId);
  });

  it('continues to gate writes before calling the remote transport', async () => {
    const s = await migrated();
    expect(await s.runtime.runAction('fixture.create-issue', {})).toMatchObject({
      ok: false, reason: 'approval_required', risk: 'medium',
    });
    expect(s.callTool).not.toHaveBeenCalled();
  });

  it('requires host consent for missing action scopes without broadening saved scopes or invoking native OAuth', async () => {
    const s = await migrated();
    expect(await s.runtime.runAction('fixture.admin_action', {})).toMatchObject({
      ok: false, reason: 'needs_consent', missingScopes: ['admin'], connectionId: original.id,
      authorizationUrl: 'https://app.example/connect/fixture',
    });
    expect(s.authorizationRequired).toHaveBeenCalledWith({
      providerId: 'fixture', scopes: ['read', 'admin'], existingConnectionId: original.id, authConfigId: original.authConfigId,
    });
    expect((await s.store.get(original.id))?.connection.scopes).toEqual(['read']);
    expect(s.callTool).not.toHaveBeenCalled();
    expect(s.authConfigs.getConfigForConnection).not.toHaveBeenCalled();
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
    expect(s.authConfigs.listForConnect).not.toHaveBeenCalled();
  });

  it('fails closed when a host authorization flow has not been provided', async () => {
    const s = await migrated({ hostAuthorization: false });
    expect(await s.runtime.runAction('fixture.admin_action', {})).toMatchObject({ ok: false, code: 'provider_not_configured' });
    await s.store.setStatus(original.id, 'needs_reauth');
    expect(await s.runtime.runAction('fixture.list-issues', {})).toMatchObject({ ok: false, code: 'provider_not_configured' });
    expect(s.callTool).not.toHaveBeenCalled();
    expect(s.authConfigs.getConfigForConnection).not.toHaveBeenCalled();
  });

  it('routes an expired host connection to host sign-in without native refresh', async () => {
    const s = await migrated();
    await s.store.setStatus(original.id, 'needs_reauth');
    expect(await s.runtime.runAction('fixture.list-issues', {})).toMatchObject({
      ok: false, reason: 'auth_required', authorizationUrl: 'https://app.example/connect/fixture',
    });
    expect(s.authorizationRequired).toHaveBeenCalledWith({
      providerId: 'fixture', scopes: ['read'], existingConnectionId: original.id, authConfigId: original.authConfigId,
    });
    expect(s.callTool).not.toHaveBeenCalled();
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
  });

  it.each(['fixture.list-issues', 'fixture.create-issue'])(
    'routes a typed remote auth rejection to host sign-in for %s', async (actionId) => {
      const s = await migrated();
      s.approval.mockResolvedValue('allow');
      s.callTool.mockRejectedValue(new NeedsReauthError());
      expect(await s.runtime.runAction(actionId, {})).toEqual({
        ok: false, reason: 'auth_required', providerId: 'fixture', authorizationUrl: 'https://app.example/connect/fixture',
      });
      expect(s.authorizationRequired).toHaveBeenCalledWith({
        providerId: 'fixture', scopes: ['read'], existingConnectionId: original.id, authConfigId: original.authConfigId,
      });
      expect(s.callTool).toHaveBeenCalledOnce();
      expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it('does not refresh native OAuth credentials if a stale row replaces the migrated credentials', async () => {
    const s = await migrated();
    await s.store.save({ ...original, status: 'active' }, await s.secretBox.seal(nativeCredentials));
    expect(await s.runtime.runAction('fixture.list-issues', {})).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(s.callTool).not.toHaveBeenCalled();
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('does not start a native OAuth flow if the connection was removed', async () => {
    const s = await migrated();
    await s.store.delete(original.id);
    expect(await s.runtime.runAction('fixture.list-issues', {})).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(s.authorizationRequired).toHaveBeenCalledWith({ providerId: 'fixture', scopes: [] });
    expect(s.authConfigs.listForConnect).not.toHaveBeenCalled();
    expect(s.callTool).not.toHaveBeenCalled();
  });

  it('rejects a stale captured client after another runtime replaces the derived transport credential', async () => {
    const old = await migrated();
    const newRegistry = createRegistry();
    const newCall = vi.fn(async () => ({ content: [{ type: 'text', text: 'new transport' }] }));
    await ingestMcpServer(newRegistry, old.store, old.secretBox, {
      name: 'builtin_fixture', identity: { providerId: 'fixture', displayName: 'Fixture' },
      connectionId: original.id, sessionToken: 'replacement-transport-token', ownerId: 'local',
      client: { listTools: async () => ({ tools: [{ name: 'list-issues' }] }), callTool: newCall },
      toolOverrides: { 'list-issues': { mutating: false } },
    });
    const fresh = createConnectorRuntime({
      registry: newRegistry, store: old.store, authRequests: old.store,
      secretBox: old.secretBox, authConfigs: old.authConfigs,
    });
    expect(await old.runtime.runAction('fixture.list-issues', {}, { connectionId: original.id })).toMatchObject({
      ok: false, reason: 'auth_required', authorizationUrl: 'https://app.example/connect/fixture',
    });
    expect(old.callTool).not.toHaveBeenCalled();
    expect(await fresh.runAction('fixture.list-issues', {})).toMatchObject({ ok: true });
    expect(newCall).toHaveBeenCalledOnce();
    expect((await old.store.get(original.id))?.connection).toMatchObject({
      accountId: original.accountId, authConfigId: original.authConfigId, status: 'active', scopes: original.scopes,
    });
  });

  it('rejects stale host authority or tool policy even when the stored credential and status are unchanged', async () => {
    let snapshotMatches = true;
    const isCurrentTransport = vi.fn(() => snapshotMatches);
    const s = await migrated({ isCurrentTransport });
    expect(await s.runtime.runAction('fixture.list-issues', {})).toMatchObject({ ok: true });
    s.callTool.mockClear();

    // Another process changes a disabled tool, then successfully re-ingests the
    // same credential. Its active row does not revive this old policy snapshot.
    snapshotMatches = false;
    await s.store.setStatus(original.id, 'active');
    for (const actionId of ['fixture.list-issues', 'fixture.inspect_context']) {
      expect(await s.runtime.runAction(actionId, {})).toMatchObject({ ok: false, reason: 'auth_required' });
    }
    expect(s.callTool).not.toHaveBeenCalled();
    expect(isCurrentTransport).toHaveBeenCalledTimes(4); // successful execution also rechecks immediately before transport dispatch
    expect(await s.runtime.testConnection(original.id)).toMatchObject({ ok: false, status: 'needs_reauth', verified: false });
    expect((await s.store.get(original.id))?.connection.status).toBe('active');
  });

  it('keeps token redaction active for responses from the external transport', async () => {
    const s = await migrated();
    s.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'mcp-transport-token' }], structuredContent: { name: 'mcp-transport-token' } });
    const result = await s.runtime.runAction('fixture.list-issues', {});
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('mcp-transport-token');
  });
});

describe('MCP transport binding cannot be bypassed by native auth or another saved account', () => {
  it.each(['fixture.list-issues', 'fixture.inspect_context'])('rejects another connection for %s', async (actionId) => {
    const s = await migrated();
    const other = { ...original, id: 'other-connection', accountId: 'other-user', label: 'Other account', email: 'other@example.com', status: 'active' as const };
    await s.store.save(other, await s.secretBox.seal({ type: 'bearer', token: 'other-token' }));
    for (const options of [{ connectionId: other.id }, { account: other.email }, { allowedConnectionIds: [other.id] }]) {
      expect(await s.runtime.runAction(actionId, {}, options)).toMatchObject({ ok: false, code: 'connection_not_found' });
    }
    expect(s.callTool).not.toHaveBeenCalled();
    expect(s.approval).not.toHaveBeenCalled();
    expect(await s.runtime.runAction(actionId, {}, { connectionId: original.id })).toMatchObject({ ok: true });
  });

  it('rejects direct-credential connect and native OAuth begin without mutating the connection', async () => {
    const s = await migrated();
    const before = await s.store.get(original.id);
    await expect(s.runtime.connectDirect('fixture', { credential: { type: 'bearer', token: 'forged-token' }, accountId: original.accountId })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.runtime.beginAuth('fixture', { existingConnectionId: original.id })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await s.store.get(original.id)).toEqual(before);
    expect(await s.store.list({})).toHaveLength(1);
    expect(s.authConfigs.listForConnect).not.toHaveBeenCalled();
  });

  it('consumes and rejects a native OAuth callback started before migration', async () => {
    const s = await migrated();
    const before = await s.store.get(original.id);
    await s.store.put({
      state: 'pending-native', providerId: 'fixture', ownerId: 'local', scopes: ['read'],
      intent: 'add_scopes', existingConnectionId: original.id, authConfigId: original.authConfigId,
      redirectUri: 'https://app.example/native-callback', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
    await expect(s.runtime.completeAuth({ code: 'native-code', state: 'pending-native' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await s.store.take('pending-native')).toBeNull();
    expect(await s.store.get(original.id)).toEqual(before);
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['fixture.raw_http', 'fixture.raw_token'])('does not expose native credentials to %s', async (actionId) => {
    const s = await migrated();
    expect(await s.runtime.runAction(actionId, {})).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
  });

  it('leaves transport health to the host and never heals a reconnect state from a local token', async () => {
    const s = await migrated();
    expect(await s.runtime.testConnection(original.id)).toMatchObject({ ok: true, verified: false });
    await s.store.setStatus(original.id, 'needs_reauth');
    expect(await s.runtime.testConnection(original.id)).toMatchObject({ ok: false, status: 'needs_reauth', verified: false });
    expect((await s.store.get(original.id))?.connection.status).toBe('needs_reauth');
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('disconnects locally without opening or revoking the historical OAuth config', async () => {
    const s = await migrated();
    await s.runtime.disconnectConnection(original.id);
    expect(await s.store.get(original.id)).toBeNull();
    expect(s.authConfigs.openConfigForConnection).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('continues to reject mismatched configs for native providers', async () => {
    const registry = createRegistry();
    registry.addBundle({
      provider: defineProvider({ id: 'fixture', displayName: 'Native Fixture', auth: bearer() }),
      toolkits: [defineToolkit({ id: 'fixture', providerId: 'fixture', displayName: 'Fixture', actions: [action({
        id: 'fixture.read', description: 'Native read', input: z.object({}), mutating: false,
        async execute() { throw new Error('Must fail before execute'); },
      })] })],
    });
    const store = inMemoryStore();
    const secretBox = plaintextSecretBox();
    await store.save({ ...original, status: 'active' }, await secretBox.seal({ type: 'bearer', token: 'native-bearer' }));
    const runtime = createConnectorRuntime({ registry, store, authRequests: store, secretBox, authConfigs: staticAuthConfigs([nativeConfig]) });
    expect(await runtime.runAction('fixture.read', {})).toMatchObject({
      ok: false, code: 'internal_error', message: expect.stringContaining('does not match'),
    });
  });
});
