import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider, HOSTED_MCP_PROVIDERS } from '@integrations/engine/providers';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { ensureHostedMcpServer } from '@/lib/integrations/hosted-mcp';
import {
  getIntegrationConnectionStore, getMcpServerStore, getRegisteredMcpRedirectUrl,
  invalidateIntegrationRuntime, selectHostedOAuthConfig,
} from '@/lib/integrations/runtime';
import { beginMcpAuthorization } from '@/lib/integrations/mcp-authorization';
import { GET } from './[sid]/route';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), begin: vi.fn(), finish: vi.fn(), desktopBegin: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
vi.mock('@integrations/engine/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@integrations/engine/mcp')>(),
  connectMcpClient: mocks.connect,
  beginMcpOAuth: mocks.begin,
  finishMcpOAuth: mocks.finish,
}));
vi.mock('@/lib/integrations/desktop-oauth', () => ({
  isDesktopRequest: (request: Request) => request.headers.get('x-ri-desktop-client') === 'fixture-desktop',
  desktopOAuth: () => ({ begin: mocks.desktopBegin }),
  desktopRelayFor: () => undefined,
}));

const providers = HOSTED_MCP_PROVIDERS.filter(provider => provider.auth?.kind === 'oauth' && provider.auth.registration === 'registered');
const callbackProfiles = providers.flatMap<{ id: string; endpointId?: string; url: string; label: string }>(provider => provider.endpoint?.kind === 'region'
  ? provider.endpoint.options.map(option => ({ id: provider.id, endpointId: option.id, url: option.url, label: `${provider.id}/${option.id}` }))
  : [{ id: provider.id, endpointId: undefined, url: provider.url!, label: provider.id }]);
const origin = 'https://registered.example';
let dir: string;

async function redirectForConsent(authProvider: OAuthClientProvider) {
  const client = await authProvider.clientInformation();
  const state = await authProvider.state!();
  await authProvider.saveCodeVerifier(`verifier:${state}`);
  const target = new URL('https://oauth.example/authorize');
  target.searchParams.set('client_id', client!.client_id);
  target.searchParams.set('redirect_uri', String(authProvider.redirectUrl));
  target.searchParams.set('state', state);
  await authProvider.redirectToAuthorization(target);
}

beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registered-callback-'));
  vi.stubEnv(APP_ROOT_ENV, dir);
  vi.stubEnv('INTEGRATIONS_REDIRECT_URI', `${origin}/api/integrations/callback`);
  for (const provider of providers) {
    const prefix = `INTEGRATIONS_${provider.id.toUpperCase()}`;
    vi.stubEnv(`${prefix}_CLIENT_ID`, `${provider.id}-client`);
    vi.stubEnv(`${prefix}_CLIENT_SECRET`, `${provider.id}-secret`);
    vi.stubEnv(`${prefix}_REDIRECT_URI`, `${origin}/api/integrations/mcp-oauth/builtin_${provider.id}`);
  }
  invalidateIntegrationRuntime();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.desktopBegin.mockRejectedValue(new Error('Registered clients must not allocate a desktop callback'));
  // Transport is mocked. Callback routing, encrypted stores, registered client
  // resolution, state consumption, PKCE persistence and runtime ingestion are real.
  mocks.connect.mockImplementation(async ({ authProvider }: { authProvider: OAuthClientProvider }) => {
    if (await authProvider.tokens()) {
      return {
        listTools: async () => ({ tools: [{ name: 'read_fixture', description: 'Read fixture', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] }),
        callTool: async () => ({ content: [] }),
        close: async () => {},
      };
    }
    await redirectForConsent(authProvider);
    throw new Error('MCP authorization required');
  });
  mocks.begin.mockImplementation(async ({ authProvider }: { authProvider: OAuthClientProvider }) => {
    await redirectForConsent(authProvider);
    return 'REDIRECT';
  });
  mocks.finish.mockImplementation(async ({ authProvider, authorizationCode }: { authProvider: OAuthClientProvider; authorizationCode: string }) => {
    const verifier = await authProvider.codeVerifier();
    expect(verifier).toBe(`verifier:${authorizationCode.slice('code:'.length)}`);
    expect((await authProvider.clientInformation())?.client_id).toMatch(/-client$/);
    expect(String(authProvider.redirectUrl)).toContain('/api/integrations/mcp-oauth/builtin_');
    await authProvider.saveTokens({ access_token: 'fixture-account-token', token_type: 'Bearer', refresh_token: 'fixture-refresh-token' });
  });
});

afterEach(() => {
  invalidateIntegrationRuntime();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function start(providerId = 'twitter', desktop = false, addAccount = false, endpointId?: string) {
  const selected = await selectHostedOAuthConfig(providerId);
  const store = getMcpServerStore();
  const definition = getHostedMcpProvider(providerId)!;
  const chosenEndpoint = endpointId ?? (definition.endpoint?.kind === 'region' ? definition.endpoint.options[0]?.id : undefined);
  const entry = await ensureHostedMcpServer(definition, store, getIntegrationConnectionStore(), 'local', {
    authConfigId: selected.config.id, ...(chosenEndpoint ? { endpointId: chosenEndpoint } : {}),
    ...(addAccount ? { addAccount: true, label: 'Work' } : {}),
  });
  const result = await beginMcpAuthorization(entry, new Request(`${origin}/api/integrations/connect`, {
    method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', ...(desktop ? { 'x-ri-desktop-client': 'fixture-desktop' } : {}) },
  }));
  expect(result.requiresAuth).toBe(true);
  if (!result.requiresAuth) throw new Error('Expected consent');
  const authorization = new URL(result.authUrl);
  const state = authorization.searchParams.get('state')!;
  return { entry, result, state, authorization };
}

async function finish(providerId: string, state: string, extra?: Record<string, string>) {
  const sid = `builtin_${providerId}`;
  const callback = new URL(`${origin}/api/integrations/mcp-oauth/${sid}`);
  callback.searchParams.set('state', state);
  callback.searchParams.set('code', `code:${state}`);
  for (const [key, value] of Object.entries(extra ?? {})) callback.searchParams.set(key, value);
  return GET(new NextRequest(callback), { params: Promise.resolve({ sid }) });
}

const result = (response: Response) => new URL(response.headers.get('location')!, origin).searchParams;

describe('registered hosted callback routing', () => {
  it('routes two concurrent account consents through the same stable callback by state', async () => {
    const personal = await start();
    const work = await start('twitter', false, true);
    expect(personal.authorization.searchParams.get('redirect_uri')).toBe(work.authorization.searchParams.get('redirect_uri'));
    expect(personal.state).not.toBe(work.state);
    expect(result(await finish('twitter', work.state)).get('connected')).toBe('Work');
    expect((await getMcpServerStore().getOAuthState(personal.entry.id))?.authorizationState).toBe(personal.state);
    expect((await getMcpServerStore().getOAuthState(personal.entry.id))?.tokens).toBeUndefined();
    expect(result(await finish('twitter', personal.state)).get('connected')).toBe('X (Twitter)');
    expect((await getMcpServerStore().getOAuthState(work.entry.id))?.tokens).toBeTruthy();
    expect((await getIntegrationConnectionStore().list({ ownerId: 'local', providerId: 'twitter' }))).toHaveLength(2);
    expect(mocks.finish).toHaveBeenCalledTimes(2);
    expect(result(await finish('twitter', work.state)).has('error')).toBe(true);
    expect(mocks.finish).toHaveBeenCalledTimes(2);
  });

  it('cancels only the account whose consent was denied', async () => {
    const personal = await start();
    const work = await start('twitter', false, true);
    expect(result(await finish('twitter', personal.state, { error: 'access_denied' })).get('error')).toBe('authorization_cancelled');
    expect((await getMcpServerStore().getOAuthState(work.entry.id))?.authorizationState).toBe(work.state);
    expect(result(await finish('twitter', work.state)).get('connected')).toBe('Work');
    expect(mocks.finish).toHaveBeenCalledOnce();
  });
  it.each(callbackProfiles)('resolves stable $label callback to its UUID and persists tokens using the real registered provider', async ({ id, endpointId, url }) => {
    const pending = await start(id, false, false, endpointId);
    expect(pending.entry.url).toBe(url);
    expect(pending.entry.id).not.toBe(`builtin_${id}`);
    expect(pending.authorization.searchParams.get('redirect_uri')).toBe(getRegisteredMcpRedirectUrl(id));
    const auth = getHostedMcpProvider(id)?.auth;
    if (auth?.kind === 'oauth' && auth.authorizeBeforeConnect) {
      expect(mocks.begin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url }));
      expect(mocks.connect).not.toHaveBeenCalled();
    } else {
      expect(mocks.begin).not.toHaveBeenCalled();
    }
    const response = await finish(id, pending.state);
    expect(result(response).get('connected')).toBe(pending.entry.displayName);
    expect(mocks.finish).toHaveBeenCalledOnce();
    expect(mocks.finish.mock.calls[0]?.[0].url).toBe(pending.entry.url);
    const saved = await getMcpServerStore().getOAuthState(pending.entry.id);
    expect(saved?.tokens).toMatchObject({ access_token: 'fixture-account-token' });
    expect(saved?.authorizationState).toBeUndefined();
    expect(saved?.codeVerifier).toBeUndefined();
    expect(getMcpServerStore().get(pending.entry.id)?.lastStatus).toBe('ok');
    expect((await getIntegrationConnectionStore().get(pending.entry.connectionId!))?.connection.authConfigId).toBe(pending.entry.authConfigId);
  });

  it('rejects foreign state and replay before invoking the token transport', async () => {
    const pending = await start();
    expect(result(await finish('twitter', 'foreign-state')).get('error')).toBe('authorization_failed');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect((await getMcpServerStore().getOAuthState(pending.entry.id))?.authorizationState).toBe(pending.state);
    expect(result(await finish('twitter', pending.state)).get('connected')).toBe('X (Twitter)');
    expect(mocks.finish).toHaveBeenCalledOnce();
    expect(result(await finish('twitter', pending.state)).get('error')).toBe('authorization_failed');
    expect(mocks.finish).toHaveBeenCalledOnce();
  });

  it('does not accept one registered provider state at another registered callback', async () => {
    const twitter = await start();
    const box = await start('box');
    expect(result(await finish('box', twitter.state)).get('error')).toBe('authorization_failed');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect((await getMcpServerStore().getOAuthState(box.entry.id))?.authorizationState).toBe(box.state);
    expect((await getMcpServerStore().getOAuthState(twitter.entry.id))?.authorizationState).toBe(twitter.state);
  });

  it('rejects an old pending callback after removal and recreation without consuming the new state', async () => {
    const old = await start();
    await getMcpServerStore().remove(old.entry.id);
    const current = await start();
    expect(current.entry.id).not.toBe(old.entry.id);
    expect(result(await finish('twitter', old.state)).get('error')).toBe('authorization_failed');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect((await getMcpServerStore().getOAuthState(current.entry.id))?.authorizationState).toBe(current.state);
    expect(await getMcpServerStore().getOAuthState(old.entry.id)).toBeNull();
    expect(result(await finish('twitter', current.state)).get('connected')).toBe('X (Twitter)');
    expect(mocks.finish).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'slack'])('does not let a server with provider %s claim the builtin_twitter callback', async providerId => {
    const entry = await getMcpServerStore().create({ slug: 'builtin_twitter', displayName: 'Imposter', url: 'https://other.example/mcp', auth: { kind: 'oauth' }, ...(providerId ? { providerId } : {}) });
    await getMcpServerStore().setOAuthState(entry.id, { authorizationState: 'imposter-state', authorizationExpiresAt: Date.now() + 60_000, callbackChannel: 'web' });
    expect(result(await finish('twitter', 'imposter-state')).get('error')).toBe('unknown_mcp_server');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect((await getMcpServerStore().getOAuthState(entry.id))?.authorizationState).toBe('imposter-state');
  });

  it('uses the registered web callback when authorization starts from the desktop app', async () => {
    const pending = await start('twitter', true);
    expect(mocks.desktopBegin).not.toHaveBeenCalled();
    expect(pending.result.desktopFlowId).toBeUndefined();
    expect(pending.authorization.searchParams.get('redirect_uri')).toBe(getRegisteredMcpRedirectUrl('twitter'));
    expect((await getMcpServerStore().getOAuthState(pending.entry.id))?.callbackChannel).toBe('web');
    expect(result(await finish('twitter', pending.state)).get('connected')).toBe('X (Twitter)');
  });

  it('requires and consumes the correct state for a registered OAuth denial without token exchange', async () => {
    const pending = await start();
    expect(result(await finish('twitter', 'foreign', { error: 'access_denied' })).get('error')).toBe('invalid_state');
    expect((await getMcpServerStore().getOAuthState(pending.entry.id))?.authorizationState).toBe(pending.state);
    expect(result(await finish('twitter', pending.state, { error: 'access_denied' })).get('error')).toBe('authorization_cancelled');
    expect(mocks.finish).not.toHaveBeenCalled();
    expect((await getMcpServerStore().getOAuthState(pending.entry.id))?.authorizationState).toBeUndefined();
    expect(result(await finish('twitter', pending.state)).get('error')).toBe('authorization_failed');
  });
});
