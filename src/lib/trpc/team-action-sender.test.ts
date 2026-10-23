/**
 * Probe (review7): a disclosed Team agent (member key + Team-signed x-ri-session)
 * using the action-bar routes (commit, PR, resolve conflicts, help with error)
 * over the real Team WebSocket and over HTTP. Does the stored user event keep
 * senderSessionId and does the delivered prompt carry the sender label, as the
 * ordinary messagesPost now does?
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import { ApiClient } from '@/lib/api/client';
import { createAppTRPCClient } from '@/lib/trpc/client';
import { appRouter } from '@/lib/trpc/router';
import { createWebSocketServer } from '@/lib/trpc/ws-server';
import { settledTeamAi, stopTeamAiWork } from '@/lib/team/ai/chat';
import { closeAllSessions } from '@/lib/runner/local-runner';

vi.mock('@/lib/executor/owner-files', async original => ({ ...await original<typeof import('@/lib/executor/owner-files')>(), executionDiff: vi.fn(async () => ({ ok: true, diff: { files: [] } })) }));
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, fake: FakeHarness;
let server: http.Server, runtime: ReturnType<typeof createWebSocketServer>, base: string;
const clients: ReturnType<typeof createAppTRPCClient>[] = [];
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  fixture = await createTeamExecutionFixture(); fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  runtime = createWebSocketServer(appRouter);
  server = http.createServer((_req, res) => { res.writeHead(599); res.end('No HTTP fallback'); });
  server.on('upgrade', (req, socket, head) => runtime.upgrade(req, socket, head));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.closeTransport();
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions();
  await runtime.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fake.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
function client(token: string, credential?: string) {
  class Socket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols, { headers: credential ? { 'x-ri-session': credential } : {} }); }
  }
  const value = createAppTRPCClient({ url: `${base}/api/trpc`, getMode: () => 'websocket', websocketOnly: true,
    WebSocket: Socket as unknown as typeof globalThis.WebSocket, transport: new ApiClient({ getToken: () => token, onUnauthorized: () => {} }) });
  clients.push(value); return value;
}
function target(label: string) {
  q.updateWorkspace(fixture.workspace.id, { isGit: true, baseBranch: 'main' });
  return q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label, branchName: 'feature', worktreePath: fixture.workspace.cwd, surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'auto_all' }).session;
}

it('WS: disclosed agent action-bar prompts keep sender attribution', async () => {
  const parent = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'ask', label: 'Sending chat', createdByMemberId: fixture.member.member.id });
  const agent = client(fixture.member.token.plaintext, sessionCredential(parent.id)!);
  const prompts: Record<string, string> = {};
  let current = '';
  fake.onTurn(async turn => { prompts[current] = turn.message; await turn.say('ok'); });
  const routes: [string, (id: string) => Promise<unknown>][] = [
    ['messagesPost', id => agent.sessions.messagesPost.mutate({ params: { id }, body: { content: 'Plain message' } } as never)],
    ['commitPost', id => agent.sessions.commitPost.mutate({ params: { id }, body: {} })],
    ['prPost', id => agent.sessions.prPost.mutate({ params: { id }, body: {} })],
    ['resolveConflictsPost', id => agent.sessions.resolveConflictsPost.mutate({ params: { id }, body: { scenario: 'pr_vs_base' } })],
    ['helpWithErrorPost', id => agent.sessions.helpWithErrorPost.mutate({ params: { id }, body: { action: 'Build', error: 'boom' } })],
    ['team.ai.send', id => agent.team.ai.send.mutate({ chatId: id, clientSendId: `send-${id}`, text: 'Legacy team send' })],
  ];
  const results: Record<string, unknown> = {};
  for (const [name, run] of routes) {
    const chat = target(name); current = name;
    try { await run(chat.id); } catch (error) { throw new Error(`${name}: ${String(error)}`); }
    await settledTeamAi();
    const user = q.listChatEvents(chat.id).filter(event => event.role === 'user');
    expect(q.listTeamChatTurns(chat.id)).toEqual([expect.objectContaining({ memberId: fixture.member.member.id, status: 'done' })]);
    results[name] = { userEvents: user.length, sender: user.map(event => event.senderSessionId ?? null), labelled: (prompts[name] ?? '').includes('[Message from'), promptSeen: Boolean(prompts[name]) };
  }
  for (const [name] of routes) {
    expect.soft((results[name] as { sender: unknown[] }).sender, `${name} stored sender`).toEqual([parent.id]);
    expect.soft((results[name] as { labelled: boolean }).labelled, `${name} delivered label`).toBe(true);
  }
}, 90_000);

it('HTTP: disclosed agent commit prompt keeps sender attribution', async () => {
  vi.stubGlobal('fetch', serveTeam);
  const parent = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'ask', label: 'Sending chat', createdByMemberId: fixture.member.member.id });
  const prompts: string[] = [];
  fake.onTurn(async turn => { prompts.push(turn.message); await turn.say('ok'); });
  const chat = target('http-commit');
  const headers = { authorization: `Bearer ${fixture.member.token.plaintext}`, [SESSION_CREDENTIAL_HEADER]: sessionCredential(parent.id)!, [API_PROTOCOL_HEADER]: String(API_PROTOCOL), 'content-type': 'application/json' };
  const res = await serveTeam('http://team.test/api/trpc/sessions.commitPost', { method: 'POST', headers, body: JSON.stringify({ params: { id: chat.id }, body: {} }) });
  expect(res.status).toBe(200);
  await settledTeamAi();
  const user = q.listChatEvents(chat.id).filter(event => event.role === 'user');
  expect.soft(user.map(event => event.senderSessionId ?? null)).toEqual([parent.id]);
  expect.soft(prompts.some(p => p.includes('[Message from'))).toBe(true);
  const plain = target('http-message');
  const res2 = await serveTeam('http://team.test/api/trpc/sessions.messagesPost', { method: 'POST', headers, body: JSON.stringify({ params: { id: plain.id }, body: { content: 'Plain HTTP message' } }) });
  expect(res2.status).toBe(200);
  await settledTeamAi();
}, 90_000);
