/**
 * The P2 re-review's probes (review of 183391a, 2026-09-25), kept as
 * regressions: a dispatch the home stopped before saving its send is reaped
 * at boot, overlapping messages are charged to their own runs, and a turn's
 * result keeps its own send's generation.
 *
 * The first probe is a P4 acceptance check, skipped until P4: a command the
 * home streamed before a disconnect, for a placement that changed since,
 * must not run when resent. Only P4's transfer changes a placement under a
 * running worker today, and whether such a command becomes stale or
 * uncertain (the worker may have received it) is P4's to decide with the
 * transfer lock (docs/homes-build.md, P2 re-review).
 */

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { CommandJournal } from '@/lib/worker/command-journal';
import { EventJournal } from '@/lib/worker/event-journal';
import { runWorker } from '@/lib/worker/run';
import { executionHandlers } from '@/lib/worker/handlers';
import { CommandProcessor } from '@/lib/worker/commands';
import type { WorkerCommand } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let q: typeof import('@/lib/db/queries');
let homeId: string, hostId: string, computerId: string, workerKey: string, chatId: string, executionId: string;
let workspace: ReturnType<typeof q.createWorkspace>;
let fake: import('@/test/fixtures/fake-harness').FakeHarness | null = null;
let stop: AbortController | null = null;
let running: Promise<unknown> | null = null;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p2-recheck-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const own = identity.ensureHomeIdentity().home;
  homeId = own.id; hostId = own.hostComputerId;
  q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'Review laptop', createdByApiKeyId: null });
  const enrollment = q.redeemEnrollGrant({ secret: grant.secret, name: 'Review laptop' });
  computerId = enrollment.computer.id; workerKey = enrollment.token.plaintext;
  workspace = q.createWorkspace({ name: 'Review', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Review execution' });
  chatId = created.session.id; executionId = created.execution.id;
  q.createPlacement({ executionId, computerId, startReason: 'created', worktreePath: home.root });
  server = await startHomeServer();
});
afterEach(async () => {
  stop?.abort(); await running; stop = null; running = null;
  await (await import('@/lib/runner/local-runner')).close(chatId);
  fake?.restore(); fake = null;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/runs/artifact-bucket'))._resetArtifactBucket();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});
function target() { return { homeId, homeUrl: server.url, homeName: 'Review home', computerName: 'Review laptop', workerKey }; }
function journals() { return { commands: new CommandJournal(homeId, path.join(home.workDir, 'commands.jsonl')), events: new EventJournal(homeId, path.join(home.workDir, 'events.jsonl')) }; }
function makeRun() {
  const run = q.createRun({ triggerId: null, workspaceId: workspace.id, executionId, chatSessionId: chatId, harness: 'claude', triggerKind: 'manual', triggerPayload: null, scheduledFor: null, status: 'queued' });
  q.markRunStarted(run.id); return run;
}
function wire(command: ReturnType<typeof q.queueWorkerCommand>): WorkerCommand {
  return { id: command.id, seq: command.seq!, kind: command.kind, target: { executionId: command.executionId, chatSessionId: command.chatSessionId, generation: command.generation }, actor: command.actor, issuedAt: command.createdAt, payload: command.payload };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Timed out');
}

it.skip('P4 acceptance: does not execute an obsolete command streamed before disconnect but never received', async () => {
  const command = q.queueWorkerCommand({ computerId, kind: 'run_script', payload: { script: 'setup', workspaceId: workspace.id, command: 'printf executed > stale-command-ran.txt', worktreePath: home.root, branchName: null }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
  // Streamed, but the connection died before the worker could journal receipt.
  q.takeCommandsForStream(computerId, 0);
  q.createPlacement({ executionId, computerId: hostId, startReason: 'continued' });
  const j = journals();
  stop = new AbortController();
  running = runWorker({ target: target(), version: 'review', describe: async () => [], signal: stop.signal, journals: j, handlers: executionHandlers({ journal: j.commands }), heartbeatMs: 10000 });
  await until(() => ['stale', 'delivered', 'failed'].includes(q.getWorkerCommand(command.id)!.state));
  expect({ state: q.getWorkerCommand(command.id)!.state, executed: fs.existsSync(path.join(home.root, 'stale-command-ran.txt')) }).toEqual({ state: 'stale', executed: false });
});

it('charges two overlapping sends to their respective runs', async () => {
  fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness('claude');
  let finishFirst!: () => void;
  const firstReady = new Promise<void>(resolve => { finishFirst = resolve; });
  fake.onTurn(async turn => {
    if (turn.message === 'first') await firstReady;
    await turn.say(turn.message);
    return { costUsd: turn.message === 'first' ? 3 : 5 };
  });
  const a = makeRun(), b = makeRun();
  const spec = { chatSessionId: chatId, harness: 'claude', cwd: home.root, sessionType: 'execution', nativeSessionId: null, permissionMode: 'ask', prePlanMode: null, model: 'fake-model', modelVariant: null, effort: null, mcpServers: [], strictMcpConfig: true, disallowedTools: [], extraArgs: [], instructions: null, firstTurnPreamble: null, env: {}, attachUserSkills: false, cleanLegacySkillLinks: false };
  const queued = [a, b].map((r, i) => q.queueWorkerCommand({ computerId, kind: 'send', payload: { runId: r.id, turnId: `turn-${i}`, message: i === 0 ? 'first' : 'second', spec }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 }));
  q.takeCommandsForStream(computerId, 0);
  const j = journals();
  const aborted = new AbortController(); aborted.abort();
  await runWorker({ target: { ...target(), homeUrl: 'http://127.0.0.1:1' }, version: 'review', signal: aborted.signal, journals: j, onSink: (await import('@/lib/runner/sink')).installRunnerSink });
  const p = new CommandProcessor({ target: target(), journal: j.commands, handlers: executionHandlers({ journal: j.commands }) });
  for (const c of queued) p.receive(wire(q.getWorkerCommand(c.id)!));
  await p.idle();
  expect(j.commands.openTurns()).toHaveLength(2);
  finishFirst();
  await fake.latest().drain();
  await until(() => j.commands.openTurns().length === 0);
  (await import('@/lib/executor/apply')).applyWorkerEvents(computerId, j.events.pending());
  expect([q.getRun(a.id)!.costUsd ?? 0, q.getRun(b.id)!.costUsd ?? 0]).toEqual([3, 5]);
});

it('keeps the producing generation on a turn result when a new command arrives first', async () => {
  const run = makeRun();
  const command = q.queueWorkerCommand({ computerId, kind: 'send', payload: { runId: run.id, turnId: 'old-turn' }, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
  q.takeCommandsForStream(computerId, 0);
  const j = journals();
  j.commands.received(wire(q.getWorkerCommand(command.id)!));
  j.commands.started(command.id); j.commands.finished(command.id, { state: 'delivered' }); j.commands.confirmed(command.id);
  q.createPlacement({ executionId, computerId, startReason: 'continued' });
  const next = q.queueWorkerCommand({ computerId, kind: 'interrupt', payload: {}, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 2 });
  q.takeCommandsForStream(computerId, 1);
  j.commands.received(wire(q.getWorkerCommand(next.id)!));
  const aborted = new AbortController(); aborted.abort();
  let sink!: import('@/lib/runner/types').RunnerSink;
  await runWorker({ target: { ...target(), homeUrl: 'http://127.0.0.1:1' }, version: 'review', signal: aborted.signal, journals: j, onSink: s => { sink = s; } });
  sink.signal(chatId, { type: 'turn_result', turnId: 'old-turn', runId: run.id, ok: true, error: null });
  (await import('@/lib/executor/apply')).applyWorkerEvents(computerId, j.events.pending());
  expect({ generation: j.events.pending()[0]!.generation, status: q.getRun(run.id)!.status, open: j.commands.openTurns().length }).toEqual({ generation: 1, status: 'completed', open: 0 });
});

it('reaps a remote dispatch interrupted before a durable send command exists', async () => {
  // adapter.deliver creates and starts the run before awaiting buildSpec and
  // describeInputFiles, and only then queues a send. Simulate a home crash
  // in that window: no worker was told about this run and none can finish it.
  const run = makeRun();
  expect(q.listWorkerCommands(computerId)).toHaveLength(0);
  q.reapStaleRunningRuns();
  expect(q.getRun(run.id)!.status).toBe('failed');
});
