/**
 * Running an execution on a connected computer (docs/homes-build.md, P2.4),
 * end to end: the home in this process behind its real proxy and routes,
 * and the worker in a process of its own, as on a laptop, with its own root,
 * journals and runner. The harness there is the fake one (see
 * `src/test/fixtures/worker-process.ts`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let laptopRoot: string;
let computerId: string;
let executionId: string;
let chatId: string;
let homeId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-exec-' });
  laptopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-laptop-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'Laptop CLI', deviceType: 'computer' });
  computerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
  server = await startHomeServer();

  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptop.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  const { workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: 1, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>);

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
  q.createPlacement({ executionId, computerId, startReason: 'created', worktreePath: worktree });

  worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => (q.getComputer(computerId)?.harnesses?.length ?? 0) > 0, "the laptop's harness report");
}, 60_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
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

describe('an execution on a connected computer', () => {
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
    await until(() => q.listWorkerCommands(computerId)[0]?.state === 'delivered', 'the acknowledgement');
    const [command] = q.listWorkerCommands(computerId);
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
    const [command] = q.listWorkerCommands(computerId);
    expect(command!.payload).toMatchObject({
      message: content,
      attachments: [{ fileName: notes.fileName, originalName: 'notes.txt', size: 13, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    expect(JSON.stringify(command!.payload)).not.toContain(getAttachmentsDir());
  }, 60_000);

  it('sends a message once, however many paths try', async () => {
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    const message = await userMessage('only once');
    await dispatch(chatId, 'only once', { sourceEventId: message.id });
    // The health check's orphan re-fire, or a retry, for the same message.
    await dispatch(chatId, 'only once', { sourceEventId: message.id });
    expect(q.listWorkerCommands(computerId).filter((c) => c.kind === 'send')).toHaveLength(1);
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

    expect(answerPendingInput(chatId, prompt!.requestId, { allow: true, updatedInput: { command: 'ls' } }).ok).toBe(true);
    await turn;
    expect(q.listChatEvents(chatId).some((e) => e.content === 'allowed')).toBe(true);
    expect(q.listChatEvents(chatId).some((e) => e.source === 'permission_response')).toBe(true);
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
    q.createPlacement({ executionId, computerId, startReason: 'continued', worktreePath: path.join(laptopRoot, 'worktrees', 'demo-1') });
    await dispatch(chatId, 'on generation two');
    const { wakeComputer } = await import('@/lib/workers/hub');
    const old = q.queueWorkerCommand({
      computerId,
      kind: 'interrupt',
      payload: null,
      actor: { source: 'human' },
      chatSessionId: chatId,
      executionId,
      generation: 1,
    });
    wakeComputer(computerId);
    await until(() => q.getWorkerCommand(old.id)?.state === 'stale', 'the stale refusal');
  }, 60_000);
});
