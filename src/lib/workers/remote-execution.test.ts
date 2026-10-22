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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProvider } from '@agentex/agent';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
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
let laptopKey: { id: string; token: string };
let workerKey: string;
let workspaceId: string;
let homeHarness: FakeHarness | null = null;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-exec-' });
  laptopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-laptop-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.pairDevice({ name: 'Laptop', kind: 'computer' });
  laptopKey = { id: laptop.key.id, token: laptop.token.plaintext };
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
  workspaceId = ws.id;
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
  const { _resetWorkerHub } = await import('@/lib/workers/hub');
  _resetWorkerHub();
  const { _resetRemoteLive } = await import('@/lib/executor/remote-live');
  _resetRemoteLive();
  await server.close();
  homeHarness?.restore();
  homeHarness = null;
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

async function configureRemoteSpeed() {
  homeHarness = installFakeHarness('claude');
  getProvider('claude').listModels = async () => [{ id: 'opus', name: 'Opus', serviceTiers: [
    { id: 'default', name: 'Standard', availability: 'available' },
    { id: 'fast', name: 'Fast', availability: 'unknown' },
  ] }];
  const q = await import('@/lib/db/queries');
  q.updateChatSession(chatId, { model: 'opus', serviceTier: 'fast' });
}

async function changeSpeedToNormal() {
  const { PATCH } = await import('@/lib/server/operations/sessions/[id]');
  const response = await PATCH({ params: { id: chatId }, body: { serviceTier: 'default' } }, {
    url: server.url, nextUrl: new URL(server.url), headers: new Headers(), signal: new AbortController().signal,
  });
  expect(response.status).toBe(200);
}

async function queueMessage(content: string, targetId = chatId) {
  const q = await import('@/lib/db/queries');
  const { dispatch } = await import('@/lib/executor/adapter');
  const message = q.insertChatEvent({ sessionId: targetId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
  const outcome = dispatch(targetId, content, { sourceEventId: message.id }).then(
    () => ({ ok: true, error: null }),
    (error: unknown) => ({ ok: false, error: String(error) }),
  );
  await until(() => q.listWorkerCommands(deviceId).some(command => command.sourceEventId === message.id), 'the queued send');
  const command = q.listWorkerCommands(deviceId).find(command => command.sourceEventId === message.id)!;
  return { outcome, commandId: command.id, runId: (command.payload as { runId: string }).runId };
}

describe('an execution on a connected device', () => {
  it.each(['answer', 'interrupt', 'close', 'close-idle'] as const)('keeps a sibling chat\'s %s control usable during another chat\'s recycle', async control => {
    const closing = control.startsWith('close');
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    const { abort, close, answerPendingInput, isRunning } = await import('@/lib/executor/adapter');
    const live = await import('@/lib/executor/live-state');
    const first = await queueMessage('LONG');
    const sibling = q.createExecutionChat({ executionId, harness: 'claude', model: 'opus', permissionMode: 'ask', serviceTier: 'fast' })!;
    const other = await queueMessage(control === 'answer' ? 'ASK before listing' : control === 'close-idle' ? 'SESSION_CONFIG' : 'LONG', sibling.id);
    await changeSpeedToNormal();
    const siblingFollowup = await queueMessage('SESSION_CONFIG', sibling.id);
    const ownFollowup = await queueMessage('SESSION_CONFIG');
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    try {
      if (control === 'close-idle') expect(await other.outcome).toMatchObject({ ok: true });
      else await until(() => control === 'answer' ? live.listForSession(sibling.id).length === 1 : isRunning(sibling.id), 'the sibling turn to start');
      if (control === 'answer') {
        const { requestId } = live.listForSession(sibling.id)[0]!;
        expect(answerPendingInput(sibling.id, requestId, { allow: true, updatedInput: { command: 'ls' } }, { source: 'human', apiKeyId: laptopKey.id }).ok).toBe(true);
      } else if (control === 'interrupt') await abort(sibling.id);
      else await close(sibling.id);
      await until(() => q.getRun(other.runId)?.completedAt != null,
        'the sibling control to finish its turn while the first chat keeps running', 5_000);
      expect(await other.outcome).toMatchObject({ ok: control !== 'close' });
      expect(isRunning(chatId)).toBe(true);
      const recycle = q.listWorkerCommands(deviceId).find(command => command.kind === 'recycle')!;
      expect(q.getWorkerCommand(recycle.id)?.state).toBe('sent');
      if (closing) {
        expect(await siblingFollowup.outcome).toMatchObject({ ok: false });
      } else {
        expect(q.getWorkerCommand(siblingFollowup.commandId)?.state).not.toBe('delivered');
      }
      expect(q.getWorkerCommand(ownFollowup.commandId)?.state).not.toBe('delivered');
    } finally {
      await abort(chatId);
      await Promise.all([first.outcome, other.outcome, siblingFollowup.outcome, ownFollowup.outcome]);
    }
    expect(await ownFollowup.outcome).toMatchObject({ ok: true });
    if (!closing) expect(await siblingFollowup.outcome).toMatchObject({ ok: true });
  }, 60_000);

  it('finishes offline queued work before recycling, holds the next send, and preserves its newly acquired native identity', async () => {
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    const first = await queueMessage('SLOW SESSION_CONFIG');
    await changeSpeedToNormal();
    const second = await queueMessage('SESSION_CONFIG');
    const commands = q.listWorkerCommands(deviceId);
    expect(commands.map(command => command.kind)).toEqual(['send', 'recycle', 'send']);
    // Neither spec knows the native ID yet. The worker must carry it across
    // the recycle instead of starting an unrelated conversation.
    expect(commands.filter(command => command.kind === 'send').map(command => (command.payload as { spec: { nativeSessionId: string | null } }).spec.nativeSessionId)).toEqual([null, null]);
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    expect(await first.outcome).toMatchObject({ ok: true });
    expect(await second.outcome).toMatchObject({ ok: true });
    const replies = q.listChatEvents(chatId).filter(event => event.source === 'agent').map(event => JSON.parse(event.content!));
    expect(replies).toEqual([
      { serviceTier: 'fast', model: 'opus', nativeSessionId: expect.any(String), sessionsStarted: 1 },
      { serviceTier: 'default', model: 'opus', nativeSessionId: replies[0].nativeSessionId, sessionsStarted: 2 },
    ]);
    expect(q.listRuns({}).filter(run => run.chatSessionId === chatId).map(run => run.status)).toEqual(['completed', 'completed']);
  }, 60_000);

  it('accepts a permission answer past a waiting recycle and queued follow-up', async () => {
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    const first = await queueMessage('ASK before listing');
    await changeSpeedToNormal();
    const second = await queueMessage('SESSION_CONFIG');
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    const live = await import('@/lib/executor/live-state');
    const { answerPendingInput } = await import('@/lib/executor/adapter');
    await until(() => live.listForSession(chatId).length === 1, 'the earlier turn to ask permission');
    const native = q.getChatSession(chatId)!.externalSessionId;
    const { requestId } = live.listForSession(chatId)[0]!;
    expect(q.listChatEvents(chatId).some(event => event.source === 'agent')).toBe(false);
    expect(answerPendingInput(chatId, requestId, { allow: true, updatedInput: { command: 'ls' } }, { source: 'human', apiKeyId: laptopKey.id }).ok).toBe(true);
    expect(await first.outcome).toMatchObject({ ok: true });
    expect(await second.outcome).toMatchObject({ ok: true });
    const replies = q.listChatEvents(chatId).filter(event => event.source === 'agent');
    expect(replies[0].content).toBe('allowed');
    expect(JSON.parse(replies[1].content!)).toMatchObject({ serviceTier: 'default', nativeSessionId: native, sessionsStarted: 2 });
  }, 60_000);

  it('honors each send snapshot even when an older prepared send arrives after the settings recycle', async () => {
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    const first = await queueMessage('SESSION_CONFIG');
    const original = q.listWorkerCommands(deviceId)[0]!;
    await changeSpeedToNormal();
    const message = await userMessage('SLOW SESSION_CONFIG prepared before the settings change');
    q.queueWorkerCommand({ deviceId, kind: 'send', chatSessionId: chatId, executionId, generation: 1,
      actor: { source: 'human' }, sourceEventId: message.id,
      payload: { ...(original.payload as object), message: message.content!, turnId: 'stale-preparation', runId: null },
    });
    const next = await queueMessage('SESSION_CONFIG');
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    expect(await first.outcome).toMatchObject({ ok: true });
    expect(await next.outcome).toMatchObject({ ok: true });
    const replies = q.listChatEvents(chatId).filter(event => event.source === 'agent').map(event => JSON.parse(event.content!));
    expect(replies.map(reply => reply.serviceTier)).toEqual(['fast', 'fast', 'default']);
    expect(replies.map(reply => reply.sessionsStarted)).toEqual([1, 2, 3]);
    expect(new Set(replies.map(reply => reply.nativeSessionId)).size).toBe(1);
  }, 60_000);

  it('receives permission answers while recovering a received send and recycle after restart', async () => {
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    const first = await queueMessage('ASK after restart');
    await changeSpeedToNormal();
    const second = await queueMessage('SESSION_CONFIG');
    // The predecessor received these but exited before handling them. Its
    // successor must recover them and keep reading the stream for controls.
    const { CommandJournal } = await import('@/lib/worker/command-journal');
    const journal = new CommandJournal(homeId, path.join(laptopRoot, '.work', 'commands', `${homeId}.jsonl`));
    for (const c of q.takeCommandsForStream(deviceId, 0)) {
      journal.received({ id: c.id, seq: c.seq!, kind: c.kind, payload: c.payload, actor: c.actor, issuedAt: c.createdAt,
        target: { chatSessionId: c.chatSessionId, executionId: c.executionId, generation: c.generation } });
    }
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    const live = await import('@/lib/executor/live-state');
    const { answerPendingInput } = await import('@/lib/executor/adapter');
    await until(() => live.listForSession(chatId).length === 1, 'the recovered permission prompt');
    const { requestId } = live.listForSession(chatId)[0]!;
    expect(answerPendingInput(chatId, requestId, { allow: true, updatedInput: { command: 'ls' } }, { source: 'human', apiKeyId: laptopKey.id }).ok).toBe(true);
    expect(await first.outcome).toMatchObject({ ok: true });
    expect(await second.outcome).toMatchObject({ ok: true });
    const replies = q.listChatEvents(chatId).filter(event => event.source === 'agent');
    expect(replies[0].content).toBe('allowed');
    expect(JSON.parse(replies[1].content!)).toMatchObject({ serviceTier: 'default', sessionsStarted: 2 });
  }, 60_000);

  it('allows interruption while recycling waits, then delivers the next message with Normal', async () => {
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    const first = await queueMessage('LONG');
    await changeSpeedToNormal();
    const second = await queueMessage('SESSION_CONFIG');
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    const { abort, isRunning } = await import('@/lib/executor/adapter');
    await until(() => isRunning(chatId), 'the earlier turn to start');
    await abort(chatId);
    expect(await first.outcome).toMatchObject({ ok: true });
    expect(await second.outcome).toMatchObject({ ok: true });
    const reply = q.listChatEvents(chatId).find(event => event.source === 'agent')!;
    expect(JSON.parse(reply.content!)).toMatchObject({ serviceTier: 'default', sessionsStarted: 2 });
  }, 60_000);

  it('lets an explicit close cancel sends waiting behind a recycle without restarting the chat', async () => {
    await configureRemoteSpeed();
    await worker!.stop();
    worker = null;
    const q = await import('@/lib/db/queries');
    const first = await queueMessage('LONG');
    await changeSpeedToNormal();
    const second = await queueMessage('SESSION_CONFIG');
    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    const { close, isRunning } = await import('@/lib/executor/adapter');
    await until(() => isRunning(chatId), 'the earlier turn to start');
    expect(await close(chatId)).toMatchObject({ queued: true });
    expect(await first.outcome).toMatchObject({ ok: false });
    expect(await second.outcome).toMatchObject({ ok: false, error: expect.stringContaining('closed before this message') });
    expect(q.listChatEvents(chatId).some(event => event.source === 'agent')).toBe(false);
    const stop = q.listWorkerCommands(deviceId).find(command => command.kind === 'stop')!;
    await until(() => q.getWorkerCommand(stop.id)?.state === 'delivered', 'the explicit close');
  }, 60_000);

  it('changes Fast to Normal in the owning worker before resuming the same conversation', async () => {
    homeHarness = installFakeHarness('claude');
    getProvider('claude').listModels = async () => [{ id: 'opus', name: 'Opus', serviceTiers: [
      { id: 'default', name: 'Standard', availability: 'available' },
      { id: 'fast', name: 'Fast', availability: 'unknown' },
    ] }];
    const q = await import('@/lib/db/queries');
    const { dispatch } = await import('@/lib/executor/adapter');
    const { PATCH } = await import('@/lib/server/operations/sessions/[id]');
    q.updateChatSession(chatId, { model: 'opus', serviceTier: 'fast' });
    const inspect = async () => {
      const message = await userMessage('SESSION_CONFIG');
      await dispatch(chatId, 'SESSION_CONFIG', { sourceEventId: message.id });
      const reply = q.listChatEvents(chatId).filter(event => event.source === 'agent').at(-1)!;
      return JSON.parse(reply.content!) as { serviceTier: string; nativeSessionId: string; sessionsStarted: number };
    };
    const fast = await inspect();
    expect(fast).toMatchObject({ serviceTier: 'fast', sessionsStarted: 1 });
    const response = await PATCH({ params: { id: chatId }, body: { serviceTier: 'default' } }, {
      url: server.url, nextUrl: new URL(server.url), headers: new Headers(), signal: new AbortController().signal,
    });
    expect(response.status).toBe(200);
    expect(q.getChatSession(chatId)?.serviceTier).toBe('default');
    // Send immediately. The queued recycle must precede it on the worker.
    const normal = await inspect();
    expect(normal).toEqual({ serviceTier: 'default', model: 'opus', nativeSessionId: fast.nativeSessionId, sessionsStarted: 2 });
    const kinds = q.listWorkerCommands(deviceId).map(command => command.kind);
    expect(kinds).toEqual(['send', 'recycle', 'send']);
    expect(homeHarness.sessions).toHaveLength(0);
  }, 60_000);

  it('runs a turn there, and the home gets its conversation and finishes its run', async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    const message = await userMessage('hello from the phone');
    await dispatch(chatId, 'hello from the phone', { sourceEventId: message.id });

    const events = q.listChatEvents(chatId);
    expect(events.some((e) => e.source === 'agent' && e.content === 'ok: hello from the phone')).toBe(true);
    const run = q.listRuns({}).find((r) => r.chatSessionId === chatId);
    expect(run).toMatchObject({ status: 'completed', triggerKind: 'manual' });
    // The acknowledgement travels apart from the turn's events, and may land after them.
    await until(() => q.listWorkerCommands(deviceId)[0]?.state === 'delivered', 'the acknowledgement');
    const [command] = q.listWorkerCommands(deviceId);
    expect(command).toMatchObject({ kind: 'send', state: 'delivered', sourceEventId: message.id, generation: 1 });
    expect(q.getChatSession(chatId)?.externalSessionId).toMatch(/^fake-/);
  }, 60_000);

  it('gives the agent there its own copy of each attached file, and never a path at home', async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const { expandMarkers } = await import('@/lib/attachments/expand-markers');
    const { getAttachmentsDir } = await import('@/lib/config/paths');
    const q = await import('@/lib/db/queries');
    const notes = await saveAttachment({ data: Buffer.from('shopping list'), originalName: 'notes.txt', mimeType: 'text/plain' });
    const content = `read [[file:${notes.fileName}]]`;
    const message = q.insertChatEvent({
      sessionId: chatId,
      role: 'user',
      source: 'user',
      content,
      attachments: [notes],
      createdAt: new Date().toISOString(),
    })!;
    // What the messages route does.
    await dispatch(chatId, await expandMarkers(content, [notes]), { sourceEventId: message.id, attachments: [notes] });

    const copy = path.join(laptopRoot, '.work', 'attachments', homeId, chatId, notes.fileName);
    expect(q.listChatEvents(chatId).some((e) => e.content === `ok: read ${copy}`)).toBe(true);
    expect(fs.readFileSync(copy, 'utf8')).toBe('shopping list');
    const [command] = q.listWorkerCommands(deviceId);
    expect(command!.payload).toMatchObject({
      message: content,
      attachments: [{ fileName: notes.fileName, originalName: 'notes.txt', size: 13, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    expect(JSON.stringify(command!.payload)).not.toContain(getAttachmentsDir());
  }, 60_000);

  it("reaches the home's servers from there, with its session's own token and never the home's key", async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    q.updateWorkspace(workspaceId, { browserEnabled: true });
    const message = await userMessage('SERVERS');
    await dispatch(chatId, 'SERVERS', { sourceEventId: message.id });
    const reply = q.listChatEvents(chatId).find((e) => e.source === 'agent')!.content!;
    const servers = JSON.parse(reply) as Array<{ url: string; headers: Record<string, string> }>;
    const browser = servers.find((s) => s.url.includes('/browser/mcp'))!;
    // At the address the laptop reaches the home by, in its agent's own profile.
    expect(browser.url).toBe(`${server.url}/api/orchestrator/browser/mcp?profile=ws-${workspaceId}`);
    expect(browser.headers.Authorization).toMatch(/^Bearer ri_session_/);
    expect(reply).not.toContain(home.token);

    // The token gets through the home's real proxy to that server, and nowhere else.
    const initialize = await fetch(browser.url, {
      method: 'POST',
      headers: { ...browser.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.text()).toContain('"serverInfo"');
    const elsewhere = await fetch(`${server.url}/api/orchestrator/browser/mcp?profile=default`, { method: 'POST', headers: browser.headers });
    expect(elsewhere.status).toBe(403);
    const tasks = await fetch(`${server.url}/api/workers/me`, { headers: browser.headers });
    expect(tasks.status).toBe(403);
  }, 60_000);

  it('sends a message once, however many paths try', async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    const message = await userMessage('only once');
    await dispatch(chatId, 'only once', { sourceEventId: message.id });
    // The health check's orphan re-fire, or a retry, for the same message.
    await dispatch(chatId, 'only once', { sourceEventId: message.id });
    expect(q.listWorkerCommands(deviceId).filter((c) => c.kind === 'send')).toHaveLength(1);
    expect(q.listRuns({}).filter((r) => r.chatSessionId === chatId)).toHaveLength(1);
    expect(q.listChatEvents(chatId).filter((e) => e.content === 'ok: only once')).toHaveLength(1);
  }, 60_000);

  it("answers the agent's permission prompt from the home", async () => {
    const { dispatch, answerPendingInput } = await import('@/lib/executor/adapter');
    const live = await import('@/lib/executor/live-state');
    const q = await import('@/lib/db/queries');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    const turn = dispatch(chatId, 'ASK before listing');
    await until(() => live.listForSession(chatId).length === 1, 'the prompt to reach the home');
    const [prompt] = live.listForSession(chatId);
    expect(prompt).toMatchObject({ kind: 'permission', toolName: 'Bash' });
    expect(q.listChatEvents(chatId).some((e) => e.source === 'permission_request')).toBe(true);

    expect(answerPendingInput(chatId, prompt!.requestId, { allow: true, updatedInput: { command: 'ls' } }, { source: 'human' }).ok).toBe(true);
    await turn;
    expect(q.listChatEvents(chatId).some((e) => e.content === 'allowed')).toBe(true);
    expect(q.listChatEvents(chatId).some((e) => e.source === 'permission_response')).toBe(true);
  }, 60_000);

  it('lets only a person approve a permission there, checked at home and again on the laptop', async () => {
    const { dispatch, answerPendingInput } = await import('@/lib/executor/adapter');
    const live = await import('@/lib/executor/live-state');
    const { wakeDevice } = await import('@/lib/workers/hub');
    const { HUMAN_ONLY_APPROVAL } = await import('@/lib/runner/pending');
    const q = await import('@/lib/db/queries');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    const turn = dispatch(chatId, 'ASK before listing');
    await until(() => live.listForSession(chatId).length === 1, 'the prompt to reach the home');
    const { requestId } = live.listForSession(chatId)[0]!;
    const allow = { allow: true, updatedInput: { command: 'ls' } };
    const agent = { source: 'ai' as const, sessionId: 'orchestrator-chat', apiKeyId: null };
    const answers = () => q.listWorkerCommands(deviceId).filter((c) => c.kind === 'answer_pending_input');

    // The home refuses it, and nothing goes to the laptop.
    expect(answerPendingInput(chatId, requestId, allow, agent)).toEqual({ ok: false, refused: HUMAN_ONLY_APPROVAL });
    expect(answers()).toHaveLength(0);

    // One that got past the home anyway is refused on the laptop, and the prompt still waits.
    const smuggled = q.queueWorkerCommand({
      deviceId,
      kind: 'answer_pending_input',
      payload: { requestId, response: allow },
      actor: agent,
      chatSessionId: chatId,
      executionId,
      generation: 1,
    });
    wakeDevice(deviceId);
    await until(() => q.getWorkerCommand(smuggled.id)?.state === 'failed', "the laptop's refusal");
    expect(q.getWorkerCommand(smuggled.id)?.error).toBe(HUMAN_ONLY_APPROVAL);
    expect(live.listForSession(chatId)).toHaveLength(1);

    // The person's approval goes through, under their name.
    const person = { source: 'human' as const, sessionId: null, apiKeyId: laptopKey.id };
    expect(answerPendingInput(chatId, requestId, allow, person).ok).toBe(true);
    await turn;
    expect(q.listChatEvents(chatId).some((e) => e.content === 'allowed')).toBe(true);
    expect(answers().find((c) => c.id !== smuggled.id)).toMatchObject({ actor: person });
  }, 60_000);

  it('carries who sent a message, and the label on one another chat sent, through the real route', async () => {
    const q = await import('@/lib/db/queries');
    const { sessionCredential, SESSION_CREDENTIAL_HEADER } = await import('@/lib/orchestrator/session-credential');
    const orchestrator = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'ask' });
    const post = (content: string, headers: Record<string, string> = {}) =>
      fetch(`${server.url}/api/sessions/${chatId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${laptopKey.token}`, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ content }),
      });
    const sendOf = (content: string) =>
      q.listWorkerCommands(deviceId).find((c) => c.kind === 'send' && (c.payload as { message: string }).message.endsWith(content));

    expect((await post('from the phone')).status).toBe(201);
    await until(() => q.listChatEvents(chatId).some((e) => e.content === 'ok: from the phone'), 'the reply');
    expect(sendOf('from the phone')).toMatchObject({ actor: { source: 'human', sessionId: null, apiKeyId: laptopKey.id } });

    expect((await post('from the orchestrator', { [SESSION_CREDENTIAL_HEADER]: sessionCredential(orchestrator.id)! })).status).toBe(201);
    await until(() => !!sendOf('from the orchestrator'), 'the send');
    const sent = sendOf('from the orchestrator')!;
    expect(sent.actor).toEqual({ source: 'ai', sessionId: orchestrator.id, apiKeyId: laptopKey.id });
    expect((sent.payload as { message: string }).message).toBe(
      "[Message from the orchestrator (the user's main chat), sent on the user's behalf]\n\nfrom the orchestrator",
    );
  }, 60_000);

  it("never sends a command for a placement that changed while the laptop was away", async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    await worker!.stop();
    worker = null;
    const message = await userMessage('sent while away');
    const turn = dispatch(chatId, 'sent while away', { sourceEventId: message.id }).then(
      () => null,
      (err: Error) => err.message,
    );
    await until(() => q.listWorkerCommands(deviceId).some((c) => c.kind === 'send'), 'the saved send');
    // Placed again meanwhile, as a move does (P3).
    q.createPlacement({ executionId, deviceId, startReason: 'continued', worktreePath: path.join(laptopRoot, 'worktrees', 'demo-1') });

    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    expect(await turn).toBe('The execution had moved to another device before this reached it.');
    const [send] = q.listWorkerCommands(deviceId).filter((c) => c.kind === 'send');
    expect(send).toMatchObject({ state: 'stale', seq: null });
    expect(q.listRuns({}).find((r) => r.chatSessionId === chatId)).toMatchObject({ status: 'failed', errorCode: 'placement_moved' });
    expect(q.listChatEvents(chatId).some((e) => e.content === 'ok: sent while away')).toBe(false);
  }, 60_000);

  it('interrupts a turn from the home', async () => {
    const { dispatch, abort } = await import('@/lib/executor/adapter');
    const live = await import('@/lib/executor/live-state');
    const turn = dispatch(chatId, 'LONG job');
    await until(() => live.isRunning(chatId), 'the laptop to report it running');
    await abort(chatId);
    await turn;
    await until(() => !live.isRunning(chatId), 'the laptop to report it stopped');
  }, 60_000);

  it('refuses a command from an earlier placement', async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    // The execution continues in a new placement on the same laptop.
    q.createPlacement({ executionId, deviceId, startReason: 'continued', worktreePath: path.join(laptopRoot, 'worktrees', 'demo-1') });
    await dispatch(chatId, 'on generation two');
    const { wakeDevice } = await import('@/lib/workers/hub');
    const old = q.queueWorkerCommand({
      deviceId,
      kind: 'interrupt',
      payload: null,
      actor: { source: 'human' },
      chatSessionId: chatId,
      executionId,
      generation: 1,
    });
    wakeDevice(deviceId);
    await until(() => q.getWorkerCommand(old.id)?.state === 'stale', 'the stale refusal');
  }, 60_000);
});
