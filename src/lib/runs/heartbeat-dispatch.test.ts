/**
 * A heartbeat fire end to end through the real dispatcher, with the agent
 * stubbed: the prompt it receives, quiet check-ins archived out of Unread,
 * reports kept, changes recorded on the run (so a check-in that changed
 * anything is never quiet), and quiet runs never delivered.
 * See docs/heartbeat-spec.md §5.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// What the stubbed agent does on its turn.
const turn = vi.hoisted(() => ({
  reply: 'HEARTBEAT_OK' as string | null,
  during: null as null | ((chatSessionId: string) => Promise<void>),
  prompts: [] as string[],
}));

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true }, createSession: vi.fn() }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async (chatSessionId: string, prompt: string) => {
    turn.prompts.push(prompt);
    if (turn.during) await turn.during(chatSessionId);
    if (turn.reply !== null) {
      const { insertChatEvent, bumpSessionOutcome } = await import('@/lib/db/queries');
      insertChatEvent({
        sessionId: chatSessionId,
        role: 'assistant',
        source: 'agent',
        content: turn.reply,
        createdAt: new Date().toISOString(),
      });
      bumpSessionOutcome(chatSessionId);
    }
  }),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));
// A run's notification is queued with the run's own change and sent after
// commit (docs/homes-build.md, P2.3), so the queue is where it's decided.
const notifySpy = vi.hoisted(() => vi.fn(() => ({ dedupeKey: 'test', channelIds: [] })));
vi.mock('@/lib/notifications/notify', () => ({
  notify: vi.fn(async () => {}),
  queueNotification: notifySpy,
  deliverNotification: vi.fn(async () => {}),
}));

vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const TEST_DB = path.join(os.tmpdir(), `ri-heartbeat-dispatch-test-${process.pid}.db`);

function wipe() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(async () => {
  wipe();
  process.env.RI_DB_PATH = TEST_DB;
  const { resetDb } = await import('@/lib/db');
  resetDb();
  turn.reply = 'HEARTBEAT_OK';
  turn.during = null;
  turn.prompts = [];
  notifySpy.mockClear();
});

afterAll(wipe);

/** Fire the heartbeat once and wait for its run to settle. */
async function fireHeartbeat() {
  const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
  const { dispatchRun } = await import('./dispatch');
  const queries = await import('@/lib/db/queries');
  const trigger = ensureHeartbeatTrigger()!;
  const { run, chatSession } = await dispatchRun({ trigger: queries.getTrigger(trigger.id)!, triggerKind: 'manual' });
  for (let i = 0; i < 200; i++) {
    const current = queries.getRun(run.id)!;
    if (current.status !== 'queued' && current.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  // The notifier and settle steps are fire-and-forget after completion.
  await new Promise((r) => setTimeout(r, 30));
  return { run: queries.getRun(run.id)!, chat: queries.getChatSession(chatSession!.id)! };
}

describe('heartbeat dispatch', () => {
  it('sends the ground rules followed by the user instructions, and records exactly that as the first message', async () => {
    const { composeHeartbeatPrompt } = await import('@/lib/heartbeat/prompt');
    const { DEFAULT_HEARTBEAT_INSTRUCTIONS } = await import('@/lib/heartbeat/constants');
    const queries = await import('@/lib/db/queries');
    const { chat } = await fireHeartbeat();
    const expected = composeHeartbeatPrompt(DEFAULT_HEARTBEAT_INSTRUCTIONS);
    expect(turn.prompts).toEqual([expected]);
    const events = queries.listRecentChatEvents(chat.id, 50);
    const firstUser = events.filter((e) => e.role === 'user').at(-1);
    expect(firstUser?.content).toBe(expected);
  });

  it('a quiet check-in is labeled, archived, and never reaches Unread', async () => {
    const queries = await import('@/lib/db/queries');
    const { getHeartbeatConfig } = await import('@/lib/heartbeat/trigger');
    const { run, chat } = await fireHeartbeat();
    expect(run).toMatchObject({ status: 'completed', statusReason: 'heartbeat_quiet', summary: 'Nothing needed' });
    expect(chat.status).toBe('archived');
    expect(queries.listNeedsReviewSessionCandidates().map((s) => s.id)).not.toContain(chat.id);
    expect(getHeartbeatConfig().lastCheckIn).toMatchObject({ quiet: true, unread: false });
  });

  it('a report stays in Unread', async () => {
    const queries = await import('@/lib/db/queries');
    turn.reply = '**Needs you**: [[task:abc]] has not moved in 3 weeks. Do, snooze, or archive?';
    const { run, chat } = await fireHeartbeat();
    expect(run.status).toBe('completed');
    expect(run.statusReason).toBeNull();
    expect(chat.status).toBe('active');
    expect(queries.listNeedsReviewSessionCandidates().map((s) => s.id)).toContain(chat.id);
  });

  it('records what the agent changed on the run, and a check-in that changed something is never quiet', async () => {
    const queries = await import('@/lib/db/queries');
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const task = queries.createTask({ title: 'Needs an area' });
    // Mid-turn, the agent edits a task through the orchestrator with its
    // session credential (as the MCP route or the CLI would), then claims quiet.
    turn.during = async (chatSessionId) => {
      const env = await runAction(
        'update_task',
        { id: task.id, description: 'Set by the heartbeat' },
        { remote: true, actor: { source: 'ai', sessionId: chatSessionId } },
      );
      expect(env.ok).toBe(true);
    };
    const { run, chat } = await fireHeartbeat();
    expect(run.artifactRefs).toEqual([{ kind: 'task', id: task.id }]);
    expect(run.statusReason).toBeNull();
    expect(chat.status).toBe('active');
  });

  it('delivers reports to bound channels but never delivers a quiet check-in', async () => {
    const queries = await import('@/lib/db/queries');
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    const trigger = ensureHeartbeatTrigger()!;
    queries.updateTrigger(trigger.id, { deliverResultTo: ['channel-1'] });

    await fireHeartbeat();
    expect(notifySpy).not.toHaveBeenCalled();

    turn.reply = '**Did**: set the area on [[task:abc]].';
    await fireHeartbeat();
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('other triggers are untouched: their prompt goes out as is and a HEARTBEAT_OK reply is just a reply', async () => {
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');
    const other = queries.createTrigger({
      name: 'nightly', harness: 'claude', targetKind: 'orchestrator', workspaceId: null,
      prompt: 'Plain prompt.', kind: 'manual',
    });
    const { run, chatSession } = await dispatchRun({ trigger: other, triggerKind: 'manual' });
    for (let i = 0; i < 200 && ['queued', 'running'].includes(queries.getRun(run.id)!.status); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(turn.prompts).toEqual(['Plain prompt.']);
    expect(queries.getRun(run.id)!.statusReason).toBeNull();
    expect(queries.getChatSession(chatSession!.id)!.status).toBe('active');
  });
});
