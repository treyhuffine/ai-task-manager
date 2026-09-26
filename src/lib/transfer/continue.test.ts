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
  // Its setup script runs after the worktree is ready: a move waits for it to finish.
  await until(() => ['done', 'failed'].includes(q.getExecution(q.getChatSessionWithExecution(session.id)!.executionId!)!.setupScriptStatus ?? ''), 'setup at home');
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

describe('Open code here', () => {
  async function review(chatId: string, headers: Record<string, string>) {
    const { POST } = await import('@/app/api/sessions/[id]/review/route');
    const res = await POST(new Request('http://x', { method: 'POST', headers }) as never, { params: Promise.resolve({ id: chatId }) });
    return { status: res.status, body: await res.json() };
  }

  it("checks out the laptop's published work on the home for review, refreshes it while clean, and keeps edits", async () => {
    const q = await import('@/lib/db/queries');
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const session = await dispatchExecutionSession({ workspaceId, computerId: laptopId, label: 'On the laptop' });
    await until(() => !!q.getOpenPlacement(session.executionId!)?.worktreePath, 'the worktree on the laptop');
    const there = q.getOpenPlacement(session.executionId!)!.worktreePath!;
    const branch = q.getChatSessionWithExecution(session.id)!.branchName!;

    // Nothing published yet.
    expect(await review(session.id, { 'x-ri-host': '1' })).toMatchObject({ status: 409, body: { error: 'not_published' } });

    fs.writeFileSync(path.join(there, 'feature.ts'), 'export const v = 1;\n');
    git(there, 'add', '.');
    git(there, 'commit', '-q', '-m', 'feature');
    git(there, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    const first = await review(session.id, { 'x-ri-host': '1' });
    expect(first).toMatchObject({ status: 200, body: { created: true, review: { sha: git(there, 'rev-parse', 'HEAD'), dirty: false, source: { name: 'Laptop' } } } });
    const reviewPath = first.body.review.path as string;
    expect(reviewPath.startsWith(home.workDir)).toBe(true);
    expect(fs.readFileSync(path.join(reviewPath, 'feature.ts'), 'utf8')).toBe('export const v = 1;\n');
    // It stays where it runs.
    expect(q.getOpenPlacement(session.executionId!)).toMatchObject({ computerId: laptopId, generation: 1 });

    fs.writeFileSync(path.join(there, 'feature.ts'), 'export const v = 2;\n');
    git(there, 'commit', '-qam', 'v2');
    git(there, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    expect(await review(session.id, { 'x-ri-host': '1' })).toMatchObject({ status: 200, body: { refreshed: true, review: { dirty: false } } });
    expect(fs.readFileSync(path.join(reviewPath, 'feature.ts'), 'utf8')).toBe('export const v = 2;\n');

    fs.writeFileSync(path.join(reviewPath, 'feature.ts'), 'my edit\n');
    fs.writeFileSync(path.join(there, 'feature.ts'), 'export const v = 3;\n');
    git(there, 'commit', '-qam', 'v3');
    git(there, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    expect(await review(session.id, { 'x-ri-host': '1' })).toMatchObject({ status: 200, body: { refreshed: false, review: { dirty: true } } });
    expect(fs.readFileSync(path.join(reviewPath, 'feature.ts'), 'utf8')).toBe('my edit\n');
  }, 120_000);

  it("checks out a home execution's published work on the laptop, through its worker", async () => {
    const q = await import('@/lib/db/queries');
    const { chatId, homeWorktree } = await startedAtHome();
    const branch = q.getChatSessionWithExecution(chatId)!.branchName!;
    fs.writeFileSync(path.join(homeWorktree, 'home.ts'), 'export {};\n');
    git(homeWorktree, 'add', '.');
    git(homeWorktree, 'commit', '-q', '-m', 'home work');
    git(homeWorktree, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    // A browser on the laptop: its viewing key linked to the laptop.
    const key = q.createApiKey({ name: 'Laptop browser', deviceType: 'other' });
    const grant = q.createComputerGrant({ kind: 'associate', computerId: laptopId, createdByApiKeyId: null });
    q.redeemAssociateGrant({ secret: grant.secret, apiKeyId: key.key.id });
    const { API_KEY_ID_HEADER, API_KEY_TYPE_HEADER } = await import('@/lib/auth/request-key');
    const result = await review(chatId, { [API_KEY_ID_HEADER]: key.key.id, [API_KEY_TYPE_HEADER]: 'other' });
    expect(result).toMatchObject({ status: 200, body: { viewer: { name: 'Laptop' }, review: { source: { name: 'Mini' }, dirty: false } } });
    const reviewPath = result.body.review.path as string;
    expect(reviewPath.startsWith(laptopRoot)).toBe(true);
    expect(fs.readFileSync(path.join(reviewPath, 'home.ts'), 'utf8')).toBe('export {};\n');
    // Not the branch the agent works on: detached, so nothing publishes to it by accident.
    expect(git(reviewPath, 'branch', '--show-current')).toBe('');
  }, 120_000);
});

describe('when a move stops', () => {
  /**
   * Only ever one owner: never more than one open placement, and where it
   * runs (an execution begun at home has no row until it first moves).
   */
  async function owner(executionId: string) {
    const { getDb } = await import('@/lib/db');
    const { executionPlacements } = await import('@/lib/db/schema');
    const { and, eq, isNull } = await import('drizzle-orm');
    const open = getDb().select().from(executionPlacements).where(and(eq(executionPlacements.executionId, executionId), isNull(executionPlacements.endedAt))).all();
    expect(open.length).toBeLessThanOrEqual(1);
    return (await import('@/lib/db/queries')).placementOf(executionId)!.computerId;
  }

  it("won't start while the source is away, and changes nothing", async () => {
    const q = await import('@/lib/db/queries');
    const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
    const { startTransfer } = await import('./continue');
    const session = await dispatchExecutionSession({ workspaceId, computerId: laptopId, label: 'Away' });
    await until(() => !!q.getOpenPlacement(session.executionId!)?.worktreePath, 'the worktree on the laptop');
    await worker!.stop();
    worker = null;
    expect(() => startTransfer({ chatSessionId: session.id, toComputerId: hostId, includeUntracked: [], requestedByApiKeyId: null })).toThrow(/Laptop isn't connected/);
    expect(q.latestTransfer(session.executionId!)).toBeNull();
    expect(await owner(session.executionId!)).toBe(laptopId);
  }, 120_000);

  it("won't move to a computer whose setup is missing a reference", async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer } = await import('./continue');
    const { chatId } = await startedAtHome();
    q.recordAgentSetupReports(laptopId, [{
      agentId: workspaceId, sourcePath: laptopClone, configRevision: null, references: [],
      status: 'missing_reference', problem: 'Reference "docs" isn\'t set up on this computer.',
    }], { complete: true });
    expect(() => startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null })).toThrow(/docs/);
  }, 120_000);

  it('stops at Saving work when the push is rejected: the source keeps the work, its held message, and resumes', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer, resumeOnSource } = await import('./continue');
    const { chatId, executionId, homeWorktree } = await startedAtHome();
    const branch = q.getChatSessionWithExecution(chatId)!.branchName!;
    // Someone else pushed to the same branch.
    const other = path.join(home.root, 'other');
    clone(other);
    git(other, 'checkout', '-q', '-b', branch);
    fs.writeFileSync(path.join(other, 'THEIRS.md'), 'theirs\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'theirs');
    git(other, 'push', '-q', 'origin', branch);
    fs.writeFileSync(path.join(homeWorktree, 'README.md'), 'mine\n');

    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    const held = await sendMessage(chatId, 'while it tried');
    const transfer = await finished(executionId);
    expect(transfer).toMatchObject({ state: 'failed', failedStage: 'saving', toGeneration: null, heldEventIds: [held.id] });
    expect(transfer.error).toMatch(/Nothing was forced/);
    expect(git(remote, 'log', '--format=%s', '-1', `refs/heads/${branch}`)).toBe('theirs');
    expect(await owner(executionId)).toBe(hostId);
    const { deliveriesForChat } = await import('@/lib/workers/delivery');
    expect(deliveriesForChat(chatId)[held.id]).toMatchObject({ state: 'held', reason: 'The move to Laptop stopped. Try again, or resume on Mini.' });

    await resumeOnSource(executionId);
    await until(() => q.listChatEvents(chatId, { limit: 100 }).some((e) => e.role === 'assistant' && (e.content ?? '').includes('while it tried')), 'the held message answered at home');
    expect(q.latestTransfer(executionId)!.heldEventIds).toEqual([]);
  }, 180_000);

  it('carries held messages into Try again, and delivers them once, where the work arrives', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer } = await import('./continue');
    const { chatId, executionId, homeWorktree } = await startedAtHome();
    const branch = q.getChatSessionWithExecution(chatId)!.branchName!;
    const other = path.join(home.root, 'other');
    clone(other);
    git(other, 'checkout', '-q', '-b', branch);
    fs.writeFileSync(path.join(other, 'THEIRS.md'), 'theirs\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'theirs');
    git(other, 'push', '-q', 'origin', branch);

    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    const held = await sendMessage(chatId, 'held across a retry');
    expect(await finished(executionId)).toMatchObject({ state: 'failed', failedStage: 'saving' });

    // Brought in on the source, as the error asked, then Try again.
    git(homeWorktree, 'pull', '-q', '--no-rebase', 'origin', branch);
    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    expect(await finished(executionId)).toMatchObject({ state: 'succeeded', toGeneration: 2, heldEventIds: [] });
    await until(
      () => q.listChatEvents(chatId, { limit: 200 }).some((e) => e.role === 'assistant' && (e.content ?? '').includes('held across a retry')),
      'the held message answered on the laptop',
    );
    expect(q.listWorkerCommands(laptopId).filter((c) => c.kind === 'send' && c.sourceEventId === held.id)).toHaveLength(1);
    expect(q.latestTransfer(executionId)!.heldEventIds).toEqual([]);
    expect(fs.existsSync(path.join(q.getOpenPlacement(executionId)!.worktreePath!, 'THEIRS.md'))).toBe(true);
  }, 240_000);

  it('after the destination took the work, finishing delivers what is still held there, and nothing at the source', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer, finishOnDestination } = await import('./continue');
    const { chatId, executionId } = await startedAtHome();
    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    const moved = await finished(executionId);
    expect(moved.state, `${moved.failedStage}: ${moved.error}`).toBe('succeeded');
    // As if it stopped after the ownership change with a message still held.
    const late = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'held after the change', createdAt: new Date().toISOString() })!;
    q.updateTransfer(moved.id, { state: 'failed', stage: 'continuing', failedStage: 'continuing', heldEventIds: [late.id] });
    expect(await finishOnDestination(executionId)).toMatchObject({ state: 'succeeded', heldEventIds: [] });
    await until(
      () => q.listChatEvents(chatId, { limit: 200 }).some((e) => e.role === 'assistant' && (e.content ?? '').includes('held after the change')),
      'the message answered on the laptop',
    );
    expect(q.listChatEvents(chatId, { limit: 200 }).filter((e) => (e.content ?? '').startsWith('home: held after the change'))).toEqual([]);
    expect(await owner(executionId)).toBe(laptopId);
  }, 240_000);

  it('stops at Setting up on a branch with commits of its own there, and goes through once that is fixed', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer } = await import('./continue');
    const { chatId, executionId } = await startedAtHome();
    const branch = q.getChatSessionWithExecution(chatId)!.branchName!;
    git(laptopClone, 'branch', branch, 'origin/main');
    const side = path.join(laptopRoot, 'side');
    git(laptopClone, 'worktree', 'add', '-q', side, branch);
    fs.writeFileSync(path.join(side, 'MINE.md'), 'x\n');
    git(side, 'add', '.');
    git(side, 'commit', '-q', '-m', 'laptop only');
    git(laptopClone, 'worktree', 'remove', side);

    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    const first = await finished(executionId);
    expect(first).toMatchObject({ state: 'failed', failedStage: 'setting_up', toGeneration: null });
    expect(first.error).toMatch(/commits that aren't in the checkpoint/);
    expect(git(laptopClone, 'log', '--format=%s', '-1', branch)).toBe('laptop only');
    expect(await owner(executionId)).toBe(hostId);

    git(laptopClone, 'branch', '-m', branch, `${branch}-laptop`);
    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    expect(await finished(executionId)).toMatchObject({ state: 'succeeded', toGeneration: 2 });
    expect(await owner(executionId)).toBe(laptopId);
  }, 180_000);

  it('stops at Setting up when the setup script fails there, keeping what it made', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer } = await import('./continue');
    const { chatId, executionId } = await startedAtHome();
    q.updateWorkspace(workspaceId, { setupCommand: 'echo "no toolchain here" >&2; exit 3' });
    startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
    const transfer = await finished(executionId);
    expect(transfer).toMatchObject({ state: 'failed', failedStage: 'setting_up', toGeneration: null });
    expect(transfer.error).toMatch(/The setup script failed on Laptop/);
    expect(transfer.error).toMatch(/no toolchain here/);
    expect(fs.existsSync(transfer.targetWorktreePath!)).toBe(true);
    expect(q.getExecution(executionId)!.setupError).toBeNull();
    expect(await owner(executionId)).toBe(hostId);
  }, 180_000);

  it('stops when the destination drops while it sets up, and can be tried again', async () => {
    const q = await import('@/lib/db/queries');
    const { startTransfer, STEP_TIMEOUTS_MS } = await import('./continue');
    const saved = { ...STEP_TIMEOUTS_MS };
    STEP_TIMEOUTS_MS.prepare = 4_000;
    STEP_TIMEOUTS_MS.setup = 4_000;
    try {
      const { chatId, executionId } = await startedAtHome();
      // A setup script long enough to kill the laptop in the middle of it.
      q.updateWorkspace(workspaceId, { setupCommand: 'sleep 30' });
      startTransfer({ chatSessionId: chatId, toComputerId: laptopId, includeUntracked: [], requestedByApiKeyId: null });
      await until(() => q.latestTransfer(executionId)?.stage === 'setting_up', 'setting up on the laptop');
      await worker!.kill();
      const transfer = await finished(executionId);
      expect(transfer).toMatchObject({ state: 'failed', failedStage: 'setting_up', toGeneration: null });
      expect(transfer.error).toMatch(/didn't finish in time on Laptop/);
      // Messages still go nowhere but the home, which kept the work.
      expect(await owner(executionId)).toBe(hostId);
    } finally {
      Object.assign(STEP_TIMEOUTS_MS, saved);
      worker = null;
    }
  }, 180_000);
});
