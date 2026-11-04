/**
 * A heartbeat fire end to end through the real dispatcher and the real
 * coordination path, with the agent stubbed: the prompt it receives, every
 * finished check-in archived out of Unread, its note reaching the main agent,
 * and the main agent's reply, and only that, pushed to the user.
 * See docs/heartbeat-spec.md §5 and §15.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// What the stubbed agent does on its turn.
const turn = vi.hoisted(() => ({
  reply: 'HEARTBEAT_OK' as string | null,
  // What the main agent says when a check-in's note reaches it.
  mainReply: 'The contract expires today. Want me to send the renewal?' as string | null,
  during: null as null | ((chatSessionId: string) => Promise<void>),
  prompts: [] as string[],
}));

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true }, createSession: vi.fn() }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async (chatSessionId: string, prompt: string, options?: { runId?: string; coordinationDeliveryIds?: string[] }) => {
    turn.prompts.push(prompt);
    const { insertChatEvent, bumpSessionOutcome, getRun, acceptAgentDeliveriesForRun, markRunStarted } = await import('@/lib/db/queries');
    const toMainAgent = !!options?.coordinationDeliveryIds?.length;
    if (toMainAgent) {
      markRunStarted(options!.runId!);
      acceptAgentDeliveriesForRun(options!.runId!, chatSessionId, options!.coordinationDeliveryIds);
    }
    if (turn.during) await turn.during(chatSessionId);
    const reply = toMainAgent ? turn.mainReply : turn.reply;
    if (reply !== null) {
      insertChatEvent({
        sessionId: chatSessionId,
        role: 'assistant',
        source: 'agent',
        content: reply,
        createdAt: new Date().toISOString(),
      });
      bumpSessionOutcome(chatSessionId);
    }
    if (toMainAgent && getRun(options!.runId!)) {
      const { finishRun } = await import('./finish');
      finishRun(options!.runId!, { ok: true });
    }
  }),
  isRunning: vi.fn(() => false),
  hasBackgroundTasks: vi.fn(() => false),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));
// A run's notification is queued with the run's own change and sent after
// commit (docs/homes-build.md, P2.3), so the queue is where it's decided.
const notifySpy = vi.hoisted(() => vi.fn((_event: Record<string, unknown>) => ({ dedupeKey: 'test', channelIds: [] })));
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
  // Remote embeddings are unrelated to heartbeat dispatch, and could finish
  // after the next fixture closes this test's database connection.
  vi.stubEnv('OPENAI_API_KEY', '');
  wipe();
  process.env.RI_DB_PATH = TEST_DB;
  const { resetDb } = await import('@/lib/db');
  resetDb();
  turn.reply = 'HEARTBEAT_OK';
  turn.mainReply = 'The contract expires today. Want me to send the renewal?';
  turn.during = null;
  turn.prompts = [];
  notifySpy.mockClear();
});

afterAll(() => {
  vi.unstubAllEnvs();
  wipe();
});

/** Fire the heartbeat once and wait for its run to settle. */
async function fireHeartbeat() {
  const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
  const { dispatchRun } = await import('./dispatch');
  const queries = await import('@/lib/db/queries');
  const trigger = (await ensureHeartbeatTrigger())!;
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

const HEARTBEAT_ID = '00000000-0000-0000-0000-000000000005';

/** Deliver whatever is queued, and let the main agent's stubbed turn finish. */
async function settleCoordination() {
  const { drainAgentCoordination } = await import('@/lib/coordination/service');
  await drainAgentCoordination();
  await drainAgentCoordination();
  await new Promise((r) => setTimeout(r, 30));
}

describe('heartbeat dispatch', () => {
  it('sends the ground rules, what the app knows, then the instructions, and records exactly that as the first message', async () => {
    const { DEFAULT_HEARTBEAT_INSTRUCTIONS } = await import('@/lib/heartbeat/constants');
    const { HEARTBEAT_GROUND_RULES } = await import('@/lib/heartbeat/prompt');
    const queries = await import('@/lib/db/queries');
    const { chat } = await fireHeartbeat();
    const sent = turn.prompts[0]!;
    expect(sent.startsWith(HEARTBEAT_GROUND_RULES)).toBe(true);
    expect(sent).toContain('## Right now');
    expect(sent).toContain('This is the first check-in today.');
    expect(sent.endsWith(`## Your instructions\n\n${DEFAULT_HEARTBEAT_INSTRUCTIONS}`)).toBe(true);
    const events = queries.listRecentChatEvents(chat.id, 50);
    const firstUser = events.filter((e) => e.role === 'user').at(-1);
    expect(firstUser?.content).toBe(sent);
  });

  it('a quiet check-in is labeled, archived, and never reaches Unread', async () => {
    const queries = await import('@/lib/db/queries');
    const { getHeartbeatConfig } = await import('@/lib/heartbeat/trigger');
    const { run, chat } = await fireHeartbeat();
    expect(run).toMatchObject({ status: 'completed', statusReason: 'heartbeat_quiet', summary: 'Nothing needed' });
    expect(chat.status).toBe('archived');
    expect(queries.listNeedsReviewSessionCandidates().map((s) => s.id)).not.toContain(chat.id);
    expect((await getHeartbeatConfig()).lastCheckIn).toMatchObject({ outcome: 'quiet' });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('what can wait is saved for later: archived, out of Unread, no turn for the main agent', async () => {
    const queries = await import('@/lib/db/queries');
    turn.reply = '**Later**\n\nThis task has not moved in 3 weeks.\n[[task:abc]]';
    const { run, chat } = await fireHeartbeat();
    await settleCoordination();
    expect(run).toMatchObject({ status: 'completed', statusReason: 'heartbeat_held', summary: 'Saved for later: This task has not moved in 3 weeks.' });
    expect(chat.status).toBe('archived');
    expect(queries.listNeedsReviewSessionCandidates().map((s) => s.id)).not.toContain(chat.id);
    expect(turn.prompts).toHaveLength(1);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('what can\'t wait reaches the main agent, who says it, and that message is what gets pushed', async () => {
    const queries = await import('@/lib/db/queries');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const main = await ensureMainChat(null);
    turn.reply = 'Checked email.\n\n**Now**\n\nThe contract expires today.\n[[task:abc]]';
    const { run, chat } = await fireHeartbeat();
    await settleCoordination();

    expect(run).toMatchObject({ status: 'completed', statusReason: 'heartbeat_told' });
    expect(run.summary).toMatch(/^Told .*: The contract expires today\.$/);
    // The check-in is done and out of the way, and its note still arrived.
    expect(chat.status).toBe('archived');
    expect(queries.listNeedsReviewSessionCandidates().map((s) => s.id)).not.toContain(chat.id);

    expect(turn.prompts).toHaveLength(2);
    expect(turn.prompts[1]).toContain('The contract expires today.');
    expect(turn.prompts[1]).toContain('A background check-in has something');
    expect(turn.prompts[1]).toContain('exactly NO_REPLY');
    expect(turn.prompts[1]).toContain('the scheduled "Heartbeat" run');
    expect(turn.prompts[1]).not.toContain('the orchestrator (the user');

    const events = queries.listRecentChatEvents(main.id, 10);
    const incoming = events.find((event) => event.role === 'user')!;
    expect(incoming).toMatchObject({ senderSessionId: chat.id });
    expect((incoming.raw as { agentCoordination: { checkIn: { at: string } } }).agentCoordination.checkIn.at).toBe(run.startedAt);
    expect(events.find((event) => event.role === 'assistant')?.content).toContain('Want me to send the renewal?');

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0]![0]).toMatchObject({
      type: 'agent.message',
      url: '/',
      body: 'The contract expires today. Want me to send the renewal?',
      dedupeKey: expect.stringMatching(/^agent\.message:/),
    });
    // Its reply shows on the main agent's row until read.
    const { isSessionUnread } = await import('@/lib/utils/session-sort');
    expect(isSessionUnread(queries.getChatSession(main.id)!)).toBe(true);
  });

  it('the main agent can decide not to pass a note on: nothing is pushed or marked new', async () => {
    const queries = await import('@/lib/db/queries');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const { isSessionUnread } = await import('@/lib/utils/session-sort');
    const main = await ensureMainChat(null);
    turn.reply = '**Now**\nThe contract expires today.';
    turn.mainReply = 'NO_REPLY';
    await fireHeartbeat();
    await settleCoordination();
    expect(turn.prompts).toHaveLength(2);
    expect(notifySpy).not.toHaveBeenCalled();
    expect(isSessionUnread(queries.getChatSession(main.id)!)).toBe(false);
  });

  it('if the main agent can\'t answer, the note itself is pushed, so something urgent still arrives', async () => {
    const queries = await import('@/lib/db/queries');
    const { runTerminalNotification } = await import('@/lib/notifications/emit');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    await ensureHeartbeatTrigger();
    const main = await ensureMainChat(null);
    const source = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', label: 'Heartbeat' });
    const { handOffToMainAgent } = await import('@/lib/heartbeat/handoff');
    const checkIn = queries.createRun({ triggerId: HEARTBEAT_ID, harness: 'claude', triggerKind: 'every', status: 'completed', chatSessionId: source.id });
    const delivery = handOffToMainAgent(checkIn, source, 'The contract expires today.');
    const run = queries.createRun({ harness: 'claude', triggerKind: 'manual', status: 'failed', chatSessionId: main.id, triggerPayload: { coordinationDeliveryIds: [delivery.id] } });
    expect(runTerminalNotification(run.id)?.event).toMatchObject({
      type: 'agent.message',
      title: 'Heartbeat',
      body: 'The contract expires today.',
      url: `/?session=${source.id}`,
    });
  });

  it('tells the next check-in what earlier ones did and raised, and when they ran', async () => {
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    await ensureMainChat(null);
    turn.reply = '**Did**\nFiled the tax task under Taxes.\n\n**Later**\nGmail permission is missing.';
    await fireHeartbeat();
    turn.reply = 'HEARTBEAT_OK';
    await fireHeartbeat();
    expect(turn.prompts[0]).not.toContain('## Earlier check-ins');
    // No changes were recorded on that run, but it saved something, so its note is read back.
    expect(turn.prompts[1]).toContain('## Earlier check-ins');
    expect(turn.prompts[1]).toContain('Gmail permission is missing.');
    expect(turn.prompts[1]).toContain('Filed the tax task under Taxes.');
    expect(turn.prompts[1]).toContain('Check-ins so far today:');
    expect(turn.prompts[1]).not.toContain('This is the first check-in today.');
  });

  it('a morning summary is just a Now note the instructions asked for, and it says what was done', async () => {
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    await ensureMainChat(null);
    turn.reply = '**Did**\nFiled the tax task under Taxes.';
    const first = await fireHeartbeat();
    expect(first.run).toMatchObject({ statusReason: 'heartbeat_quiet', summary: 'Did: Filed the tax task under Taxes.' });
    expect(notifySpy).not.toHaveBeenCalled();
    turn.reply = "**Now**\nFiled the tax task under Taxes. Three questions are waiting.";
    await fireHeartbeat();
    await settleCoordination();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0]![0]).toMatchObject({ type: 'agent.message' });
  });

  it('the first message from a check-in says what it is, and later ones do not', async () => {
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    await ensureMainChat(null);
    turn.reply = '**Now**\nThe contract expires today.';
    await fireHeartbeat();
    await settleCoordination();
    expect(turn.prompts[1]).toContain('Settings > Heartbeat');
    turn.reply = '**Now**\nThe roof is leaking.';
    await fireHeartbeat();
    await settleCoordination();
    expect(turn.prompts[3]).toContain('The roof is leaking.');
    expect(turn.prompts[3]).not.toContain('Settings > Heartbeat');
  });

  it('hands over chats that finished since the last check-in, with their status line, and leaves out the rest', async () => {
    const queries = await import('@/lib/db/queries');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const main = await ensureMainChat(null);
    await fireHeartbeat();
    const finished = (label: string, status: 'completed' | 'failed', extra: object = {}) => {
      const chat = queries.createChatSession({ type: 'content', harness: 'claude', status: 'active', label });
      const at = new Date().toISOString();
      queries.createRun({ harness: 'claude', triggerKind: 'manual', status, chatSessionId: chat.id, startedAt: at, completedAt: at, createdAt: at, ...extra });
      return chat;
    };
    const ok = finished('Fix the login page', 'completed');
    queries.updateChatSession(ok.id, { turnStatus: { line: 'Test the preview', needsYou: true, effort: 'quick', unblocks: null, at: new Date().toISOString() } });
    finished('Import the tasks', 'failed', { errorMessage: 'Disk full' });
    const at = new Date().toISOString();
    queries.createRun({ harness: 'claude', triggerKind: 'manual', status: 'completed', chatSessionId: main.id, startedAt: at, completedAt: at, createdAt: at });
    await fireHeartbeat();
    const sent = turn.prompts.at(-1)!;
    expect(sent).toContain('## Chats since the last check-in');
    expect(sent).toContain(`Fix the login page (sessionId ${ok.id}): completed`);
    expect(sent).toContain('Its status: "Test the preview" (waiting on the user)');
    expect(sent).toContain('Import the tasks');
    expect(sent).toContain('failed');
    expect(sent).toContain('Disk full');
    // The main chat is the conversation, not work to check on.
    expect(sent).not.toContain(main.id);
  });

  it('a check-in filing a task keeps its place in the stale list, and anything else counts as a touch', async () => {
    const queries = await import('@/lib/db/queries');
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const area = queries.createArea({ name: 'Taxes' });
    const filed = queries.createTask({ title: 'Quarterly taxes' });
    const edited = queries.createTask({ title: 'Mortgage' });
    const old = '2026-01-01T00:00:00.000Z';
    const { getDb } = await import('@/lib/db');
    const { tasks } = await import('@/lib/db/schema');
    getDb().update(tasks).set({ updatedAt: old }).run();
    turn.during = async (chatSessionId) => {
      const actor = { source: 'ai' as const, sessionId: chatSessionId };
      expect((await runAction('update_task', { id: filed.id, areaId: area.id }, { remote: true, actor })).ok).toBe(true);
      expect((await runAction('update_task', { id: edited.id, areaId: area.id, description: 'Notes' }, { remote: true, actor })).ok).toBe(true);
    };
    await fireHeartbeat();
    expect(queries.getTask(filed.id)).toMatchObject({ areaId: area.id, updatedAt: old });
    expect(queries.getTask(edited.id)?.updatedAt).not.toBe(old);
    // Outside a check-in, filing counts as usual.
    expect((await runAction('update_task', { id: filed.id, areaId: null }, { remote: false })).ok).toBe(true);
    expect(queries.getTask(filed.id)?.updatedAt).not.toBe(old);
  });

  it('records what the agent changed on the run, and changes alone send no message', async () => {
    const queries = await import('@/lib/db/queries');
    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const task = queries.createTask({ title: 'Needs an area' });
    // Mid-turn, the agent edits a task through the orchestrator with its
    // session credential (as the MCP route or the CLI would), then replies quiet.
    turn.during = async (chatSessionId) => {
      const env = await runAction(
        'update_task',
        { id: task.id, description: 'Set by the heartbeat' },
        { remote: true, actor: { source: 'ai', sessionId: chatSessionId } },
      );
      expect(env.ok).toBe(true);
    };
    const { run, chat } = await fireHeartbeat();
    await settleCoordination();
    expect(run.artifactRefs).toEqual([{ kind: 'task', id: task.id }]);
    expect(run.statusReason).toBe('heartbeat_quiet');
    expect(chat.status).toBe('archived');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('a failed check-in stays in Unread and sends nothing on', async () => {
    const queries = await import('@/lib/db/queries');
    const { finishRun } = await import('./finish');
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    await ensureHeartbeatTrigger();
    const chat = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', label: 'Heartbeat' });
    const run = queries.createRun({ triggerId: HEARTBEAT_ID, harness: 'claude', triggerKind: 'every', status: 'running', chatSessionId: chat.id });
    queries.updateChatSession(chat.id, { createdByRunId: run.id });
    finishRun(run.id, { ok: false, errorCode: 'timeout', errorMessage: 'Run exceeded 1800s timeout' });
    expect(queries.getChatSession(chat.id)?.status).toBe('active');
    expect(queries.listNeedsReviewSessionCandidates().map((s) => s.id)).toContain(chat.id);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('a note never goes to a chat bound to a Slack thread, where the reply would be posted', async () => {
    const queries = await import('@/lib/db/queries');
    const { addMainChat, ensureMainChat } = await import('@/lib/sessions/main-chat');
    const own = await ensureMainChat(null);
    // A Slack thread is a main chat too, and here it's the most recently active.
    const threadChat = await addMainChat(null);
    queries.updateChatSession(threadChat.id, { lastActivityAt: new Date(Date.now() + 60_000).toISOString() });
    const connection = queries.createConversationConnection({ id: 'c1', name: 'Ri Personal', provider: 'slack', workspaceId: null, enabled: true, externalWorkspaceId: 'T001', externalAgentId: 'UBOT', channels: ['C001'] });
    const thread = queries.ensureConversationThread(connection.id, 'C001', '1.0');
    queries.bindConversationThread(thread.id, threadChat.id);
    turn.reply = '**Now**\nThe contract expires today.';
    await fireHeartbeat();
    await settleCoordination();
    expect(queries.listRecentChatEvents(own.id, 10).some((event) => event.senderSessionId)).toBe(true);
    expect(queries.listRecentChatEvents(threadChat.id, 10).some((event) => event.senderSessionId)).toBe(false);
    expect(queries.currentPrivateMainChat()?.id).toBe(own.id);
  });

  it('declining leaves earlier unread messages unread, and read ones read', async () => {
    const queries = await import('@/lib/db/queries');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const { isSessionUnread } = await import('@/lib/utils/session-sort');
    const main = await ensureMainChat(null);
    // Told them something earlier, and they haven't read it.
    const earlier = new Date(Date.now() - 60_000).toISOString();
    queries.insertChatEvent({ sessionId: main.id, role: 'assistant', source: 'agent', content: 'The contract expires today.', createdAt: earlier });
    queries.updateChatSession(main.id, { lastOutcomeEventAt: earlier, lastViewedAt: null });
    turn.reply = '**Now**\nThe contract still expires today.';
    turn.mainReply = 'NO_REPLY';
    await fireHeartbeat();
    await settleCoordination();
    expect(turn.prompts).toHaveLength(2);
    expect(isSessionUnread(queries.getChatSession(main.id)!)).toBe(true);
    expect(queries.getChatSession(main.id)!.lastOutcomeEventAt).toBe(earlier);

    // Once it's read, another declined note doesn't bring the mark back.
    queries.markSessionRead(main.id);
    turn.reply = '**Now**\nThe contract really still expires today.';
    await fireHeartbeat();
    await settleCoordination();
    expect(turn.prompts).toHaveLength(4);
    expect(isSessionUnread(queries.getChatSession(main.id)!)).toBe(false);
  });

  it('a note that never reached the main agent is raised again, and Settings says so', async () => {
    const queries = await import('@/lib/db/queries');
    const { checkInContext } = await import('@/lib/heartbeat/notes');
    const { getHeartbeatConfig } = await import('@/lib/heartbeat/trigger');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const main = await ensureMainChat(null);
    turn.reply = '**Now**\nThe contract expires today.\n\n**Later**\nPick a name.';
    await fireHeartbeat();
    await settleCoordination();
    const trigger = queries.getTrigger(HEARTBEAT_ID)!;
    expect(checkInContext(trigger)).toContain('The contract expires today.');
    expect((await getHeartbeatConfig()).lastCheckIn?.handOffFailed).toBe(false);
    // The main agent's turn died, as it does when the home restarts mid-turn.
    const turnRun = queries.listRuns({ limit: 50 }).find((run) => run.chatSessionId === main.id)!;
    queries.updateRun(turnRun.id, { status: 'failed' });
    expect((await getHeartbeatConfig()).lastCheckIn?.handOffFailed).toBe(true);
    expect(checkInContext(trigger)).not.toContain('The contract expires today.');
    // Later wasn't lost, so it still counts as raised.
    expect(checkInContext(trigger)).toContain('Pick a name.');
  });

  it('what a person types never absorbs a waiting note, which waits for its own turn', async () => {
    const queries = await import('@/lib/db/queries');
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const main = await ensureMainChat(null);
    const source = queries.createChatSession({ type: 'orchestration', harness: 'claude', status: 'archived', label: 'Heartbeat' });
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    await ensureHeartbeatTrigger();
    const { handOffToMainAgent } = await import('@/lib/heartbeat/handoff');
    const checkIn = queries.createRun({ triggerId: HEARTBEAT_ID, harness: 'claude', triggerKind: 'every', status: 'completed', chatSessionId: source.id });
    const delivery = handOffToMainAgent(checkIn, source, 'The contract expires today.');
    queries.updateAgentDelivery(delivery.id, { targetSessionId: main.id });
    queries.persistAgentDelivery(delivery.id);
    expect(queries.pendingAgentDeliveries(main.id).map((input) => input.id)).toEqual([delivery.id]);
    expect(queries.humanCoordinationContext(main.id, null)).toEqual([]);
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
