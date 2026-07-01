import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-needs-review-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  return import('@/lib/db/queries');
}

const past = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

describe('listNeedsReviewSessionCandidates', () => {
  it('excludes the interactive orchestrator chat but keeps executions and scheduled orchestration chats', async () => {
    const q = await setup();
    const { getDb } = await import('@/lib/db');
    const { workspaces, runs } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');

    // 1. Interactive orchestrator chat with an unread reply — the bug case.
    const orch = q.getOrCreateDefaultOrchestrator('claude_code');
    const interactive = q.createChatSession({
      type: 'orchestration', agentId: orch.id, label: null, status: 'active',
    });
    q.updateChatSession(interactive.id, {
      lastOutcomeEventAt: past(1), lastViewedAt: past(10),
    });

    // 2. Execution chat with an unread outcome — must stay in the queue.
    const wsId = uuidv7();
    getDb().insert(workspaces).values({
      id: wsId, name: 'Ws', slug: `ws-${Date.now()}`, cwd: '/tmp/ws', isGit: false,
    }).run();
    const executor = q.getOrCreateDefaultExecutor('claude_code');
    const { session: execChat } = q.createExecutionWithChat({
      workspaceId: wsId, agentId: executor.id, label: 'Work',
    });
    q.updateChatSession(execChat.id, {
      lastOutcomeEventAt: past(1), lastViewedAt: past(10),
    });

    // 3. Scheduled orchestration chat (created_by_run_id set) with an unread
    //    outcome — must stay: needs-review is how scheduled results surface.
    const scheduled = q.createChatSession({
      type: 'orchestration', agentId: orch.id, label: 'Morning triage', status: 'active',
    });
    const runId = uuidv7();
    getDb().insert(runs).values({
      id: runId, agentId: orch.id, chatSessionId: scheduled.id,
      triggerKind: 'cron', status: 'completed',
    }).run();
    q.updateChatSession(scheduled.id, {
      createdByRunId: runId, lastOutcomeEventAt: past(1), lastViewedAt: past(10),
    });

    const ids = q.listNeedsReviewSessionCandidates().map((s) => s.id);
    expect(ids).not.toContain(interactive.id); // the Chat tab is not an inbox item
    expect(ids).toContain(execChat.id);
    expect(ids).toContain(scheduled.id);
  });
});
