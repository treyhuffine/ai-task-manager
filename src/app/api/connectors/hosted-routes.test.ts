import { ensureHostedMcpServer } from '@/lib/connectors/hosted-mcp';
import { mcpServerStore, type McpServerStore } from '@/lib/connectors/mcp-servers';
import { AuthConfigRequiredError, ConnectorError, fileLock, type Connection, type ConnectionStore, type ResolvedAuthConfig, type StoredConnection } from '@connectors/engine';
import { getHostedMcpProvider, HOSTED_MCP_PROVIDERS } from '@connectors/engine/providers';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  runtime: vi.fn(), connectionStore: vi.fn(), serverStore: vi.fn(), invalidate: vi.fn(),
  begin: vi.fn(), buildCredential: vi.fn(), deleteChannels: vi.fn(),
  selectConfig: vi.fn(), configLock: vi.fn(),
}));
vi.mock('@/lib/connectors/runtime', () => ({
  getConnectorRuntime: mocked.runtime,
  getConnectorConnectionStore: mocked.connectionStore,
  getConnectorOwnerId: () => 'local',
  getMcpServerStore: mocked.serverStore,
  invalidateConnectorRuntime: mocked.invalidate,
  buildCredential: mocked.buildCredential,
  selectHostedOAuthConfig: mocked.selectConfig,
  withHostedOAuthConfigLock: mocked.configLock,
}));
vi.mock('@/lib/connectors/mcp-authorization', () => ({ beginMcpAuthorization: mocked.begin }));
vi.mock('@connectors/engine/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@connectors/engine/providers')>();
  return { ...actual, getHostedMcpProvider: (id: string) => id === 'public-fixture'
    ? { id, displayName: 'Public fixture', url: 'https://public.example/mcp', auth: { kind: 'none' as const } }
    : actual.getHostedMcpProvider(id) };
});
vi.mock('@/lib/db/queries', () => ({ deleteChannelsForConnection: mocked.deleteChannels }));
vi.mock('@/lib/connectors/desktop-oauth', () => ({
  isDesktopRequest: () => false,
  desktopOAuth: vi.fn(),
  desktopRelayFor: vi.fn(),
}));

import { POST as connect } from './connect/route';
import { POST as connectDirect } from './connectDirect/route';
import { POST as disconnect } from './disconnect/route';
import { PATCH as patchServer } from './mcp-servers/[id]/route';

const definition = getHostedMcpProvider('todoist')!;
const oauthProviderIds = HOSTED_MCP_PROVIDERS.filter((provider) => (provider.auth?.kind ?? 'oauth') === 'oauth').map((provider) => provider.id);
const publicProviderIds = HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'none').map((provider) => provider.id);
const bearerProviderIds = HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'bearer').map((provider) => provider.id);
const registeredProviderIds = HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'oauth' && provider.auth.registration === 'registered').map((provider) => provider.id);
function selectedEndpoint(providerId: string): { selection: { endpointId?: string; instanceUrl?: string }; url: string } {
  const provider = getHostedMcpProvider(providerId)!;
  if (provider.endpoint?.kind === 'region') {
    const option = provider.endpoint.options[0]!;
    return { selection: { endpointId: option.id }, url: option.url };
  }
  if (provider.endpoint?.kind === 'instance') {
    const instanceUrl = 'https://workflow.example/instance';
    return { selection: { instanceUrl }, url: `${instanceUrl}${provider.endpoint.path}` };
  }
  if (!provider.url) throw new Error(`Fixture requires explicit selection for ${providerId}`);
  return { selection: {}, url: provider.url };
}
let dir: string;
let servers: McpServerStore;
let connections: ConnectionStore;
let rows: Map<string, StoredConnection>;
let nativeDisconnect: ReturnType<typeof vi.fn>;
let oauthApps: Map<string, ResolvedAuthConfig>;

function oauthApp(providerId: string, id = `${providerId}-app`): ResolvedAuthConfig {
  return {
    config: { id, providerId, scheme: 'oauth2', scope: 'owner', ownerId: 'local', status: 'active',
      oauth: { clientId: `${id}-client`, redirectUri: `http://localhost:42241/api/connectors/mcp-oauth/builtin_${providerId}` } },
    clientSecret: `${id}-secret`,
  };
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'legacy-todoist', ownerId: 'local', providerId: 'todoist', accountId: 'saved-account',
    status: 'needs_reauth', scopes: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function request(endpoint: string, body: unknown) {
  return new NextRequest(`http://localhost:42241/api/connectors/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-routes-test-'));
  servers = mcpServerStore({
    dir,
    secretBox: { seal: async (value) => value, open: async <T,>(value: unknown) => value as T },
    lock: fileLock({ dir: path.join(dir, 'locks') }),
  });
  rows = new Map();
  connections = {
    list: vi.fn(async (filter) => [...rows.values()].map((row) => row.connection).filter((row) =>
      (!filter?.ownerId || row.ownerId === filter.ownerId) && (!filter?.providerId || row.providerId === filter.providerId),
    )),
    get: vi.fn(async (id) => rows.get(id) ?? null),
    save: vi.fn(async (saved, sealed) => { rows.set(saved.id, { connection: saved, sealed }); }),
    setStatus: vi.fn(async (id, status) => { const row = rows.get(id); if (row) row.connection.status = status; }),
    delete: vi.fn(async (id) => { rows.delete(id); }),
  };
  nativeDisconnect = vi.fn();
  mocked.runtime.mockResolvedValue({ disconnectConnection: nativeDisconnect });
  mocked.connectionStore.mockReturnValue(connections);
  mocked.serverStore.mockReturnValue(servers);
  mocked.begin.mockResolvedValue({ requiresAuth: true, authUrl: 'https://todoist.com/oauth/authorize?state=fixture', desktopFlowId: 'desktop-flow' });
  oauthApps = new Map(registeredProviderIds.map(providerId => [`${providerId}-app`, oauthApp(providerId)]));
  mocked.selectConfig.mockImplementation(async (providerId: string, id?: string) => {
    const selected = oauthApps.get(id ?? `${providerId}-app`);
    if (!selected || selected.config.providerId !== providerId || selected.config.status !== 'active') {
      throw new ConnectorError(id ? 'auth_config_unavailable' : 'provider_not_configured', 'Configure an active OAuth app');
    }
    return selected;
  });
  mocked.configLock.mockImplementation(async <T,>(_id: string, fn: () => Promise<T>) => fn());
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('hosted connect route', () => {
  it.each(oauthProviderIds)('uses the pinned OAuth service for %s', async (providerId) => {
    const { selection, url } = selectedEndpoint(providerId);
    const req = request('connect', { providerId, ...selection });
    const response = await connect(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authorizationUrl: expect.stringContaining('https://'), desktopFlowId: 'desktop-flow' });
    expect(servers.list()).toHaveLength(1);
    expect(servers.list()[0]).toMatchObject({ providerId, url, auth: { kind: 'oauth' } });
    if (registeredProviderIds.includes(providerId)) {
      expect(servers.list()[0]?.authConfigId).toBe(`${providerId}-app`);
      expect(mocked.selectConfig).toHaveBeenNthCalledWith(1, providerId, undefined);
      expect(mocked.selectConfig).toHaveBeenNthCalledWith(2, providerId, `${providerId}-app`);
      expect(mocked.configLock).toHaveBeenCalledExactlyOnceWith(`${providerId}-app`, expect.any(Function));
    } else {
      expect(mocked.selectConfig).not.toHaveBeenCalled();
      expect(mocked.configLock).not.toHaveBeenCalled();
    }
    expect(mocked.begin).toHaveBeenCalledExactlyOnceWith(servers.list()[0], expect.objectContaining({ headers: req.headers, url: req.url }), undefined);
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it.each(registeredProviderIds)('requires a configured OAuth app for %s before saving or authorizing', async (providerId) => {
    oauthApps.clear();
    const response = await connect(request('connect', { providerId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'provider_not_configured' });
    expect(servers.list()).toHaveLength(0);
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it.each(['box-app', 'missing-app', 'disabled-app'])('rejects an unavailable or cross-provider OAuth app %s', async (authConfigId) => {
    const disabled = oauthApp('twitter', 'disabled-app');
    disabled.config.status = 'disabled';
    oauthApps.set(disabled.config.id, disabled);
    const response = await connect(request('connect', { providerId: 'twitter', authConfigId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'auth_config_unavailable' });
    expect(servers.list()).toHaveLength(0);
    expect(mocked.begin).not.toHaveBeenCalled();
  });

  it('returns named OAuth app choices without selecting one or exposing a secret', async () => {
    const choices = [{ authConfigId: 'work', label: 'Work' }, { authConfigId: 'personal', label: 'Personal' }];
    mocked.selectConfig.mockRejectedValue(new AuthConfigRequiredError('twitter', choices));
    const response = await connect(request('connect', { providerId: 'twitter' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'auth_config_required', choices });
    expect(servers.list()).toHaveLength(0);
    expect(mocked.begin).not.toHaveBeenCalled();
  });

  it('revalidates the selected OAuth app inside its deletion lock before server creation', async () => {
    mocked.configLock.mockImplementation(async <T,>(id: string, fn: () => Promise<T>) => {
      oauthApps.delete(id);
      return fn();
    });
    const response = await connect(request('connect', { providerId: 'twitter' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'auth_config_unavailable' });
    expect(mocked.selectConfig).toHaveBeenCalledTimes(2);
    expect(servers.list()).toHaveLength(0);
    expect(mocked.begin).not.toHaveBeenCalled();
  });

  it('reconnects through the bound app even if the default changes and rejects a requested switch', async () => {
    const personal = oauthApp('twitter', 'personal-app');
    oauthApps.set(personal.config.id, personal);
    expect((await connect(request('connect', { providerId: 'twitter', authConfigId: personal.config.id }))).status).toBe(200);
    const original = servers.list()[0]!;
    await servers.setOAuthState(original.id, { clientInformation: { client_id: personal.config.oauth!.clientId }, tokens: { access_token: 'personal-token' } });
    mocked.begin.mockClear();
    mocked.selectConfig.mockClear();
    const retried = await connect(request('connect', { providerId: 'twitter' }));
    expect(retried.status).toBe(200);
    expect(mocked.selectConfig).toHaveBeenNthCalledWith(1, 'twitter', personal.config.id);
    expect(mocked.begin.mock.calls[0]?.[0]).toMatchObject({ id: original.id, authConfigId: personal.config.id });
    mocked.begin.mockClear();
    const changed = await connect(request('connect', { providerId: 'twitter', authConfigId: 'twitter-app' }));
    expect(changed.status).toBe(400);
    expect(await changed.json()).toEqual({ error: 'Disconnect this connector before changing its OAuth app.' });
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(await servers.getOAuthState(original.id)).toMatchObject({ tokens: { access_token: 'personal-token' } });
  });

  it('never falls back to another OAuth app if the existing bound app disappears', async () => {
    expect((await connect(request('connect', { providerId: 'twitter' }))).status).toBe(200);
    const original = servers.list()[0]!;
    await servers.setOAuthState(original.id, { tokens: { access_token: 'old-bound-token' } });
    oauthApps.delete('twitter-app');
    oauthApps.set('replacement', oauthApp('twitter', 'replacement'));
    mocked.begin.mockClear();
    const response = await connect(request('connect', { providerId: 'twitter' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'auth_config_unavailable' });
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(servers.get(original.id)?.authConfigId).toBe('twitter-app');
  });

  it('accepts only one of two concurrent client choices without starting auth for the losing app', async () => {
    oauthApps.set('second-app', oauthApp('twitter', 'second-app'));
    const responses = await Promise.all([
      connect(request('connect', { providerId: 'twitter', authConfigId: 'twitter-app' })),
      connect(request('connect', { providerId: 'twitter', authConfigId: 'second-app' })),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    expect(servers.list()).toHaveLength(1);
    expect(mocked.begin).toHaveBeenCalledOnce();
    expect(mocked.begin.mock.calls[0]?.[0].authConfigId).toBe(servers.list()[0]?.authConfigId);
  });

  it('creates fresh authority for another app after disconnecting and erases the old OAuth state', async () => {
    expect((await connect(request('connect', { providerId: 'dropbox' }))).status).toBe(200);
    const original = servers.list()[0]!;
    await servers.setOAuthState(original.id, { clientInformation: { client_id: 'old-client' }, tokens: { access_token: 'old-token' } });
    expect((await disconnect(request('disconnect', { id: original.connectionId }))).status).toBe(200);
    oauthApps.set('new-app', oauthApp('dropbox', 'new-app'));
    expect((await connect(request('connect', { providerId: 'dropbox', authConfigId: 'new-app' }))).status).toBe(200);
    const replacement = servers.list()[0]!;
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.authConfigId).toBe('new-app');
    expect(await servers.getOAuthState(original.id)).toBeNull();
    expect(await servers.getOAuthState(replacement.id)).toBeNull();
    expect(nativeDisconnect).not.toHaveBeenCalled();
  });

  it.each([
    { providerId: 'intercom' },
    { providerId: 'intercom', endpointId: 'unknown' },
    { providerId: 'intercom', instanceUrl: 'https://attacker.example' },
    { providerId: 'n8n' },
    { providerId: 'n8n', instanceUrl: 'http://remote.example' },
    { providerId: 'n8n', instanceUrl: 'https://workflow.example?token=secret' },
    { providerId: 'n8n', instanceUrl: 'https://user:secret@workflow.example' },
    { providerId: 'todoist', instanceUrl: 'https://attacker.example' },
    { providerId: 'paypal' },
    { providerId: 'paypal', endpointId: 'unknown' },
    { providerId: 'paypal', instanceUrl: 'https://attacker.example' },
    { providerId: 'docusign' },
    { providerId: 'docusign', endpointId: 'unknown' },
    { providerId: 'docusign', instanceUrl: 'https://attacker.example' },
  ])('rejects missing or invalid endpoint selection before authorization: %j', async (body) => {
    const response = await connect(request('connect', body));
    expect(response.status).toBe(400);
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.runtime).not.toHaveBeenCalled();
    expect(servers.list()).toHaveLength(0);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });

  it.each([
    { providerId: 'intercom', initial: { endpointId: 'eu' }, replacement: { endpointId: 'us' }, url: 'https://mcp.eu.intercom.com/mcp' },
    { providerId: 'n8n', initial: { instanceUrl: 'https://one.example' }, replacement: { instanceUrl: 'https://two.example' }, url: 'https://one.example/mcp-server/http' },
    { providerId: 'paypal', initial: { endpointId: 'sandbox' }, replacement: { endpointId: 'production' }, url: 'https://mcp.sandbox.paypal.com/mcp' },
    { providerId: 'docusign', initial: { endpointId: 'demo' }, replacement: { endpointId: 'production' }, url: 'https://mcp-d.docusign.com/mcp' },
  ])('keeps $providerId retries and stored credentials on the selected endpoint', async ({ providerId, initial, replacement, url }) => {
    const firstResponse = await connect(request('connect', { providerId, ...initial }));
    expect(firstResponse.status).toBe(200);
    const original = servers.list()[0]!;
    await servers.setOAuthState(original.id, { clientInformation: { client_id: 'original-client' }, tokens: { access_token: 'original-token' } });
    const savedOAuth = await servers.getOAuthState(original.id);
    mocked.begin.mockClear();
    const changed = await connect(request('connect', { providerId, ...replacement }));
    expect(changed.status).toBe(400);
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(servers.get(original.id)?.url).toBe(url);
    expect(await servers.getOAuthState(original.id)).toEqual(savedOAuth);
    const retried = await connect(request('connect', { providerId }));
    expect(retried.status).toBe(200);
    expect(mocked.begin).toHaveBeenCalledOnce();
    expect(mocked.begin.mock.calls[0]?.[0]).toMatchObject({ id: original.id, url, accountId: original.accountId });
  });

  it('permits a new region only after disconnect and never carries the previous region OAuth state across', async () => {
    expect((await connect(request('connect', { providerId: 'intercom', endpointId: 'eu' }))).status).toBe(200);
    const original = servers.list()[0]!;
    await servers.setOAuthState(original.id, { clientInformation: { client_id: 'eu-client' }, tokens: { access_token: 'eu-token' } });
    expect((await disconnect(request('disconnect', { id: original.connectionId }))).status).toBe(200);
    expect((await connect(request('connect', { providerId: 'intercom', endpointId: 'us' }))).status).toBe(200);
    const replacement = servers.list()[0]!;
    expect(replacement.url).toBe('https://mcp.intercom.com/mcp');
    expect(replacement.accountId).not.toBe(original.accountId);
    expect(await servers.getOAuthState(replacement.id)).toBeNull();
    expect(await servers.getOAuthState(original.id)).toBeNull();
    expect(mocked.begin.mock.calls.at(-1)?.[0].id).toBe(replacement.id);
  });

  it.each([...bearerProviderIds, 'public-fixture', ...publicProviderIds])('does not start browser authorization for %s', async (providerId) => {
    const response = await connect(request('connect', { providerId }));
    expect(response.status).toBe(400);
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(servers.list()).toHaveLength(0);
  });
  it('creates the pinned hosted entry, preserves legacy identity, and returns the normal sign-in response', async () => {
    const old = connection();
    await connections.save(old, 'sealed-legacy-token');
    const req = request('connect', { providerId: 'todoist', returnTo: '/welcome?step=connect' });
    const response = await connect(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requiresAuth: true,
      serverId: expect.any(String),
      authUrl: 'https://todoist.com/oauth/authorize?state=fixture',
      authorizationUrl: 'https://todoist.com/oauth/authorize?state=fixture',
      desktopFlowId: 'desktop-flow',
    });
    const entry = servers.list()[0];
    expect(entry).toMatchObject({ providerId: 'todoist', connectionId: old.id, accountId: old.accountId, url: definition.url, auth: { kind: 'oauth' } });
    expect(mocked.begin).toHaveBeenCalledExactlyOnceWith(entry, expect.objectContaining({ headers: req.headers, url: req.url }), '/welcome?step=connect');
    expect(mocked.runtime).not.toHaveBeenCalled();
    expect(mocked.invalidate).toHaveBeenCalledOnce();
  });

  it('reuses the staged entry when authorization fails and the user retries', async () => {
    mocked.begin.mockRejectedValueOnce(new Error('Authorization service unavailable'));
    const failed = await connect(request('connect', { providerId: 'todoist' }));
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: 'Authorization service unavailable' });
    const staged = servers.list()[0]!;
    const retried = await connect(request('connect', { providerId: 'todoist' }));
    expect(retried.status).toBe(200);
    expect(servers.list()).toHaveLength(1);
    expect(mocked.begin.mock.calls[1]?.[0].id).toBe(staged.id);
  });

  it('supports an existing authorization without requiring a redirect', async () => {
    mocked.begin.mockResolvedValue({ requiresAuth: false });
    const response = await connect(request('connect', { providerId: 'todoist' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requiresAuth: false, serverId: expect.any(String) });
    expect(mocked.invalidate).toHaveBeenCalledOnce();
  });

  it('never forwards an off-site return path to hosted authorization', async () => {
    const response = await connect(request('connect', { providerId: 'todoist', returnTo: '//attacker.example' }));
    expect(response.status).toBe(200);
    expect(mocked.begin.mock.calls[0]?.[2]).toBeFalsy();
  });
});

function successfulDiscovery() {
  mocked.runtime.mockImplementation(async () => {
    for (const entry of servers.list()) {
      await servers.setHealth(entry.id, { lastStatus: 'ok', lastCheckedAt: 'then', lastToolCount: 1 });
      await connections.save(connection({ id: entry.connectionId!, providerId: entry.providerId!, accountId: entry.accountId!, status: 'active' }), 'sealed-derived-placeholder');
    }
    return { disconnectConnection: nativeDisconnect };
  });
}

describe('hosted direct connection flow', () => {
  it.each(publicProviderIds)('connects the pinned public catalog service %s without credentials', async (providerId) => {
    successfulDiscovery();
    const response = await connectDirect(request('connectDirect', { providerId, fields: {} }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connection: { id: `hosted-${providerId}`, providerId, status: 'active' } });
    expect(servers.list()).toHaveLength(1);
    const entry = servers.list()[0]!;
    expect(entry).toMatchObject({ providerId, url: getHostedMcpProvider(providerId)!.url, auth: { kind: 'none' } });
    expect(await servers.openSecret(entry.id)).toBeNull();
    expect(await servers.getOAuthState(entry.id)).toBeNull();
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.buildCredential).not.toHaveBeenCalled();
  });

  it.each(publicProviderIds)('rejects credentials for the public catalog service %s', async (providerId) => {
    const response = await connectDirect(request('connectDirect', { providerId, fields: { token: 'unneeded' } }));
    expect(response.status).toBe(400);
    expect(servers.list()).toHaveLength(0);
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it.each(bearerProviderIds)('connects %s with a stored bearer credential and no native credential path', async (providerId) => {
    successfulDiscovery();
    const { selection, url } = selectedEndpoint(providerId);
    const response = await connectDirect(request('connectDirect', { providerId, ...selection, fields: { token: '  fixture-connection-token  ' } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ connection: { id: `hosted-${providerId}`, providerId, status: 'active' } });
    expect(JSON.stringify(body)).not.toContain('fixture-connection-token');
    expect(JSON.stringify(body)).not.toContain('sealed');
    const entry = servers.list()[0]!;
    expect(entry).toMatchObject({ providerId, url, auth: { kind: 'bearer' } });
    expect(await servers.openSecret(entry.id)).toBe('fixture-connection-token');
    expect(mocked.buildCredential).not.toHaveBeenCalled();
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.invalidate).toHaveBeenCalledOnce();
  });

  it('requires a Smartsheet region and cannot replace its token while switching that region', async () => {
    successfulDiscovery();
    const missing = await connectDirect(request('connectDirect', { providerId: 'smartsheet', fields: { token: 'initial-token' } }));
    expect(missing.status).toBe(400);
    expect(servers.list()).toHaveLength(0);
    expect(mocked.runtime).not.toHaveBeenCalled();
    const created = await connectDirect(request('connectDirect', { providerId: 'smartsheet', endpointId: 'eu', fields: { token: 'europe-token' } }));
    expect(created.status).toBe(200);
    const original = servers.list()[0]!;
    expect(original.url).toBe('https://mcp.smartsheet.eu');
    mocked.runtime.mockClear();
    const switched = await connectDirect(request('connectDirect', {
      providerId: 'smartsheet', serverId: original.id, existingConnectionId: original.connectionId,
      endpointId: 'us', fields: { token: 'replacement-token' },
    }));
    expect(switched.status).toBe(400);
    expect(await switched.json()).toEqual({ error: 'Disconnect this connector before changing its region or instance.' });
    expect(servers.get(original.id)?.url).toBe('https://mcp.smartsheet.eu');
    expect(await servers.openSecret(original.id)).toBe('europe-token');
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it.each(bearerProviderIds)('requires a nonempty string token for %s before creating state', async (providerId) => {
    for (const token of [undefined, '', '  ', 42]) {
      const response = await connectDirect(request('connectDirect', { providerId, fields: { token } }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'A connection token is required.' });
    }
    expect(servers.list()).toHaveLength(0);
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it('rotates a bearer token while preserving the existing connection identity', async () => {
    successfulDiscovery();
    await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'first-token' } }));
    const original = servers.list()[0]!;
    const response = await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'second-token' } }));
    expect(response.status).toBe(200);
    expect(servers.list()).toHaveLength(1);
    expect(servers.get(original.id)).toMatchObject({ connectionId: original.connectionId, accountId: original.accountId });
    expect(servers.get(original.id)?.credentialRevision).not.toBe(original.credentialRevision);
    expect(await servers.openSecret(original.id)).toBe('second-token');
  });

  it('does not report successful connection when discovery fails and redacts transport token echoes', async () => {
    mocked.runtime.mockImplementation(async () => {
      const entry = servers.list()[0]!;
      await servers.setHealth(entry.id, { lastStatus: 'unreachable', lastError: 'Rejected fixture-token by service', lastCheckedAt: 'then' });
      return {};
    });
    const response = await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'fixture-token' } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Rejected [REDACTED] by service' });
    expect(rows.size).toBe(0);
  });

  it('does not accept a successful discovery for a token replaced during the request', async () => {
    mocked.runtime.mockImplementation(async () => {
      const entry = servers.list()[0]!;
      await servers.update(entry.id, { secret: 'newer-token' });
      await servers.setHealth(entry.id, { lastStatus: 'ok', lastCheckedAt: 'then' });
      return {};
    });
    const response = await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'older-token' } }));
    expect(response.status).toBe(409);
    expect(await servers.openSecret(servers.list()[0]!.id)).toBe('newer-token');
  });

  it('does not report success when disconnected during discovery', async () => {
    mocked.runtime.mockImplementation(async () => { await servers.remove(servers.list()[0]!.id); return {}; });
    const response = await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'fixture-token' } }));
    expect(response.status).toBe(409);
    expect(servers.list()).toHaveLength(0);
  });

  it('connects a catalog-selected public service without creating a secret or requiring browser auth', async () => {
    successfulDiscovery();
    const response = await connectDirect(request('connectDirect', { providerId: 'public-fixture', fields: {} }));
    expect(response.status).toBe(200);
    const entry = servers.list()[0]!;
    expect(entry).toMatchObject({ providerId: 'public-fixture', auth: { kind: 'none' } });
    expect(await servers.openSecret(entry.id)).toBeNull();
    expect(await servers.getOAuthState(entry.id)).toBeNull();
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.buildCredential).not.toHaveBeenCalled();
  });

  it('rejects credentials posted to a public service', async () => {
    const response = await connectDirect(request('connectDirect', { providerId: 'public-fixture', fields: { token: 'unneeded' } }));
    expect(response.status).toBe(400);
    expect(servers.list()).toHaveLength(0);
    expect(mocked.runtime).not.toHaveBeenCalled();
  });
});

it.each(oauthProviderIds)('rejects pasted %s tokens before constructing a runtime or credential', async (providerId) => {
  const response = await connectDirect(request('connectDirect', { providerId, fields: { apiKey: 'legacy-token' } }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'This connector uses browser sign-in. Connect it from Settings.' });
  expect(mocked.runtime).not.toHaveBeenCalled();
  expect(mocked.buildCredential).not.toHaveBeenCalled();
  expect(servers.list()).toHaveLength(0);
});

describe('hosted disconnect route', () => {
  it('disables the authority and invalidates the derived connection through the MCP settings route', async () => {
    successfulDiscovery();
    await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'fixture-token' } }));
    const entry = servers.list()[0]!;
    const response = await patchServer(request(`mcp-servers/${entry.id}`, { enabled: false }), { params: Promise.resolve({ id: entry.id }) });
    expect(response.status).toBe(200);
    expect(servers.get(entry.id)?.enabled).toBe(false);
    expect((await connections.get(entry.connectionId!))?.connection.status).toBe('needs_reauth');
    expect(await servers.openSecret(entry.id)).toBe('fixture-token');
  });

  it('does not allow the generic MCP route to change a named connector endpoint or credential', async () => {
    const entry = await ensureHostedMcpServer(getHostedMcpProvider('github')!, servers, connections, 'local', { secret: 'original-token' });
    for (const patch of [{ url: 'https://attacker.example/mcp' }, { auth: { kind: 'none' } }, { secret: 'replacement' }]) {
      const response = await patchServer(request(`mcp-servers/${entry.id}`, patch), { params: Promise.resolve({ id: entry.id }) });
      expect(response.status).toBe(400);
    }
    expect(servers.get(entry.id)?.url).toBe(getHostedMcpProvider('github')!.url);
    expect(await servers.openSecret(entry.id)).toBe('original-token');
  });
  it.each(bearerProviderIds)('removes %s and its stored bearer token without calling native disconnect', async (providerId) => {
    successfulDiscovery();
    const { selection } = selectedEndpoint(providerId);
    await connectDirect(request('connectDirect', { providerId, ...selection, fields: { token: 'fixture-token' } }));
    const entry = servers.list()[0]!;
    const response = await disconnect(request('disconnect', { id: entry.connectionId }));
    expect(response.status).toBe(200);
    expect(await servers.openSecret(entry.id)).toBeNull();
    expect(servers.get(entry.id)).toBeNull();
    expect(await connections.get(entry.connectionId!)).toBeNull();
    expect(nativeDisconnect).not.toHaveBeenCalled();
  });
  it('removes the authoritative entry and sealed OAuth state so a rebuild cannot resurrect it', async () => {
    const old = connection();
    await connections.save(old, 'sealed-legacy-token');
    const entry = await ensureHostedMcpServer(definition, servers, connections, 'local');
    await servers.setOAuthState(entry.id, { tokens: { access_token: 'fixture-token' } });
    const response = await disconnect(request('disconnect', { id: old.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(servers.list()).toHaveLength(0);
    expect(await servers.getOAuthState(entry.id)).toBeNull();
    expect(await connections.get(old.id)).toBeNull();
    expect(mocked.invalidate).toHaveBeenCalledOnce();
    expect(mocked.runtime).not.toHaveBeenCalled();
    expect(mocked.deleteChannels).toHaveBeenCalledExactlyOnceWith(old.id);
  });

  it('cleans up a legacy-only connection even though the native Todoist provider is gone', async () => {
    const old = connection();
    await connections.save(old, 'sealed-legacy-token');
    const response = await disconnect(request('disconnect', { id: old.id }));
    expect(response.status).toBe(200);
    expect(await connections.get(old.id)).toBeNull();
    expect(mocked.runtime).not.toHaveBeenCalled();
    expect(mocked.invalidate).toHaveBeenCalledOnce();
    expect(mocked.deleteChannels).toHaveBeenCalledExactlyOnceWith(old.id);
  });

  it.each(['jira', 'confluence'])('cleans up retired %s credentials without routing through the new Atlassian client', async (providerId) => {
    const old = connection({ id: `legacy-${providerId}`, providerId });
    await connections.save(old, 'sealed-old-3lo-token');
    const response = await disconnect(request('disconnect', { id: old.id }));
    expect(response.status).toBe(200);
    expect(await connections.get(old.id)).toBeNull();
    expect(mocked.runtime).not.toHaveBeenCalled();
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.deleteChannels).toHaveBeenCalledExactlyOnceWith(old.id);
  });

  it('cleans up a staged hosted entry even if no derived connection has been ingested yet', async () => {
    const entry = await ensureHostedMcpServer(definition, servers, connections, 'local');
    const response = await disconnect(request('disconnect', { id: entry.connectionId }));
    expect(response.status).toBe(200);
    expect(servers.list()).toHaveLength(0);
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it('does not remove another owner’s saved connection or hosted entry', async () => {
    const old = connection({ ownerId: 'other-owner' });
    await connections.save(old, 'sealed-legacy-token');
    const entry = await ensureHostedMcpServer(definition, servers, connections, 'other-owner');
    const response = await disconnect(request('disconnect', { id: old.id }));
    expect(response.status).toBe(404);
    expect(servers.get(entry.id)).not.toBeNull();
    expect(await connections.get(old.id)).not.toBeNull();
    expect(mocked.invalidate).not.toHaveBeenCalled();
    expect(mocked.deleteChannels).not.toHaveBeenCalled();
  });

  it('keeps the normal engine disconnect flow for other providers', async () => {
    const other = connection({ id: 'google-account', providerId: 'google' });
    await connections.save(other, 'sealed-google-token');
    const response = await disconnect(request('disconnect', { id: other.id }));
    expect(response.status).toBe(200);
    expect(nativeDisconnect).toHaveBeenCalledExactlyOnceWith(other.id);
    expect(mocked.deleteChannels).toHaveBeenCalledExactlyOnceWith(other.id);
  });
});

describe('hosted account selection routes', () => {
  const setupId = 'd8103603-6144-4be6-b7ba-683f32334063';
  async function oauthAccounts(providerId = 'todoist') {
    expect((await connect(request('connect', { providerId, label: 'Personal' }))).status).toBe(200);
    const personal = servers.list()[0]!;
    expect((await connect(request('connect', { providerId, addAccount: true, setupId, label: 'Work' }))).status).toBe(200);
    const work = servers.list().find(entry => entry.id !== personal.id)!;
    await servers.setOAuthState(personal.id, { tokens: { access_token: 'personal-account-token' } });
    await servers.setOAuthState(work.id, { tokens: { access_token: 'work-account-token' } });
    mocked.begin.mockClear();
    mocked.selectConfig.mockClear();
    mocked.invalidate.mockClear();
    return { personal, work };
  }
  async function bearerAccounts() {
    successfulDiscovery();
    expect((await connectDirect(request('connectDirect', { providerId: 'github', label: 'Personal', fields: { token: 'personal-account-token' } }))).status).toBe(200);
    const personal = servers.list()[0]!;
    expect((await connectDirect(request('connectDirect', { providerId: 'github', addAccount: true, setupId, label: 'Work', fields: { token: 'work-account-token' } }))).status).toBe(200);
    const work = servers.list().find(entry => entry.id !== personal.id)!;
    mocked.invalidate.mockClear();
    mocked.runtime.mockClear();
    return { personal, work };
  }

  it.each([
    { providerId: 'paypal', productionUrl: 'https://mcp.paypal.com/mcp', otherEnvironment: 'sandbox', otherUrl: 'https://mcp.sandbox.paypal.com/mcp' },
    { providerId: 'docusign', productionUrl: 'https://mcp.docusign.com/mcp', otherEnvironment: 'demo', otherUrl: 'https://mcp-d.docusign.com/mcp' },
  ])('keeps $providerId production and test accounts independently bound through reconnect', async ({ providerId, productionUrl, otherEnvironment, otherUrl }) => {
    expect((await connect(request('connect', { providerId, endpointId: 'production', label: 'Production' }))).status).toBe(200);
    const production = servers.list()[0]!;
    await servers.setOAuthState(production.id, { tokens: { access_token: 'production-token', refresh_token: 'production-refresh', token_type: 'Bearer' } });
    const productionOAuth = await servers.getOAuthState(production.id);
    mocked.begin.mockClear();

    // A new account must not silently inherit the first account's environment.
    const missingEnvironment = await connect(request('connect', { providerId, addAccount: true, setupId, label: 'Test' }));
    expect(missingEnvironment.status).toBe(400);
    expect(servers.list()).toHaveLength(1);
    expect(mocked.begin).not.toHaveBeenCalled();

    const registered = registeredProviderIds.includes(providerId);
    const authConfigId = `${providerId}-test-app`;
    if (registered) oauthApps.set(authConfigId, oauthApp(providerId, authConfigId));
    const added = await connect(request('connect', {
      providerId, addAccount: true, setupId, label: 'Test', endpointId: otherEnvironment,
      ...(registered ? { authConfigId } : {}),
    }));
    expect(added.status).toBe(200);
    const testAccount = servers.list().find(entry => entry.id !== production.id)!;
    expect(await added.json()).toMatchObject({ serverId: testAccount.id });
    expect(servers.list()).toHaveLength(2);
    expect(production.url).toBe(productionUrl);
    expect(testAccount).toMatchObject({ url: otherUrl, displayName: 'Test', ...(registered ? { authConfigId } : {}) });
    expect(testAccount.connectionId).not.toBe(production.connectionId);
    expect(testAccount.accountId).not.toBe(production.accountId);
    expect(mocked.begin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: testAccount.id, url: otherUrl }), expect.objectContaining({ headers: expect.any(Headers), url: expect.stringContaining('/api/connectors/connect') }), undefined);
    expect(await servers.getOAuthState(production.id)).toEqual(productionOAuth);
    expect(await servers.getOAuthState(testAccount.id)).toBeNull();

    await servers.setOAuthState(testAccount.id, { tokens: { access_token: 'test-token', token_type: 'Bearer' } });
    const testOAuth = await servers.getOAuthState(testAccount.id);
    mocked.begin.mockClear();
    mocked.selectConfig.mockClear();
    expect((await connect(request('connect', { providerId, serverId: testAccount.id }))).status).toBe(200);
    expect(mocked.begin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: testAccount.id, url: otherUrl, ...(registered ? { authConfigId } : {}),
    }), expect.objectContaining({ headers: expect.any(Headers), url: expect.stringContaining('/api/connectors/connect') }), undefined);
    if (registered) expect(mocked.selectConfig).toHaveBeenNthCalledWith(1, providerId, authConfigId);
    else expect(mocked.selectConfig).not.toHaveBeenCalled();

    mocked.begin.mockClear();
    const switched = await connect(request('connect', { providerId, serverId: testAccount.id, endpointId: 'production' }));
    expect(switched.status).toBe(400);
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(servers.get(testAccount.id)?.url).toBe(otherUrl);
    expect(await servers.getOAuthState(testAccount.id)).toEqual(testOAuth);
    expect(await servers.getOAuthState(production.id)).toEqual(productionOAuth);
  });

  it.each(['todoist', 'twitter'])('requires explicit selection before reconnecting either %s account', async providerId => {
    const { personal, work } = await oauthAccounts(providerId);
    const response = await connect(request('connect', { providerId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'account_required' });
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.selectConfig).not.toHaveBeenCalled();
    expect(mocked.invalidate).not.toHaveBeenCalled();
    expect(await servers.getOAuthState(personal.id)).toMatchObject({ tokens: { access_token: 'personal-account-token' } });
    expect(await servers.getOAuthState(work.id)).toMatchObject({ tokens: { access_token: 'work-account-token' } });
  });

  it.each(['server', 'connection', 'both'])('reconnects only the chosen OAuth account when selected by %s', async selection => {
    const { personal, work } = await oauthAccounts();
    const response = await connect(request('connect', {
      providerId: 'todoist', ...(selection !== 'connection' ? { serverId: work.id } : {}),
      ...(selection !== 'server' ? { existingConnectionId: work.connectionId } : {}),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ serverId: work.id });
    expect(mocked.begin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: work.id, connectionId: work.connectionId }), expect.objectContaining({ headers: expect.any(Headers), url: expect.stringContaining('/api/connectors/connect') }), undefined);
    expect(servers.list()).toHaveLength(2);
    expect(await servers.getOAuthState(personal.id)).toMatchObject({ tokens: { access_token: 'personal-account-token' } });
  });

  it('rejects contradictory OAuth server and connection choices instead of choosing either account', async () => {
    const { personal, work } = await oauthAccounts();
    const response = await connect(request('connect', { providerId: 'todoist', serverId: personal.id, existingConnectionId: work.connectionId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'connection_not_found' });
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(mocked.invalidate).not.toHaveBeenCalled();
  });

  it('does not reconnect a deleted, cross-provider or foreign-owner account', async () => {
    const { personal, work } = await oauthAccounts();
    const other = await ensureHostedMcpServer(getHostedMcpProvider('notion')!, servers, connections, 'local');
    await connections.save(connection({ id: work.connectionId, providerId: 'todoist', ownerId: 'other-owner' }), 'sealed-foreign');
    for (const serverId of ['removed-account', other.id, work.id]) {
      const response = await connect(request('connect', { providerId: 'todoist', serverId }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'connection_not_found' });
    }
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(await servers.getOAuthState(personal.id)).toMatchObject({ tokens: { access_token: 'personal-account-token' } });
  });

  it('retains each registered account app when the accounts use different clients', async () => {
    oauthApps.set('work-app', oauthApp('twitter', 'work-app'));
    expect((await connect(request('connect', { providerId: 'twitter', label: 'Personal' }))).status).toBe(200);
    const personal = servers.list()[0]!;
    expect((await connect(request('connect', { providerId: 'twitter', addAccount: true, setupId, label: 'Work', authConfigId: 'work-app' }))).status).toBe(200);
    const work = servers.list().find(entry => entry.id !== personal.id)!;
    mocked.selectConfig.mockClear();
    mocked.begin.mockClear();
    const response = await connect(request('connect', { providerId: 'twitter', serverId: work.id }));
    expect(response.status).toBe(200);
    expect(mocked.selectConfig).toHaveBeenNthCalledWith(1, 'twitter', 'work-app');
    expect(mocked.begin.mock.calls[0]?.[0]).toMatchObject({ id: work.id, authConfigId: 'work-app' });
    mocked.begin.mockClear();
    const mismatched = await connect(request('connect', { providerId: 'twitter', serverId: work.id, authConfigId: personal.authConfigId }));
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toEqual({ error: 'Disconnect this connector before changing its OAuth app.' });
    expect(mocked.begin).not.toHaveBeenCalled();
    expect(servers.get(personal.id)?.authConfigId).toBe('twitter-app');
    expect(servers.get(work.id)?.authConfigId).toBe('work-app');
  });

  it('reuses the same Add account setup after authorization fails instead of creating a third account', async () => {
    expect((await connect(request('connect', { providerId: 'todoist', label: 'Personal' }))).status).toBe(200);
    const personal = servers.list()[0]!;
    mocked.begin.mockRejectedValueOnce(new Error('Consent unavailable'));
    const body = { providerId: 'todoist', addAccount: true, setupId, label: 'Work' };
    expect((await connect(request('connect', body))).status).toBe(400);
    const work = servers.list().find(entry => entry.id !== personal.id)!;
    expect((await connect(request('connect', body))).status).toBe(200);
    expect(servers.list()).toHaveLength(2);
    expect(mocked.begin.mock.calls.at(-1)?.[0].id).toBe(work.id);
    expect(servers.get(personal.id)?.displayName).toBe('Personal');
  });

  it('rejects an ambiguous bearer rotation without touching either token', async () => {
    const { personal, work } = await bearerAccounts();
    const response = await connectDirect(request('connectDirect', { providerId: 'github', fields: { token: 'ambiguous-new-token' } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'account_required' });
    expect(await servers.openSecret(personal.id)).toBe('personal-account-token');
    expect(await servers.openSecret(work.id)).toBe('work-account-token');
    expect(mocked.runtime).not.toHaveBeenCalled();
    expect(mocked.invalidate).not.toHaveBeenCalled();
  });

  it.each(['server', 'connection', 'both'])('rotates only the chosen bearer account using %s selection', async selection => {
    const { personal, work } = await bearerAccounts();
    const response = await connectDirect(request('connectDirect', {
      providerId: 'github', fields: { token: 'replacement-work-token' },
      ...(selection !== 'connection' ? { serverId: work.id } : {}),
      ...(selection !== 'server' ? { existingConnectionId: work.connectionId } : {}),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connection: { id: work.connectionId, accountId: work.accountId } });
    expect(await servers.openSecret(personal.id)).toBe('personal-account-token');
    expect(servers.get(personal.id)?.credentialRevision).toBe(personal.credentialRevision);
    expect(await servers.openSecret(work.id)).toBe('replacement-work-token');
    expect(servers.get(work.id)?.credentialRevision).not.toBe(work.credentialRevision);
    expect(servers.list()).toHaveLength(2);
  });

  it('rejects contradictory bearer identities before replacing a credential', async () => {
    const { personal, work } = await bearerAccounts();
    const response = await connectDirect(request('connectDirect', {
      providerId: 'github', serverId: personal.id, existingConnectionId: work.connectionId, fields: { token: 'unwanted-token' },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'connection_not_found' });
    expect(await servers.openSecret(personal.id)).toBe('personal-account-token');
    expect(await servers.openSecret(work.id)).toBe('work-account-token');
    expect(mocked.runtime).not.toHaveBeenCalled();
  });

  it('disconnects exactly the selected account and leaves its sibling secret and connection intact', async () => {
    const { personal, work } = await bearerAccounts();
    const response = await disconnect(request('disconnect', { id: personal.connectionId }));
    expect(response.status).toBe(200);
    expect(servers.get(personal.id)).toBeNull();
    expect(await connections.get(personal.connectionId!)).toBeNull();
    expect(await servers.openSecret(work.id)).toBe('work-account-token');
    expect(await connections.get(work.connectionId!)).not.toBeNull();
    expect(mocked.deleteChannels).toHaveBeenCalledExactlyOnceWith(personal.connectionId);
  });
});
