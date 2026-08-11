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
  it('excludes interactive and own-review-surface chats but keeps executions and other scheduled chats', async () => {
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

    // 4. App-managed runs that already have a review surface of their own —
    //    the deck refresh (Deck pane) and every stream sweep (stream digest +
    //    "Needs your call"). None of their chats may pile up in this queue.
    const { RESERVED_TRIGGER_IDS, TRIGGERS_WITH_OWN_REVIEW_SURFACE } = await import(
      '@/lib/triggers/reserved'
    );
    const selfReviewed = [
      { id: RESERVED_TRIGGER_IDS.morningDeck, name: 'Morning deck refresh', cron: '0 4 * * *' },
      { id: RESERVED_TRIGGER_IDS.streamSweepDebounce, name: 'Stream triage sweep', cron: '*/20 * * * *' },
      { id: RESERVED_TRIGGER_IDS.morningStreamSweep, name: 'Morning stream triage', cron: '30 3 * * *' },
      { id: RESERVED_TRIGGER_IDS.weeklyStreamDigest, name: 'Weekly stream digest', cron: '0 16 * * 0' },
    ].map(({ id, name, cron }) => {
      q.createTrigger({
        id,
        name,
        description: name,
        enabled: true,
        agentId: orch.id,
        workspaceId: null,
        targetKind: 'orchestrator',
        prompt: name,
        kind: 'cron',
        cronExpression: cron,
        timezone: 'UTC',
        nextRunAt: new Date().toISOString(),
      });
      const chat = q.createChatSession({
        type: 'orchestration', agentId: orch.id, label: name, status: 'active',
      });
      const run = q.createRun({
        triggerId: id,
        agentId: orch.id,
        chatSessionId: chat.id,
        triggerKind: 'cron',
        status: 'completed',
      });
      q.updateChatSession(chat.id, {
        createdByRunId: run.id, lastOutcomeEventAt: past(1), lastViewedAt: past(10),
      });
      return chat.id;
    });
    // Guard against a new sentinel being listed but never exercised here.
    expect(selfReviewed).toHaveLength(TRIGGERS_WITH_OWN_REVIEW_SURFACE.length);

    const ids = q.listNeedsReviewSessionCandidates().map((s) => s.id);
    expect(ids).not.toContain(interactive.id); // the Chat tab is not an inbox item
    expect(ids).toContain(execChat.id);
    expect(ids).toContain(scheduled.id);
    for (const id of selfReviewed) expect(ids).not.toContain(id);
  });

  it('surfaces a detached background outcome once without replaying it as unread', async () => {
    const q = await setup();
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');

    const workspaceId = uuidv7();
    getDb().insert(workspaces).values({
      id: workspaceId,
      name: 'Background outcome workspace',
      slug: `background-outcome-${Date.now()}`,
      cwd: '/tmp/background-outcome',
      isGit: false,
    }).run();
    const executor = q.getOrCreateDefaultExecutor('codex');
    const { session } = q.createExecutionWithChat({
      workspaceId,
      agentId: executor.id,
      label: 'Detached child',
    });

    q.insertChatEvent({
      sessionId: session.id,
      role: 'system',
      source: 'result',
      content: null,
      externalEventId: 'root-result',
      createdAt: past(2),
    });
    q.updateChatSession(session.id, { lastViewedAt: past(1), unreadMarkerAt: null });
    expect(q.listNeedsReviewSessionCandidates().map((row) => row.id)).not.toContain(session.id);

    const terminalAt = new Date().toISOString();
    q.insertChatEvent({
      sessionId: session.id,
      role: 'system',
      source: 'background_task',
      content: 'Detached inspection complete',
      externalEventId: 'background-terminal',
      createdAt: terminalAt,
      raw: {
        type: 'background_task',
        phase: 'completed',
        taskId: 'child-1',
        taskType: 'subagent',
        status: 'completed',
        summary: 'Detached inspection complete',
      },
    });
    expect(q.listNeedsReviewSessionCandidates().map((row) => row.id)).toContain(session.id);

    q.updateChatSession(session.id, {
      lastViewedAt: new Date(Date.parse(terminalAt) + 1_000).toISOString(),
      unreadMarkerAt: null,
    });
    expect(q.listNeedsReviewSessionCandidates().map((row) => row.id)).not.toContain(session.id);

    expect(q.insertChatEvent({
      sessionId: session.id,
      role: 'system',
      source: 'background_task',
      content: 'Detached inspection complete',
      externalEventId: 'background-terminal',
      createdAt: new Date(Date.now() + 2_000).toISOString(),
    })).toBeNull();
    expect(q.listNeedsReviewSessionCandidates().map((row) => row.id)).not.toContain(session.id);
  });
});
