/**
 * Continue here, end to end (docs/homes-spec.md §8.2 and §8.3, P4.2 to
 * P4.4): a real worker process for the laptop, real Git (a bare remote, and
 * a clone for each computer), the fake harness on both sides. Work moves from
 * the home to the laptop with its tracked changes and the untracked file the
 * person chose, and back. The source is stopped first, the checkpoint is
 * pushed without force, the destination runs its setup and starts a fresh
 * session from the handoff, "Continued on Laptop" is recorded once, and a
 * message sent during the move is held and delivered once, there.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let fake: FakeHarness;
let laptopRoot: string;
let hostId: string;
let laptopId: string;
let workspaceId: string;
let remote: string;
let homeClone: string;
let laptopClone: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
function clone(into: string) {
  git(path.dirname(into), 'clone', '-q', remote, into);
  git(into, 'config', 'user.email', 'test@example.com');
  git(into, 'config', 'user.name', 'Test');
}

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-continue-' });
  laptopRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-continue-laptop-')));
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const own = identity.ensureHomeIdentity().home;
  hostId = own.hostComputerId;
  const q = await import('@/lib/db/queries');
  q.updateComputer(hostId, { name: 'Mini' });

  // One repository, a clone on each computer.
  remote = path.join(home.root, 'remote.git');
  git(home.root, 'init', '-q', '--bare', '-b', 'main', remote);
  const seed = path.join(home.root, 'seed');
  clone(seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# demo\n');
  fs.writeFileSync(path.join(seed, '.gitignore'), '.env*\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first');
  git(seed, 'push', '-q', 'origin', 'main');
  fs.mkdirSync(path.join(home.root, 'projects'), { recursive: true });
  homeClone = path.join(home.root, 'projects', 'demo');
  clone(homeClone);
  fs.writeFileSync(path.join(homeClone, '.env.local'), 'SECRET=mini\n');
  fs.mkdirSync(path.join(laptopRoot, 'projects'), { recursive: true });
  laptopClone = path.join(laptopRoot, 'projects', 'demo');
  clone(laptopClone);
  fs.writeFileSync(path.join(laptopClone, '.env.local'), 'SECRET=laptop\n');

  workspaceId = q.createWorkspace({
    name: 'Demo',
    cwd: homeClone,
    isGit: true,
    baseBranch: 'main',
    filesToCopy: ['.env*'],
    setupCommand: 'hostname > SETUP_RAN',
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
    worktreeRoot: path.join(home.root, 'worktrees'),
  }).id;
  q.recordAgentSetupReports(hostId, [{ agentId: workspaceId, sourcePath: homeClone, configRevision: null, references: [], status: 'ready', problem: null }], { complete: true });

  // The laptop: enrolled, its own setup file and registry.
  const laptopKey = q.createApiKey({ name: 'Laptop CLI', deviceType: 'computer' });
  laptopId = q.registerComputerForApiKey({ apiKeyId: laptopKey.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
  const { writeSetupFile } = await import('@/lib/setups/local-file');
  writeSetupFile(laptopClone, { version: 1, homeId: own.id, agents: { [workspaceId]: { references: {} } } }, null);
  fs.mkdirSync(path.join(laptopRoot, '.config'), { recursive: true });
  fs.writeFileSync(path.join(laptopRoot, '.config', 'setups.json'), JSON.stringify({ version: 1, locations: [{ dir: laptopClone, registeredAt: new Date().toISOString() }] }));
  q.recordAgentSetupReports(laptopId, [{ agentId: workspaceId, sourcePath: laptopClone, configRevision: null, references: [], status: 'ready', problem: null }], { complete: true });

  server = await startHomeServer();
  process.env.RI_PUBLIC_BASE_URL = server.url;
  fake = installFakeHarness('claude');
  fake.onTurn(async (turn) => {
    await turn.say(`home: ${turn.message.slice(0, 80)}`);
  });
  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptopKey.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  const { workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: WORKER_PROTOCOL, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>);
  worker = await startWorkerProcess({ homeUrl: server.url, homeId: own.id, workerKey, root: laptopRoot });
  await until(() => (q.getComputer(laptopId)?.harnesses?.length ?? 0) > 0, "the laptop's harness report");
}, 90_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
  fake.restore();
  delete process.env.RI_PUBLIC_BASE_URL;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
});

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

/** Send a message the way the messages route does: saved first, then dispatched with its event. */
async function sendMessage(chatId: string, content: string) {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const event = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
  void executor.dispatch(chatId, content, { sourceEventId: event.id }).catch(() => {});
  return event;
}

async function startedAtHome() {
  const q = await import('@/lib/db/queries');
  const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
  const session = await dispatchExecutionSession({ workspaceId, label: 'Fix login' });
  await until(() => {
    const s = q.getChatSessionWithExecution(session.id);
    return !!s?.worktreePath && fs.existsSync(s.worktreePath);
  }, 'the worktree at home');
  const chat = q.getChatSessionWithExecution(session.id)!;
  return { chatId: chat.id, executionId: chat.executionId!, homeWorktree: chat.worktreePath! };
}

async function finished(executionId: string) {
  const q = await import('@/lib/db/queries');
  await until(() => q.latestTransfer(executionId)?.state !== 'active', 'the move to finish', 90_000);
  return q.latestTransfer(executionId)!;
}

describe('Continue here', () => {
  it('moves work from the home to the laptop, with its changes and the chosen file, and back', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer } = await import('./continue');
    const { chatId, executionId, homeWorktree } = await startedAtHome();
    await sendMessage(chatId, 'first message at home');
    await until(() => q.listChatEvents(chatId, { limit: 50 }).some((e) => e.source === 'result'), 'the first turn at home');

    // Work in progress at home: a tracked change, a new file to take along,
    // one to leave behind, and a secret.
    fs.writeFileSync(path.join(homeWorktree, 'README.md'), '# demo, being fixed\n');
    fs.writeFileSync(path.join(homeWorktree, 'login.ts'), 'export const login = 1;\n');
    fs.writeFileSync(path.join(homeWorktree, 'notes.txt'), 'scratch\n');
    fs.writeFileSync(path.join(homeWorktree, '.env.local'), 'SECRET=mini-worktree\n');

    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: ['login.ts'], requestedByApiKeyId: null });
    // Sent while it moves: held, not sent to the home.
    const held = await sendMessage(chatId, 'sent while moving');
    const transfer = await finished(executionId);
    expect(transfer, `${transfer.failedStage}: ${transfer.error}`).toMatchObject({ state: 'succeeded', stage: 'done', fromGeneration: 1, toGeneration: 2, heldEventIds: [] });

    // Ownership: the laptop, at the next generation, from the pushed checkpoint.
    const placement = q.getOpenPlacement(executionId)!;
    expect(placement).toMatchObject({ computerId: laptopId, generation: 2, startReason: 'continued', checkpointSha: transfer.checkpointSha });
    expect(git(remote, 'rev-parse', `refs/heads/${transfer.branch}`)).toBe(transfer.checkpointSha);
    const there = placement.worktreePath!;
    expect(there.startsWith(laptopRoot)).toBe(true);
    expect(fs.readFileSync(path.join(there, 'README.md'), 'utf8')).toBe('# demo, being fixed\n');
    expect(fs.readFileSync(path.join(there, 'login.ts'), 'utf8')).toBe('export const login = 1;\n');
    expect(fs.existsSync(path.join(there, 'notes.txt'))).toBe(false);
    // Local setup is the laptop's own, copied from its folder, and its setup script ran there.
    expect(fs.readFileSync(path.join(there, '.env.local'), 'utf8')).toBe('SECRET=laptop\n');
    expect(fs.existsSync(path.join(there, 'SETUP_RAN'))).toBe(true);
    // The home kept its worktree, and what was left out of the move.
    expect(fs.readFileSync(path.join(homeWorktree, 'notes.txt'), 'utf8')).toBe('scratch\n');
    expect(q.getExecution(executionId)!.worktreePath).toBeNull();

    // Recorded once, and the held message delivered once, there, starting from the handoff.
    const events = () => q.listChatEvents(chatId, { limit: 200 });
    expect(events().filter((e) => e.source === 'continuation').map((e) => e.content)).toEqual(['Continued on Laptop']);
    await until(() => events().some((e) => e.role === 'assistant' && (e.content ?? '').includes('sent while moving')), 'the held message answered on the laptop');
    const answer = events().find((e) => e.role === 'assistant' && (e.content ?? '').includes('sent while moving'))!;
    expect(answer.content).toContain('<continuation>');
    // A fresh session there, the one at home kept in the history.
    await until(() => q.listNativeSessions(chatId).length === 2, "the laptop's session recorded");
    expect(q.listNativeSessions(chatId).map((n) => [n.computerId, n.endReason])).toEqual([[hostId, 'continued'], [laptopId, null]]);
    expect(q.getChatSession(chatId)!.externalSessionId).toBe(q.listNativeSessions(chatId)[1].nativeSessionId);
    expect(q.listWorkerCommands(laptopId).filter((c) => c.kind === 'send' && c.sourceEventId === held.id)).toHaveLength(1);
    expect(events().filter((e) => e.role === 'assistant' && (e.content ?? '').startsWith('home: sent while moving'))).toEqual([]);

    // And back to the home, into the worktree it had.
    fs.writeFileSync(path.join(there, 'login.ts'), 'export const login = 2;\n');
    startTransfer({ chatSessionId: chatId, toComputerId: hostId, includeUntracked: [], requestedByApiKeyId: null });
    const back = await finished(executionId);
    expect(back, `${back.failedStage}: ${back.error}`).toMatchObject({ state: 'succeeded', fromGeneration: 2, toGeneration: 3 });
    expect(q.getOpenPlacement(executionId)).toMatchObject({ computerId: hostId, generation: 3, worktreePath: homeWorktree });
    expect(q.getExecution(executionId)!.worktreePath).toBe(homeWorktree);
    expect(fs.readFileSync(path.join(homeWorktree, 'login.ts'), 'utf8')).toBe('export const login = 2;\n');
    expect(events().filter((e) => e.source === 'continuation').map((e) => e.content)).toEqual(['Continued on Laptop', 'Continued on Mini']);
  }, 240_000);
});
