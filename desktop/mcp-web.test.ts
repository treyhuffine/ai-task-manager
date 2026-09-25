import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { makeMcpOAuthProvider, type McpOAuthState } from '../src/lib/connectors/mcp-oauth';
import { mcpServerStore, type McpServerStore } from '../src/lib/connectors/mcp-servers';
import { mockMcp } from './mock-mcp';

const mocks = vi.hoisted(() => ({ store: vi.fn(), rebuild: vi.fn(), invalidate: vi.fn() }));
const webOrigin = 'https://home.example';
vi.mock('@/lib/connectors/runtime', () => ({
  getMcpServerStore: mocks.store,
  getConnectorRuntime: mocks.rebuild,
  invalidateConnectorRuntime: mocks.invalidate,
  MCP_TIMEOUT_MS: 5000,
  withTimeout: <T,>(operation: Promise<T>) => operation,
  mcpOAuthProviderFor: (entry: { id: string }, onRedirect?: (url: URL) => void, options?: { redirectUri?: string; interactive?: boolean }) => {
    const store: McpServerStore = mocks.store();
    return makeMcpOAuthProvider({
      redirectUrl: options?.redirectUri ?? `${webOrigin}/api/connectors/mcp-oauth/${entry.id}`,
      clientName: 'Ri web regression',
      load: async () => (await store.getOAuthState(entry.id) ?? {}) as McpOAuthState,
      save: (state) => store.setOAuthState(entry.id, state as Record<string, unknown>),
      onRedirect,
      interactive: options?.interactive,
    });
  },
}));
import { beginMcpAuthorization } from '../src/lib/connectors/mcp-authorization';
import { GET } from '../src/app/api/connectors/mcp-oauth/[sid]/route';

let dir: string;
let store: McpServerStore;
let provider: Awaited<ReturnType<typeof mockMcp>>;
beforeEach(async () => {
  vi.stubEnv('RI_DESKTOP', '');
  vi.clearAllMocks();
  // This fixture checks callback/SDK behavior, not encrypted storage.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mcp-web-'));
  store = mcpServerStore({ dir, secretBox: { seal: async (value) => value, open: async <T,>(value: unknown) => value as T },
    lock: { withLock: async (_name, fn) => fn() } });
  mocks.store.mockReturnValue(store);
  mocks.rebuild.mockResolvedValue({});
  provider = await mockMcp();
});
afterEach(() => {
  provider?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function authorize() {
  const entry = await store.create({ slug: 'fixture', displayName: 'Fixture', url: provider.url, auth: { kind: 'oauth' } });
  const result = await beginMcpAuthorization(entry);
  expect(result.requiresAuth).toBe(true);
  if (!result.requiresAuth) throw new Error('Expected authorization');
  expect(result.desktopFlowId).toBeUndefined();
  const authorization = new URL(result.authUrl);
  expect(authorization.searchParams.get('redirect_uri')).toBe(`${webOrigin}/api/connectors/mcp-oauth/${entry.id}`);
  const consent = await fetch(authorization, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  const finish = (url: URL) => GET(new NextRequest(url), { params: Promise.resolve({ sid: entry.id }) });
  return { entry, callback, finish };
}

it('keeps web MCP OAuth working through persisted state and PKCE, rejecting foreign state and replay', async () => {
  const { entry, callback, finish } = await authorize();
  const foreign = new URL(callback);
  foreign.searchParams.set('state', 'foreign');
  expect(new URL((await finish(foreign)).headers.get('location')!).searchParams.get('error')).toBe('authorization_failed');
  expect(provider.exchanges).toBe(0);
  const response = await finish(callback);
  expect(new URL(response.headers.get('location')!).searchParams.get('connected')).toBe('Fixture');
  expect(provider.exchanges).toBe(1);
  const saved = await store.getOAuthState(entry.id);
  expect(saved?.tokens).toMatchObject({ access_token: provider.token });
  expect(saved?.authorizationState).toBeUndefined();
  expect(saved?.codeVerifier).toBeUndefined();
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(new URL((await finish(callback)).headers.get('location')!).searchParams.get('error')).toBe('authorization_failed');
  expect(provider.exchanges).toBe(1);
});

it('requires valid state for web denial and consumes it without a token exchange', async () => {
  const { entry, callback, finish } = await authorize();
  callback.searchParams.delete('code');
  callback.searchParams.set('error', 'access_denied');
  const forged = new URL(callback);
  forged.searchParams.set('state', 'foreign');
  expect(new URL((await finish(forged)).headers.get('location')!).searchParams.get('error')).toBe('invalid_state');
  expect((await store.getOAuthState(entry.id))?.authorizationState).toBeTruthy();
  expect(new URL((await finish(callback)).headers.get('location')!).searchParams.get('error')).toBe('authorization_cancelled');
  expect((await store.getOAuthState(entry.id))?.authorizationState).toBeUndefined();
  expect(provider.exchanges).toBe(0);
});

it('rejects an expired web callback before attempting exchange', async () => {
  const { entry, callback, finish } = await authorize();
  await store.setOAuthState(entry.id, { ...await store.getOAuthState(entry.id), authorizationExpiresAt: Date.now() - 1 });
  expect(new URL((await finish(callback)).headers.get('location')!).searchParams.get('error')).toBe('authorization_failed');
  expect(provider.exchanges).toBe(0);
});
