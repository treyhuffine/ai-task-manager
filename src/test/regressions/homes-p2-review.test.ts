/**
 * The P2.1–P2.6 review's probes (review of 09d788b..694cf64, 2026-09-25),
 * kept as regressions. Each asserts the behavior the review asked for. Two
 * were adapted to the real path: re-enrollment goes through `enrollWorker`,
 * the service the enroll route uses, and the sink probe first journals the
 * send that started the chat's session, as a real worker always has. The
 * home-restart probe's run has the send that started it, since a worker's
 * turn result now counts only for its own sends (finding 1).
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import type { WorkerCommand } from '@/lib/workers/protocol';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let q: typeof import('@/lib/db/queries');
let homeId: string;
let hostId: string;
let computerId: string;
let workerKey: string;
let workerKeyId: string;
let workspace: ReturnType<typeof q.createWorkspace>;
let chatId: string;
let executionId: string;
let subprocess: import('@/test/fixtures/worker-process').WorkerProcess | null = null;
let fake: import('@/test/fixtures/fake-harness').FakeHarness | null = null;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p2-review-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const own = identity.ensureHomeIdentity().home;
  homeId = own.id;
  hostId = own.hostComputerId;
  q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'Review laptop', createdByApiKeyId: null });
  const enrollment = q.redeemEnrollGrant({ secret: grant.secret, name: 'Review laptop' });
  computerId = enrollment.computer.id;
  workerKey = enrollment.token.plaintext;
  workerKeyId = enrollment.key.id;
  workspace = q.createWorkspace({ name: 'Review', cwd: path.join(home.root, 'source'), isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Review execution' });
  chatId = created.session.id;
  executionId = created.execution.id;
  q.createPlacement({ executionId, computerId, startReason: 'created', worktreePath: path.join(home.root, 'laptop-source') });
  server = await startHomeServer();
});

afterEach(async () => {
  await subprocess?.stop();
  subprocess = null;
  fake?.restore();
  fake = null;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/runs/artifact-bucket'))._resetArtifactBucket();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

function target() {
  return { homeId, homeUrl: server.url, homeName: 'Review home', computerName: 'Review laptop', workerKey };
}

async function post(route: string, body: unknown) {
  return fetch(server.url + route, {
    method: 'POST',
    headers: { authorization: `Bearer ${workerKey}`, 'x-ri-worker-protocol': String(WORKER_PROTOCOL), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRun(sessionId = chatId) {
  const run = q.createRun({ triggerId: null, workspaceId: workspace.id, executionId: sessionId === chatId ? executionId : null, chatSessionId: sessionId, harness: 'claude', triggerKind: 'manual', triggerPayload: null, scheduledFor: null, status: 'queued' });
  q.markRunStarted(run.id);
  return run;
}

function wire(command: ReturnType<typeof q.queueWorkerCommand>): WorkerCommand {
  return { id: command.id, seq: command.seq!, kind: command.kind, target: { executionId: command.executionId, chatSessionId: command.chatSessionId, generation: command.generation }, actor: command.actor, issuedAt: command.createdAt, payload: command.payload };
}

it('a worker cannot finish a run belonging to a different chat on the home', async () => {
  const victim = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Home-only victim' });
  const run = makeRun(victim.session.id);
  const result = await post('/api/workers/me/events', { events: [{ position: 1, eventId: 'cross-run', generation: 1, chatSessionId: chatId, occurredAt: new Date().toISOString(), kind: 'signal', signal: { type: 'turn_result', turnId: 'unrelated', runId: run.id, ok: true, error: null } }] });
  expect(result.status).toBe(200);
  expect(q.getRun(run.id)?.status).toBe('running');
});

it('a worker heartbeat cannot create pending prompts for a home-only chat', async () => {
  const victim = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: null });
  const result = await post('/api/workers/me/heartbeat', { protocol: WORKER_PROTOCOL, version: 'review', harnesses: [], state: 'awake', live: { running: [victim.session.id], backgroundTasks: {}, pending: [{ requestId: 'forged-prompt', sessionId: victim.session.id, kind: 'permission', toolUseId: 'forged-prompt', toolName: 'Bash', input: { command: 'anything' }, title: null, description: null, createdAt: new Date().toISOString() }] } });
  expect(result.status).toBe(200);
  const live = await import('@/lib/executor/remote-live');
  expect(live.remoteChat(victim.session.id)).toBeNull();
});

it('the real worker sink preserves old-placement events as history after a move', async () => {
  const { EventJournal } = await import('@/lib/worker/event-journal');
  const { runWorker } = await import('@/lib/worker/run');
  const { CommandJournal } = await import('@/lib/worker/command-journal');
  const events = new EventJournal(homeId, path.join(home.workDir, 'events.jsonl'));
  const commands = new CommandJournal(homeId, path.join(home.workDir, 'commands.jsonl'));
  // The send that started this chat's session on the laptop, at generation 1.
  commands.received({ id: 'started-it', seq: 1, kind: 'send', target: { executionId, chatSessionId: chatId, generation: 1 }, actor: { source: 'human' }, issuedAt: new Date().toISOString(), payload: {} });
  const controller = new AbortController();
  controller.abort();
  let sink!: import('@/lib/runner/types').RunnerSink;
  await runWorker({ target: target(), version: 'review', signal: controller.signal, describe: async () => [], journals: { commands, events }, onSink: (s) => { sink = s; } });
  // Suppress network posting by stopping the test server while the old output is journaled.
  await server.close();
  await sink.writer.write({ sessionId: chatId, role: 'assistant', source: 'agent', content: 'Output before moving' });
  const buffered = events.pending();
  q.createPlacement({ executionId, computerId: hostId, startReason: 'continued' });
  const result = (await import('@/lib/executor/apply')).applyWorkerEvents(computerId, buffered);
  expect(result.refused).toEqual([]);
  expect(q.listChatEvents(chatId).some((e) => e.content === 'Output before moving')).toBe(true);
});

it('recovery performs no side effects before a revoked worker is authenticated', async () => {
  const { CommandJournal } = await import('@/lib/worker/command-journal');
  const { EventJournal } = await import('@/lib/worker/event-journal');
  const { runWorker } = await import('@/lib/worker/run');
  const command = q.queueWorkerCommand({ computerId, kind: 'run_script', payload: { script: 'setup', workspaceId: workspace.id, command: 'printf executed > review-revoked-script.txt', worktreePath: home.root, branchName: null }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
  q.takeCommandsForStream(computerId, 0);
  const commands = new CommandJournal(homeId, path.join(home.workDir, 'commands.jsonl'));
  commands.received(wire(q.getWorkerCommand(command.id)!));
  q.revokeApiKey(workerKeyId, 'Review revocation');
  const handlers = (await import('@/lib/worker/handlers')).executionHandlers({ journal: commands });
  const recovery = handlers.run_script!.recover;
  let recoveryDone!: Promise<import('@/lib/workers/protocol').WorkerCommandAckBody>;
  handlers.run_script!.recover = (...args) => (recoveryDone = recovery(...args));
  const outcome = await runWorker({ target: target(), version: 'review', describe: async () => [], journals: { commands, events: new EventJournal(homeId, path.join(home.workDir, 'events.jsonl')) }, handlers });
  if (recoveryDone) await recoveryDone;
  expect(outcome.reason).toBe('revoked');
  expect(fs.existsSync(path.join(home.root, 'review-revoked-script.txt'))).toBe(false);
});

it('an event journal repairs a torn final line before appending again', async () => {
  const { EventJournal } = await import('@/lib/worker/event-journal');
  const file = path.join(home.workDir, 'torn-events.jsonl');
  fs.mkdirSync(home.workDir, { recursive: true });
  fs.writeFileSync(file, '{"position":1,"eventId":"partial');
  const journal = new EventJournal(homeId, file);
  const input = { eventId: 'new', generation: 1, chatSessionId: chatId, occurredAt: new Date().toISOString(), kind: 'signal' as const, signal: { type: 'running' as const, running: false } };
  journal.append(input);
  journal.append({ ...input, eventId: 'newer' });
  expect(() => new EventJournal(homeId, file)).not.toThrow();
});

it('a command journal repairs a torn final line before appending again', async () => {
  const { CommandJournal } = await import('@/lib/worker/command-journal');
  const file = path.join(home.workDir, 'torn-commands.jsonl');
  fs.mkdirSync(home.workDir, { recursive: true });
  fs.writeFileSync(file, '{"stage":"received","commandId":"partial');
  const journal = new CommandJournal(homeId, file);
  const command: WorkerCommand = { id: 'next', seq: 1, kind: 'stop', target: { executionId, chatSessionId: chatId, generation: 1 }, actor: { source: 'human' }, issuedAt: new Date().toISOString(), payload: {} };
  journal.received(command);
  journal.started(command.id);
  expect(() => new CommandJournal(homeId, file)).not.toThrow();
});

it('live mode on a different filesystem does not run the worktree setup script in the source folder', async () => {
  const command = q.queueWorkerCommand({ computerId, kind: 'prepare', payload: { workspace: { ...workspace, isGit: true, setupCommand: 'echo setup' }, chatSessionId: chatId, label: null, baseBranch: null, prNumber: null, live: true }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
  q.takeCommandsForStream(computerId, 0);
  const response = await post(`/api/workers/me/commands/${command.id}/ack`, { state: 'delivered', result: { worktreePath: path.join(home.root, 'different-laptop-source'), branchName: 'main', baseSha: 'abc', warning: null } });
  expect(response.status).toBe(200);
  expect(q.listWorkerCommands(computerId).filter((c) => c.kind === 'run_script')).toEqual([]);
});

it('re-enrolling a worker settles runs for commands it marks uncertain', async () => {
  const run = makeRun();
  const command = q.queueWorkerCommand({ computerId, kind: 'send', payload: { runId: run.id, turnId: 'reenrollment-turn' }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
  q.takeCommandsForStream(computerId, 0);
  const grant = q.createComputerGrant({ kind: 'enroll', computerId, createdByApiKeyId: null });
  const { enrollWorker } = await import('@/lib/workers/enroll');
  enrollWorker({ secret: grant.secret, name: 'Review laptop again' });
  expect(q.getWorkerCommand(command.id)?.state).toBe('uncertain');
  expect(q.getRun(run.id)?.status).toBe('failed');
});

async function until(check: () => boolean, name: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${name}. ${subprocess?.output()}`);
}

async function launchWorker() {
  const { startWorkerProcess } = await import('@/test/fixtures/worker-process');
  fs.mkdirSync(path.join(home.root, 'laptop-source'), { recursive: true });
  subprocess = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: path.join(home.root, 'laptop-root') });
  await until(() => !!q.getComputer(computerId)?.harnesses?.length, 'worker heartbeat');
}

it('a delivered turn interrupted by a worker process restart eventually leaves running', async () => {
  const fixture = await import('@/test/fixtures/fake-harness');
  fake = fixture.installFakeHarness('claude');
  await launchWorker();
  const { dispatch } = await import('@/lib/executor/adapter');
  void dispatch(chatId, 'LONG review turn').catch(() => {});
  await until(() => q.listWorkerCommands(computerId).some((c) => c.kind === 'send' && c.state === 'delivered'), 'send acknowledgement');
  const command = q.listWorkerCommands(computerId).find((c) => c.kind === 'send')!;
  const { runId } = command.payload as { runId: string };
  expect(q.getRun(runId)?.status).toBe('running');
  await subprocess!.stop();
  subprocess = null;
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  await launchWorker();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const { healthCheckSession } = await import('@/lib/executor/health');
  await healthCheckSession(chatId, { force: true, redispatchOrphans: false });
  expect(q.getRun(runId)?.status).not.toBe('running');
}, 30000);

it('two overlapping dispatches of one source event do not create an orphan run', async () => {
  fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness('claude');
  await launchWorker();
  const { dispatch } = await import('@/lib/executor/adapter');
  const message = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'same send', createdAt: new Date().toISOString() })!;
  void dispatch(chatId, 'same send', { sourceEventId: message.id }).catch(() => {});
  void dispatch(chatId, 'same send', { sourceEventId: message.id }).catch(() => {});
  await until(() => q.listRuns({}).some((r) => r.chatSessionId === chatId && r.status === 'completed'), 'completed turn');
  expect(q.listWorkerCommands(computerId).filter((c) => c.kind === 'send')).toHaveLength(1);
  expect(q.listRuns({}).filter((r) => r.chatSessionId === chatId)).toHaveLength(1);
}, 30000);

it('an explicitly old-generation result never charges the current run', async () => {
  const moved = q.createPlacement({ executionId, computerId: hostId, startReason: 'continued' });
  expect(moved.generation).toBe(2);
  const currentRun = makeRun();
  (await import('@/lib/runs/artifact-bucket')).beginRun(currentRun.id, chatId);
  const result = await post('/api/workers/me/events', { events: [{ position: 1, eventId: 'old-cost', generation: 1, chatSessionId: chatId, occurredAt: new Date().toISOString(), kind: 'chat_event', cumulative: false, chatEvent: { role: 'system', source: 'result', content: 'old turn', raw: { type: 'result', costUsd: 9 } } }] });
  expect(result.status).toBe(200);
  expect(q.listChatEvents(chatId).some((e) => e.id === 'old-cost')).toBe(true);
  expect(q.getRun(currentRun.id)?.costUsd ?? 0).toBe(0);
});

it('home startup does not fail a turn still running on a connected computer', async () => {
  const run = makeRun();
  q.queueWorkerCommand({ computerId, kind: 'send', payload: { runId: run.id, turnId: 'survived-home-restart' }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
  // startScheduler calls this unconditionally when the home boots.
  q.reapStaleRunningRuns();
  // The already-running laptop finishes normally after the home returns.
  const response = await post('/api/workers/me/events', { events: [{ position: 1, eventId: 'after-home-restart', generation: 1, chatSessionId: chatId, occurredAt: new Date().toISOString(), kind: 'signal', signal: { type: 'turn_result', turnId: 'survived-home-restart', runId: run.id, ok: true, error: null } }] });
  expect(response.status).toBe(200);
  expect(q.getRun(run.id)?.status).toBe('completed');
});

it('migrations 0004 through 0006 preserve populated chat records and the set-null FK', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { createDatabaseAt, migrationTags } = await import('@/test/fixtures/migrations');
  const { runMigrations } = await import('@/lib/db/migrate');
  const file = path.join(home.root, 'pre-p2.db');
  createDatabaseAt(file, migrationTags()[3]!);
  const sqlite = new Database(file);
  try {
    sqlite.prepare("INSERT INTO chat_sessions (id, type, status, permission_mode, harness) VALUES ('old-chat', 'orchestration', 'active', 'ask', 'claude')").run();
    sqlite.prepare("INSERT INTO chat_events (id, session_id, role, source, content) VALUES ('old-event', 'old-chat', 'assistant', 'agent', 'preserve me')").run();
    const before = sqlite.prepare('SELECT rowid, * FROM chat_events').all() as Array<{ rowid: number; id: string; session_id: string; content: string }>;
    // 0004 onwards: every migration after the one the database was built at.
    expect(runMigrations(sqlite, path.resolve('drizzle')).applied).toBe(migrationTags().length - 4);
    expect(sqlite.prepare('SELECT rowid, id, session_id, content FROM chat_events').all()).toEqual(
      before.map((row) => ({ rowid: row.rowid, id: row.id, session_id: row.session_id, content: row.content })),
    );
    const fk = (sqlite.pragma('foreign_key_list(chat_sessions)') as Array<{ from: string; on_delete: string }>).find((x) => x.from === 'computer_id');
    expect(fk?.on_delete).toBe('SET NULL');
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally { sqlite.close(); }
});
