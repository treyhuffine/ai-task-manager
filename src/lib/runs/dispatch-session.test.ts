/**
 * Triggers that send to one existing chat (`targetKind: 'session'`). The
 * fire goes into that chat as its own run, with the chat's engine, and never
 * creates a chat or an execution. A chat that is busy, paused or gone is
 * handled before anything is sent. The executor and the live run state are
 * stubbed, so these exercise the dispatcher's decisions, not an agent.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true }, createSession: vi.fn() }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
const executor = vi.hoisted(() => ({
  dispatch: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 20));
  }),
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: executor.dispatch,
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));
// A turn in flight that has no run row: a person typing in the chat.
const live = vi.hoisted(() => ({ running: new Set<string>() }));
vi.mock('@/lib/executor/live-state', () => ({
  isRunning: (id: string) => live.running.has(id),
  hasBackgroundTasks: () => false,
}));

const TEST_DB = path.join(os.tmpdir(), `ri-dispatch-session-test-${process.pid}.db`);
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

function removeDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
beforeEach(() => {
  removeDb();
  process.env.RI_DB_PATH = TEST_DB;
  live.running.clear();
  executor.dispatch.mockClear();
});
afterAll(removeDb);

async function seed() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  const db = getDb();
  const queries = await import('@/lib/db/queries');
  const { dispatchRun } = await import('./dispatch');
  const workspace = queries.createWorkspace({ name: 'TestWs', cwd: os.tmpdir(), isGit: false, filesToCopy: [] });
  const { session: chat } = queries.createExecutionWithChat({ workspaceId: workspace.id, harness: 'codex', label: 'Backfill' });
  const trigger = queries.createTrigger({
    name: 'backfill-check',
    targetKind: 'session',
    targetSessionId: chat.id,
    workspaceId: workspace.id,
    harness: 'codex',
    prompt: 'Check the backfill.',
    kind: 'every',
    intervalSeconds: 900,
    concurrencyPolicy: 'skip_if_running',
  });
  return { db, queries, dispatchRun, workspace, chat, trigger };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 100));
}

describe('dispatchRun for a chat target', () => {
  it('sends into the existing chat as a labeled message, with no new chat or execution', async () => {
    const { db, queries, dispatchRun, chat, trigger } = await seed();
    const { chatSessions, executions } = await import('@/lib/db/schema');
    const chatsBefore = db.select().from(chatSessions).all().length;
    const executionsBefore = db.select().from(executions).all().length;

    const fired = await dispatchRun({ trigger, triggerKind: 'every', scheduledFor: new Date().toISOString() });
    await settle();

    expect(fired.chatSession?.id).toBe(chat.id);
    expect(fired.run).toMatchObject({
      chatSessionId: chat.id,
      executionId: chat.executionId,
      workspaceId: chat.workspaceId,
      harness: 'codex',
      triggerId: trigger.id,
    });
    expect(queries.getRun(fired.run.id)?.status).toBe('completed');
    expect(db.select().from(chatSessions).all()).toHaveLength(chatsBefore);
    expect(db.select().from(executions).all()).toHaveLength(executionsBefore);
    // A person's chat was not created by this run.
    expect(queries.getChatSession(chat.id)?.createdByRunId).toBeNull();

    const message = `[from trigger backfill-check (${trigger.id})]\n\nCheck the backfill.`;
    expect(queries.listChatEvents(chat.id).filter((e) => e.role === 'user').map((e) => e.content)).toEqual([message]);
    expect(executor.dispatch).toHaveBeenCalledWith(chat.id, message, expect.objectContaining({ runId: fired.run.id, internalCall: true }));
  });

  it('uses the chat\'s current engine when it has changed since the trigger was made', async () => {
    const { db, dispatchRun, chat, trigger } = await seed();
    const { chatSessions } = await import('@/lib/db/schema');
    db.update(chatSessions).set({ harness: 'claude' }).where(eq(chatSessions.id, chat.id)).run();
    const fired = await dispatchRun({ trigger, triggerKind: 'every' });
    expect(fired.run.harness).toBe('claude');
    await settle();
  });

  it('sends into a chat with no execution, such as an agent main chat or Ri', async () => {
    const { queries, dispatchRun } = await seed();
    const main = queries.createChatSession({ type: 'orchestration', harness: 'claude', label: 'Ri' });
    const trigger = queries.createTrigger({ name: 'ri-check', targetKind: 'session', targetSessionId: main.id,
      harness: 'claude', prompt: 'Look at the deck.', kind: 'manual' });
    const fired = await dispatchRun({ trigger, triggerKind: 'manual' });
    expect(fired.run).toMatchObject({ chatSessionId: main.id, executionId: null, workspaceId: null });
    expect(queries.getRun(fired.run.id)?.status).toBe('running');
    await settle();
    expect(queries.listChatEvents(main.id).some((e) => e.role === 'user' && e.content?.includes('Look at the deck.'))).toBe(true);
  });

  it('skips a chat with a turn in flight, sending nothing', async () => {
    const { queries, dispatchRun, chat, trigger } = await seed();
    live.running.add(chat.id);
    const fired = await dispatchRun({ trigger, triggerKind: 'every' });
    expect(fired.run).toMatchObject({ status: 'skipped', statusReason: 'chat_busy', chatSessionId: chat.id });
    expect(fired.chatSession).toBeNull();
    expect(queries.listChatEvents(chat.id)).toHaveLength(0);
    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(queries.getTrigger(trigger.id)?.lastRunStatus).toBe('skipped');
  });

  it('skips while its own earlier fire is still running', async () => {
    const { queries, dispatchRun, trigger } = await seed();
    const first = await dispatchRun({ trigger, triggerKind: 'every' });
    const second = await dispatchRun({ trigger, triggerKind: 'every' });
    expect(queries.getRun(first.run.id)?.status).toBe('running');
    expect(second.run).toMatchObject({ status: 'skipped', statusReason: 'chat_busy' });
    await settle();
  });

  it('adds the prompt to the turn under way when the trigger coalesces', async () => {
    const { queries, dispatchRun, chat, trigger } = await seed();
    const coalescing = queries.updateTrigger(trigger.id, { concurrencyPolicy: 'coalesce_if_active' })!;
    live.running.add(chat.id);
    const fired = await dispatchRun({ trigger: coalescing, triggerKind: 'every' });
    expect(fired.run).toMatchObject({ status: 'skipped', statusReason: 'coalesced_into_active', chatSessionId: chat.id });
    const marker = queries.listChatEvents(chat.id).find((e) => e.role === 'user');
    expect(marker?.content).toBe(`[from trigger backfill-check (${trigger.id})]\n\nCheck the backfill.`);
    expect(executor.dispatch).toHaveBeenCalledWith(chat.id, marker?.content, expect.objectContaining({ internalCall: true }));
  });

  it('skips a chat whose incoming messages are paused, even when the trigger coalesces', async () => {
    const { db, queries, dispatchRun, chat, trigger } = await seed();
    const { chatSessions } = await import('@/lib/db/schema');
    db.update(chatSessions).set({ coordinationHeldAt: new Date().toISOString() }).where(eq(chatSessions.id, chat.id)).run();
    const coalescing = queries.updateTrigger(trigger.id, { concurrencyPolicy: 'coalesce_if_active' })!;
    const fired = await dispatchRun({ trigger: coalescing, triggerKind: 'every' });
    expect(fired.run).toMatchObject({ status: 'skipped', statusReason: 'chat_paused' });
    expect(queries.listChatEvents(chat.id)).toHaveLength(0);
    expect(executor.dispatch).not.toHaveBeenCalled();
  });

  it('fails and pauses the trigger when its chat is archived', async () => {
    const { queries, dispatchRun, chat, trigger } = await seed();
    queries.archiveChatSession(chat.id);
    const fired = await dispatchRun({ trigger, triggerKind: 'every' });
    expect(fired.run).toMatchObject({ status: 'failed', errorCode: 'target_chat_unavailable' });
    expect(fired.run.errorMessage).toMatch(/archived\. The trigger is paused\./);
    expect(queries.getTrigger(trigger.id)).toMatchObject({ enabled: false, disabledReason: 'target_chat_unavailable' });
    expect(executor.dispatch).not.toHaveBeenCalled();
  });

  it('fails and pauses the trigger when its chat no longer exists', async () => {
    const { queries, dispatchRun, trigger } = await seed();
    const orphaned = queries.updateTrigger(trigger.id, { targetSessionId: 'deleted-chat' })!;
    const fired = await dispatchRun({ trigger: orphaned, triggerKind: 'every' });
    expect(fired.run).toMatchObject({ status: 'failed', errorCode: 'target_chat_unavailable', chatSessionId: null });
    expect(fired.run.errorMessage).toMatch(/no longer exists/);
    expect(queries.getTrigger(trigger.id)?.enabled).toBe(false);
  });
});

describe('a one-time job for a chat', () => {
  async function oneTime(over: { concurrencyPolicy?: 'skip_if_running' | 'coalesce_if_active' } = {}) {
    const seeded = await seed();
    const { runTick } = await import('@/lib/scheduler/runner');
    const due = new Date(Date.now() - 60_000).toISOString();
    const job = seeded.queries.createTrigger({
      name: 'restart-window',
      targetKind: 'session',
      targetSessionId: seeded.chat.id,
      workspaceId: seeded.workspace.id,
      harness: 'codex',
      prompt: 'Start the restart.',
      kind: 'at',
      runAt: due,
      nextRunAt: due,
      concurrencyPolicy: over.concurrencyPolicy ?? 'skip_if_running',
    });
    const runs = () => seeded.queries.listRuns({}).filter((r) => r.triggerId === job.id);
    return { ...seeded, runTick, job, due, runs };
  }

  it('waits while the chat is busy, then goes when it is free, once', async () => {
    const { queries, runTick, chat, job, due, runs } = await oneTime();
    live.running.add(chat.id);

    expect(await runTick(new Date())).toBe(0);
    expect(await runTick(new Date())).toBe(0);
    // Nothing used up and nothing recorded, so an hour's wait leaves no trail of skips.
    expect(runs()).toHaveLength(0);
    expect(queries.getTrigger(job.id)).toMatchObject({ nextRunAt: due, lastFiredAt: null, enabled: true });

    live.running.delete(chat.id);
    expect(await runTick(new Date())).toBe(1);
    await settle();
    expect(runs()).toHaveLength(1);
    expect(queries.getTrigger(job.id)?.nextRunAt).toBeNull();
    expect(queries.listChatEvents(chat.id).filter((e) => e.content?.includes('Start the restart.'))).toHaveLength(1);

    expect(await runTick(new Date())).toBe(0);
    expect(runs()).toHaveLength(1);
  });

  it('waits while the chat is on Hold, even when it would otherwise coalesce', async () => {
    const { db, queries, runTick, chat, job, due, runs } = await oneTime({ concurrencyPolicy: 'coalesce_if_active' });
    const { chatSessions } = await import('@/lib/db/schema');
    db.update(chatSessions).set({ coordinationHeldAt: new Date().toISOString() }).where(eq(chatSessions.id, chat.id)).run();

    expect(await runTick(new Date())).toBe(0);
    expect(runs()).toHaveLength(0);
    expect(queries.getTrigger(job.id)?.nextRunAt).toBe(due);

    db.update(chatSessions).set({ coordinationHeldAt: null }).where(eq(chatSessions.id, chat.id)).run();
    expect(await runTick(new Date())).toBe(1);
    await settle();
    expect(runs()).toHaveLength(1);
  });

  it('joins the turn under way when it coalesces, with nothing to wait for', async () => {
    const { queries, runTick, chat, job, runs } = await oneTime({ concurrencyPolicy: 'coalesce_if_active' });
    live.running.add(chat.id);
    expect(await runTick(new Date())).toBe(1);
    expect(runs()).toHaveLength(1);
    expect(queries.getTrigger(job.id)?.nextRunAt).toBeNull();
    expect(queries.listChatEvents(chat.id).some((e) => e.content?.includes('Start the restart.'))).toBe(true);
    await settle();
  });

  it('does not wait for an archived chat: the fire fails and pauses the trigger', async () => {
    const { queries, runTick, chat, job, runs } = await oneTime();
    queries.archiveChatSession(chat.id);
    await runTick(new Date());
    expect(runs()[0]).toMatchObject({ status: 'failed', errorCode: 'target_chat_unavailable' });
    expect(queries.getTrigger(job.id)?.enabled).toBe(false);
  });

  it('Run now still skips and shows why', async () => {
    const { dispatchRun, chat, job } = await oneTime();
    live.running.add(chat.id);
    const fired = await dispatchRun({ trigger: job, triggerKind: 'manual' });
    expect(fired.run).toMatchObject({ status: 'skipped', statusReason: 'chat_busy' });
  });

  it('leaves a repeating schedule to skip, since its next slot is coming', async () => {
    const { oneTimeFireMustWait } = await import('./dispatch');
    const { chat, trigger } = await seed();
    live.running.add(chat.id);
    expect(oneTimeFireMustWait(trigger)).toBe(false);
  });
});

describe('lateFireNote', () => {
  it('names the slot in the schedule\'s timezone and how late it is', async () => {
    const { lateFireNote } = await import('./dispatch');
    expect(lateFireNote('2026-11-03T15:00:00Z', 'America/Denver', new Date('2026-11-03T18:39:32Z')))
      .toBe('This scheduled run was due at Tue, Nov 3, 8:00 AM MST and is starting 3h 39m late. Do the work unless being this late makes it pointless or unsafe. If you skip it, say why.');
    expect(lateFireNote('2026-11-01T15:00:00Z', 'UTC', new Date('2026-11-03T17:30:00Z')))
      .toContain('and is starting 2d 2h late.');
  });

  it('stays out of the way until a fire is 5 minutes late', async () => {
    const { lateFireNote } = await import('./dispatch');
    const due = '2026-11-03T15:00:00Z';
    expect(lateFireNote(due, 'UTC', new Date('2026-11-03T15:04:59Z'))).toBeNull();
    expect(lateFireNote(due, 'UTC', new Date('2026-11-03T15:05:00Z'))).toContain('is starting 5m late.');
    expect(lateFireNote(null, 'UTC')).toBeNull();
  });

  it('goes under the trigger\'s name in a chat, so the message still says who sent it', async () => {
    const { queries, dispatchRun, chat, trigger } = await seed();
    await dispatchRun({ trigger, triggerKind: 'every', scheduledFor: new Date(Date.now() - 2 * 60 * 60_000).toISOString() });
    await settle();
    const sent = queries.listChatEvents(chat.id).find((e) => e.role === 'user')!;
    expect(sent.content).toMatch(new RegExp(`^\\[from trigger backfill-check \\(${trigger.id}\\)\\]\\n\\nThis scheduled run was due at .+ and is starting 2h late\\. .+\\n\\nCheck the backfill\\.$`));
  });
});
