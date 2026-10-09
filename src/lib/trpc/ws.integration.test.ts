import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import getPort from 'get-port';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { z } from 'zod/v4';
import { tracked } from '@trpc/server';
import { subscribeTerminalOutput } from '@/lib/realtime/terminal-transport';
import { terminalSubscriptionInput } from './terminal-subscription';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ApiClient, apiErrorStatus, apiErrorCode } from '@/lib/api/client';
import { router, viewerProcedure as p } from './init';
import { createWebSocketContext } from './ws-auth';
import { createWebSocketServer } from './ws-server';
import { createAppTRPCClient } from './client';
import type { WebSocketRuntime } from './ws-runtime';
import type { TransportMode } from './transport-state';
import { getTransportStatus } from './transport-state';

let home: TestHome;
let server: http.Server;
let runtime: WebSocketRuntime;
let base: string;
let writes: string[];
let httpPaths: string[];
let sockets: WebSocket[];
let clients: ReturnType<typeof createAppTRPCClient>[];
let failAfterWrite: boolean;
let failRead: boolean;
let supported: boolean;
let pauseWrite: Promise<void> | undefined;
let outputCursors: (number | null)[];

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-ws-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const bootstrap = await import('@/lib/auth/bootstrap');
  home.token = bootstrap.ensureLocalToken().plaintext;
  writes = []; httpPaths = []; sockets = []; clients = [];
  failAfterWrite = false; failRead = false; supported = true;
  pauseWrite = undefined;
  outputCursors = [];
  const fixture = router({
    transport: router({ capabilities: p.query(() => ({ websocket: supported })), ping: p.query(() => ({ now: Date.now() })) }),
    tasks: router({
      list: p.query(async ({ ctx }) => {
        if (failRead && new URL(ctx.request.url).pathname === '/api/trpc/ws') {
          sockets.at(-1)!.terminate();
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return writes.map((title, index) => ({ id: String(index), title }));
      }),
      create: p.input(z.object({ title: z.string(), rawInput: z.string() })).mutation(async ({ input, ctx }) => {
        writes.push(input.title);
        await pauseWrite;
        if (failAfterWrite && new URL(ctx.request.url).pathname === '/api/trpc/ws') {
          sockets.at(-1)!.terminate();
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return { id: String(writes.length - 1), title: input.title };
      }),
      update: p.input(z.object({ id: z.string(), patch: z.object({ title: z.string() }) })).mutation(({ input }) => {
        writes[Number(input.id)] = input.patch.title;
        return { id: input.id, title: input.patch.title };
      }),
    }),
    terminals: router({ output: p.input(terminalSubscriptionInput).subscription(async function* ({ input, signal }) {
      outputCursors.push(input.after);
      yield tracked(String(input.after ?? 0), { event: 'ready' as const, data: { id: input.terminalId, resumed: input.after !== null } });
      const id = String((input.after ?? 0) + 1);
      yield tracked(id, { event: 'data' as const, data: 'output', id });
      await new Promise<void>(resolve => {
        if (signal!.aborted) resolve();
        else signal!.addEventListener('abort', () => resolve(), { once: true });
      });
    }) }),
  });
  runtime = createWebSocketServer(fixture);
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    httpPaths.push(url.pathname);
    void nodeHTTPRequestHandler({ req, res, path: url.pathname.replace('/api/trpc/', ''), router: fixture,
      createContext: () => createWebSocketContext(new Request(url, { headers: req.headers as Record<string, string> }), null),
    });
  });
  server.on('upgrade', (req, socket, head) => runtime.upgrade(req, socket, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  for (const client of clients) await client.closeTransport();
  for (const socket of sockets) socket.terminate();
  await runtime.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function client(getMode: () => TransportMode = () => 'websocket', token: string | (() => string) = home.token, websocketOnly = false) {
  class TrackedSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); }
  }
  const c = createAppTRPCClient({ url: `${base}/api/trpc`, getMode, websocketOnly, WebSocket: TrackedSocket as unknown as typeof globalThis.WebSocket,
    transport: new ApiClient({ getToken: () => typeof token === 'function' ? token() : token, onUnauthorized: () => {} }) });
  clients.push(c);
  return c;
}

it('delivers bounded app-sized resources without dropping the socket or retrying a mutation',async()=>{
  writes.push('x'.repeat(2*1024*1024));
  const c=client();
  expect((await c.tasks.list.query())[0].title.length).toBe(2*1024*1024);
  await c.tasks.create.mutate({title:'After the resource',rawInput:'After the resource'});
  expect(writes).toHaveLength(2);
  expect(sockets).toHaveLength(1);
  expect(httpPaths.every(path=>path==='/api/trpc/transport.capabilities')).toBe(true);
});

it('keeps the terminal socket independent of HTTP preference and API diagnostics', async () => {
  const previous = getTransportStatus();
  const c = client(() => 'http', home.token, true);
  await c.tasks.create.mutate({ title: 'Strict socket', rawInput: 'Strict socket' });
  expect(await c.tasks.list.query()).toEqual([{ id: '0', title: 'Strict socket' }]);
  expect(sockets).toHaveLength(1);
  expect(httpPaths).toEqual([]);
  expect(getTransportStatus()).toBe(previous);
});

it('refuses terminal writes when WS is disabled without any HTTP fallback', async () => {
  vi.stubEnv('RI_TRPC_WS_DISABLED', '1');
  const c = client(() => 'http', home.token, true);
  const error = await c.tasks.create.mutate({ title: 'Never HTTP', rawInput: 'Never HTTP' }).catch(error => error);
  expect(apiErrorStatus(error)).toBe(503);
  expect(apiErrorCode(error)).toBe('websocket_unavailable');
  expect(writes).toEqual([]);
  expect(httpPaths).toEqual([]);
});

it('does not retry a disconnected terminal read over HTTP', async () => {
  const c = client(() => 'http', home.token, true);
  await c.tasks.create.mutate({ title: 'Strict read', rawInput: 'Strict read' });
  failRead = true;
  const error = await c.tasks.list.query().catch(error => error);
  expect(apiErrorStatus(error)).toBe(503);
  expect(httpPaths).toEqual([]);
});

it('does not replay unconfirmed terminal writes on either transport', async () => {
  const c = client(() => 'http', home.token, true);
  await c.tasks.list.query();
  failAfterWrite = true;
  const error = await c.tasks.create.mutate({ title: 'Once on WS', rawInput: 'Once on WS' }).catch(error => error);
  expect(apiErrorStatus(error)).toBe(424);
  expect(writes).toEqual(['Once on WS']);
  expect(httpPaths).toEqual([]);
});

it.each([{ httpOnly: true }, { headers: { 'x-ri-device-id': 'viewer' } }])('never allows an HTTP escape hatch on the terminal socket (%j)', async context => {
  const c = client(() => 'http', home.token, true);
  const error = await c.tasks.list.query(undefined, { context }).catch(error => error);
  expect(apiErrorStatus(error)).toBe(503);
  expect(httpPaths).toEqual([]);
  expect(sockets).toHaveLength(0);
});

it('reconnects terminal output after a real disconnect with the delivered cursor and no SSE', async () => {
  const c = client(() => 'http', home.token, true);
  const position = { after: 5 as number | null };
  const listener = vi.fn();
  const stop = subscribeTerminalOutput('/sessions/chat', 'shell', position, listener, {
    document: undefined,
    ws: (deliver, fail) => {
      const subscription = c.terminals.output.subscribe({ base: '/sessions/chat', terminalId: 'shell', after: position.after }, {
        onData: ({ data }) => deliver(data), onError: fail, onComplete: fail,
      });
      return () => subscription.unsubscribe();
    },
  });
  try {
    await vi.waitFor(() => expect(position.after).toBe(6));
    sockets.at(-1)!.terminate();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('unavailable', { message: 'The terminal WebSocket is disconnected. Reconnecting.' }));
    await vi.waitFor(() => expect(position.after).toBe(7), { timeout: 5_000 });
    expect(outputCursors).toEqual([5, 6]);
    expect(httpPaths).toEqual([]);
    expect(sockets).toHaveLength(2);
  } finally { stop(); }
});

it.each([null, 'http'])('honors the browser default and saved HTTP rollback for reads and writes (%s)', async saved => {
  vi.stubGlobal('window', { location: new URL(base), localStorage: { getItem: () => saved }, addEventListener: vi.fn() });
  const c = createAppTRPCClient({ url: `${base}/api/trpc`, WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    transport: new ApiClient({ getToken: () => home.token, onUnauthorized: () => {} }) });
  clients.push(c);
  await c.tasks.create.mutate({ title: 'Default socket', rawInput: 'Default socket' });
  expect(await c.tasks.list.query()).toEqual([{ id: '0', title: 'Default socket' }]);
  expect(httpPaths).toEqual(saved === 'http' ? ['/api/trpc/tasks.create', '/api/trpc/tasks.list'] : ['/api/trpc/transport.capabilities']);
});

it('negotiates once and runs typed reads and writes on one socket, with HTTP rollback', async () => {
  let mode: TransportMode = 'websocket';
  const c = client(() => mode);
  await c.tasks.create.mutate({ title: 'Socket', rawInput: 'Socket' });
  expect(await c.tasks.list.query()).toEqual([{ id: '0', title: 'Socket' }]);
  expect(sockets).toHaveLength(1);
  expect(httpPaths).toEqual(['/api/trpc/transport.capabilities']);
  mode = 'http';
  await c.tasks.create.mutate({ title: 'HTTP', rawInput: 'HTTP' });
  expect(await c.tasks.list.query()).toHaveLength(2);
  expect(httpPaths).toContain('/api/trpc/tasks.create');
  expect(writes).toEqual(['Socket', 'HTTP']);
});

it('falls back before sending writes when the Home has no socket capability', async () => {
  supported = false;
  const c = client();
  await c.tasks.create.mutate({ title: 'Fallback', rawInput: 'Fallback' });
  expect(writes).toEqual(['Fallback']);
  expect(sockets).toHaveLength(0);
});

it('does not replay a write that reached Home but lost its acknowledgement', async () => {
  const c = client();
  await c.tasks.list.query();
  failAfterWrite = true;
  let error: unknown;
  try { await c.tasks.create.mutate({ title: 'Once', rawInput: 'Once' }); } catch (caught) { error = caught; }
  expect(apiErrorStatus(error)).toBe(424);
  expect(apiErrorCode(error)).toBe('unconfirmed_write');
  expect(writes).toEqual(['Once']);
  expect(httpPaths).not.toContain('/api/trpc/tasks.create');
  expect(await c.tasks.list.query()).toEqual([{ id: '0', title: 'Once' }]);
});

it('retries a disconnected read over HTTP', async () => {
  const c = client();
  await c.tasks.create.mutate({ title: 'Read me', rawInput: 'Read me' });
  failRead = true;
  expect(await c.tasks.list.query()).toHaveLength(1);
  expect(httpPaths).toContain('/api/trpc/tasks.list');
});

it('isolates custom operation headers on HTTP', async () => {
  const c = client();
  await c.tasks.list.query();
  await c.tasks.create.mutate({ title: 'HTTP context', rawInput: 'HTTP context' }, { context: { headers: { 'x-ri-device-id': 'viewer' } } });
  expect(httpPaths).toContain('/api/trpc/tasks.create');
  expect(writes).toEqual(['HTTP context']);
});

it('revalidates a revoked key before any further effect on an open socket', async () => {
  const c = client();
  await c.tasks.list.query();
  const q = await import('@/lib/db/queries');
  const { hashToken } = await import('@/lib/auth/tokens');
  q.revokeApiKey(q.findApiKeyByHash(hashToken(home.token))!.id);
  await expect(c.tasks.create.mutate({ title: 'Refused', rawInput: 'Refused' })).rejects.toMatchObject({ data: { httpStatus: 401 } });
  expect(writes).toEqual([]);
});

it('rejects foreign browser origins before upgrading, even with a cookie', async () => {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/trpc/ws', { headers: { origin: 'https://foreign.example', cookie: `ri_session=${home.token}` } });
  sockets.push(ws);
  const status = await new Promise<number>(resolve => {
    ws.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); ws.terminate(); });
    ws.on('error', () => {});
  });
  expect(status).toBe(403);
});

it('rejects protocol mismatches and forged viewer headers in the first message', async () => {
  const request = new Request(base + '/api/trpc/ws', { headers: { 'x-ri-api-key-id': 'forged', 'x-ri-caller-location': 'home' } });
  expect(() => createWebSocketContext(request, { token: 'invalid', protocol: '1' })).toThrow();
  try { createWebSocketContext(request, { token: home.token, protocol: '999' }); throw new Error('accepted'); }
  catch (error) { expect((error as { cause: { status: number } }).cause.status).toBe(426); }
  const ctx = createWebSocketContext(request, { token: home.token, protocol: '1' });
  expect(ctx.key!.apiKeyId).not.toBe('forged');
});

it('admits reads during drain, blocks new work, and refuses upgrades while offline', async () => {
  const c = client();
  await c.tasks.list.query();
  const { writeMaintenance, clearMaintenance } = await import('@/lib/service/maintenance');
  writeMaintenance({ phase: 'draining', token: 'test', startedAt: new Date().toISOString() });
  try {
    expect(await c.tasks.list.query()).toEqual([]);
    await expect(c.tasks.create.mutate({ title: 'Refused', rawInput: 'Refused' })).rejects.toMatchObject({ data: { httpStatus: 503 } });
    expect(writes).toEqual([]);
    await c.tasks.update.mutate({ id: '0', patch: { title: 'Drain save' } });
    expect(writes).toEqual(['Drain save']);
  } finally { clearMaintenance(); }
});

it('refuses upgrades in offline and validation phases', async () => {
  const { writeMaintenance, clearMaintenance } = await import('@/lib/service/maintenance');
  const refused = () => new Promise<number>(resolve => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/trpc/ws');
    sockets.push(ws);
    ws.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode!); ws.terminate(); });
    ws.on('error', () => {});
  });
  writeMaintenance({ phase: 'offline', token: 'test', startedAt: new Date().toISOString() });
  try { expect(await refused()).toBe(503); } finally { clearMaintenance(); }
  vi.stubEnv('RI_SERVICE_VALIDATING', '1');
  expect(await refused()).toBe(503);
});

it('rejects worker and expired keys without treating them as viewers', async () => {
  const q = await import('@/lib/db/queries');
  const worker = q.createApiKey({ name: 'Worker', role: 'worker', deviceId: null });
  const expired = q.createApiKey({ name: 'Expired', role: 'sign_in', deviceId: null, expiresAt: '2000-01-01T00:00:00Z' });
  const request = new Request(base + '/api/trpc/ws');
  expect(() => createWebSocketContext(request, { token: worker.token.plaintext, protocol: '1' })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  expect(() => createWebSocketContext(request, { token: expired.token.plaintext, protocol: '1' })).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }));
});

it('authenticates through the TLS gateway with the public origin and closes upgraded sockets on shutdown', async () => {
  const { ensureGeneratedTls } = await import('@/lib/config/tls');
  const { startHttp2Gateway } = await import('@/cli/http2-gateway');
  const tls = await ensureGeneratedTls();
  const publicPort = await getPort();
  const origin = `https://localhost:${publicPort}`;
  const gateway = await startHttp2Gateway({ publicPort, publicBaseUrl: origin, upstreamHost: '127.0.0.1', upstreamPort: (server.address() as AddressInfo).port, tls });
  const ws = new WebSocket(origin.replace('https:', 'wss:') + '/api/trpc/ws?connectionParams=1', { ca: tls.probeCa, headers: { origin } });
  sockets.push(ws);
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ method: 'connectionParams', data: { token: home.token, protocol: '1' } }));
    const reply = new Promise<string>(resolve => ws.once('message', data => resolve(String(data))));
    ws.send(JSON.stringify({ id: 1, method: 'query', params: { path: 'transport.ping' } }));
    expect(JSON.parse(await reply)).toMatchObject({ id: 1, result: { type: 'data', data: { now: expect.any(Number) } } });
    const closed = new Promise(resolve => ws.once('close', resolve));
    await gateway.close(50);
    await closed;
  } finally { ws.terminate(); await gateway.close(50); }
}, 30_000);

it('closes an idle authorized socket promptly after revocation', async () => {
  const c = client();
  await c.tasks.list.query();
  const ws = sockets.at(-1)!;
  const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));
  const q = await import('@/lib/db/queries');
  const { hashToken } = await import('@/lib/auth/tokens');
  q.revokeApiKey(q.findApiKeyByHash(hashToken(home.token))!.id);
  expect(await closed).toBe(4401);
}, 5_000);

it('drops home-machine privileges when the host token changes on an open connection', async () => {
  const ctx = createWebSocketContext(new Request(base + '/api/trpc/ws'), { token: home.token, protocol: '1' });
  expect(ctx.key!.location).toBe('home');
  const { writeAuthConfig } = await import('@/lib/auth/config-file');
  writeAuthConfig({ localToken: 'a-new-host-token' });
  ctx.authorize();
  expect(ctx.key!.location).toBe('elsewhere');
  expect(ctx.request.headers.get('x-ri-caller-location')).toBe('elsewhere');
});

it('reauthenticates a changed token before sending another operation', async () => {
  let token = home.token;
  const c = client(() => 'websocket', () => token);
  await c.tasks.list.query();
  const q = await import('@/lib/db/queries');
  token = q.pairDevice({ name: 'Fresh viewer', kind: 'phone' }).token.plaintext;
  const { hashToken } = await import('@/lib/auth/tokens');
  q.revokeApiKey(q.findApiKeyByHash(hashToken(home.token))!.id);
  await c.tasks.create.mutate({ title: 'Fresh credential', rawInput: 'Fresh credential' });
  expect(writes).toEqual(['Fresh credential']);
  expect(sockets).toHaveLength(2);
});

it('finishes a sent write on its original socket while new operations switch to HTTP', async () => {
  let mode: TransportMode = 'websocket';
  let release = () => {};
  pauseWrite = new Promise<void>(resolve => { release = resolve; });
  const c = client(() => mode);
  await c.tasks.list.query();
  const pending = c.tasks.create.mutate({ title: 'Keep the acknowledgement', rawInput: 'Keep the acknowledgement' });
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  const ws = sockets.at(-1)!;
  mode = 'http';
  expect(await c.tasks.list.query()).toHaveLength(1);
  expect(ws.readyState).toBe(WebSocket.OPEN);
  release();
  await pending;
  await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
  expect(httpPaths).not.toContain('/api/trpc/tasks.create');
  expect(writes).toHaveLength(1);
});
