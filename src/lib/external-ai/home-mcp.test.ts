import { NextRequest } from 'next/server';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { HOME_CONTENT_ACTIONS, HOME_MCP_PATH } from './policy';
import { homeMcpAddress } from './address';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/embeddings/embed')>()), generateEmbedding: vi.fn(async () => { throw new Error('No model in this test'); }), upsertEmbedding: vi.fn(async () => {}), deleteEmbedding: vi.fn() }));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));
vi.setConfig({ testTimeout: 60_000 });

let home: TestHome;
let viewer: string;
const clients: Client[] = [];
const BASE = 'http://home.test';

beforeAll(async () => {
  await Promise.all([import('@/proxy'), import('@/app/api/orchestrator/[transport]/route'), import('./router')]);
}, 120_000);
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-personal-mcp-' });
  const q = await import('@/lib/db/queries');
  viewer = q.pairDevice({ name: 'Laptop', kind: 'computer' }).token.plaintext;
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await home.cleanup();
});

function forwarded(auth: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of auth.headers) {
    if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
  }
  return headers;
}
async function serve(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new NextRequest(input instanceof Request ? input : String(input), { ...init, signal: init?.signal ?? undefined });
  const { proxy } = await import('@/proxy');
  const auth = proxy(request);
  if (auth.headers.get('x-middleware-next') !== '1') return auth;
  const route = await import('@/app/api/orchestrator/[transport]/route');
  return route[request.method as 'GET' | 'POST' | 'DELETE'](new NextRequest(request, { headers: forwarded(auth) }));
}
async function connect(token: string, headers: Record<string, string> = {}) {
  const client = new Client({ name: 'outside-assistant', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}${HOME_MCP_PATH}`), {
    fetch: serve as typeof fetch, requestInit: { headers: { authorization: `Bearer ${token}`, ...headers } },
  }));
  return client;
}
async function settings(token = viewer) {
  const { proxy } = await import('@/proxy');
  const { createTRPCContext } = await import('@/lib/trpc/init');
  const { externalAiRouter } = await import('./router');
  const request = new NextRequest(`${BASE}/api/trpc/externalAi.list`, { headers: { authorization: `Bearer ${token}`, origin: 'https://untrusted.example' } });
  const auth = proxy(request);
  return externalAiRouter.createCaller(createTRPCContext(new Request(request.url, { headers: forwarded(auth) })));
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  // A tool the server never registered is refused at the protocol level (MCP SDK 2.x), not as a result.
  const result = await client.callTool({ name, arguments: args }).catch((error: Error & { code?: number }) => {
      if (error.code !== -32602 || !/not found/i.test(error.message)) throw error;
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  return { isError: !!result.isError, text, json: () => JSON.parse(text) };
}

it('issues one-time credentials through viewer settings with a saved remote address, never the request origin', async () => {
  const { setRemoteBaseUrl } = await import('@/lib/auth/bootstrap');
  setRemoteBaseUrl('https://my-home.example');
  const api = await settings();
  const made = await api.create({ name: '  Laptop  Claude ' });
  expect(made).toMatchObject({ client: { name: 'Laptop Claude', lastUsedAt: null }, mcpUrl: `https://my-home.example${HOME_MCP_PATH}`, reachable: true });
  expect(made.token).toBeTruthy();
  expect(await api.list()).toEqual([made.client]);
  expect(Object.keys(made.client).sort()).toEqual(['createdAt', 'keyId', 'lastUsedAt', 'name']);
  const q = await import('@/lib/db/queries');
  expect(q.getApiKey(made.client.keyId)?.hash).not.toBe(made.token);
});

it('discovers only content tools and refuses calls to private or hidden tools by name', async () => {
  const { token } = await (await settings()).create({ name: 'Codex' });
  const client = await connect(token, { 'x-ri-api-key-scope': 'viewer', 'x-ri-caller-location': 'home', 'x-ri-member-id': 'owner', 'x-ri-session': 'forged.session' });
  expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([...HOME_CONTENT_ACTIONS].sort());
  for (const name of ['describe_paths', 'describe_schema', 'delegate_work', 'list_sessions', 'message_agent', 'regenerate_deck', 'report_result', 'get_result', 'list_results', 'query', 'run_sql']) {
    expect((await call(client, name)).isError, name).toBe(true);
  }
});

it('reads, creates and edits real tasks and notes, with normal mirrors, revisions and search', async () => {
  const q = await import('@/lib/db/queries');
  const { token } = await (await settings()).create({ name: 'My assistant' });
  const client = await connect(token);
  const task = (await call(client, 'create_task', { title: 'Book trip', rawInput: 'Book trip', body: 'Compare trains' })).json().result;
  expect(task.id).toBeTruthy();
  const note = (await call(client, 'create_note', { title: 'Trip decisions', body: 'Compare trains', kind: 'decision' })).json().result;
  expect(note.id).toBeTruthy();
  expect((await call(client, 'update_note', { id: note.id, body: 'Take the train', expected_body_revision: note.bodyRevision })).json().ok).toBe(true);
  expect((await call(client, 'update_note', { id: note.id, body: 'A stale replacement', expected_body_revision: note.bodyRevision })).json()).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(q.getNote(note.id)?.body).toBe('Take the train');
  expect((await call(client, 'get_task', { id: task.id })).json().result.body).toBe('Compare trains');
  expect((await call(client, 'search', { query: 'trip' })).json().result.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([task.id, note.id]));
  const fs = await import('node:fs');
  const { findByIdInType } = await import('@/lib/export/mirror/fs');
  await vi.waitFor(async () => {
    const files = await findByIdInType('note', note.id);
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(files[0], 'utf8')).toContain('Take the train');
  });
});

it('keeps capture stream entries out of external search without changing normal search', async () => {
  const q = await import('@/lib/db/queries');
  q.createNote({ title: 'Zebracactus note', body: 'Zebracactus' });
  const stream = q.createStream({ rawText: 'Zebracactus private capture', source: 'capture' });
  const { hybridSearchWithEntities } = await import('@/lib/embeddings/search');
  expect((await hybridSearchWithEntities('Zebracactus')).some(row => row.id === stream.id)).toBe(true);
  const { token } = await (await settings()).create({ name: 'Claude' });
  const result = (await call(await connect(token), 'search', { query: 'Zebracactus' })).json();
  expect(result.ok).toBe(true);
  expect(result.result).toHaveLength(1);
  expect(result.result[0].type).toBe('note');
});

it('refuses browser, WebSocket, team, files, NL MCP and administrative access', async () => {
  const { token } = await (await settings()).create({ name: 'Outside' });
  const { proxy } = await import('@/proxy');
  for (const path of ['/api/trpc/tasks.list', '/api/trpc/externalAi.create', '/api/orchestrator/sse', '/api/mcp', '/api/team/mcp', '/api/attachments/example.txt', '/api/workers/me', '/api/settings/base-url']) {
    const response = proxy(new NextRequest(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-ri-api-key-scope': 'viewer' } }));
    expect(response.status, path).toBe(403);
  }
  const { POST } = await import('@/app/api/session/route');
  expect((await POST(new NextRequest(`${BASE}/api/session`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }))).status).toBe(401);
  const { createWebSocketContext } = await import('@/lib/trpc/ws-auth');
  expect(() => createWebSocketContext(new Request(BASE, { headers: { authorization: `Bearer ${token}` } }), {})).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  await expect((await settings(token)).create({ name: 'Cannot mint another key' })).rejects.toThrow();
});

it('revokes at the next request, even for an already initialized MCP client, and leaves other clients working', async () => {
  const api = await settings();
  const first = await api.create({ name: 'Laptop' });
  const second = await api.create({ name: 'Work' });
  const client = await connect(first.token);
  expect((await call(client, 'list_tasks')).json().ok).toBe(true);
  expect((await api.list()).find(row => row.keyId === first.client.keyId)?.lastUsedAt).toBeTruthy();
  await api.revoke({ keyId: first.client.keyId });
  await api.revoke({ keyId: first.client.keyId });
  await expect(call(client, 'list_tasks')).rejects.toThrow(/unauthorized/);
  expect((await call(await connect(second.token), 'list_tasks')).json().ok).toBe(true);
  expect((await api.list()).map(row => row.keyId)).toEqual([second.client.keyId]);
});

it('does not claim external keys as host sign-ins at restart or revoke browser keys from this pane', async () => {
  const q = await import('@/lib/db/queries');
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  const host = ensureLocalToken();
  ensureHomeIdentity();
  const made = await (await settings()).create({ name: 'Assistant' });
  q.giveHostItsKeys();
  expect(q.getApiKey(made.client.keyId)?.deviceId).toBeNull();
  const { lookupApiToken } = await import('@/lib/auth/api-token');
  const hostKey = lookupApiToken(host.plaintext)!.key;
  await (await settings()).revoke({ keyId: hostKey.id });
  expect(lookupApiToken(host.plaintext)).not.toBeNull();
  expect((await call(await connect(made.token), 'list_tasks')).json().ok).toBe(true);
});

it('still gives a regular viewer the full orchestrator tools', async () => {
  const client = await connect(viewer);
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['describe_paths', 'delegate_work', 'search']));
});

it('checks expiration and the scoped dispatcher again, even if a request passed the proxy earlier', async () => {
  const q = await import('@/lib/db/queries');
  const made = await (await settings()).create({ name: 'Temporary' });
  const { runAction } = await import('@/lib/orchestrator/dispatch');
  const ctx = { remote: true, caller: { location: 'elsewhere' as const, scope: 'home_content' as const, apiKeyId: made.client.keyId } };
  expect((await runAction('describe_paths', {}, ctx)).ok).toBe(false);
  q.revokePersonalAiClient(made.client.keyId);
  expect((await runAction('list_tasks', {}, ctx)).ok).toBe(false);
  const expired = q.createApiKey({ role: 'ai_client', name: 'Expired', deviceId: null, memberId: null, expiresAt: '2000-01-01T00:00:00.000Z' });
  expect((await runAction('list_tasks', {}, { ...ctx, caller: { ...ctx.caller, apiKeyId: expired.key.id } })).ok).toBe(false);
  await expect(connect(expired.token.plaintext)).rejects.toThrow(/unauthorized/);
});

it('rejects insecure or credential-bearing remote URLs before creating credentials', async () => {
  expect(homeMcpAddress(null, 'http://localhost:4224')).toEqual({ mcpUrl: `http://localhost:4224${HOME_MCP_PATH}`, reachable: false });
  for (const remote of ['http://home.example', 'https://name:secret@home.example', 'https://home.example/path', 'https://home.example/?leak=1', 'file:///tmp/home']) {
    expect(() => homeMcpAddress(remote, 'http://localhost:4224'), remote).toThrow();
  }
  const { setRemoteBaseUrl } = await import('@/lib/auth/bootstrap');
  setRemoteBaseUrl('http://home.example');
  const api = await settings();
  await expect(api.create({ name: 'Blocked' })).rejects.toThrow(/HTTPS/);
  expect(await api.list()).toEqual([]);
});

it('refuses personal client management and personal-shaped keys on a team', async () => {
  const { createTeamTestHome } = await import('@/test/fixtures/team-home');
  const team = await createTeamTestHome('ri-mcp-team-isolation-');
  try {
    const q = await import('@/lib/db/queries');
    expect(() => q.createPersonalAiClient('Wrong home')).toThrow(/team space/);
    expect(() => q.listPersonalAiClients()).toThrow(/team space/);
    expect(() => q.revokePersonalAiClient('anything')).toThrow(/team space/);
    const stray = q.createApiKey({ role: 'ai_client', name: 'No member', memberId: null, deviceId: null });
    const { proxy } = await import('@/proxy');
    for (const path of [HOME_MCP_PATH, '/api/team/mcp']) {
      const response = proxy(new NextRequest(`${BASE}${path}`, { headers: { authorization: `Bearer ${stray.token.plaintext}` } }));
      expect(response.status).toBe(401);
    }
  } finally { await team.cleanup(); }
});
