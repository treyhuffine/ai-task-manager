/**
 * Durable commands and events between a home and a worker
 * (docs/homes-build.md, P2.3), over real HTTP through the real proxy and
 * routes, with the real worker loop and journals on disk: commands applied
 * once whatever is resent, recovery after a restart, acknowledgements that
 * outlive an outage, and a journal of events stored at home in order, once.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerCommandKind } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import type { WorkerTarget } from '@/lib/worker/client';
import type { CommandHandlers, CommandKindHandler } from '@/lib/worker/commands';
import type { WorkerStatus } from '@/lib/worker/run';

let home: TestHome;
let server: HomeServer;
let homeId: string;
let laptopKey: string;
let computerId: string;
let target: WorkerTarget;
let journalDir: string;
const running: AbortController[] = [];

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-journals-' });
  journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-journal-files-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'MacBook CLI', deviceType: 'computer' });
  laptopKey = laptop.token.plaintext;
  computerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'MacBook', platform: 'darwin' }).computer.id;
  server = await startHomeServer();
  target = await enroll();
});

afterEach(async () => {
  for (const c of running.splice(0)) c.abort();
  const { _resetWorkerHub } = await import('@/lib/workers/hub');
  _resetWorkerHub();
  await server.close();
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(journalDir, { recursive: true, force: true });
});

async function enroll(): Promise<WorkerTarget> {
  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptopKey}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  const enrolled = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'mac', protocol: 1, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>);
  return { homeUrl: server.url, homeId, homeName: 'My Ri', computerName: 'MacBook', workerKey: enrolled.workerKey };
}

async function journals(name = 'a') {
  const { CommandJournal } = await import('@/lib/worker/command-journal');
  const { EventJournal } = await import('@/lib/worker/event-journal');
  return {
    commands: new CommandJournal(homeId, path.join(journalDir, `${name}-commands.jsonl`)),
    events: new EventJournal(homeId, path.join(journalDir, `${name}-events.jsonl`)),
  };
}

async function start(opts: {
  handlers?: CommandHandlers;
  journals?: Awaited<ReturnType<typeof journals>>;
  statuses?: WorkerStatus[];
  onSink?: (sink: import('@/lib/runner/types').RunnerSink) => void;
} = {}) {
  const controller = new AbortController();
  running.push(controller);
  const { runWorker } = await import('@/lib/worker/run');
  const exit = runWorker({
    target,
    version: 'test',
    signal: controller.signal,
    describe: async () => [],
    handlers: opts.handlers,
    journals: opts.journals ?? (await journals()),
    onStatus: (s) => opts.statuses?.push(s),
    onSink: opts.onSink,
    backoffMinMs: 20,
    backoffMaxMs: 50,
    postRetryMs: 50,
  });
  return { controller, exit };
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** A handler that counts runs and acknowledges them as delivered. */
function counting(recovery: CommandKindHandler['recover'] = async () => ({ state: 'uncertain' })) {
  const runs: string[] = [];
  const recovered: string[] = [];
  const handler: CommandKindHandler = {
    async run(command, ctx) {
      ctx.markStarted();
      runs.push(command.id);
      return { state: 'delivered', result: { ran: true } };
    },
    async recover(command, stage, ctx) {
      recovered.push(`${command.id}:${stage}`);
      return recovery(command, stage, ctx);
    },
  };
  return { handler, runs, recovered };
}

async function queue(kind: WorkerCommandKind = 'interrupt', chatSessionId: string | null = null) {
  const q = await import('@/lib/db/queries');
  const { wakeComputer } = await import('@/lib/workers/hub');
  const command = q.queueWorkerCommand({ computerId, kind, payload: { n: 1 }, actor: { source: 'human' }, chatSessionId });
  wakeComputer(computerId);
  return command;
}

async function stateOf(id: string) {
  const q = await import('@/lib/db/queries');
  return q.getWorkerCommand(id)?.state;
}

describe('commands', () => {
  it('are carried out once and acknowledged', async () => {
    const { handler, runs } = counting();
    const statuses: WorkerStatus[] = [];
    await start({ handlers: { interrupt: handler }, statuses });
    await until(() => statuses.some((s) => s.state === 'connected'), 'the worker to connect');
    const command = await queue();
    await until(async () => (await stateOf(command.id)) === 'delivered', 'the acknowledgement');
    expect(runs).toEqual([command.id]);
  });

  it('are never applied twice, whatever is resent', async () => {
    const { handler, runs } = counting();
    const statuses: WorkerStatus[] = [];
    const j = await journals();
    await start({ handlers: { interrupt: handler }, journals: j, statuses });
    await until(() => statuses.some((s) => s.state === 'connected'), 'the worker to connect');
    const command = await queue();
    await until(async () => (await stateOf(command.id)) === 'delivered', 'the acknowledgement');

    // The same command again on a new connection, as after a lost ack.
    const { CommandProcessor } = await import('@/lib/worker/commands');
    const processor = new CommandProcessor({ journal: j.commands, handlers: { interrupt: handler }, target });
    processor.receive(j.commands.get(command.id)!.command);
    await processor.idle();
    const hub = await import('@/lib/workers/hub');
    hub._dropWorkerStreams(computerId);
    await until(() => statuses.filter((s) => s.state === 'connected').length === 2, 'a reconnect');
    expect(runs).toEqual([command.id]);
  });

  it('left unfinished by a restart go through their recovery rule, not run again', async () => {
    const command = await queue();
    const q = await import('@/lib/db/queries');
    const [sent] = q.takeCommandsForStream(computerId, 0);
    const j = await journals();
    const wire = {
      id: sent!.id,
      seq: sent!.seq!,
      kind: sent!.kind,
      target: { executionId: null, chatSessionId: null, generation: null },
      actor: sent!.actor,
      issuedAt: sent!.createdAt,
      payload: sent!.payload,
    };
    // The earlier worker process received it, began its effect, and died.
    j.commands.received(wire);
    j.commands.started(wire.id);

    const { handler, runs, recovered } = counting();
    await start({ handlers: { interrupt: handler }, journals: await journals() });
    await until(async () => (await stateOf(command.id)) === 'uncertain', 'the recovered outcome');
    expect(runs).toEqual([]);
    expect(recovered).toEqual([`${command.id}:started`]);
  });

  it('resend an acknowledgement the home never confirmed', async () => {
    const command = await queue();
    const q = await import('@/lib/db/queries');
    const [sent] = q.takeCommandsForStream(computerId, 0);
    const j = await journals();
    const wire = {
      id: sent!.id,
      seq: sent!.seq!,
      kind: sent!.kind,
      target: { executionId: null, chatSessionId: null, generation: null },
      actor: sent!.actor,
      issuedAt: sent!.createdAt,
      payload: sent!.payload,
    };
    // Finished, but the home was unreachable when the acknowledgement went out.
    j.commands.received(wire);
    j.commands.finished(wire.id, { state: 'delivered' });
    expect(await stateOf(command.id)).toBe('sent');

    const { handler, runs } = counting();
    const reopened = await journals();
    await start({ handlers: { interrupt: handler }, journals: reopened });
    await until(async () => (await stateOf(command.id)) === 'delivered', 'the resent acknowledgement');
    await until(() => reopened.commands.get(command.id)?.stage === 'confirmed', 'the confirmation');
    expect(runs).toEqual([]);
  });

  it('resume after the receipt cursor, and a command received before it is not applied again', async () => {
    const { handler, runs } = counting();
    const a = await queue();
    const b = await queue();
    const c = await queue();
    const q = await import('@/lib/db/queries');
    const sent = q.takeCommandsForStream(computerId, 0);
    expect(sent.map((s) => s.seq)).toEqual([1, 2, 3]);
    const j = await journals();
    const wire = (i: number) => ({
      id: sent[i]!.id,
      seq: sent[i]!.seq!,
      kind: sent[i]!.kind,
      target: { executionId: null, chatSessionId: null, generation: null },
      actor: sent[i]!.actor,
      issuedAt: sent[i]!.createdAt,
      payload: sent[i]!.payload,
    });
    // 1 and 3 arrived, 2 was lost with the connection.
    j.commands.received(wire(0));
    j.commands.finished(a.id, { state: 'delivered' });
    j.commands.received(wire(2));
    j.commands.finished(c.id, { state: 'delivered' });
    expect(j.commands.cursor()).toBe(1);

    await start({ handlers: { interrupt: handler }, journals: await journals() });
    await until(async () => (await stateOf(b.id)) === 'delivered', 'the lost command');
    await until(async () => (await stateOf(c.id)) === 'delivered', 'the resent acknowledgement');
    expect(runs).toEqual([b.id]);
  });

  it('cancelled while queued are never sent, and leave no gap in the numbering', async () => {
    const q = await import('@/lib/db/queries');
    const first = await queue();
    const second = await queue();
    expect(q.cancelWorkerCommand(first.id)?.state).toBe('cancelled');
    const sent = q.takeCommandsForStream(computerId, 0);
    expect(sent.map((s) => [s.id, s.seq])).toEqual([[second.id, 1]]);
    expect(q.cancelWorkerCommand(second.id)).toBeNull(); // already streamed
  });

  it('streamed to a worker that is replaced become uncertain, not resent', async () => {
    const command = await queue();
    const q = await import('@/lib/db/queries');
    q.takeCommandsForStream(computerId, 0);
    target = await enroll();
    expect(await stateOf(command.id)).toBe('uncertain');
    expect(q.takeCommandsForStream(computerId, 0)).toEqual([]);
  });

  it("a kind this computer doesn't handle fails with what to do", async () => {
    const statuses: WorkerStatus[] = [];
    await start({ statuses });
    await until(() => statuses.some((s) => s.state === 'connected'), 'the worker to connect');
    const command = await queue('git');
    await until(async () => (await stateOf(command.id)) === 'failed', 'the refusal');
    const q = await import('@/lib/db/queries');
    expect(q.getWorkerCommand(command.id)?.error).toMatch(/doesn't handle "git"/);
  });
});

describe('events', () => {
  async function chatOnWorker() {
    const q = await import('@/lib/db/queries');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'auto_all' });
    q.updateChatSession(chat.id, { computerId } as never);
    return chat;
  }

  async function manualRun(chatSessionId: string) {
    const q = await import('@/lib/db/queries');
    const run = q.createRun({
      triggerId: null,
      workspaceId: null,
      executionId: null,
      chatSessionId,
      harness: 'claude',
      triggerKind: 'manual',
      triggerPayload: null,
      scheduledFor: null,
      status: 'queued',
    });
    q.markRunStarted(run.id);
    return run;
  }

  it('are journaled, posted, and applied at home in order', async () => {
    const chat = await chatOnWorker();
    const run = await manualRun(chat.id);
    let sink: import('@/lib/runner/types').RunnerSink | null = null;
    const j = await journals();
    await start({ journals: j, onSink: (s) => (sink = s) });
    await until(() => sink !== null, 'the sink');
    await sink!.writer.write({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Hello from the laptop' });
    sink!.signal(chat.id, { type: 'native_session', nativeSessionId: 'native-1' });
    sink!.signal(chat.id, { type: 'turn_result', turnId: 't1', runId: run.id, ok: true, error: null });

    const q = await import('@/lib/db/queries');
    await until(() => q.getAckedEventSeq(computerId) === 3, 'the home to store all three');
    expect(q.listChatEvents(chat.id).map((e) => e.content)).toContain('Hello from the laptop');
    expect(q.getChatSession(chat.id)?.externalSessionId).toBe('native-1');
    expect(q.getRun(run.id)?.status).toBe('completed');
    expect(j.events.ackedPosition()).toBe(3);
  });

  it('wait in the journal while the home is unreachable, and survive a restart', async () => {
    const chat = await chatOnWorker();
    const j = await journals();
    const { createWorkerSink } = await import('@/lib/worker/sink');
    const offline = createWorkerSink({ journal: j.events });
    await offline.writer.write({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Written while offline' });

    // A new process opens the same journal and posts it.
    await start({ journals: await journals() });
    const q = await import('@/lib/db/queries');
    await until(() => q.getAckedEventSeq(computerId) === 1, 'the home to store it');
    expect(q.listChatEvents(chat.id).some((e) => e.content === 'Written while offline')).toBe(true);
  });

  it('replayed are stored once, and a gap stops the batch', async () => {
    const chat = await chatOnWorker();
    const { applyWorkerEvents } = await import('@/lib/executor/apply');
    const q = await import('@/lib/db/queries');
    const event = (position: number, content: string) => ({
      position,
      eventId: `event-${position}`,
      generation: null,
      chatSessionId: chat.id,
      occurredAt: new Date().toISOString(),
      kind: 'chat_event' as const,
      chatEvent: { role: 'assistant', source: 'agent', content },
      cumulative: false,
    });
    expect(applyWorkerEvents(computerId, [event(1, 'one'), event(2, 'two')]).acked).toBe(2);
    expect(applyWorkerEvents(computerId, [event(1, 'one'), event(2, 'two')]).acked).toBe(2);
    expect(applyWorkerEvents(computerId, [event(4, 'four')]).acked).toBe(2);
    const contents = q.listChatEvents(chat.id).map((e) => e.content);
    expect(contents.filter((c) => c === 'one')).toHaveLength(1);
    expect(contents).not.toContain('four');
  });

  it("for a chat that doesn't run on this computer are refused, and the journal moves on", async () => {
    const q = await import('@/lib/db/queries');
    const elsewhere = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'auto_all' });
    const { applyWorkerEvents } = await import('@/lib/executor/apply');
    const result = applyWorkerEvents(computerId, [
      {
        position: 1,
        eventId: 'e1',
        generation: null,
        chatSessionId: elsewhere.id,
        occurredAt: new Date().toISOString(),
        kind: 'chat_event',
        chatEvent: { role: 'assistant', source: 'agent', content: 'not mine to write' },
        cumulative: false,
      },
    ]);
    expect(result).toEqual({ acked: 1, refused: [1] });
    expect(q.listChatEvents(elsewhere.id)).toHaveLength(0);
  });

  it('from a cleared journal number on after what the home holds', async () => {
    const chat = await chatOnWorker();
    const q = await import('@/lib/db/queries');
    q.setAckedEventSeq(computerId, 7);
    let sink: import('@/lib/runner/types').RunnerSink | null = null;
    const statuses: WorkerStatus[] = [];
    await start({ journals: await journals('fresh'), onSink: (s) => (sink = s), statuses });
    await until(() => statuses.some((s) => s.state === 'connected'), 'the worker to connect');
    await sink!.writer.write({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'After a reinstall' });
    await until(() => q.getAckedEventSeq(computerId) === 8, 'the home to store it');
    expect(q.listChatEvents(chat.id).some((e) => e.content === 'After a reinstall')).toBe(true);
  });

  it('compacted away are skipped when the home no longer has them', async () => {
    const chat = await chatOnWorker();
    const q = await import('@/lib/db/queries');
    const j = await journals();
    const { createWorkerSink } = await import('@/lib/worker/sink');
    const sink = createWorkerSink({ journal: j.events });
    for (const n of [1, 2, 3]) await sink.writer.write({ sessionId: chat.id, role: 'assistant', source: 'agent', content: `old ${n}` });
    j.events.ack(3); // the home took them, then lost them in a restore
    await sink.writer.write({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'new' });
    expect(q.getAckedEventSeq(computerId)).toBe(0);

    const { EventPoster } = await import('@/lib/worker/poster');
    await new EventPoster(target, j.events).kick();
    expect(q.getAckedEventSeq(computerId)).toBe(4);
    expect(q.listChatEvents(chat.id).some((e) => e.content === 'new')).toBe(true);
  });
});

describe('cumulative parts', () => {
  it('are replaced only by a newer revision', async () => {
    const q = await import('@/lib/db/queries');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'opencode', status: 'active', permissionMode: 'auto_all' });
    const { applyChatEvent } = await import('@/lib/executor/apply');
    const part = (content: string, partRevision: number) => ({
      sessionId: chat.id,
      role: 'assistant',
      source: 'agent',
      content,
      externalEventId: 'part-1',
      partRevision,
    });
    applyChatEvent(part('Hello', 100), { cumulative: true });
    applyChatEvent(part('Hello world', 300), { cumulative: true });
    applyChatEvent(part('Hello wor', 200), { cumulative: true }); // a late replay
    expect(q.listChatEvents(chat.id).map((e) => e.content)).toEqual(['Hello world']);
  });
});

describe('notifications', () => {
  it('left pending by a crash are sent by the drain', async () => {
    const q = await import('@/lib/db/queries');
    const channel = q.createNotificationChannel({
      userId: 'local',
      kind: 'connector',
      providerId: 'test',
      config: {},
      events: ['execution.finished'],
      enabled: true,
    });
    const { queueNotification, drainPendingNotifications } = await import('@/lib/notifications/notify');
    queueNotification({
      type: 'execution.finished',
      userId: 'local',
      dedupeKey: 'execution.finished:run-crashed',
      title: 'Done',
      body: 'Finished while the home crashed.',
      url: '/',
    });
    const sent: string[] = [];
    const deps = {
      resolveAdapter: () => ({
        kind: 'connector' as const,
        providerId: 'test',
        async deliver(_channel: unknown, rendered: { title: string }) {
          sent.push(rendered.title);
          return {};
        },
      }),
    };
    // Too young: its own sender may still be on it.
    expect(await drainPendingNotifications({ deps })).toBe(0);
    expect(await drainPendingNotifications({ olderThanMs: -1000, deps })).toBe(1);
    expect(sent).toEqual(['Done']);
    expect(q.listNotificationDeliveries('local').find((d) => d.channelId === channel.id)?.status).toBe('sent');
  });
});
