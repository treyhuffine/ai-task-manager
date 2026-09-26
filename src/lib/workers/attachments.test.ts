/**
 * Files the person attached, from the home to the computer a message went
 * to (docs/homes-build.md, "Attachments and artifacts", P2.5): the worker
 * attachment route's rules, and the worker's fetch, check and store, against
 * the home's real proxy and routes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@/db/types';
import type { WorkerTarget } from '@/lib/worker/client';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let homeId: string;
let laptop: { computerId: string; target: WorkerTarget };
let executionId: string;
let chatId: string;
let laptopDir: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-worker-attachments-' });
  laptopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-worker-attachments-laptop-'));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  server = await startHomeServer();
  laptop = await enrollComputer('Laptop');

  const q = await import('@/lib/db/queries');
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
  q.createPlacement({ executionId, computerId: laptop.computerId, startReason: 'created', worktreePath: '/laptop/demo' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopDir, { recursive: true, force: true });
});

async function enrollComputer(name: string): Promise<{ computerId: string; target: WorkerTarget; cliKey: string }> {
  const q = await import('@/lib/db/queries');
  const cli = q.createApiKey({ name: `${name} CLI`, deviceType: 'computer' });
  const computerId = q.registerComputerForApiKey({ apiKeyId: cli.key.id, name, platform: 'darwin' }).computer.id;
  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cli.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  const { workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name, protocol: WORKER_PROTOCOL, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>);
  return {
    computerId,
    cliKey: cli.token.plaintext,
    target: { homeUrl: server.url, homeId, homeName: 'My Ri', computerName: name, workerKey },
  };
}

async function attach(text: string, name = 'notes.txt'): Promise<Attachment> {
  const { saveAttachment } = await import('@/lib/attachments/save');
  return saveAttachment({ data: Buffer.from(text), originalName: name, mimeType: 'text/plain' });
}

/** A send carrying these files, as the stream hands it to the laptop. */
async function sentWith(files: Attachment[]) {
  const q = await import('@/lib/db/queries');
  const { describeInputFiles } = await import('@/lib/executor/input-files');
  const message = `read ${files.map((f) => `[[file:${f.fileName}]]`).join(' ')}`;
  const attachments = await describeInputFiles(message, files);
  const command = q.queueWorkerCommand({
    computerId: laptop.computerId,
    kind: 'send',
    payload: { spec: { chatSessionId: chatId }, message, turnId: 't', runId: null, attachments },
    actor: { source: 'human' },
    chatSessionId: chatId,
    executionId,
    generation: 1,
  });
  q.takeCommandsForStream(laptop.computerId, 0);
  return { commandId: command.id, attachments };
}

async function get(key: string, fileName: string, commandId: string | null) {
  const query = commandId === null ? '' : `?command=${commandId}`;
  const res = await fetch(`${server.url}/api/workers/me/attachments/${fileName}${query}`, {
    headers: { authorization: `Bearer ${key}`, 'x-ri-worker-protocol': String(WORKER_PROTOCOL) },
  });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

describe('the worker attachment route', () => {
  it('serves a file only for the send that carries it, to the computer it went to, while that send waits', async () => {
    const q = await import('@/lib/db/queries');
    const notes = await attach('shopping list');
    const other = await attach('not for the laptop', 'other.txt');
    const { commandId } = await sentWith([notes]);
    const key = laptop.target.workerKey;

    expect(await get(key, notes.fileName, commandId)).toEqual({ status: 200, body: 'shopping list' });
    expect((await get(key, notes.fileName, null)).status).toBe(400);
    expect(await get(key, 'notes..txt', commandId)).toMatchObject({ status: 400, body: { error: 'invalid_params' } });
    expect(await get(key, other.fileName, commandId)).toMatchObject({ status: 404, body: { error: 'not_found' } });

    // Another enrolled computer, or a key that isn't a worker's.
    const desktop = await enrollComputer('Desktop');
    expect(await get(desktop.target.workerKey, notes.fileName, commandId)).toMatchObject({ status: 404 });
    expect((await get(desktop.cliKey, notes.fileName, commandId)).status).toBe(403);

    // Once delivered, the send no longer needs it.
    q.ackWorkerCommand(laptop.computerId, commandId, { state: 'delivered' });
    expect(await get(key, notes.fileName, commandId)).toMatchObject({ status: 409, body: { error: 'not_waiting' } });
  });

  it('refuses a send from an earlier placement', async () => {
    const q = await import('@/lib/db/queries');
    const notes = await attach('shopping list');
    const { commandId } = await sentWith([notes]);
    q.createPlacement({ executionId, computerId: laptop.computerId, startReason: 'continued', worktreePath: '/laptop/demo' });
    expect(await get(laptop.target.workerKey, notes.fileName, commandId)).toMatchObject({ status: 409, body: { error: 'stale' } });
  });
});

describe("the worker's copy", () => {
  it('is fetched and checked once, then used as it is', async () => {
    const { fetchInputFiles } = await import('@/lib/worker/input-files');
    const notes = await attach('shopping list');
    const photo = await attach('not really a photo', 'photo.png');
    const { commandId, attachments } = await sentWith([notes, photo]);
    const fetches = vi.spyOn(globalThis, 'fetch');

    await fetchInputFiles({ target: laptop.target, commandId, dir: laptopDir, files: attachments });
    expect(fs.readFileSync(path.join(laptopDir, notes.fileName), 'utf8')).toBe('shopping list');
    expect(fs.readFileSync(path.join(laptopDir, photo.fileName), 'utf8')).toBe('not really a photo');
    expect(fetches).toHaveBeenCalledTimes(2);

    await fetchInputFiles({ target: laptop.target, commandId, dir: laptopDir, files: attachments });
    expect(fetches).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(laptopDir).sort()).toEqual([notes.fileName, photo.fileName].sort());
  });

  it('replaces a partial copy a crash left, and clears what it left behind', async () => {
    const { fetchInputFiles } = await import('@/lib/worker/input-files');
    const notes = await attach('shopping list');
    const { commandId, attachments } = await sentWith([notes]);
    fs.writeFileSync(path.join(laptopDir, notes.fileName), 'shop');
    fs.writeFileSync(path.join(laptopDir, `.${notes.fileName}.crashed.part`), 'shopping l');

    await fetchInputFiles({ target: laptop.target, commandId, dir: laptopDir, files: attachments });
    expect(fs.readdirSync(laptopDir)).toEqual([notes.fileName]);
    expect(fs.readFileSync(path.join(laptopDir, notes.fileName), 'utf8')).toBe('shopping list');
  });

  it('keeps files only in a folder named for a plain chat id', async () => {
    const { inputFilesDir } = await import('@/lib/worker/input-files');
    expect(() => inputFilesDir(homeId, '../../elsewhere')).toThrow(/isn't a chat id/);
    expect(inputFilesDir(homeId, chatId).endsWith(path.join('attachments', homeId, chatId))).toBe(true);
  });

  it('is refused when the bytes differ from what the send said, and nothing of them is kept', async () => {
    const { fetchInputFiles } = await import('@/lib/worker/input-files');
    const { attachmentPath } = await import('@/lib/attachments/save');
    const notes = await attach('shopping list');
    const { commandId, attachments } = await sentWith([notes]);
    fs.writeFileSync(attachmentPath(notes.fileName), 'shopping LIST');

    await expect(
      fetchInputFiles({ target: laptop.target, commandId, dir: laptopDir, files: attachments, retryMs: 1 }),
    ).rejects.toThrow(/notes\.txt came from My Ri damaged/);
    expect(fs.readdirSync(laptopDir)).toEqual([]);
  });

  it('says so when the file is gone from home', async () => {
    const { fetchInputFiles } = await import('@/lib/worker/input-files');
    const { attachmentPath } = await import('@/lib/attachments/save');
    const notes = await attach('shopping list');
    const { commandId, attachments } = await sentWith([notes]);
    fs.rmSync(attachmentPath(notes.fileName));

    await expect(fetchInputFiles({ target: laptop.target, commandId, dir: laptopDir, files: attachments })).rejects.toThrow(
      "Couldn't fetch notes.txt from My Ri: notes.txt is no longer at home.",
    );
  });
});

describe('files a computer names', () => {
  it('never become chips at home, since their bytes are on that computer only', async () => {
    const { applyWorkerEvents } = await import('@/lib/executor/apply');
    const q = await import('@/lib/db/queries');
    const notes = await attach('made on the laptop');
    const chatEvent = { role: 'assistant', source: 'agent', content: 'here it is', attachments: [notes] };
    applyWorkerEvents(laptop.computerId, [
      {
        position: 1,
        eventId: 'laptop-event-1',
        generation: 1,
        chatSessionId: chatId,
        occurredAt: new Date().toISOString(),
        kind: 'chat_event',
        chatEvent: chatEvent as never,
        cumulative: false,
      },
    ]);
    const stored = q.listChatEvents(chatId).find((e) => e.content === 'here it is');
    expect(stored?.attachments).toEqual([]);
  });
});
