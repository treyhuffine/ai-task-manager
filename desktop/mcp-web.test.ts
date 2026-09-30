import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { makeMcpOAuthProvider, type McpOAuthState } from '../src/lib/connectors/mcp-oauth';
import { mcpServerStore, type McpServerStore } from '../src/lib/connectors/mcp-servers';
import { desktopOAuth } from '../src/lib/connectors/desktop-oauth';
import { mockMcp } from './mock-mcp';

const mocks = vi.hoisted(() => ({ store: vi.fn(), rebuild: vi.fn(), invalidate: vi.fn(), redirectOrigin: 'https://home.example' }));
const webOrigin = 'https://home.example';
const pageOrigin = 'https://phone.beamd.run';
vi.mock('@/lib/connectors/runtime', () => ({
  getMcpServerStore: mocks.store,
  getMcpOAuthRedirectUrl: (sid: string) => `${mocks.redirectOrigin}/api/connectors/mcp-oauth/${sid}`,
  getConnectorRuntime: mocks.rebuild,
  invalidateConnectorRuntime: mocks.invalidate,
  MCP_TIMEOUT_MS: 5000,
  withTimeout: <T,>(operation: Promise<T>) => operation,
  mcpOAuthProviderFor: (entry: { id: string }, onRedirect?: (url: URL) => void, options?: { redirectUri?: string; interactive?: boolean; callbackChannel?: 'web' | 'desktop' }) => {
    const store: McpServerStore = mocks.store();
    return makeMcpOAuthProvider({
      redirectUrl: options?.redirectUri ?? `${mocks.redirectOrigin}/api/connectors/mcp-oauth/${entry.id}`,
      clientName: 'Ri web regression',
      load: async () => (await store.getOAuthState(entry.id) ?? {}) as McpOAuthState,
      compareAndSave: (revision, state) => store.compareAndSetOAuthState(entry.id, revision,
        state as Record<string, unknown>) as Promise<McpOAuthState | null>,
      onRedirect,
      interactive: options?.interactive,
      callbackChannel: options?.callbackChannel,
    });
  },
}));
import { beginMcpAuthorization } from '../src/lib/connectors/mcp-authorization';
import { GET } from '../src/app/api/connectors/mcp-oauth/[sid]/route';

let dir: string;
let store: McpServerStore;
let provider: Awaited<ReturnType<typeof mockMcp>>;
beforeEach(async () => {
  vi.stubEnv('RI_DESKTOP', '1');
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'native-client-only');
  vi.stubEnv('RI_DESKTOP_OAUTH_RELAY_PROVIDERS', '');
  vi.clearAllMocks();
  mocks.redirectOrigin = webOrigin;
  // This fixture checks callback/SDK behavior, not encrypted storage.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mcp-web-'));
  store = mcpServerStore({ dir, secretBox: { seal: async (value) => value, open: async <T,>(value: unknown) => value as T },
    lock: { withLock: async (_name, fn) => fn() } });
  mocks.store.mockReturnValue(store);
  mocks.rebuild.mockImplementation(async () => {
    for (const entry of store.list()) await store.setHealth(entry.id, { lastStatus: 'ok', lastCheckedAt: new Date().toISOString() });
    return { getToolkits: () => store.list().map((entry) => ({ id: entry.providerId ?? `mcp_${entry.slug}` })) };
  });
  provider = await mockMcp();
});
afterEach(() => {
  desktopOAuth().close();
  provider?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function authorize(recordOrigin = true) {
  const entry = await store.create({ slug: 'fixture', displayName: 'Fixture', url: provider.url, auth: { kind: 'oauth' } });
  const request = recordOrigin ? new Request('http://localhost:4224/api/connectors/mcp-servers', {
    method: 'POST', headers: { origin: pageOrigin, 'sec-fetch-site': 'same-origin' },
  }) : undefined;
  const result = await beginMcpAuthorization(entry, request);
  expect(result.requiresAuth).toBe(true);
  if (!result.requiresAuth) throw new Error('Expected authorization');
  expect(result.desktopFlowId).toBeUndefined();
  const authorization = new URL(result.authUrl);
  expect(authorization.searchParams.get('redirect_uri')).toBe(`${webOrigin}/api/connectors/mcp-oauth/${entry.id}`);
  const consent = await fetch(authorization, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  // Next reports its internal address even when the browser reached the callback through HTTPS.
  const finish = (url: URL) => GET(new NextRequest(`http://localhost:4224${url.pathname}${url.search}`), { params: Promise.resolve({ sid: entry.id }) });
  return { entry, callback, finish };
}

const resultUrl = (response: Response) => new URL(response.headers.get('location')!, webOrigin);

it('keeps web MCP OAuth working through persisted state and PKCE, rejecting foreign state and replay', async () => {
  const { entry, callback, finish } = await authorize();
  const foreign = new URL(callback);
  foreign.searchParams.set('state', 'foreign');
  expect(resultUrl(await finish(foreign)).searchParams.get('error')).toBe('authorization_failed');
  expect(provider.exchanges).toBe(0);
  const response = await finish(callback);
  expect(response.headers.get('location')).toBe(`${pageOrigin}/?settings=connectors&connected=Fixture`);
  expect(provider.exchanges).toBe(1);
  const saved = await store.getOAuthState(entry.id);
  expect(saved?.tokens).toMatchObject({ access_token: provider.token });
  expect(saved?.authorizationState).toBeUndefined();
  expect(saved?.codeVerifier).toBeUndefined();
  expect(mocks.invalidate).toHaveBeenCalledTimes(2); // Start stops cached sessions, completion reloads tools.
  expect(resultUrl(await finish(callback)).searchParams.get('error')).toBe('authorization_failed');
  expect(provider.exchanges).toBe(1);
});

it('requires valid state for web denial and consumes it without a token exchange', async () => {
  const { entry, callback, finish } = await authorize();
  callback.searchParams.delete('code');
  callback.searchParams.set('error', 'access_denied');
  const forged = new URL(callback);
  forged.searchParams.set('state', 'foreign');
  expect(resultUrl(await finish(forged)).searchParams.get('error')).toBe('invalid_state');
  expect((await store.getOAuthState(entry.id))?.authorizationState).toBeTruthy();
  const response = await finish(callback);
  expect(response.headers.get('location')).toBe(`${pageOrigin}/?settings=connectors&error=authorization_cancelled`);
  expect((await store.getOAuthState(entry.id))?.authorizationState).toBeUndefined();
  expect(provider.exchanges).toBe(0);
});

it('rejects an expired web callback before attempting exchange', async () => {
  const { entry, callback, finish } = await authorize();
  await store.setOAuthState(entry.id, { ...await store.getOAuthState(entry.id), authorizationExpiresAt: Date.now() - 1 });
  expect(resultUrl(await finish(callback)).searchParams.get('error')).toBe('authorization_failed');
  expect(provider.exchanges).toBe(0);
});

it('keeps the callback browser on its origin when no starting page was recorded', async () => {
  const { callback, finish } = await authorize(false);
  const response = await finish(callback);
  expect(response.headers.get('location')).toBe('/?settings=connectors&connected=Fixture');
  expect(resultUrl(response).origin).toBe(webOrigin);
  expect(provider.exchanges).toBe(1);
});

it('completes a web flow after the configured remote origin changes and returns to its starting page', async () => {
  const { entry, callback, finish } = await authorize();
  expect((await store.getOAuthState(entry.id))?.callbackChannel).toBe('web');
  mocks.redirectOrigin = 'https://new-home.example';
  const response = await finish(callback);
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe(`${pageOrigin}/?settings=connectors&connected=Fixture`);
  expect(provider.exchanges).toBe(1);
  expect((await store.getOAuthState(entry.id))?.tokens).toMatchObject({ access_token: provider.token });
});

it('rejects desktop MCP state at the web callback without consuming its native authorization', async () => {
  const entry = await store.create({ slug: 'native', displayName: 'Native fixture', url: provider.url, auth: { kind: 'oauth' } });
  const result = await beginMcpAuthorization(entry, new Request('https://localhost/api/connectors/mcp-servers', {
    method: 'POST', headers: { 'x-ri-desktop-client': 'native-client-only' },
  }));
  expect(result.requiresAuth).toBe(true);
  if (!result.requiresAuth) throw new Error('Expected native authorization');
  expect(result.desktopFlowId).toBeTruthy();
  const authorization = new URL(result.authUrl);
  const state = authorization.searchParams.get('state')!;
  expect((await store.getOAuthState(entry.id))?.callbackChannel).toBe('desktop');
  const consent = await fetch(authorization, { redirect: 'manual' });
  const nativeCallback = new URL(consent.headers.get('location')!);
  const response = await GET(new NextRequest(`http://localhost:4224/api/connectors/mcp-oauth/${entry.id}${nativeCallback.search}`), {
    params: Promise.resolve({ sid: entry.id }),
  });
  expect(response.status).toBe(400);
  expect(provider.exchanges).toBe(0);
  expect((await store.getOAuthState(entry.id))?.authorizationState).toBe(state);
  expect((await fetch(nativeCallback)).status).toBe(200);
  expect(provider.exchanges).toBe(1);
  expect((await store.getOAuthState(entry.id))?.tokens).toMatchObject({ access_token: provider.token });
});
