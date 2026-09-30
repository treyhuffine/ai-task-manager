import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ConnectionStore } from '@connectors/engine';
import { fileLock } from '@connectors/engine';
import { getHostedMcpProvider, HOSTED_MCP_PROVIDERS } from '@connectors/engine/providers';
import { aesGcmSecretBox, generateSecretKey } from '@connectors/engine/crypto';
import {
  ensureHostedMcpServer,
  hostedMcpConnectionId,
  hostedMcpDefinition,
  hostedMcpRequiresAuth,
  markHostedMcpReconnectRequired,
  hostedAccountSelection,
} from './hosted-mcp';
import { mcpServerStore, type McpServerEntry } from './mcp-servers';

const definition = getHostedMcpProvider('todoist')!;
const bearerProviders = HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'bearer');
const registeredProviders = HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'oauth' && provider.auth.registration === 'registered');
const dirs: string[] = [];

function freshStore(encrypted = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-mcp-test-'));
  dirs.push(dir);
  return mcpServerStore({
    dir,
    secretBox: encrypted ? aesGcmSecretBox({ key: generateSecretKey() }) : { seal: async (value) => value, open: async <T,>(value: unknown) => value as T },
    lock: fileLock({ dir: path.join(dir, 'locks') }),
  });
}

function savedConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'old-todoist-connection',
    ownerId: 'local',
    providerId: 'todoist',
    accountId: 'existing-user-123',
    scopes: [],
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function connectionStore(rows: Connection[] = []) {
  const list = vi.fn<ConnectionStore['list']>(async (filter) => rows.filter((row) =>
    (!filter?.ownerId || row.ownerId === filter.ownerId) && (!filter?.providerId || row.providerId === filter.providerId),
  ));
  const setStatus = vi.fn<ConnectionStore['setStatus']>(async (id, status) => {
    const row = rows.find((item) => item.id === id);
    if (row) row.status = status;
  });
  const get = vi.fn<ConnectionStore['get']>(async (id) => {
    const connection = rows.find(row => row.id === id);
    return connection ? { connection, sealed: 'sealed-fixture' } : null;
  });
  return { list, setStatus, get };
}

function entry(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: 'server-1', providerId: 'todoist', slug: 'builtin_todoist',
    displayName: 'Todoist', url: definition.url!, enabled: true, auth: { kind: 'oauth' },
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('multiple hosted accounts', () => {
  const setupId = 'ae8c37c1-df91-4105-a738-6d2da375ad80';

  it('adds independent accounts and requires explicit selection for reconnect', async () => {
    const servers = freshStore(true);
    const connections = connectionStore();
    const personal = await ensureHostedMcpServer(definition, servers, connections, 'local', { label: 'Personal' });
    const work = await ensureHostedMcpServer(definition, servers, connections, 'local', { addAccount: true, setupId, label: 'Work' });
    expect(personal.displayName).toBe('Personal');
    expect(work.displayName).toBe('Work');
    expect(work.accountId).not.toBe(personal.accountId);
    expect(work.connectionId).not.toBe(personal.connectionId);
    await servers.setOAuthState(personal.id, { tokens: { access_token: 'personal-access-token' } });
    await servers.setOAuthState(work.id, { tokens: { access_token: 'work-access-token' } });
    await expect(ensureHostedMcpServer(definition, servers, connections, 'local')).rejects.toMatchObject({ code: 'account_required' });
    expect((await ensureHostedMcpServer(definition, servers, connections, 'local', { existingConnectionId: work.connectionId })).id).toBe(work.id);
    expect((await servers.getOAuthState(personal.id))?.tokens).toEqual({ access_token: 'personal-access-token' });
  });

  it('reuses a retried Add account setup under concurrent creation', async () => {
    const servers = freshStore();
    const connections = connectionStore();
    const opts = { addAccount: true, setupId, label: 'Work' };
    const [one, two] = await Promise.all([
      ensureHostedMcpServer(definition, servers, connections, 'local', opts),
      ensureHostedMcpServer(definition, servers, connections, 'local', opts),
    ]);
    expect(one.id).toBe(two.id);
    expect(servers.list()).toHaveLength(1);
    expect((await ensureHostedMcpServer(definition, servers, connections, 'local', opts)).id).toBe(one.id);
  });

  it('isolates tokens, endpoint choices and registered app identities', async () => {
    const servers = freshStore(true);
    const connections = connectionStore();
    const github = getHostedMcpProvider('github')!;
    const one = await ensureHostedMcpServer(github, servers, connections, 'local', { secret: 'personal-token' });
    const two = await ensureHostedMcpServer(github, servers, connections, 'local', { addAccount: true, setupId, secret: 'work-token' });
    await ensureHostedMcpServer(github, servers, connections, 'local', { serverId: two.id, secret: 'new-work-token' });
    expect(await servers.openSecret(one.id)).toBe('personal-token');
    expect(await servers.openSecret(two.id)).toBe('new-work-token');
    const slack = getHostedMcpProvider('slack')!;
    const slackOne = await ensureHostedMcpServer(slack, servers, connections, 'local', { authConfigId: 'personal-app' });
    const slackTwo = await ensureHostedMcpServer(slack, servers, connections, 'local', { addAccount: true, authConfigId: 'work-app' });
    await expect(ensureHostedMcpServer(slack, servers, connections, 'local', { serverId: slackTwo.id, authConfigId: 'personal-app' })).rejects.toThrow('Disconnect');
    expect(servers.get(slackOne.id)?.authConfigId).toBe('personal-app');
    const intercom = getHostedMcpProvider('intercom')!;
    const us = await ensureHostedMcpServer(intercom, servers, connections, 'local', { endpointId: 'us' });
    const eu = await ensureHostedMcpServer(intercom, servers, connections, 'local', { addAccount: true, endpointId: 'eu' });
    expect(us.url).not.toBe(eu.url);
    await expect(ensureHostedMcpServer(intercom, servers, connections, 'local', { serverId: eu.id, endpointId: 'us' })).rejects.toThrow('Disconnect');
  });

  it('keeps Smartsheet regional credentials separate and rejects a region change before replacing a token', async () => {
    const provider = getHostedMcpProvider('smartsheet')!;
    if (provider.endpoint?.kind !== 'region') throw new Error('Expected finite Smartsheet regions');
    const servers = freshStore(true);
    const connections = connectionStore();
    const accounts: McpServerEntry[] = [];
    for (const region of provider.endpoint.options) accounts.push(await ensureHostedMcpServer(provider, servers, connections, 'local', {
      endpointId: region.id, secret: `fixture-${region.id}-token`, addAccount: accounts.length > 0, label: region.label,
    }));
    const europe = accounts[1]!;
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local', { secret: 'ambiguous-token' })).rejects.toMatchObject({ code: 'account_required' });
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local', {
      serverId: europe.id, endpointId: 'us', secret: 'wrong-region-token',
    })).rejects.toThrow('Disconnect');
    expect(await servers.openSecret(europe.id)).toBe('fixture-eu-token');
    await ensureHostedMcpServer(provider, servers, connections, 'local', { serverId: europe.id, secret: 'rotated-eu-token' });
    expect(servers.get(europe.id)).toMatchObject({ url: 'https://mcp.smartsheet.eu', connectionId: europe.connectionId, accountId: europe.accountId });
    expect(await Promise.all(accounts.map(account => servers.openSecret(account.id)))).toEqual(['fixture-us-token', 'rotated-eu-token', 'fixture-au-token']);
    expect(new Set(accounts.map(account => account.connectionId)).size).toBe(3);
    expect(new Set(accounts.map(account => account.accountId)).size).toBe(3);
    const disk = fs.readFileSync(path.join(dirs.at(-1)!, 'mcp-servers.json'), 'utf8');
    for (const secret of ['fixture-us-token', 'rotated-eu-token', 'fixture-au-token', 'wrong-region-token']) expect(disk).not.toContain(secret);
  });

  it('migrates a specifically chosen legacy account without adopting another', async () => {
    const servers = freshStore();
    const one = savedConnection();
    const two = savedConnection({ id: 'second-old', accountId: 'second-account' });
    const connections = connectionStore([one, two]);
    const chosen = await ensureHostedMcpServer(definition, servers, connections, 'local', { existingConnectionId: two.id });
    expect(chosen.connectionId).toBe(two.id);
    expect(chosen.accountId).toBe(two.accountId);
    const other = await ensureHostedMcpServer(definition, servers, connections, 'local', { existingConnectionId: one.id });
    expect(other.connectionId).toBe(one.id);
    expect(other.slug).not.toBe(chosen.slug);
  });

  it('rejects foreign, mismatched and missing account selectors without creating replacements', async () => {
    const servers = freshStore();
    const old = savedConnection({ ownerId: 'another-owner' });
    const connections = connectionStore([old]);
    for (const options of [
      { serverId: 'missing' }, { existingConnectionId: old.id },
      { addAccount: true, existingConnectionId: old.id }, { addAccount: true, setupId: 'bad-id' },
    ]) await expect(ensureHostedMcpServer(definition, servers, connections, 'local', options)).rejects.toThrow();
    expect(servers.list()).toHaveLength(0);
    await expect(ensureHostedMcpServer(getHostedMcpProvider('exa')!, servers, connections, 'local', { addAccount: true })).rejects.toThrow('does not use accounts');
    expect(() => hostedAccountSelection({ addAccount: 'true' })).toThrow('Invalid account selection');
    expect(() => hostedAccountSelection({ existingConnectionId: 7 })).toThrow('Invalid existingConnectionId');
  });

  it('marks only the selected account for reauthorization', async () => {
    const one = savedConnection();
    const two = savedConnection({ id: 'second-account' });
    const connections = connectionStore([one, two]);
    await markHostedMcpReconnectRequired('todoist', connections, 'local', two.id);
    expect(one.status).toBe('active');
    expect(two.status).toBe('needs_reauth');
  });
});

describe('hostedMcpDefinition', () => {
  it.each(bearerProviders)('pins $id to its bearer endpoint and declared write policy', (provider) => {
    const { id } = provider;
    const urls = provider.endpoint?.kind === 'region' ? provider.endpoint.options.map(option => option.url) : [provider.url!];
    for (const url of urls) {
      const server = entry({ providerId: id, url, auth: { kind: 'bearer' } });
      expect(hostedMcpDefinition(server)).toEqual(provider);
      expect(() => hostedMcpDefinition({ ...server, auth: { kind: 'oauth' } })).toThrow('trusted service configuration');
      expect(() => hostedMcpDefinition({ ...server, url: `${url}?redirect=other` })).toThrow('trusted service configuration');
    }
  });
  it('grants built-in identity only to the catalog-pinned endpoint with OAuth', () => {
    expect(hostedMcpDefinition(entry())).toEqual(definition);
    expect(hostedMcpDefinition(entry({ providerId: undefined }))).toBeUndefined();
  });

  it.each([
    { url: 'https://attacker.example/mcp' },
    { url: `${definition.url}?redirect=https://attacker.example` },
    { auth: { kind: 'bearer' as const } },
    { auth: { kind: 'none' as const } },
    { providerId: 'unknown-provider' },
  ])('rejects a forged built-in entry %j', (patch) => {
    expect(() => hostedMcpDefinition(entry(patch))).toThrow('trusted service configuration');
  });
});

describe('ensureHostedMcpServer', () => {
  it.each(registeredProviders)('requires an OAuth app for $id before saving server authority', async (provider) => {
    const servers = freshStore();
    await expect(ensureHostedMcpServer(provider, servers, connectionStore(), 'local')).rejects.toThrow('Choose an OAuth app');
    expect(servers.list()).toHaveLength(0);
  });

  it.each(registeredProviders)('binds $id to its selected app without adopting the old native credentials', async (provider) => {
    const servers = freshStore(true);
    const old = savedConnection({ id: `old-${provider.id}`, providerId: provider.id, authConfigId: 'old-native-app' });
    const option = provider.endpoint?.kind === 'region' ? provider.endpoint.options[0] : undefined;
    const first = await ensureHostedMcpServer(provider, servers, connectionStore([old]), 'local', {
      authConfigId: 'registered-app', ...(option ? { endpointId: option.id } : {}),
    });
    const accountId = option ? `${provider.id}:${createHash('sha256').update(option.url).digest('hex').slice(0, 20)}` : old.accountId;
    expect(first).toMatchObject({
      providerId: provider.id, authConfigId: 'registered-app', connectionId: old.id, accountId,
      url: option?.url ?? provider.url,
    });
    expect(await servers.getOAuthState(first.id)).toBeNull();
    expect(await servers.openSecret(first.id)).toBeNull();
  });

  it('preserves the bound app and its encrypted OAuth state during retries and rejects a client switch', async () => {
    const provider = getHostedMcpProvider('twitter')!;
    const servers = freshStore(true);
    const connections = connectionStore();
    const first = await ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-one' });
    await servers.setOAuthState(first.id, { clientInformation: { client_id: 'first-client' }, tokens: { access_token: 'first-access-token', refresh_token: 'first-refresh-token' } });
    const before = await servers.getOAuthState(first.id);
    expect((await ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-one' })).id).toBe(first.id);
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-two' })).rejects.toThrow('Disconnect');
    expect(servers.get(first.id)?.authConfigId).toBe('app-one');
    expect(await servers.getOAuthState(first.id)).toEqual(before);
    expect(fs.readFileSync(path.join(dirs.at(-1)!, 'mcp-servers.json'), 'utf8')).not.toContain('first-refresh-token');
  });

  it('rejects a losing concurrent OAuth app selection under the real file lock', async () => {
    const provider = getHostedMcpProvider('slack')!;
    const servers = freshStore(true);
    const connections = connectionStore();
    const outcomes = await Promise.allSettled([
      ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-one' }),
      ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-two' }),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringContaining('different OAuth app') }) }),
    ]);
    const winner = outcomes.find(result => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Expected an accepted OAuth app');
    expect(servers.list()).toHaveLength(1);
    expect(servers.list()[0]?.authConfigId).toBe(winner.value.authConfigId);
  });

  it('starts with fresh OAuth state when a removed connector is recreated for another app', async () => {
    const provider = getHostedMcpProvider('dropbox')!;
    const servers = freshStore(true);
    const connections = connectionStore();
    const first = await ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-one' });
    await servers.setOAuthState(first.id, { clientInformation: { client_id: 'first-client' }, tokens: { access_token: 'first-access-token' } });
    await servers.remove(first.id);
    const replacement = await ensureHostedMcpServer(provider, servers, connections, 'local', { authConfigId: 'app-two' });
    expect(replacement.id).not.toBe(first.id);
    expect(replacement.authConfigId).toBe('app-two');
    expect(await servers.getOAuthState(first.id)).toBeNull();
    expect(await servers.getOAuthState(replacement.id)).toBeNull();
    expect(await servers.openSecret(replacement.id)).toBeNull();
  });

  it('rejects app bindings for dynamic OAuth and anonymous services', async () => {
    const servers = freshStore();
    for (const provider of [definition, getHostedMcpProvider('exa')!]) {
      await expect(ensureHostedMcpServer(provider, servers, connectionStore(), 'local', { authConfigId: 'inapplicable-client' })).rejects.toThrow('does not use a registered OAuth app');
    }
    expect(servers.list()).toHaveLength(0);
  });

  it('requires an explicit first region, then reuses its authority and endpoint-derived identity', async () => {
    const provider = getHostedMcpProvider('intercom')!;
    const servers = freshStore(true);
    const connections = connectionStore();
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local')).rejects.toThrow('supported workspace region');
    expect(servers.list()).toHaveLength(0);
    const first = await ensureHostedMcpServer(provider, servers, connections, 'local', { endpointId: 'eu' });
    expect(first.url).toBe('https://mcp.eu.intercom.com/mcp');
    expect(first.accountId).toBe(`intercom:${createHash('sha256').update(first.url).digest('hex').slice(0, 20)}`);
    await servers.setOAuthState(first.id, { clientInformation: { client_id: 'eu-client' }, tokens: { access_token: 'eu-token' } });
    const before = await servers.getOAuthState(first.id);
    expect((await ensureHostedMcpServer(provider, servers, connections, 'local')).id).toBe(first.id);
    expect((await ensureHostedMcpServer(provider, servers, connections, 'local', { endpointId: 'eu' })).id).toBe(first.id);
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local', { endpointId: 'us' })).rejects.toThrow('Disconnect');
    expect(await servers.getOAuthState(first.id)).toEqual(before);
    expect(servers.list()).toHaveLength(1);
    expect(servers.list()[0]?.url).toBe(first.url);
  });

  it('freezes a normalized instance and never transfers saved OAuth credentials to another destination', async () => {
    const provider = getHostedMcpProvider('n8n')!;
    const servers = freshStore(true);
    const connections = connectionStore();
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local')).rejects.toThrow('instance URL is required');
    const first = await ensureHostedMcpServer(provider, servers, connections, 'local', { instanceUrl: 'https://one.example/n8n/' });
    expect(first.url).toBe('https://one.example/n8n/mcp-server/http');
    expect(first.accountId).toBe(`n8n:${createHash('sha256').update(first.url).digest('hex').slice(0, 20)}`);
    await servers.setOAuthState(first.id, { clientInformation: { client_id: 'one-client' }, tokens: { access_token: 'one-token' } });
    const before = await servers.getOAuthState(first.id);
    await expect(ensureHostedMcpServer(provider, servers, connections, 'local', { instanceUrl: 'https://two.example' })).rejects.toThrow('Disconnect');
    expect((await ensureHostedMcpServer(provider, servers, connections, 'local', { instanceUrl: first.url })).id).toBe(first.id);
    expect(await servers.getOAuthState(first.id)).toEqual(before);
    expect(servers.list()).toHaveLength(1);
    await servers.remove(first.id);
    const second = await ensureHostedMcpServer(provider, servers, connections, 'local', { instanceUrl: 'https://two.example' });
    expect(second.accountId).not.toBe(first.accountId);
    expect(second.id).not.toBe(first.id);
    expect(await servers.getOAuthState(second.id)).toBeNull();
    expect(await servers.openSecret(second.id)).toBeNull();
    expect(JSON.stringify(servers.list())).not.toContain('one-token');
  });

  it('rejects different concurrent region selections instead of reusing the first client on the second endpoint', async () => {
    const provider = getHostedMcpProvider('intercom')!;
    const servers = freshStore();
    const connections = connectionStore();
    const outcomes = await Promise.allSettled([
      ensureHostedMcpServer(provider, servers, connections, 'local', { endpointId: 'us' }),
      ensureHostedMcpServer(provider, servers, connections, 'local', { endpointId: 'eu' }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('different region or instance') }) });
    expect(servers.list()).toHaveLength(1);
    const fulfilled = outcomes.find((result) => result.status === 'fulfilled');
    if (fulfilled?.status !== 'fulfilled') throw new Error('Expected one accepted region');
    expect(servers.list()[0]?.url).toBe(fulfilled.value.url);
  });

  it('binds a configurable account identity to the selected endpoint even if a derived row remains', async () => {
    const provider = getHostedMcpProvider('n8n')!;
    const servers = freshStore();
    const old = savedConnection({ id: 'old-n8n', providerId: 'n8n', accountId: 'old-endpoint' });
    const selected = await ensureHostedMcpServer(provider, servers, connectionStore([old]), 'local', { instanceUrl: 'https://new.example' });
    expect(selected.connectionId).toBe(old.id);
    expect(selected.accountId).toBe(`n8n:${createHash('sha256').update(selected.url).digest('hex').slice(0, 20)}`);
    expect(selected.accountId).not.toBe(old.accountId);
  });

  it.each(bearerProviders)('encrypts $id tokens and preserves identity on rotation', async (provider) => {
    const { id } = provider;
    const region = provider.endpoint?.kind === 'region' ? provider.endpoint.options[0] : undefined;
    const servers = freshStore(true);
    const connections = connectionStore();
    const first = await ensureHostedMcpServer(provider, servers, connections, 'local', {
      secret: '  first-fixture-token  ', ...(region ? { endpointId: region.id } : {}),
    });
    const accountId = region ? `${id}:${createHash('sha256').update(region.url).digest('hex').slice(0, 20)}` : `${id}:default`;
    expect(first).toMatchObject({ providerId: id, connectionId: `hosted-${id}`, accountId, auth: { kind: 'bearer' } });
    expect(first.credentialRevision).toBeTruthy();
    expect(await servers.openSecret(first.id)).toBe('first-fixture-token');
    expect(await hostedMcpRequiresAuth(first, servers)).toBe(false);
    const disk = fs.readFileSync(path.join(dirs.at(-1)!, 'mcp-servers.json'), 'utf8');
    expect(disk).not.toContain('first-fixture-token');
    expect(JSON.stringify(servers.list())).not.toContain('first-fixture-token');
    const rotated = await ensureHostedMcpServer(provider, servers, connections, 'local', { secret: 'replacement-fixture-token' });
    expect(rotated).toMatchObject({ id: first.id, connectionId: first.connectionId, accountId: first.accountId });
    expect(rotated.credentialRevision).not.toBe(first.credentialRevision);
    expect(await servers.openSecret(first.id)).toBe('replacement-fixture-token');
    expect(await servers.getOAuthState(first.id)).toBeNull();
    const retried = await ensureHostedMcpServer(provider, servers, connections, 'local');
    expect(retried.credentialRevision).toBe(rotated.credentialRevision);
    expect(servers.list()).toHaveLength(1);
  });

  it('rejects missing tokens, secrets for OAuth, and forged caller definitions before saving', async () => {
    const servers = freshStore();
    const connections = connectionStore();
    const github = getHostedMcpProvider('github')!;
    await expect(ensureHostedMcpServer(github, servers, connections, 'local')).rejects.toThrow('token is required');
    await expect(ensureHostedMcpServer(github, servers, connections, 'local', { secret: ' ' })).rejects.toThrow('token is required');
    await expect(ensureHostedMcpServer(definition, servers, connections, 'local', { secret: 'fixture' })).rejects.toThrow('does not accept a token');
    await expect(ensureHostedMcpServer({ ...github, url: 'https://attacker.example/mcp' }, servers, connections, 'local', { secret: 'fixture' })).rejects.toThrow('trusted service configuration');
    await expect(ensureHostedMcpServer({ ...github, auth: { kind: 'none' } }, servers, connections, 'local')).rejects.toThrow('trusted service configuration');
    expect(servers.list()).toHaveLength(0);
  });

  it('checks the selected auth mechanism without conflating a network outage with lost credentials', async () => {
    const servers = freshStore();
    const bearer = await ensureHostedMcpServer(getHostedMcpProvider('github')!, servers, connectionStore(), 'local', { secret: 'fixture' });
    await servers.setHealth(bearer.id, { lastStatus: 'unreachable', lastCheckedAt: 'then' });
    expect(await hostedMcpRequiresAuth(servers.get(bearer.id)!, servers)).toBe(false);
    await servers.update(bearer.id, { secret: null });
    expect(await hostedMcpRequiresAuth(servers.get(bearer.id)!, servers)).toBe(true);
    const publicServer = entry({ auth: { kind: 'none' } });
    expect(await hostedMcpRequiresAuth(publicServer, servers)).toBe(false);
    expect(await hostedMcpRequiresAuth({ ...publicServer, enabled: false }, servers)).toBe(true);
    expect(await hostedMcpRequiresAuth(undefined, servers)).toBe(true);
  });
  it('preserves legacy connection and account IDs without adopting a custom Todoist server', async () => {
    const servers = freshStore();
    const custom = await servers.create({ slug: 'todoist', displayName: 'Todoist', url: definition.url!, auth: { kind: 'oauth' } });
    const connections = connectionStore([savedConnection()]);
    const hosted = await ensureHostedMcpServer(definition, servers, connections, 'local');
    expect(hosted).toMatchObject({
      providerId: 'todoist', slug: 'builtin_todoist', connectionId: 'old-todoist-connection',
      accountId: 'existing-user-123', url: definition.url, auth: { kind: 'oauth' },
    });
    expect(hostedMcpConnectionId(hosted)).toBe('old-todoist-connection');
    expect(hostedMcpConnectionId(custom)).toBe('mcp-todoist');
    expect(connections.list).toHaveBeenCalledWith({ ownerId: 'local', providerId: 'todoist' });
    expect(servers.list()).toHaveLength(2);
  });

  it('persists a stable new identity and reuses it across retries and concurrent requests', async () => {
    const servers = freshStore();
    const connections = connectionStore();
    const [first, concurrent] = await Promise.all([
      ensureHostedMcpServer(definition, servers, connections, 'local'),
      ensureHostedMcpServer(definition, servers, connections, 'local'),
    ]);
    const retried = await ensureHostedMcpServer(definition, servers, connections, 'local');
    expect(first).toMatchObject({ connectionId: 'hosted-todoist', accountId: 'todoist:default' });
    expect(concurrent.id).toBe(first.id);
    expect(retried.id).toBe(first.id);
    expect(servers.list()).toHaveLength(1);
  });

  it('reenables the same hosted entry without replacing its saved authorization', async () => {
    const servers = freshStore();
    const connections = connectionStore();
    const original = await ensureHostedMcpServer(definition, servers, connections, 'local');
    await servers.setOAuthState(original.id, { tokens: { access_token: 'fixture-token' } });
    const authorization = await servers.getOAuthState(original.id);
    await servers.update(original.id, { enabled: false });
    const retried = await ensureHostedMcpServer(definition, servers, connections, 'local');
    expect(retried).toMatchObject({ id: original.id, enabled: true });
    expect(await servers.getOAuthState(original.id)).toEqual(authorization);
  });

  it('does not arbitrarily choose between multiple legacy accounts', async () => {
    const servers = freshStore();
    const connections = connectionStore([savedConnection(), savedConnection({ id: 'another', accountId: 'another-user' })]);
    await expect(ensureHostedMcpServer(definition, servers, connections, 'local')).rejects.toMatchObject({ code: 'account_required' });
    expect(servers.list()).toHaveLength(0);
  });

  it('does not adopt a custom server that occupies the reserved slug during creation', async () => {
    const servers = freshStore();
    await servers.create({ slug: 'builtin_todoist', displayName: 'Custom', url: definition.url!, auth: { kind: 'oauth' } });
    await expect(ensureHostedMcpServer(definition, servers, connectionStore(), 'local')).rejects.toMatchObject({ code: 'slug_taken' });
    expect(servers.list()[0]?.providerId).toBeUndefined();
  });

  it('rejects a previously stored built-in entry whose destination has been changed', async () => {
    const servers = freshStore();
    const original = await ensureHostedMcpServer(definition, servers, connectionStore(), 'local');
    await servers.update(original.id, { url: 'https://attacker.example/mcp' });
    await expect(ensureHostedMcpServer(definition, servers, connectionStore(), 'local')).rejects.toThrow('trusted service configuration');
  });
});

it('marks old tokens for sign-in once, preserving other providers and owners', async () => {
  const rows = [
    savedConnection(),
    savedConnection({ id: 'already-expired', status: 'needs_reauth' }),
    savedConnection({ id: 'other-owner', ownerId: 'someone-else' }),
    savedConnection({ id: 'other-provider', providerId: 'google' }),
  ];
  const connections = connectionStore(rows);
  await markHostedMcpReconnectRequired('todoist', connections, 'local');
  await markHostedMcpReconnectRequired('todoist', connections, 'local');
  expect(connections.setStatus).toHaveBeenCalledExactlyOnceWith('old-todoist-connection', 'needs_reauth', expect.any(String));
  expect(rows[2]?.status).toBe('active');
  expect(rows[3]?.status).toBe('active');
});
