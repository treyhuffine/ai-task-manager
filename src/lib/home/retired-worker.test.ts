/**
 * The worker replacing the laptop's own home (docs/homes-spec.md §10.2,
 * P5.2), end to end over HTTP: the laptop's chats are imported into the
 * Mini's home and placed on the laptop, the laptop's home is retired, and a
 * worker run from the same folder picks up that work in the worktree it was
 * always in. Nothing on the laptop moved.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let laptop: TestHome;
let mini: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let project: string;
let worktree: string;
const ids = { agent: '', chat: '', execution: '' };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

/** Run with this process's paths pointed at the laptop's folder. */
async function asLaptop<T>(fn: () => T | Promise<T>): Promise<T> {
  const keys = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR'] as const;
  const saved = keys.map((k) => [k, process.env[k]] as const);
  process.env.RI_ROOT = laptop.root;
  process.env.RI_DB_PATH = laptop.dbPath;
  process.env.RI_CONFIG_DIR = laptop.configDir;
  process.env.RI_WORK_DIR = laptop.workDir;
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  // The laptop's own home: a project, and work in a worktree inside the home's folder.
  laptop = await createTestHome({ prefix: 'ri-retired-worker-laptop-' });
  project = path.join(laptop.root, '..', `${path.basename(laptop.root)}-project`);
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.email', 'test@example.com');
  git(project, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(project, 'README.md'), '# demo\n');
  git(project, 'add', '.');
  git(project, 'commit', '-q', '-m', 'first');
  worktree = path.join(laptop.workDir, 'worktrees', 'demo', 'demo-1');
  git(project, 'worktree', 'add', '-q', '-b', 'demo/fix', worktree);
  fs.writeFileSync(path.join(worktree, 'unpushed.ts'), 'work in progress\n');
  {
    const q = await import('@/lib/db/queries');
    ids.agent = q.createWorkspace({ name: 'Demo', cwd: project, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
    const made = q.createExecutionWithChat({ workspaceId: ids.agent, harness: 'claude', label: 'Fix it', worktreePath: worktree, branchName: 'demo/fix' });
    ids.chat = made.session.id;
    ids.execution = made.execution.id;
    q.insertChatEvent({ sessionId: ids.chat, role: 'user', source: 'user', content: 'Started on the laptop' });
    (await import('@/lib/db')).resetDb();
  }

  // The Mini's home, over HTTP.
  mini = await createTestHome({ prefix: 'ri-retired-worker-mini-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  server = await startHomeServer();
}, 60_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await mini.cleanup();
  await laptop.cleanup();
  fs.rmSync(project, { recursive: true, force: true });
  delete process.env.RI_MIRROR_DISABLED;
});

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

it("runs the laptop's work through its worker once its home is retired, in the worktree it was always in", async () => {
  const q = await import('@/lib/db/queries');

  // 1. The laptop's chats come into the Mini's home, placed on the laptop.
  const { applyHomeImport } = await import('./import-records');
  const imported = applyHomeImport({ sourceRoot: laptop.root, deviceName: 'Laptop' });
  const laptopId = imported.device.id!;
  expect(q.getOpenPlacement(ids.execution)).toMatchObject({ deviceId: laptopId, worktreePath: worktree });

  // 2. The laptop's home retires. Its worktree stays.
  const { retireHome } = await import('./retire');
  await asLaptop(() => retireHome({ successor: 'the Mini' }));
  expect(fs.readFileSync(path.join(worktree, 'unpushed.ts'), 'utf8')).toBe('work in progress\n');

  // 3. The same folder enrolls as the Laptop the chats were placed on, and runs its worker.
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: laptopId, deviceName: null, createdByApiKeyId: null });
  const enrolled = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.secret, name: 'laptop', protocol: WORKER_PROTOCOL, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string; deviceId: string }>);
  expect(enrolled.deviceId).toBe(laptopId);
  worker = await startWorkerProcess({ homeUrl: server.url, homeId: q.getHome()!.id, workerKey: enrolled.workerKey, root: laptop.root });
  await until(() => q.getWorkspaceSetup(ids.agent, laptopId)?.found === true, "the laptop checking its folder");

  // 4. A message from the Mini runs there, in the laptop's worktree.
  const { dispatch } = await import('@/lib/executor/adapter');
  const message = q.insertChatEvent({ sessionId: ids.chat, role: 'user', source: 'user', content: 'INSTRUCTIONS' })!;
  await dispatch(ids.chat, 'INSTRUCTIONS', { sourceEventId: message.id });
  await until(() => q.listChatEvents(ids.chat).some((e) => e.source === 'agent' && (e.content ?? '').includes(worktree)), 'the reply from the laptop');
  expect(q.listWorkerCommands(laptopId).some((c) => c.kind === 'send')).toBe(true);
  // Nothing moved: still the laptop's work, in the same folder, and the chat's history is whole.
  expect(q.getOpenPlacement(ids.execution)).toMatchObject({ deviceId: laptopId, generation: 1, worktreePath: worktree });
  expect(q.listChatEvents(ids.chat)[0]!.content).toBe('Started on the laptop');
  // And the laptop's folder never grew a home of its own again.
  expect(fs.existsSync(laptop.dbPath)).toBe(false);
}, 90_000);
