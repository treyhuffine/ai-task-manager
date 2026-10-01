/**
 * Starting an execution on a connected device (docs/homes-build.md, P2.4),
 * end to end: the home places it there, the worker prepares a worktree from
 * its own copy of the agent's repository, found through its own setup files,
 * runs the agent's setup script as a separate command, and carries out a
 * message sent before any of that finished.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { setUpAgentOn } from '@/test/fixtures/setups';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let laptopRoot: string;
let deviceId: string;
let workspaceId: string;
let repo: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-start-' });
  laptopRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-start-laptop-')));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  // The worker-process fixture installs and reports only fake Claude.
  q.updateUserState({ defaultHarness: 'claude' });
  const laptop = q.pairDevice({ name: 'Laptop', kind: 'computer' });
  deviceId = q.registerDeviceForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).device.id;
  server = await startHomeServer();

  // The agent, known to the home.
  const ws = q.createWorkspace({
    name: 'Demo',
    cwd: path.join(home.root, 'demo-on-the-mini'),
    isGit: true,
    baseBranch: 'main',
    filesToCopy: ['.env.local'],
    setupCommand: 'echo "set up on the laptop" > SETUP_RAN',
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
  });
  workspaceId = ws.id;

  // The laptop's own copy of its repository, set up for the agent there.
  repo = path.join(laptopRoot, 'projects', 'demo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(repo, '.env.local'), 'SECRET=laptop\n');
  // A connected folder the home knows, mapped on the laptop, and one left out there.
  q.createReferenceFolder({ workspaceId: ws.id, alias: 'docs', path: path.join(home.root, 'docs-on-the-mini'), description: 'The design docs' });
  q.createReferenceFolder({ workspaceId: ws.id, alias: 'secrets', path: path.join(home.root, 'secrets-on-the-mini') });
  fs.mkdirSync(path.join(laptopRoot, 'projects', 'docs'), { recursive: true });
  // As the home records them: the worker is sent its folders when it connects.
  await setUpAgentOn(ws.id, deviceId, repo, { links: { docs: path.join(laptopRoot, 'projects', 'docs'), secrets: null } });

  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptop.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  const { workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: WORKER_PROTOCOL, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>);
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
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
});

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

describe('starting an execution on a connected device', () => {
  it('prepares it there from its own repository, and runs a message sent before that finished', async () => {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const { ensureWorktreeReady } = await import('@/lib/runs/dispatch');
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');

    const person = { source: 'human' as const, sessionId: null, apiKeyId: 'phone-key' };
    const session = await dispatchExecutionSession({ workspaceId, deviceId, label: 'Fix the readme', actor: person });
    expect(q.getOpenPlacement(session.executionId!)).toMatchObject({ deviceId, generation: 1, worktreePath: null });
    // The prepare carries who started it (P2.6).
    expect(q.listWorkerCommands(deviceId).find((c) => c.kind === 'prepare')).toMatchObject({ actor: person });

    // What the messages route does, at once, with the worktree not made yet.
    expect(await ensureWorktreeReady(session.id, q.getExecution(session.executionId!)!)).toEqual({ ok: true });
    const message = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'tidy it up', createdAt: new Date().toISOString() })!;
    await dispatch(session.id, 'tidy it up', { sourceEventId: message.id });

    expect(q.listChatEvents(session.id).some((e) => e.content === 'ok: tidy it up')).toBe(true);
    const placement = q.getOpenPlacement(session.executionId!)!;
    expect(placement.worktreePath).toBeTruthy();
    expect(placement.worktreePath!.startsWith(path.join(laptopRoot, '.work', 'worktrees'))).toBe(true);
    const execution = q.getExecution(session.executionId!)!;
    // The home's own path column stays the home's: nothing here points at the laptop.
    expect(execution.worktreePath).toBeNull();
    expect(execution.branchName).toBe(git(placement.worktreePath!, 'branch', '--show-current'));
    expect(fs.readFileSync(path.join(placement.worktreePath!, '.env.local'), 'utf8')).toBe('SECRET=laptop\n');

    // The setup script ran there, as its own command.
    await until(() => q.getExecution(session.executionId!)?.setupScriptStatus === 'done', 'the setup script');
    expect(fs.readFileSync(path.join(placement.worktreePath!, 'SETUP_RAN'), 'utf8')).toBe('set up on the laptop\n');
    // The setup script is queued when the prepare is acknowledged, which can
    // be before or after the send: both run after the prepare, in order.
    await until(() => q.listWorkerCommands(deviceId).every((c) => c.state === 'delivered'), 'every acknowledgement');
    const kinds = q.listWorkerCommands(deviceId).map((c) => c.kind);
    expect(kinds[0]).toBe('prepare');
    expect([...kinds].sort()).toEqual(['prepare', 'run_script', 'send']);
  }, 90_000);

  it("shows the laptop's worktree through the home's own routes, and says when the laptop is gone", async () => {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const q = await import('@/lib/db/queries');
    const { NextRequest } = await import('next/server');
    const session = await dispatchExecutionSession({ workspaceId, deviceId, label: 'Look around' });
    await until(() => !!q.getOpenPlacement(session.executionId!)?.worktreePath, 'the worktree');
    const worktree = q.getOpenPlacement(session.executionId!)!.worktreePath!;
    fs.writeFileSync(path.join(worktree, 'NOTES.md'), 'written on the laptop\n');

    const call = async (route: string, query = '') => {
      const { GET } = (await import(`@/app/api/sessions/[id]/${route}/route`)) as {
        GET: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
      };
      const res = await GET(new NextRequest(`http://127.0.0.1/api/sessions/${session.id}/${route}${query}`), {
        params: Promise.resolve({ id: session.id }),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };

    const tree = await call('tree');
    expect(tree.status).toBe(200);
    const paths = (tree.body.entries as Array<{ path: string }>).map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'NOTES.md', '.env.local']));
    expect(await call('file', '?path=NOTES.md')).toMatchObject({ status: 200, body: { content: 'written on the laptop\n' } });
    expect(await call('file', '?path=../outside')).toMatchObject({ status: 400 });
    const stats = await call('diff-stats');
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ files: expect.any(Number), additions: expect.any(Number), deletions: 0 });
    expect(stats.body.files as number).toBeGreaterThanOrEqual(1);

    await worker!.stop();
    worker = null;
    const gone = await call('tree');
    expect(gone).toMatchObject({ status: 409, body: { error: 'unavailable', message: 'Laptop is not connected right now.' } });
  }, 90_000);

  it("changes the laptop's worktree through the home's own routes, never a folder at home (P3.5)", async () => {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const q = await import('@/lib/db/queries');
    const { NextRequest } = await import('next/server');
    const session = await dispatchExecutionSession({ workspaceId, deviceId, label: 'Edit there' });
    await until(() => !!q.getOpenPlacement(session.executionId!)?.worktreePath, 'the worktree');
    const worktree = q.getOpenPlacement(session.executionId!)!.worktreePath!;
    const ctx = { params: Promise.resolve({ id: session.id }) };
    type Handler = (req: InstanceType<typeof NextRequest>, c: typeof ctx) => Promise<Response>;
    const call = async (route: string, method: 'PUT' | 'POST' | 'DELETE', query = '', body?: unknown) => {
      const mod = (await import(`@/app/api/sessions/[id]/${route}/route`)) as Record<string, Handler>;
      const req = new NextRequest(`http://127.0.0.1/api/sessions/${session.id}/${route}${query}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      });
      const res = await mod[method](req, ctx);
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const there = (rel: string) => path.join(worktree, rel);

    expect(await call('file', 'PUT', '?path=NOTES.md', { content: 'saved from the phone\n' })).toMatchObject({ status: 200, body: { ok: true, path: 'NOTES.md' } });
    expect(fs.readFileSync(there('NOTES.md'), 'utf8')).toBe('saved from the phone\n');
    expect(await call('file/create', 'POST', '', { path: 'src/new.ts' })).toMatchObject({ status: 200, body: { path: 'src/new.ts' } });
    expect(fs.existsSync(there('src/new.ts'))).toBe(true);
    expect(await call('dir', 'POST', '', { path: 'docs/guides' })).toMatchObject({ status: 200 });
    expect(fs.statSync(there('docs/guides')).isDirectory()).toBe(true);
    expect(await call('file/rename', 'POST', '', { from: 'src/new.ts', to: 'src/renamed.ts' })).toMatchObject({ status: 200, body: { to: 'src/renamed.ts' } });
    expect(fs.existsSync(there('src/renamed.ts'))).toBe(true);
    // Refusals read as they do at home.
    expect(await call('file/rename', 'POST', '', { from: 'src/renamed.ts', to: 'NOTES.md' })).toMatchObject({ status: 409, body: { code: 'exists' } });
    expect(await call('file', 'PUT', '?path=../outside.txt', { content: 'no' })).toMatchObject({ status: 400, body: { code: 'invalid_path' } });
    expect(fs.existsSync(path.join(path.dirname(worktree), 'outside.txt'))).toBe(false);
    expect(await call('file', 'DELETE', '?path=src/renamed.ts')).toMatchObject({ status: 200, body: { kind: 'file' } });
    expect(fs.existsSync(there('src/renamed.ts'))).toBe(false);
    expect(await call('dir', 'DELETE', '?path=docs')).toMatchObject({ status: 200, body: { kind: 'dir' } });
    expect(fs.existsSync(there('docs'))).toBe(false);
    // A resolved conflict is written and staged there.
    expect(await call('file/resolve-conflict', 'POST', '', { path: 'README.md', content: '# demo, resolved\n' })).toMatchObject({ status: 200 });
    expect(git(worktree, 'status', '--porcelain', '--', 'README.md')).toBe('M  README.md');
    // Work in progress comes from the agent's folder on the laptop, not the one at home.
    fs.writeFileSync(path.join(repo, 'TODO.md'), 'started on the laptop\n');
    expect(await call('wip', 'POST', '', { action: 'copy' })).toMatchObject({ status: 200, body: { action: 'copy', copied: expect.arrayContaining(['TODO.md']) } });
    expect(fs.readFileSync(there('TODO.md'), 'utf8')).toBe('started on the laptop\n');

    // A change from an earlier placement is refused there.
    const { requestWorker } = await import('@/lib/workers/hub');
    const ws = q.getWorkspace(workspaceId)!;
    expect(await requestWorker(deviceId, 'write_execution', {
      executionId: session.executionId, generation: 0, baseSha: null,
      workspace: { id: ws.id, isGit: true, baseBranch: 'main', filesToCopy: [] },
      write: { kind: 'write', path: 'NOTES.md', content: 'stale' },
    })).toMatchObject({ status: 409, body: { error: 'moved' } });
    expect(fs.readFileSync(there('NOTES.md'), 'utf8')).toBe('saved from the phone\n');

    // The home never opens that path on its own disk.
    const { openSessionWorktree } = await import('@/app/api/sessions/[id]/_helpers');
    const refused = await openSessionWorktree(session.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.response.status).toBe(409);

    await worker!.stop();
    worker = null;
    expect(await call('file', 'PUT', '?path=NOTES.md', { content: 'while away' })).toMatchObject({
      status: 409,
      body: { error: 'unavailable', message: "Laptop is not connected right now, so the change wasn't made." },
    });
    expect(fs.readFileSync(there('NOTES.md'), 'utf8')).toBe('saved from the phone\n');
  }, 90_000);

  it('tells the agent there its environment, as the laptop resolved it, beside the instructions and in them', async () => {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    const session = await dispatchExecutionSession({ workspaceId, deviceId, label: 'Where am I' });
    const message = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'INSTRUCTIONS', createdAt: new Date().toISOString() })!;
    await dispatch(session.id, 'INSTRUCTIONS', { sourceEventId: message.id });
    const instructions = q.listChatEvents(session.id).find((e) => e.source === 'agent')!.content!;
    const worktree = q.getOpenPlacement(session.executionId!)!.worktreePath!;

    const file = path.join(laptopRoot, '.work', 'session-instructions', `${session.id}.environment.json`);
    const environment = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(environment).toMatchObject({
      deviceName: 'Laptop',
      agent: { id: workspaceId, name: 'Demo' },
      cwd: worktree,
      sourceFolder: repo,
      mode: 'worktree',
      branch: git(worktree, 'branch', '--show-current'),
      head: git(worktree, 'rev-parse', 'HEAD'),
      references: [
        { alias: 'docs', description: 'The design docs', path: path.join(laptopRoot, 'projects', 'docs'), state: 'ready' },
        { alias: 'secrets', description: null, path: null, state: 'omitted' },
      ],
    });
    expect(instructions).toContain('## Your environment');
    expect(instructions).toContain(`\`${file}\``);
    expect(instructions).toContain('- secrets: left out on this device');
    // Nothing of the home's paths, and nothing of Ri's written into the
    // repository: only what the agent's own setup put there (its copied
    // file, and its setup script's output).
    expect(instructions).not.toContain(home.root);
    await until(() => q.getExecution(session.executionId!)?.setupScriptStatus === 'done', 'the setup script');
    expect(git(worktree, 'status', '--porcelain').split('\n').sort()).toEqual(['?? .env.local', '?? SETUP_RAN']);
  }, 90_000);

  it("refuses a device the agent isn't set up on, saying so", async () => {
    const q = await import('@/lib/db/queries');
    const other = q.pairDevice({ name: 'Other', kind: 'computer' });
    const otherDevice = q.registerDeviceForApiKey({ apiKeyId: other.key.id, name: 'Other', platform: 'darwin' }).device;
    const { dispatchExecutionSession, DeviceUnavailableForDispatch } = await import('@/lib/sessions/dispatch');
    await expect(dispatchExecutionSession({ workspaceId, deviceId: otherDevice.id })).rejects.toBeInstanceOf(
      DeviceUnavailableForDispatch,
    );
    await expect(dispatchExecutionSession({ workspaceId, deviceId: otherDevice.id })).rejects.toThrow(/Other doesn't run agents yet\. To turn it on, run `ri worker enroll` on it\. Or set Demo up on .+ in its Setup tab\./);
  });

  it('says its folder there is gone when it went while the laptop was connected, before placing anything there', async () => {
    const q = await import('@/lib/db/queries');
    expect(q.getWorkspaceSetup(workspaceId, deviceId)).toMatchObject({ status: 'ready', found: true });
    fs.renameSync(repo, `${repo}-moved`);
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    await expect(dispatchExecutionSession({ workspaceId, deviceId })).rejects.toThrow(`Demo's folder on Laptop, ${repo}, isn't there.`);
    expect(q.getWorkspaceSetup(workspaceId, deviceId)).toMatchObject({ status: 'missing_folder', found: false });
    expect(q.listWorkspaceExecutions(workspaceId)).toHaveLength(0);
  });
});


it('starts plan mode on the worker even when the home has no harness binary', async () => {
  const savedCommand = process.env.CLAUDE_COMMAND;
  process.env.CLAUDE_COMMAND = '/usr/bin/false';
  const { clearHarnessRuntimeCache } = await import('@/lib/harness/runtime');
  const { clearHarnessModelCache } = await import('@/lib/harness/model-discovery');
  clearHarnessRuntimeCache('claude');
  clearHarnessModelCache('claude');
  try {
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const { ensureWorktreeReady } = await import('@/lib/runs/dispatch');
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');
    const session = await dispatchExecutionSession({ workspaceId, deviceId, harness: 'claude', model: 'opus', permissionMode: 'plan' });
    expect(session.permissionMode).toBe('plan');
    expect(await ensureWorktreeReady(session.id, q.getExecution(session.executionId!)!)).toEqual({ ok: true });
    await dispatch(session.id, 'plan on the laptop');
    expect(q.listChatEvents(session.id).some((event) => event.content === 'ok: plan on the laptop')).toBe(true);
    expect(q.getChatSession(session.id)?.permissionMode).toBe('plan');
  } finally {
    if (savedCommand === undefined) delete process.env.CLAUDE_COMMAND;
    else process.env.CLAUDE_COMMAND = savedCommand;
    clearHarnessRuntimeCache('claude');
    clearHarnessModelCache('claude');
  }
}, 90_000);
