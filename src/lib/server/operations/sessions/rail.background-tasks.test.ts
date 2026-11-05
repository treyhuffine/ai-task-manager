import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { runnerState } from '@/lib/runner/live-state';
import { clearDeviceMirror, replaceDeviceMirror } from '@/lib/executor/remote-live';
import { unwrapOperation } from '@/lib/server/operation';

let home: TestHome | undefined;
afterEach(async () => {
  runnerState.backgroundTasks.clear();
  runnerState.runningSessions.clear();
  clearDeviceMirror('background-test-device');
  vi.restoreAllMocks();
  await home?.cleanup();
});

async function setup() {
  home = await createTestHome({ prefix: 'ri-rail-background-' });
  const q = await import('@/lib/db/queries');
  const workspace = q.createWorkspace({ name: 'Build Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const { execution, session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Verify changes' });
  q.updateChatSession(session.id, { label: 'Long test run', lastActivityAt: '2026-11-05T10:00:00Z' });
  const sibling = q.createChatSession({ executionId: execution.id, workspaceId: workspace.id, harness: 'claude', type: 'execution', userId: 'local' });
  q.updateChatSession(sibling.id, { lastActivityAt: '2026-11-05T11:00:00Z' });
  const agentMain = q.createChatSession({ workspaceId: workspace.id, harness: 'claude', type: 'orchestration', userId: 'local' });
  const main = q.createChatSession({ harness: 'claude', type: 'orchestration', userId: 'local' });
  const { GET } = await import('./rail');
  const read = async () => unwrapOperation(await GET({}, { headers: new Headers() } as never));
  return { q, session, sibling, agentMain, main, read };
}

it('counts live tasks in exact chats, including main chats and a sibling omitted from the rail', async () => {
  const { session, sibling, agentMain, main, read } = await setup();
  runnerState.backgroundTasks.set(session.id, new Set(['test-a', 'test-b']));
  runnerState.backgroundTasks.set(agentMain.id, new Set(['research']));
  runnerState.backgroundTasks.set(main.id, new Set(['summary']));
  runnerState.runningSessions.add(sibling.id);

  const rail = await read();
  expect(rail.sessions.map(chat => chat.id)).toEqual([sibling.id]);
  expect(rail.runningSessionIds).toEqual([sibling.id]);
  expect(rail.backgroundChats).toHaveLength(3);
  expect(rail.backgroundChats.find(chat => chat.id === session.id)).toMatchObject({ label: 'Long test run', workspaceName: 'Build Ri', taskCount: 2 });
  expect(rail.backgroundChats.find(chat => chat.id === agentMain.id)).toMatchObject({ workspaceName: 'Build Ri', taskCount: 1 });
  expect(rail.backgroundChats.find(chat => chat.id === main.id)).toMatchObject({ workspaceName: null, executionId: null, taskCount: 1 });
  expect(rail.backgroundChats.reduce((sum, chat) => sum + chat.taskCount, 0)).toBe(4);
  expect(rail.backgroundChats[0]).not.toHaveProperty('scratchPad');
  expect(rail.backgroundChats[0]).not.toHaveProperty('externalTranscriptPath');
});

it('uses live state after completion or a restart, even when historical starts remain', async () => {
  const { q, session, read } = await setup();
  q.insertChatEvent({ sessionId: session.id, source: 'system', role: 'system', content: 'background_task', raw: { type: 'background_task', taskId: 'old-start', phase: 'started', status: 'running' } });
  runnerState.backgroundTasks.set(session.id, new Set(['live']));
  expect((await read()).backgroundChats).toHaveLength(1);
  runnerState.backgroundTasks.clear();
  const rail = await read();
  expect(rail.backgroundSessionIds).toEqual([]);
  expect(rail.backgroundChats).toEqual([]);
});

it('includes background work reported by a connected device', async () => {
  const { session, read } = await setup();
  replaceDeviceMirror('background-test-device', { running: [], pending: [], backgroundTasks: { [session.id]: ['remote-a', 'remote-b'] } });
  expect((await read()).backgroundChats).toEqual([expect.objectContaining({ id: session.id, taskCount: 2 })]);
  clearDeviceMirror('background-test-device');
  expect((await read()).backgroundChats).toEqual([]);
});

it('keeps background chat labels and counts behind the rail\'s existing visibility policy', async () => {
  const { q, session, main, read } = await setup();
  q.updateChatSession(main.id, { label: 'Private background work' });
  runnerState.backgroundTasks.set(session.id, new Set(['visible']));
  runnerState.backgroundTasks.set(main.id, new Set(['private']));
  const access = await import('@/lib/workspaces/access');
  const views = await import('@/lib/sessions/view-state');
  vi.spyOn(views, 'conversationViews').mockImplementation((_key, rows) => [...rows]);
  vi.spyOn(access, 'executionCatalogAuthority').mockReturnValue({ member: { id: 'viewer' } } as never);
  vi.spyOn(access, 'sessionAuthority').mockImplementation((_key, id) => {
    if (id === main.id) throw new q.TeamError('not_allowed', 'Private chat');
    return null;
  });
  const rail = await read();
  expect(rail.backgroundSessionIds).toEqual([session.id]);
  expect(rail.backgroundChats).toEqual([expect.objectContaining({ id: session.id, taskCount: 1 })]);
  expect(JSON.stringify(rail)).not.toContain('Private background work');
});

it('reads only requested chat ids by index and never scans transcript events', async () => {
  const { q, session } = await setup();
  const { getRawDb } = await import('@/lib/db');
  const db = getRawDb();
  const prepare = vi.spyOn(db, 'prepare');
  expect(q.listBackgroundTaskChats([session.id])).toHaveLength(1);
  const statements = prepare.mock.calls.map(([statement]) => statement);
  expect(statements.some(statement => statement.includes('chat_events'))).toBe(false);
  const select = statements.find(statement => statement.includes('from "chat_sessions"'))!;
  expect(select).toBeDefined();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${select}`).all(session.id) as { detail: string }[];
  expect(plan.some(row => /SEARCH chat_sessions USING INDEX sqlite_autoindex_chat_sessions/.test(row.detail))).toBe(true);
  expect(q.listBackgroundTaskChats([])).toEqual([]);
});
