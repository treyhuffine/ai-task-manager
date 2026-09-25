/**
 * Faults, end to end (docs/homes-build.md, P2.8): the home in this process
 * behind its real proxy and routes, the worker in a process of its own. The
 * home goes away mid-turn and comes back, a computer's local execution is
 * turned off with work under way, and a prompt outlives the worker that
 * raised it, once stopped and once crashed. The rest of the fault matrix is
 * covered where its mechanism lives (see the build notes).
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
let chatId: string;
let homeId: string;
let workerKey: string;
let workerKeyId: string;
let ownerKey: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-faults-' });
  laptopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-faults-laptop-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'Laptop CLI', deviceType: 'computer' });
  ownerKey = laptop.token.plaintext;
  computerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
  server = await startHomeServer();

  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerKey}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  ({ workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: 1, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>));
  workerKeyId = q.getWorkerEnrollmentForComputer(computerId)!.apiKeyId;

  const worktree = path.join(laptopRoot, 'worktrees', 'demo-1');
  fs.mkdirSync(worktree, { recursive: true });
  const ws = q.createWorkspace({ name: 'Demo', cwd: path.join(home.root, 'demo'), isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Remote work' });
  chatId = created.session.id;
  q.createPlacement({ executionId: created.execution.id, computerId, startReason: 'created', worktreePath: worktree });
  worker = await startWorker();
}, 60_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
});

async function startWorker(): Promise<WorkerProcess> {
  const q = await import('@/lib/db/queries');
  const before = q.getComputer(computerId)?.lastSeenAt ?? '';
  const started = await startWorkerProcess({ homeUrl: server.url, homeId, workerKey, root: laptopRoot });
  await until(() => (q.getComputer(computerId)?.lastSeenAt ?? '') > before && (q.getComputer(computerId)?.harnesses?.length ?? 0) > 0, 'a heartbeat');
  return started;
}

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

/** Kill the worker as a crash does, and wait for the home to see its stream gone. */
async function crash(): Promise<void> {
  await worker!.kill();
  worker = null;
  const { isComputerConnected } = await import('@/lib/workers/hub');
  await until(() => !isComputerConnected(computerId), 'the home to see the laptop gone');
}

async function send(content: string) {
  const q = await import('@/lib/db/queries');
  const { dispatch } = await import('@/lib/executor/adapter');
  const message = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
  const outcome = dispatch(chatId, content, { sourceEventId: message.id }).then(
    () => null,
    (err: Error) => err.message,
  );
  return { outcome, sendOf: () => q.getSendForEvent(message.id) };
}

describe('a home outage', () => {
  it('lets a running turn finish, and everything reaches the home in order once it is back', async () => {
    const q = await import('@/lib/db/queries');
    const turn = await send('SLOW');
    await until(() => turn.sendOf()?.state === 'delivered', 'the send to be delivered');
    const port = Number(new URL(server.url).port);
    await server.close();

    // The turn finishes on the laptop meanwhile, and its output waits there.
    await new Promise((r) => setTimeout(r, 2_500));
    expect(q.listChatEvents(chatId).some((e) => e.content === 'slow done')).toBe(false);

    server = await startHomeServer({ port });
    expect(await turn.outcome).toBeNull();
    expect(q.listChatEvents(chatId).some((e) => e.content === 'slow done')).toBe(true);
    const run = q.listRuns({}).find((r) => r.chatSessionId === chatId);
    expect(run).toMatchObject({ status: 'completed' });
  }, 60_000);
});

describe('turning off local execution', () => {
  it('settles the work it had: a turn under way there, and a message still waiting to go', async () => {
    const q = await import('@/lib/db/queries');
    const running = await send('LONG');
    await until(() => running.sendOf()?.state === 'delivered', 'the long turn');
    // The laptop crashes, and a message is saved for it meanwhile.
    await crash();
    const waiting = await send('after the crash');
    await until(() => waiting.sendOf()?.state === 'queued', 'the saved message');

    const res = await fetch(`${server.url}/api/devices/${workerKeyId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerKey}` },
    });
    expect(res.status).toBe(204);

    expect(await running.outcome).toBe('Local execution on Laptop was turned off.');
    expect(await waiting.outcome).toBe('Local execution on this computer was turned off before this reached it.');
    expect(waiting.sendOf()).toMatchObject({ state: 'cancelled' });
    const runs = q.listRuns({}).filter((r) => r.chatSessionId === chatId);
    expect(runs.map((r) => [r.status, r.errorCode]).sort()).toEqual([
      ['failed', 'computer_turned_off'],
      ['failed', 'delivery_cancelled'],
    ]);
  }, 60_000);
});

describe('a prompt that outlives its worker', () => {
  it('leaves the home when the worker stops, so nothing is answered for it', async () => {
    const q = await import('@/lib/db/queries');
    const live = await import('@/lib/executor/live-state');
    const { answerPendingInput } = await import('@/lib/executor/adapter');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    await send('ASK before listing');
    await until(() => live.listForSession(chatId).length === 1, 'the prompt');
    const { requestId } = live.listForSession(chatId)[0]!;

    await worker!.stop();
    worker = null;
    await until(() => live.listForSession(chatId).length === 0, 'the prompt to leave');
    expect(answerPendingInput(chatId, requestId, { allow: true, updatedInput: {} }, { source: 'human' })).toEqual({ ok: false });
    expect(q.listWorkerCommands(computerId).some((c) => c.kind === 'answer_pending_input')).toBe(false);
  }, 60_000);

  it("is answered stale when the worker crashed, and the turn it blocked is reported cut off", async () => {
    const q = await import('@/lib/db/queries');
    const live = await import('@/lib/executor/live-state');
    const { answerPendingInput } = await import('@/lib/executor/adapter');
    q.updateChatSession(chatId, { permissionMode: 'ask' });
    const turn = await send('ASK before listing');
    await until(() => live.listForSession(chatId).length === 1, 'the prompt');
    const { requestId } = live.listForSession(chatId)[0]!;

    // A crash says nothing, so the home still shows the prompt: unknown is not stopped.
    await crash();
    expect(live.listForSession(chatId)).toHaveLength(1);
    expect(answerPendingInput(chatId, requestId, { allow: true, updatedInput: {} }, { source: 'human' }).ok).toBe(true);
    const answer = () => q.listWorkerCommands(computerId).find((c) => c.kind === 'answer_pending_input');
    expect(answer()).toMatchObject({ state: 'queued' });

    worker = await startWorker();
    expect(await turn.outcome).toBe("The turn stopped when Ri's worker on Laptop restarted.");
    await until(() => answer()?.state === 'stale', 'the answer to come back stale');
    expect(q.listChatEvents(chatId).some((e) => e.content === 'allowed')).toBe(false);
    expect(live.listForSession(chatId)).toHaveLength(0);
  }, 60_000);
});
