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
