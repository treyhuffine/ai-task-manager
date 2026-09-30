import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Where main chats live and where they must not show up
 * (docs/agents-view-spec.md §4, Phases 5 and 6). An agent's main chat is an
 * orchestration chat with a workspace and no execution. Its replies are the
 * conversation, not work owed review, so it stays out of Needs Review, and
 * the rail and the agent's execution list only ever show executions.
 */

const TEST_DB = path.join(os.tmpdir(), `ri-main-chats-test-${process.pid}.db`);

beforeEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
});

const past = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

async function seed() {
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({ name: 'ri', cwd: os.tmpdir(), isGit: false, filesToCopy: [], status: 'active' });
  const other = q.createWorkspace({ name: 'bounce', cwd: os.tmpdir(), isGit: false, filesToCopy: [], status: 'active' });
  const appChat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
  const agentChat = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
  const otherAgentChat = q.createChatSession({ type: 'orchestration', workspaceId: other.id, harness: 'claude', status: 'active' });
  const { session: execution } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Refactor auth' });
  const fired = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
  const run = q.createRun({ harness: 'claude', chatSessionId: fired.id, triggerKind: 'manual', status: 'completed' });
  q.updateChatSession(fired.id, { createdByRunId: run.id });
  return { q, ws, other, appChat, agentChat, otherAgentChat, execution, fired };
}

describe('listMainChats', () => {
  it("scopes by workspace: null is the app's main chat, an id is that agent's", async () => {
    const { q, ws, other, appChat, agentChat, otherAgentChat } = await seed();
    expect(q.listMainChats(null).map((s) => s.id)).toEqual([appChat.id]);
    expect(q.listMainChats(ws.id).map((s) => s.id)).toEqual([agentChat.id]);
    expect(q.listMainChats(other.id).map((s) => s.id)).toEqual([otherAgentChat.id]);
  });

  it('never returns executions or scheduled fires, and filters by status', async () => {
    const { q, ws, agentChat } = await seed();
    q.archiveChatSession(agentChat.id);
    expect(q.listMainChats(ws.id, { status: 'active' })).toEqual([]);
    expect(q.listMainChats(ws.id, { status: 'archived' }).map((s) => s.id)).toEqual([agentChat.id]);
  });

  it('orders by latest activity and honors a limit', async () => {
    const { q, ws, agentChat } = await seed();
    const newer = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
    q.updateChatSession(agentChat.id, { lastActivityAt: past(10) });
    q.updateChatSession(newer.id, { lastActivityAt: past(1) });
    expect(q.listMainChats(ws.id).map((s) => s.id)).toEqual([newer.id, agentChat.id]);
    expect(q.listMainChats(ws.id, { limit: 1 }).map((s) => s.id)).toEqual([newer.id]);
  });
});

describe("an agent's main chat stays out of work surfaces", () => {
  it('is never a Needs Review candidate, even with an unread reply', async () => {
    const { q, agentChat, execution } = await seed();
    for (const id of [agentChat.id, execution.id]) {
      q.updateChatSession(id, { lastOutcomeEventAt: past(1), lastViewedAt: past(10) });
    }
    const ids = q.listNeedsReviewSessionCandidates().map((s) => s.id);
    expect(ids).toContain(execution.id);
    expect(ids).not.toContain(agentChat.id);
  });

  it('is not in the rail or the agent\'s execution list', async () => {
    const { q, ws, agentChat, execution } = await seed();
    const rail = q.listRailSessions().map((s) => s.id);
    expect(rail).toContain(execution.id);
    expect(rail).not.toContain(agentChat.id);
    const executions = q.listWorkspaceExecutions(ws.id).map((s) => s.id);
    expect(executions).toEqual([execution.id]);
  });
});

describe('listAgentMainChats (the rail)', () => {
  it("returns each active agent's current main chat, the same one currentMainChat picks", async () => {
    const { q, ws, other, agentChat, otherAgentChat } = await seed();
    const newer = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
    q.updateChatSession(agentChat.id, { lastActivityAt: past(10) });
    q.updateChatSession(newer.id, { lastActivityAt: past(1) });
    const { currentMainChat } = await import('@/lib/sessions/main-chat');

    const byAgent = new Map(q.listAgentMainChats().map((c) => [c.workspaceId, c.id]));
    expect(byAgent).toEqual(new Map([[ws.id, newer.id], [other.id, otherAgentChat.id]]));
    expect(byAgent.get(ws.id)).toBe(currentMainChat(ws.id)?.id);
  });

  it('carries what the rail needs to tell a new reply apart', async () => {
    const { q, ws, agentChat } = await seed();
    q.updateChatSession(agentChat.id, { lastOutcomeEventAt: past(1), lastViewedAt: past(10) });
    const [chat] = q.listAgentMainChats().filter((c) => c.workspaceId === ws.id);
    expect(chat).toEqual({
      id: agentChat.id,
      workspaceId: ws.id,
      lastOutcomeEventAt: expect.any(String),
      unreadMarkerAt: null,
      lastViewedAt: expect.any(String),
      preview: null,
    });
    expect(chat.lastOutcomeEventAt! > chat.lastViewedAt!).toBe(true);
  });

  it("previews the agent's latest message as one plain line, never yours or a tool's", async () => {
    const { q, ws, agentChat } = await seed();
    const say = (source: string, role: 'user' | 'assistant' | 'system', content: string, mins: number) =>
      q.insertChatEvent({ sessionId: agentChat.id, role, source, content, createdAt: past(mins) });
    say('agent', 'assistant', 'Old news', 30);
    say('agent', 'assistant', '## Login page is ready\n\nDetails follow.', 10);
    say('tool_result', 'system', 'npm test passed', 5);
    say('user', 'user', 'thanks!', 1);
    const [chat] = q.listAgentMainChats().filter((c) => c.workspaceId === ws.id);
    expect(chat.preview).toBe('Login page is ready · Details follow.');
  });

  it("leaves out the app's chat, executions, scheduled fires, archived chats and archived agents", async () => {
    const { q, ws, other, agentChat, appChat, execution, fired } = await seed();
    q.archiveChatSession(agentChat.id);
    q.archiveWorkspace(other.id);
    const ids = q.listAgentMainChats().map((c) => c.id);
    expect(ids).toEqual([]);
    for (const id of [appChat.id, execution.id, fired.id]) expect(ids).not.toContain(id);
    expect(q.listAgentMainChats().some((c) => c.workspaceId === ws.id)).toBe(false);
  });
});

describe('listWorkspaceExecutionTasks', () => {
  it("lists the open tasks the agent's active executions work, each with its executions", async () => {
    const { q, ws, other, execution } = await seed();
    const area = q.createArea({ name: 'Work' });
    const open = q.createTask({ title: 'Ship the agent view', areaId: area.id });
    const done = q.createTask({ title: 'Old work', areaId: area.id });
    const elsewhere = q.createTask({ title: 'Other agent', areaId: area.id });
    const { session: second } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Second' });
    const { session: otherExec } = q.createExecutionWithChat({ workspaceId: other.id, harness: 'claude', label: 'x' });
    q.attachExecutionToTask(execution.executionId!, open.id);
    q.attachExecutionToTask(second.executionId!, open.id);
    q.attachExecutionToTask(execution.executionId!, done.id);
    q.attachExecutionToTask(otherExec.executionId!, elsewhere.id);
    q.completeTask(done.id, { meta: { source: 'human' } });

    const tasks = q.listWorkspaceExecutionTasks(ws.id);
    expect(tasks.map((t) => t.id)).toEqual([open.id]);
    expect(new Set(tasks[0]!.executionIds)).toEqual(new Set([execution.executionId, second.executionId]));
  });

  it('forgets archived executions', async () => {
    const { q, ws, execution } = await seed();
    const task = q.createTask({ title: 'Parked' });
    q.attachExecutionToTask(execution.executionId!, task.id);
    q.archiveExecution(execution.executionId!);
    expect(q.listWorkspaceExecutionTasks(ws.id)).toEqual([]);
  });
});
