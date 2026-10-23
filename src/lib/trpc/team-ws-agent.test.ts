/** Real WebSocket and real application router, with fake provider discovery. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import * as q from '@/lib/db/queries';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import { ApiClient } from '@/lib/api/client';
import { createAppTRPCClient } from './client';
import { appRouter } from './router';
import { createWebSocketServer } from './ws-server';
import { settledTeamAi, stopTeamAiWork } from '@/lib/team/ai/chat';
import { closeAllSessions } from '@/lib/runner/local-runner';

vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, fake: FakeHarness;
let server: http.Server, runtime: ReturnType<typeof createWebSocketServer>, base: string;
const clients: ReturnType<typeof createAppTRPCClient>[] = [];
beforeEach(async () => {
  fixture = await createTeamExecutionFixture(); fake = installFakeHarness('codex'); fake.modelId = 'gpt-6.1-sol';
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
  fake.restore(); await fixture.cleanup();
});
function client(token: string, credential?: string) {
  class Socket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols, { headers: credential ? { 'x-ri-session': credential } : {} }); }
  }
  const value = createAppTRPCClient({ url: `${base}/api/trpc`, getMode: () => 'websocket', websocketOnly: true,
    WebSocket: Socket as unknown as typeof globalThis.WebSocket, transport: new ApiClient({ getToken: () => token, onUnauthorized: () => {} }) });
  clients.push(value); return value;
}
it('retains agent identity for person-only controls, launch permissions and live revalidation', async () => {
  const parent = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'codex', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'auto_edits' });
  const agent = client(fixture.owner.token.plaintext, sessionCredential(parent.id)!);
  await expect(agent.team.ai.setEnabled.mutate({ enabled: false })).rejects.toThrow();
  expect(q.getTeamAiSettings()?.enabled).toBe(true);
  await expect(agent.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} })).rejects.toThrow(/Only a person/);
  const next = await agent.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  expect(next.permissionMode).toBe('auto_edits');
  const person = client(fixture.owner.token.plaintext);
  await person.team.ai.setEnabled.mutate({ enabled: false });
  expect(q.getTeamAiSettings()?.enabled).toBe(false);
  q.archiveChatSession(parent.id);
  await expect(agent.team.ai.status.query()).rejects.toThrow();
}, 30_000);

it('preserves a disclosed sending chat in shared messages and the delivered prompt', async () => {
  const parent = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'codex', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'ask', label: 'Sending chat' });
  const target = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'codex', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'auto_all' });
  const prompts: string[] = [];
  fake.onTurn(async turn => { prompts.push(turn.message); await turn.say('Done'); });
  const agent = client(fixture.member.token.plaintext, sessionCredential(parent.id)!);
  await agent.sessions.messagesPost.mutate({ params: { id: target.id }, body: { content: 'Read the changes' } });
  await settledTeamAi();
  const message = q.listChatEvents(target.id).find(event => event.role === 'user')!;
  expect(message.senderSessionId).toBe(parent.id);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain(`[Message from the "${fixture.workspace.name}" agent's main chat, sent on the user's behalf]`);
  const person = client(fixture.member.token.plaintext);
  await person.sessions.messagesPost.mutate({ params: { id: target.id }, body: { content: 'Human follow-up' } });
  await settledTeamAi();
  expect(q.listChatEvents(target.id).find(event => event.content === 'Human follow-up')?.senderSessionId).toBeNull();
}, 30_000);
