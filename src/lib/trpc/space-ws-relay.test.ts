import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { connectTeam, disconnectTeam } from '@/lib/spaces/connect';
import { readTeamKey } from '@/lib/spaces/credentials';
import { teamTRPC } from '@/lib/spaces/remote';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { resetAuthorityCache } from '@/lib/home/authority';
import { ensureLocalToken } from '@/lib/auth/bootstrap';
import { lookupApiToken } from '@/lib/auth/api-token';
import { ApiClient } from '@/lib/api/client';
import * as q from '@/lib/db/queries';
import { appRouter } from './router';
import { createWebSocketServer } from './ws-server';
import { createAppTRPCClient } from './client';
import type { WebSocketRuntime } from './ws-runtime';
import { publishRuntime } from '@/lib/realtime/bus';

let team: TeamProcess, teamRoot: string, home: TestHome, server: http.Server, runtime: WebSocketRuntime, base: string;
let clients: ReturnType<typeof createAppTRPCClient>[], sockets: WebSocket[], frames: string[], requests: string[];
let unauthorizedCalls: number;
beforeAll(async () => { teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-team-ws-child-')); team = await startTeamProcess(teamRoot, 'Team socket', 'Owner', { websocket: true }); }, 90_000);
afterAll(async () => { await team?.stop(); fs.rmSync(teamRoot, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); home = await createTestHome({ prefix: 'ri-team-ws-parent-' }); resetHomeIdentityCache(); resetAuthorityCache(); ensureHomeIdentity(); home.token = ensureLocalToken().plaintext;
  clients = []; sockets = []; frames = []; requests = []; unauthorizedCalls = 0;
  runtime = createWebSocketServer(appRouter);
  server = http.createServer((req, response) => { requests.push(req.url!); response.writeHead(404); response.end(); });
  server.on('upgrade', (req, socket, head) => runtime.upgrade(req, socket, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  for (const client of clients) await client.closeTransport(); for (const socket of sockets) socket.terminate();
  await runtime.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await home.cleanup(); resetHomeIdentityCache(); resetAuthorityCache(); vi.unstubAllEnvs();
});
async function connected() {
  const owner = teamTRPC(team.url, team.ownerToken);
  return connectTeam({ link: (await owner.team.invitations.create.mutate()).link, name: 'Maya' });
}
function client(teamId: string, token = home.token) {
  class TrackedSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); this.on('message', data => frames.push(data.toString())); }
  }
  const client = createAppTRPCClient({ url: `${base}/api/space/${teamId}/trpc`, websocketOnly: true, WebSocket: TrackedSocket as unknown as typeof globalThis.WebSocket,
    transport: new ApiClient({ getToken: () => token, onUnauthorized: () => { unauthorizedCalls++; } }) });
  clients.push(client); return client;
}
function closed(socket: WebSocket) {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The idle relay did not close after revocation.')), 5_000);
    socket.once('close', code => { clearTimeout(timer); resolve(code); });
  });
}
it('relays real typed operations as the connected member, without either private credential in browser frames', async () => {
  const connection = await connected(); const credential = await readTeamKey(connection.id); const remote = client(connection.id);
  expect((await remote.team.me.query()).member.name).toBe('Maya');
  const personal = q.createTask({ title: 'Same title', rawInput: 'Same title' });
  const shared = await remote.tasks.create.mutate({ title: 'Same title', rawInput: 'Same title' });
  expect(shared.id).not.toBe(personal.id);
  expect((await remote.tasks.list.query({})).map(task => task.id)).toContain(shared.id);
  expect(q.getTask(shared.id)).toBeUndefined(); expect(q.getTask(personal.id)?.title).toBe('Same title');
  expect(frames.join('\n')).not.toContain(home.token); expect(frames.join('\n')).not.toContain(credential!.token);
  expect(requests).toEqual([]);
  await expect(remote.userState.list.query()).resolves.toBeDefined();
  await expect(remote.deck.current.query({})).rejects.toMatchObject({ data: { httpStatus: 403 } });
});
it('relays a team page subscription without reading the personal Home event bus', async () => {
  const connection = await connected(); const remote = client(connection.id);
  const received: unknown[] = [];
  let subscription: { unsubscribe(): void } | undefined;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The team page subscription did not become ready.')), 5_000);
    subscription = remote.live.output.subscribe({ s: [], t: [] }, { onData: frame => { received.push(frame); if (frame.event === 'ready') { clearTimeout(timeout); resolve(); } }, onError: error => { clearTimeout(timeout); reject(error); } });
  });
  try {
    const personalChat = q.createChatSession({ harness: 'codex', type: 'orchestration' });
    publishRuntime(personalChat.id, true);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(JSON.stringify(received)).not.toContain(personalChat.id);
    expect(frames.join('\n')).not.toContain(home.token);
    expect(frames.join('\n')).not.toContain((await readTeamKey(connection.id))!.token);
    expect(requests).toEqual([]);
  } finally { subscription?.unsubscribe(); }
});
it('refuses an unrelated viewer credential and a disconnected Home without making an HTTP fallback', async () => {
  const connection = await connected(); const forged = client(connection.id, 'ri_unrelated_credential');
  await expect(forged.team.me.query()).rejects.toThrow(); expect(requests).toEqual([]);
  const remote = client(connection.id); expect((await remote.team.me.query()).member.id).toBe(connection.memberId);
  await disconnectTeam(connection.id);
  await expect(remote.tasks.list.query({})).rejects.toThrow(); expect(requests).toEqual([]);
});
it('revokes an existing relay on personal sign-out and team membership removal', async () => {
  const connection = await connected(); const remote = client(connection.id);
  expect((await remote.team.me.query()).member.id).toBe(connection.memberId);
  const owner = teamTRPC(team.url, team.ownerToken);
  const memberClosed = closed(sockets.at(-1)!);
  await owner.team.removeMember.mutate({ id: connection.memberId });
  expect(await memberClosed).toBe(4403);
  expect(q.getTeamConnection(connection.id)?.status).toBe('revoked');
  expect(lookupApiToken(home.token)).not.toBeNull();
  await expect(remote.tasks.list.query({})).rejects.toThrow();
  expect(requests).toEqual([]);
  // A distinct connection and client can no longer act after its personal key is revoked.
  const second = await connected(); const own = client(second.id); await own.team.me.query();
  const personalClosed = closed(sockets.at(-1)!);
  const host = lookupApiToken(home.token)!;
  q.revokeApiKey(host.key.id, 'Fixture sign-out');
  expect(await personalClosed).toBe(4403);
  await expect(own.tasks.list.query({})).rejects.toThrow(); expect(requests).toEqual([]);
});
it('rejects foreign origins before connecting to the team', async () => {
  const connection = await connected();
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/space/${connection.id}/trpc/ws`, { headers: { origin: 'https://unrelated.test' } }); sockets.push(socket);
  const status = await new Promise<number>(resolve => { socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!); }); socket.once('error', () => {}); });
  expect(status).toBe(403); expect(requests).toEqual([]);
});

it('refuses an identified agent before forwarding a personal viewer credential', async () => {
  const connection = await connected();
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/space/${connection.id}/trpc/ws`, { headers: { 'x-ri-session': 'identified-agent', authorization: `Bearer ${home.token}` } });
  sockets.push(socket);
  const status = await new Promise<number>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!); });
    socket.once('open', () => reject(new Error('An agent reached the relay.')));
    socket.once('error', () => {});
  });
  expect(status).toBe(403);
});
it.each([false, true])('replaces private parameters, redacts escaped credentials and isolates team auth refusal (batch %s)', async batched => {
  const connection = await connected(), credential = (await readTeamKey(connection.id))!;
  const mockServer = http.createServer(); const mock = new WebSocketServer({ server: mockServer });
  let parameters: unknown, receivedHeaders: http.IncomingHttpHeaders = {};
  let refuse = false;
  mock.on('connection', (socket, request) => {
    receivedHeaders = request.headers;
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.method === 'connectionParams') { parameters = message.data; return; }
      if (refuse) {
        const error = { id: message.id, error: { code: -32001, message: 'Team sign-in revoked', data: { code: 'UNAUTHORIZED', httpStatus: 401 } } };
        socket.send(JSON.stringify(batched ? [error] : error)); return;
      }
      const result = message.params.path === 'transport.ping' ? { now: Date.now() } : {
        team: { id: connection.id, name: connection.name, members: 2, hostedOn: null },
        member: { id: connection.memberId, name: credential.token, role: 'member' },
      };
      const encoded = JSON.stringify({ id: message.id, result: { type: 'data', data: result } }).replace(credential.token,
        [...credential.token].map(character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')).join(''));
      socket.send(encoded);
    });
  });
  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  q.saveTeamConnection({ ...connection, url: `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}` });
  const remote = client(connection.id);
  try {
    expect((await remote.team.me.query()).member.name).toBe('[redacted]');
    expect(parameters).toEqual({ token: credential.token, protocol: expect.any(String), documentHome: connection.id, documentViewer: connection.memberId });
    expect(receivedHeaders.authorization).toBe('Bearer ' + credential.token);
    expect(receivedHeaders.cookie).toBeUndefined(); expect(receivedHeaders.origin).toBeUndefined();
    expect(JSON.stringify(parameters)).not.toContain(home.token);
    expect(frames.join('\n')).not.toContain(home.token); expect(frames.join('\n')).not.toContain(credential.token);
    refuse = true;
    await expect(remote.team.me.query()).rejects.toThrow();
    expect(q.getTeamConnection(connection.id)?.status).toBe('revoked');
    expect(unauthorizedCalls).toBe(0); expect(lookupApiToken(home.token)).not.toBeNull();
  } finally {
    await remote.closeTransport(); for (const peer of mock.clients) peer.terminate();
    await new Promise<void>(resolve => mock.close(() => resolve())); await new Promise<void>(resolve => mockServer.close(() => resolve()));
  }
});


it('refuses a fresh embedded socket that still names the old connected member', async () => {
  const original=await connected();await disconnectTeam(original.id);const replacement=await connected();
  expect(replacement.memberId).not.toBe(original.memberId);
  const socket=new WebSocket(`${base.replace('http:','ws:')}/api/space/${replacement.id}/trpc/ws`);sockets.push(socket);
  const refused=closed(socket);
  await new Promise<void>(resolve=>socket.once('open',resolve));
  socket.send(JSON.stringify({method:'connectionParams',data:{token:home.token,protocol:'1',documentHome:original.id,documentViewer:original.memberId}}));
  expect(await refused).toBe(4403);expect(requests).toEqual([]);
});
