/**
 * Running an execution on a connected device (docs/homes-build.md, P2.4),
 * end to end: the home in this process behind its real proxy and routes,
 * and the worker in a process of its own, as on a laptop, with its own root,
 * journals and runner. The harness there is the fake one (see
 * `src/test/fixtures/worker-process.ts`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let laptopRoot: string;
let deviceId: string;
let executionId: string;
let chatId: string;
let homeId: string;
let workerKey: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-exec-' });
  laptopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-laptop-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.pairDevice({ name: 'Laptop', kind: 'computer' });
  deviceId = q.registerDeviceForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).device.id;
  server = await startHomeServer();

  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptop.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  ({ workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: WORKER_PROTOCOL, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>));

  // An agent with an execution placed on the laptop, its worktree there.
  const worktree = path.join(laptopRoot, 'worktrees', 'demo-1');
  fs.mkdirSync(worktree, { recursive: true });
  const ws = q.createWorkspace({
    name: 'Demo',
    cwd: path.join(home.root, 'demo'),
    isGit: false,
    filesToCopy: [],
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
  });
  const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Remote work' });
  executionId = created.execution.id;
  chatId = created.session.id;
  q.createPlacement({ executionId, deviceId, startReason: 'created', worktreePath: worktree });

  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => (q.getDevice(deviceId)?.harnesses?.length ?? 0) > 0, "the laptop's harness report");
}, 60_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await (await import('@/lib/coordination/service')).stopAgentCoordination();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  const { _resetWorkerHub } = await import('@/lib/workers/hub');
  _resetWorkerHub();
  const { _resetRemoteLive } = await import('@/lib/executor/remote-live');
  _resetRemoteLive();
  await server.close();
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
});

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

async function userMessage(content: string) {
  const q = await import('@/lib/db/queries');
  return q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
}


it('F6: an offline device receives two distinct assignment sends for one chat before either is accepted', async () => {
  const q = await import('@/lib/db/queries');
  const coordination = await import('@/lib/coordination/service');
  const { isDeviceConnected, wakeDevice } = await import('@/lib/workers/hub');
  await worker!.stop();
  worker = null;
  q.setAgentCoordinationPolicy('global', '1', 'allow');
  const a = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  const b = q.createChatSession({ type: 'content', harness: 'claude' });
  q.setAgentCoordinationHold(a.id, true);
  q.setAgentCoordinationHold(b.id, true);
  const first = await coordination.submitAgentRequest({ remote: true, actor: { source: 'ai', sessionId: a.id } }, { target: `session:${chatId}`, requestId: 'first', kind: 'question', content: 'First assignment.' });
  await coordination.drainAgentCoordination();
  const second = await coordination.submitAgentRequest({ remote: true, actor: { source: 'ai', sessionId: b.id } }, { target: `session:${chatId}`, requestId: 'second', kind: 'question', content: 'Second, unrelated assignment.' });
  for (let n = 0; n < 4; n++) await coordination.drainAgentCoordination();
  const sends = q.listWorkerCommands(deviceId).filter(command => command.kind === 'send');
  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => isDeviceConnected(deviceId), 'the reconnected worker');
  wakeDevice(deviceId);
  await until(() => ['completed','failed'].includes(q.getAgentRequest(second.requestId!)?.status ?? '') && ['completed','failed'].includes(q.getAgentRequest(first.requestId!)?.status ?? ''), 'both outcomes', 20_000);
  expect(q.getAgentRequest(first.requestId!)?.status).toBe('completed');
  expect(q.getAgentRequest(second.requestId!)?.status).toBe('completed');
  expect(sends.length).toBe(1);
}, 60_000);

it('F7: a human send folds a delivery whose own reserved send is already queued, so the device supplies it twice', async () => {
  const q = await import('@/lib/db/queries');
  const coordination = await import('@/lib/coordination/service');
  const { dispatch } = await import('@/lib/executor/adapter');
  const { isDeviceConnected, wakeDevice } = await import('@/lib/workers/hub');
  await worker!.stop();
  worker = null;
  q.setAgentCoordinationPolicy('global', '1', 'allow');
  const a = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  q.setAgentCoordinationHold(a.id, true);
  const first = await coordination.submitAgentRequest({ remote: true, actor: { source: 'ai', sessionId: a.id } }, { target: `session:${chatId}`, requestId: 'only', kind: 'message', content: 'UNIQUE-MARKER one-way note.' });
  await coordination.drainAgentCoordination();
  const message = await userMessage('Human follow-up while the laptop is away.');
  void dispatch(chatId, message.content!, { sourceEventId: message.id, actor: { source: 'human' } }).catch(() => {});
  await until(() => q.listWorkerCommands(deviceId).filter(c => c.kind === 'send').length === 2, 'both sends queued');
  const payloads = q.listWorkerCommands(deviceId).filter(c => c.kind === 'send').map(c => (c.payload as {message:string}).message.includes('UNIQUE-MARKER'));
  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => isDeviceConnected(deviceId), 'the reconnected worker');
  wakeDevice(deviceId);
  await until(() => q.listChatEvents(chatId).filter(e => e.source === 'agent').length >= 2, 'two replies', 20_000);
  const replies = q.listChatEvents(chatId).filter(e => e.source === 'agent' && e.content?.includes('UNIQUE-MARKER')).length;
  expect(payloads.filter(Boolean).length).toBe(1);
  expect(replies).toBe(1);
  expect(q.getAgentDelivery(first.id)?.status).toBe('accepted');
}, 60_000);

it('does not audit queued human direction or cancel a held unaccepted assignment when Stop is pressed', async () => {
  const q = await import('@/lib/db/queries');
  const service = await import('@/lib/coordination/service');
  const executor = await import('@/lib/executor/adapter');
  const { recordCoordinationProducer } = await import('@/lib/coordination/run-context');
  const { stableCoordinationId } = await import('@/lib/coordination/ids');
  const { isDeviceConnected, wakeDevice } = await import('@/lib/workers/hub');
  await worker!.stop();
  worker = null;
  q.setAgentCoordinationPolicy('global', '1', 'allow');
  const source = q.createChatSession({ type: 'content', harness: 'claude' });
  q.setAgentCoordinationHold(source.id, true);
  const initial = await service.submitAgentRequest({ remote: true, actor: { source: 'ai', sessionId: source.id } }, { target: `session:${chatId}`, requestId: 'held-stop', kind: 'question', content: 'Complete this once released.' });
  await service.drainAgentCoordination();
  const reserved = q.getAgentRequest(initial.requestId!)!.runId!;
  recordCoordinationProducer(chatId, reserved);
  q.setAgentCoordinationHold(chatId, true);
  const human = await userMessage('My own direction, still not accepted.');
  void executor.dispatch(chatId, human.content!, { sourceEventId: human.id, actor: { source: 'human' } }).catch(() => {});
  await until(() => !!q.getSendForEvent(human.id), 'the saved human send');
  expect(q.getChatEventById(stableCoordinationId('audit', reserved, 'coordination_human_direction'))).toBeNull();
  await executor.abort(chatId, { source: 'human' });
  expect(q.getAgentRequest(initial.requestId!)?.status).toBe('queued');
  expect(q.getSendForEvent(initial.eventId)?.state).toBe('queued');
  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => isDeviceConnected(deviceId), 'the reconnected held worker');
  q.setAgentCoordinationHold(chatId, false);
  wakeDevice(deviceId);
  await until(() => q.getAgentRequest(initial.requestId!)?.status === 'completed', 'the original assignment outcome');
  expect(q.getAgentRequest(initial.requestId!)?.runId).toBe(reserved);
}, 60_000);

it('waits for an offline ordinary send before admitting a distinct required assignment', async () => {
  const q = await import('@/lib/db/queries');
  const service = await import('@/lib/coordination/service');
  const { isDeviceConnected, wakeDevice } = await import('@/lib/workers/hub');
  await worker!.stop();
  worker = null;
  q.setAgentCoordinationPolicy('global', '1', 'allow');
  const source = q.createChatSession({ type: 'content', harness: 'claude' });
  q.setAgentCoordinationHold(source.id, true);
  service.startAgentCoordination();
  await service.submitAgentRequest({ remote: true, actor: { source: 'ai', sessionId: source.id } }, { target: `session:${chatId}`, requestId: 'ordinary-first', kind: 'message', content: 'Read this note first.' });
  await service.drainAgentCoordination();
  const assignment = await service.submitAgentRequest({ remote: true, actor: { source: 'ai', sessionId: source.id } }, { target: `session:${chatId}`, requestId: 'required-next', kind: 'question', content: 'Distinct assigned work.' });
  await service.drainAgentCoordination();
  expect(q.listWorkerCommands(deviceId).filter(command => command.kind === 'send')).toHaveLength(1);
  expect(q.getAgentRequest(assignment.requestId!)?.runId).toBeNull();
  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => isDeviceConnected(deviceId), 'the worker after the ordinary send');
  wakeDevice(deviceId);
  await until(() => q.getAgentRequest(assignment.requestId!)?.status === 'completed', 'the distinct assignment completion');
  expect(q.terminalAgentDelivery(assignment.requestId!)?.payload.content).toContain('Distinct assigned work.');
}, 60_000);
