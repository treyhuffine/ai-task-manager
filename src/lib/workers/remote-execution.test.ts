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
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let laptopRoot: string;
let computerId: string;
let executionId: string;
let chatId: string;
let homeId: string;
let laptopKey: { id: string; token: string };
let workerKey: string;
let workspaceId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-exec-' });
  laptopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-laptop-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'Laptop CLI', deviceType: 'computer' });
  laptopKey = { id: laptop.key.id, token: laptop.token.plaintext };
  computerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
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

    expect(answerPendingInput(chatId, prompt!.requestId, { allow: true, updatedInput: { command: 'ls' } }, { source: 'human' }).ok).toBe(true);
    await turn;
    expect(q.listChatEvents(chatId).some((e) => e.content === 'allowed')).toBe(true);
    expect(q.listChatEvents(chatId).some((e) => e.source === 'permission_response')).toBe(true);
  }, 60_000);

  it('lets only a person approve a permission there, checked at home and again on the laptop', async () => {
    const { dispatch, answerPendingInput } = await import('@/lib/executor/adapter');
    const live = await import('@/lib/executor/live-state');
    const { wakeComputer } = await import('@/lib/workers/hub');
    const { HUMAN_ONLY_APPROVAL } = await import('@/lib/runner/pending');
    const q = await import('@/lib/db/queries');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    const turn = dispatch(chatId, 'ASK before listing');
    await until(() => live.listForSession(chatId).length === 1, 'the prompt to reach the home');
    const { requestId } = live.listForSession(chatId)[0]!;
    const allow = { allow: true, updatedInput: { command: 'ls' } };
    const agent = { source: 'ai' as const, sessionId: 'orchestrator-chat', apiKeyId: null };
    const answers = () => q.listWorkerCommands(computerId).filter((c) => c.kind === 'answer_pending_input');

    // The home refuses it, and nothing goes to the laptop.
    expect(answerPendingInput(chatId, requestId, allow, agent)).toEqual({ ok: false, refused: HUMAN_ONLY_APPROVAL });
    expect(answers()).toHaveLength(0);

    // One that got past the home anyway is refused on the laptop, and the prompt still waits.
    const smuggled = q.queueWorkerCommand({
      computerId,
      kind: 'answer_pending_input',
      payload: { requestId, response: allow },
      actor: agent,
      chatSessionId: chatId,
      executionId,
      generation: 1,
    });
    wakeComputer(computerId);
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
      q.listWorkerCommands(computerId).find((c) => c.kind === 'send' && (c.payload as { message: string }).message.endsWith(content));

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
    await until(() => q.listWorkerCommands(computerId).some((c) => c.kind === 'send'), 'the saved send');
    // Placed again meanwhile, as a move does (P3).
    q.createPlacement({ executionId, computerId, startReason: 'continued', worktreePath: path.join(laptopRoot, 'worktrees', 'demo-1') });

    worker = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
    expect(await turn).toBe('The execution had moved to another computer before this reached it.');
    const [send] = q.listWorkerCommands(computerId).filter((c) => c.kind === 'send');
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
