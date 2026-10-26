/**
 * A new chat's first message, while its worktree is still being made.
 *
 * The messages route saves the message, then waits for the worktree before
 * `dispatch` reserves it. Opening the chat runs recovery (`healthCheckSession`
 * with `redispatchOrphans`) in that gap. Recovery took the message for an
 * orphan, sent it itself ahead of the worktree, and put "This message wasn't
 * sent: Session has no resolvable cwd" in the chat, while the route went on
 * to deliver it. It also cleared the chat's running flag under the route's
 * preparation. Real home, real git worktree, fake harness.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { ProvisionArgs } from '@/lib/sessions/dispatch';

/** Worktree creation waits here, as a real one takes seconds. */
let provisioning: { entered: Promise<void>; enter: () => void; gate: Promise<void>; release: () => void };
function newProvisioning() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { entered, enter, gate, release };
}

vi.mock('@/lib/sessions/dispatch', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/sessions/dispatch')>();
  return {
    ...real,
    provisionWorktreeForSession: async (args: ProvisionArgs) => {
      provisioning.enter();
      await provisioning.gate;
      return real.provisionWorktreeForSession(args);
    },
  };
});

let home: TestHome;
let fake: FakeHarness;
let chatId: string;
let executionId: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
  cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
}).toString().trim();

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-first-message-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const repo = path.join(home.root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Fixture');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  const q = await import('@/lib/db/queries');
  const workspace = q.createWorkspace({ name: 'Code', cwd: repo, isGit: true, baseBranch: 'main' });
  // As a new chat is created: setup started, no worktree yet.
  const created = q.createExecutionWithChat({
    workspaceId: workspace.id, harness: 'claude', label: 'Review', setupStartedAt: new Date().toISOString(),
  });
  chatId = created.session.id;
  executionId = created.execution.id;
  fake = installFakeHarness('claude');
  provisioning = newProvisioning();
});

afterEach(async () => {
  provisioning.release();
  vi.restoreAllMocks();
  await (await import('@/lib/runner/local-runner')).closeAllSessions();
  fake.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  vi.unstubAllEnvs();
});

async function send(id: string, content: string) {
  const { POST } = await import('@/lib/server/operations/sessions/[id]/messages');
  const { operationContext } = await import('@/lib/server/operation');
  const input = { params: { id: chatId }, body: { content, id } };
  return POST(input, operationContext(new Request('http://fixture/'), input, '/sessions/[id]/messages'));
}

async function refusals() {
  const q = await import('@/lib/db/queries');
  return q.listRecentChatEvents(chatId, 50)
    .filter((e) => (e.raw as { subtype?: unknown } | null)?.subtype === 'send_refused')
    .map((e) => e.content);
}

it('opening a new chat while its worktree is being made leaves the first message to its send', async () => {
  const executor = await import('./adapter');
  const health = await import('./health');
  const q = await import('@/lib/db/queries');
  const messageId = uuidv7();

  expect(await send(messageId, 'Review this PR')).toMatchObject({ ok: true, status: 201 });
  await provisioning.entered;
  expect(executor.isRunning(chatId)).toBe(true);

  // The chat opens: recovery runs while the route waits for the worktree.
  const opened = await health.healthCheckSession(chatId, { redispatchOrphans: true });
  expect(opened).toMatchObject({ classification: 'healthy', redispatched: false, fixes: [] });
  expect(executor.isRunning(chatId)).toBe(true);
  // A Resync skips the cooldown, and still leaves it alone.
  expect(await health.healthCheckSession(chatId, { redispatchOrphans: true, force: true })).toMatchObject({ redispatched: false });
  // The client retries the same message (a dropped response): still the first send's.
  expect(await send(messageId, 'Review this PR')).toMatchObject({ ok: true, status: 201 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await refusals()).toEqual([]);
  expect(fake.sessions).toHaveLength(0);

  provisioning.release();
  await vi.waitFor(() => expect(fake.sessions.flatMap((s) => s.messages)).toHaveLength(1));
  expect(fake.sessions.flatMap((s) => s.messages)[0]).toContain('Review this PR');
  const worktree = q.getExecution(executionId)!.worktreePath!;
  expect(fs.existsSync(worktree)).toBe(true);
  expect(fake.sessions[0].ctx.cwd).toBe(worktree);
  await vi.waitFor(() => expect(executor.isRunning(chatId)).toBe(false));
  expect(await refusals()).toEqual([]);
  // Once its turn is done, the message has its answer: nothing left to recover.
  expect(await health.healthCheckSession(chatId, { redispatchOrphans: true, force: true })).toMatchObject({ redispatched: false });
  expect(fake.sessions.flatMap((s) => s.messages)).toHaveLength(1);
}, 20_000);

it('a message whose worktree cannot be made is refused once, by its send', async () => {
  const health = await import('./health');
  const q = await import('@/lib/db/queries');
  // The workspace's folder is gone, so the worktree can't be made.
  fs.rmSync(q.getWorkspace(q.getExecution(executionId)!.workspaceId)!.cwd, { recursive: true, force: true });

  expect(await send(uuidv7(), 'Review this PR')).toMatchObject({ ok: true, status: 201 });
  await provisioning.entered;
  await health.healthCheckSession(chatId, { redispatchOrphans: true });
  expect(await refusals()).toEqual([]);

  provisioning.release();
  await vi.waitFor(async () => expect(await refusals()).toHaveLength(1));
  expect((await refusals())[0]).toMatch(/^This message wasn't sent: /);
  expect((await refusals())[0]).not.toContain('no resolvable cwd');
  // Final: recovery never sends it after all.
  expect(await health.healthCheckSession(chatId, { redispatchOrphans: true, force: true })).toMatchObject({ redispatched: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await refusals()).toHaveLength(1);
  expect(fake.sessions).toHaveLength(0);
}, 20_000);
