// Review-5 probe: personal Home, an execution placed on another device. Restart agent and
// closing one chat tab go through the real tRPC router as the owner. The remote runner
// queues a stop and reports { closed: false, queued: true } even when the device is online.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const localTitles: string[] = [];
import fs from 'node:fs';
let home: { token: string; cleanup(): Promise<void>; root: string };
const out: Record<string, unknown> = {};
beforeAll(async () => {
  const { preloadTeamRoutes, serveTeam } = await import('@/test/fixtures/team-home');
  await preloadTeamRoutes();
  const { createTestHome } = await import('@/test/fixtures/home');
  home = await createTestHome({ prefix: 'ri-remote-stop-' }) as never;
  (await import('@/lib/home/identity')).ensureHomeIdentity();
  const { localRunner } = await import('@/lib/runner/local-runner');
  vi.spyOn(localRunner, 'generateTitle').mockImplementation(async id => { localTitles.push(id); });
  home.token = (await import('@/lib/auth/bootstrap')).ensureLocalToken().plaintext;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => serveTeam(String(input instanceof Request ? input.url : input).replace(/^\//, 'http://localhost/'), init));
}, 120_000);
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await home?.cleanup(); });

async function call(path: string, body: unknown) {
  const response = await fetch(`http://localhost/api/trpc/${path}`, { method: 'POST', headers: { authorization: `Bearer ${home.token}`, 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.text()).slice(0, 300) };
}

it('restart and close-chat on an execution that lives on another device', async () => {
  const q = await import('@/lib/db/queries');
  const path = await import('node:path');
  const cwd = path.join(home.root, 'project'); fs.mkdirSync(cwd);
  const ws = q.createWorkspace({ name: 'Remote agent', cwd, isGit: false } as never);
  const device = q.createDevice({ name: 'Laptop', platform: 'darwin', hostname: 'fixture-only', kind: 'computer' } as never);
  const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'codex', label: 'Remote execution', worktreePath: cwd } as never);
  const executionId = (q.getChatSessionWithExecution(session.id) as { executionId: string }).executionId;
  q.createPlacement({ executionId, deviceId: device.id, startReason: 'created', worktreePath: cwd });
  const sibling = q.createExecutionChat({ executionId, harness: 'codex' } as never)!;
  q.updateChatSession(sibling.id, { label: null, labelSource: 'fallback' });
  q.insertChatEvent({ sessionId: sibling.id, source: 'user', role: 'user', content: 'Review the remote build' });
  out.placementIsHome = q.chatPlacement(session.id)?.isHome;
  out.restart = await call('sessions.restartPost', { params: { id: session.id }, body: {} });
  out.closeChat = await call('sessions.closeChatPost', { params: { id: sibling.id }, body: {} });
  out.siblingStatus = q.getChatSession(sibling.id)?.status;
  await vi.waitFor(() => expect(q.listWorkerCommands(device.id).filter(command => command.kind === 'generate_title')).toHaveLength(1));
  const title = q.listWorkerCommands(device.id).find(command => command.kind === 'generate_title')!;
  expect(title.chatSessionId).toBe(sibling.id);
  expect(title.payload).toMatchObject({ reuseExisting: false, description: expect.stringContaining('Review the remote build') });
  const Database = (await import('better-sqlite3')).default; const { getDbPath } = await import('@/lib/config/paths');
  const db = new Database(getDbPath(), { readonly: true });
  out.queuedCommands = db.prepare('select kind, chat_session_id = ? as primary_chat from worker_commands order by created_at').all(session.id);
  db.close();
  const local = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'codex', label: 'Local execution', worktreePath: cwd } as never);
  const localExec = (q.getChatSessionWithExecution(local.session.id) as { executionId: string }).executionId;
  const localSibling = q.createExecutionChat({ executionId: localExec, harness: 'codex' } as never)!;
  q.updateChatSession(localSibling.id, { label: null, labelSource: 'fallback' });
  q.insertChatEvent({ sessionId: localSibling.id, source: 'user', role: 'user', content: 'Review the local build' });
  out.localPlacementIsHome = q.chatPlacement(local.session.id)?.isHome;
  out.localRestart = await call('sessions.restartPost', { params: { id: local.session.id }, body: {} });
  out.localCloseChat = await call('sessions.closeChatPost', { params: { id: localSibling.id }, body: {} });
  out.derivedLabelForClosedLocalChat = localTitles.includes(localSibling.id);
  expect(out.restart).toMatchObject({ status: 200 });
  expect(out.closeChat).toMatchObject({ status: 200 });
  expect(out.siblingStatus).toBe('archived');
  expect(out.localRestart).toMatchObject({ status: 200 });
  expect(out.localCloseChat).toMatchObject({ status: 200 });
  expect(out.derivedLabelForClosedLocalChat).toBe(true);
  expect((out.queuedCommands as { kind: string; primary_chat: number }[]).filter(command => command.kind === 'stop')).toEqual(expect.arrayContaining([{ kind: 'stop', primary_chat: 1 }, { kind: 'stop', primary_chat: 0 }]));
  expect(out.placementIsHome).toBe(false);
}, 120_000);
