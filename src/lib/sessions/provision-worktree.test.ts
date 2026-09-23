/**
 * `provisionWorktreeForSession` runs once per execution at a time.
 *
 * Creating a session starts a provision in the background, and the first
 * message's self-heal (`ensureWorktreeReady`) finds no worktree yet and asks
 * for one too. Both used to build a worktree and a branch. The later one was
 * recorded and the other was left on disk with nothing pointing at it (seen
 * as `-2` worktree paths in real homes). These tests run real git so the
 * evidence is the repo itself: one worktree, one branch.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true }, createSession: vi.fn() }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  invalidateHarnessSession: vi.fn(),
  close: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-provision-')));
const TEST_DB = path.join(ROOT, 'data.db');

const sh = (cwd: string, cmd: string) =>
  execSync(cmd, {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b' },
  }).toString().trim();

type Q = typeof import('@/lib/db/queries');
let q: Q;

/** A committed repo with no remote, and a workspace on it whose worktrees land under ROOT. */
async function makeGitWorkspace(name: string) {
  const repo = path.join(ROOT, name);
  fs.mkdirSync(repo);
  sh(repo, 'git init -q -b main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# hi\n');
  sh(repo, 'git add -A && git commit -qm init');

  const { getDb } = await import('@/lib/db');
  const { uuidv7 } = await import('uuidv7');
  const { workspaces } = await import('@/lib/db/schema');
  const id = uuidv7();
  getDb()
    .insert(workspaces)
    .values({
      id, name, slug: name, cwd: repo, isGit: true, baseBranch: 'main', status: 'active',
      worktreeRoot: path.join(ROOT, 'worktrees', name),
      filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true,
    })
    .run();
  return { repo, ws: q.getWorkspace(id)! };
}

function worktrees(repo: string): string[] {
  return sh(repo, 'git worktree list --porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length))
    .filter((p) => p !== repo);
}

function branches(repo: string): string[] {
  return sh(repo, "git for-each-ref --format='%(refname:short)' refs/heads").split('\n').filter((b) => b !== 'main');
}

beforeAll(async () => {
  process.env.RI_DB_PATH = TEST_DB;
  const { resetDb } = await import('@/lib/db');
  resetDb();
  q = await import('@/lib/db/queries');
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('provisionWorktreeForSession', () => {
  it('joins a provision already running for the execution instead of building a second worktree', async () => {
    const { repo, ws } = await makeGitWorkspace('joins');
    const { execution, session: chatSession } = q.createExecutionWithChat({
      workspaceId: ws.id, harness: 'claude', label: 'Create HELLO.md', worktreePath: null,
      setupStartedAt: new Date().toISOString(),
    });
    const { provisionWorktreeForSession } = await import('./dispatch');
    const args = {
      ws, executionId: execution.id, sessionId: chatSession.id, label: 'Create HELLO.md',
      baseBranchOverride: null, prNumber: null,
    };

    const first = provisionWorktreeForSession(args);
    const second = provisionWorktreeForSession(args);
    expect(second).toBe(first);
    await Promise.all([first, second]);

    const recorded = q.getExecution(execution.id)!;
    expect(recorded.setupError).toBeNull();
    expect(worktrees(repo)).toEqual([recorded.worktreePath]);
    expect(branches(repo)).toEqual([recorded.branchName]);
  });

  it('the first message racing session create leaves one worktree (ensureWorktreeReady joins)', async () => {
    const { repo, ws } = await makeGitWorkspace('races');
    const { execution, session: chatSession } = q.createExecutionWithChat({
      workspaceId: ws.id, harness: 'claude', label: null, worktreePath: null,
      setupStartedAt: new Date().toISOString(),
    });
    const { provisionWorktreeForSession } = await import('./dispatch');
    const { ensureWorktreeReady } = await import('@/lib/runs/dispatch');

    const errors = vi.spyOn(console, 'error');

    // What dispatchExecutionSession fires in the background ...
    const background = provisionWorktreeForSession({
      ws, executionId: execution.id, sessionId: chatSession.id, label: null,
      baseBranchOverride: null, prNumber: null,
    });
    // ... and what the first POST /messages runs before the worktree lands.
    const ready = await ensureWorktreeReady(chatSession.id, q.getExecution(execution.id)!);
    await background;

    expect(ready).toEqual({ ok: true });
    const recorded = q.getExecution(execution.id)!;
    // Unjoined, the loser either leaves a second worktree behind or fails
    // and marks a working execution's setup as failed until the winner lands.
    expect(recorded.setupError).toBeNull();
    expect(errors.mock.calls.flat().join('\n')).not.toContain('worktree provisioning failed');
    errors.mockRestore();
    expect(worktrees(repo)).toEqual([recorded.worktreePath]);
    expect(branches(repo)).toEqual([recorded.branchName]);
  });

  it('two executions starting at once with the same label each get a worktree', async () => {
    const { repo, ws } = await makeGitWorkspace('same-label');
    const make = () => q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Fix bug', worktreePath: null });
    const [a, b] = [make(), make()];
    const { provisionWorktreeForSession } = await import('./dispatch');
    const argsFor = (x: typeof a) => ({
      ws, executionId: x.execution.id, sessionId: x.session.id, label: 'Fix bug',
      baseBranchOverride: null, prNumber: null,
    });

    // Different executions never share a provision. Both ask for
    // `same-label/fix-bug` at the same moment, so one loses the ref lock
    // inside git and moves on to `-2` instead of failing.
    const [pa, pb] = [provisionWorktreeForSession(argsFor(a)), provisionWorktreeForSession(argsFor(b))];
    expect(pb).not.toBe(pa);
    await Promise.all([pa, pb]);

    const [ra, rb] = [q.getExecution(a.execution.id)!, q.getExecution(b.execution.id)!];
    expect([ra.setupError, rb.setupError]).toEqual([null, null]);
    expect(new Set(worktrees(repo))).toEqual(new Set([ra.worktreePath, rb.worktreePath]));
    expect(new Set(branches(repo))).toEqual(new Set(['same-label/fix-bug', 'same-label/fix-bug-2']));
    // No half-made directory from the losing attempt.
    expect(fs.readdirSync(ws.worktreeRoot!).map((d) => path.join(ws.worktreeRoot!, d)).sort())
      .toEqual([ra.worktreePath, rb.worktreePath].sort());

    // The map entry clears on settle, so a later retry for the same
    // execution runs rather than returning the finished promise.
    const again = provisionWorktreeForSession(argsFor(a));
    expect(again).not.toBe(pa);
    await again;
  });

  it('names an unlabeled branch from the random half of the id, not the timestamp', async () => {
    const { deriveSessionLabelSlug } = await import('@/lib/workspaces');
    // Two UUIDv7s a few ms apart share their first 8 chars.
    const one = '01a0cc1d-2eeb-7d42-9e6e-4c46cba371b8';
    const two = '01a0cc1d-2ef0-7a11-8c3d-9f02e5d4c7a1';
    expect(deriveSessionLabelSlug(null, one)).toBe('session-4c46cb');
    expect(deriveSessionLabelSlug(null, two)).not.toBe(deriveSessionLabelSlug(null, one));
    expect(deriveSessionLabelSlug('Fix the login bug', one)).toBe('fix-the-login-bug');
  });
});
