import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { ensureHostedMcpServer } from './hosted-mcp';
import {
  getConnectorAdmin, getConnectorConnectionStore, getMcpServerStore, getProviderStatuses,
  getRegisteredMcpRedirectUrl, invalidateConnectorRuntime, mcpOAuthProviderFor, selectHostedOAuthConfig,
} from './runtime';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
vi.mock('@connectors/engine/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@connectors/engine/mcp')>(),
  connectMcpClient: vi.fn(async () => ({ listTools: async () => ({ tools: [] }), close: async () => {} })),
}));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-runtime-'));
  vi.stubEnv(APP_ROOT_ENV, dir);
  vi.stubEnv('CONNECTORS_REDIRECT_URI', 'https://app.example/api/connectors/callback');
  vi.stubEnv('CONNECTORS_TWITTER_CLIENT_ID', 'registered-client');
  vi.stubEnv('CONNECTORS_TWITTER_CLIENT_SECRET', 'registered-secret');
  vi.stubEnv('CONNECTORS_TWITTER_REDIRECT_URI', 'https://app.example/api/connectors/mcp-oauth/builtin_twitter');
  invalidateConnectorRuntime();
});
afterEach(() => {
  invalidateConnectorRuntime();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function pending() {
  const selected = await selectHostedOAuthConfig('twitter');
  return ensureHostedMcpServer(getHostedMcpProvider('twitter')!, getMcpServerStore(), getConnectorConnectionStore(), 'local', { authConfigId: selected.config.id });
}

describe('registered clients through the real host stores', () => {
  it('exposes a stable registered callback and secret-free setup status before server creation', async () => {
    const status = (await getProviderStatuses(true)).find(provider => provider.id === 'twitter')!;
    expect(status.configured).toBe(true);
    expect(status.mcp).toMatchObject({ oauthRegistration: 'registered', redirectUri: getRegisteredMcpRedirectUrl('twitter') });
    expect(status.desktopCallback).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain('registered-secret');
  });

  it('does not mark an old native callback as ready for hosted sign-in', async () => {
    vi.stubEnv('CONNECTORS_TWITTER_REDIRECT_URI', 'https://app.example/api/connectors/callback');
    expect((await getProviderStatuses()).find(provider => provider.id === 'twitter')?.configured).toBe(false);
    await expect(selectHostedOAuthConfig('twitter')).rejects.toThrow('Register https://app.example/api/connectors/mcp-oauth/builtin_twitter');
  });

  it('loads the pinned registered app, then rejects a credential rotation in an existing provider', async () => {
    const entry = await pending();
    const provider = mcpOAuthProviderFor(entry);
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'registered-client', client_secret: 'registered-secret' });
    await provider.saveTokens({ access_token: 'account-token', token_type: 'bearer' });
    expect(await provider.tokens()).toMatchObject({ access_token: 'account-token' });
    vi.stubEnv('CONNECTORS_TWITTER_CLIENT_SECRET', 'replacement-secret');
    await expect(provider.tokens()).rejects.toThrow();
    expect(JSON.stringify(await getMcpServerStore().getOAuthState(entry.id))).not.toContain('registered-secret');
  });

  it('blocks deleting an OAuth app even before pending setup creates a derived connection', async () => {
    const admin = await getConnectorAdmin();
    const config = await admin.addConfig({ providerId: 'twitter', scheme: 'oauth2', scope: 'owner', ownerId: 'local', label: 'Work', oauth: { clientId: 'work-client', redirectUri: getRegisteredMcpRedirectUrl('twitter') }, clientSecret: 'work-secret' });
    const servers = getMcpServerStore();
    const entry = await ensureHostedMcpServer(getHostedMcpProvider('twitter')!, servers, getConnectorConnectionStore(), 'local', { authConfigId: config.id });
    await expect(admin.removeConfig(config.id)).rejects.toMatchObject({ code: 'conflict' });
    await servers.remove(entry.id);
    await expect(admin.removeConfig(config.id)).resolves.toBeUndefined();
  });

  it('keeps registered client identity available after legitimate token invalidation', async () => {
    const entry = await pending();
    const provider = mcpOAuthProviderFor(entry);
    await provider.clientInformation();
    await provider.saveTokens({ access_token: 'expired-token', token_type: 'bearer' });
    await provider.invalidateCredentials!('tokens');
    expect((await provider.clientInformation())?.client_id).toBe('registered-client');
    expect(await provider.tokens()).toBeUndefined();
    expect(getMcpServerStore().get(entry.id)?.credentialRevision).toBeTruthy();
  });

  it('rejects a disabled registered app on the next token read', async () => {
    const admin = await getConnectorAdmin();
    const config = await admin.addConfig({ providerId: 'twitter', scheme: 'oauth2', scope: 'owner', ownerId: 'local', label: 'Work', oauth: { clientId: 'work-client', redirectUri: getRegisteredMcpRedirectUrl('twitter') }, clientSecret: 'work-secret' });
    const entry = await ensureHostedMcpServer(getHostedMcpProvider('twitter')!, getMcpServerStore(), getConnectorConnectionStore(), 'local', { authConfigId: config.id });
    const provider = mcpOAuthProviderFor(entry);
    await provider.clientInformation();
    await provider.saveTokens({ access_token: 'work-token', token_type: 'bearer' });
    await admin.setStatus(config.id, 'disabled');
    await expect(provider.tokens()).rejects.toMatchObject({ code: 'auth_config_unavailable' });
  });
});
