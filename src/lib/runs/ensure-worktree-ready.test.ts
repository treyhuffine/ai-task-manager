/**
 * `ensureWorktreeReady` is the self-heal the interactive message route now
 * runs before dispatch. It must:
 *   - no-op (ok) when there's no execution or the workspace isn't git
 *   - no-op (ok) WITHOUT reprovisioning when the worktree dir still exists
 *     (the hot path on every message send — an existsSync, nothing more)
 *   - reset + reprovision when the worktree dir is gone, then report ok
 *     once a usable path lands
 *
 * Git provisioning (`provisionWorktreeForSession`) is mocked so we drive
 * the decision table deterministically without shelling out to git.
 *
 * The DB is migrated ONCE (beforeAll) and each test mints its own
 * workspace + execution rows — repeating `resetDb()` (a full migration)
 * per test adds enough parallel load to flake time-sensitive tests in
 * other files under the full suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true }, createSession: vi.fn() }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

// Mock only `provisionWorktreeForSession`; keep the rest of the module real.
const provisionWorktreeForSession = vi.fn();
vi.mock('@/lib/sessions/dispatch', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/sessions/dispatch')>()),
  provisionWorktreeForSession: (...a: unknown[]) => provisionWorktreeForSession(...a),
}));

const TEST_DB = path.join(os.tmpdir(), `flow-ewr-test-${process.pid}.db`);
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ewr-'));
const existingWorktree = path.join(tmpBase, 'wt-live');
const freshWorktree = path.join(tmpBase, 'wt-fresh');
const missingWorktree = path.join(tmpBase, 'wt-gone'); // never created
fs.mkdirSync(existingWorktree, { recursive: true });
fs.mkdirSync(freshWorktree, { recursive: true });

type Q = typeof import('@/lib/db/queries');
let q: Q;
let gitWsId: string;
let nonGitWsId: string;
let agentId: string;

async function makeWorkspace(isGit: boolean): Promise<string> {
  const { getDb } = await import('@/lib/db');
  const { uuidv7 } = await import('uuidv7');
  const { workspaces } = await import('@/lib/db/schema');
  const id = uuidv7();
  getDb()
    .insert(workspaces)
    .values({ id, name: 'Ws', slug: 'ws-' + id, cwd: tmpBase, isGit, baseBranch: 'main' })
    .run();
  return id;
}

function makeExecution(workspaceId: string, worktreePath: string | null) {
  const { execution } = q.createExecutionWithChat({
    workspaceId,
    agentId,
    label: null,
    worktreePath,
    branchName: worktreePath ? 'feat' : null,
    baseSha: worktreePath ? 'abc' : null,
  });
  return execution;
}

beforeAll(async () => {
  for (const s of ['', '-wal', '-shm']) {
    const p = TEST_DB + s;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  q = await import('@/lib/db/queries');
  const { uuidv7 } = await import('uuidv7');
  const { agents } = await import('@/lib/db/schema');
  agentId = uuidv7();
  getDb()
    .insert(agents)
    .values({ id: agentId, userId: 'local', kind: 'executor', name: 'A', harness: 'claude_code', config: {}, status: 'active' })
    .run();
  gitWsId = await makeWorkspace(true);
  nonGitWsId = await makeWorkspace(false);
});

beforeEach(() => provisionWorktreeForSession.mockReset());

afterAll(() => {
  for (const s of ['', '-wal', '-shm']) {
    const p = TEST_DB + s;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('ensureWorktreeReady', () => {
  it('no execution (orchestrator target) → ok, no provisioning', async () => {
    const { ensureWorktreeReady } = await import('./dispatch');
    const res = await ensureWorktreeReady('chat1', null);
    expect(res).toEqual({ ok: true });
    expect(provisionWorktreeForSession).not.toHaveBeenCalled();
  });

  it('non-git workspace → ok, no provisioning', async () => {
    const execution = makeExecution(nonGitWsId, null);
    const { ensureWorktreeReady } = await import('./dispatch');
    const res = await ensureWorktreeReady('chat1', execution);
    expect(res).toEqual({ ok: true });
    expect(provisionWorktreeForSession).not.toHaveBeenCalled();
  });

  it('git workspace, worktree dir exists → ok WITHOUT reprovisioning', async () => {
    const execution = makeExecution(gitWsId, existingWorktree);
    const { ensureWorktreeReady } = await import('./dispatch');
    const res = await ensureWorktreeReady('chat1', execution);
    expect(res).toEqual({ ok: true });
    expect(provisionWorktreeForSession).not.toHaveBeenCalled();
  });

  it('git workspace, worktree dir MISSING → reprovisions, then ok', async () => {
    const execution = makeExecution(gitWsId, missingWorktree);
    // Simulate a successful provision: stamp a real worktree dir onto the row.
    provisionWorktreeForSession.mockImplementation(async () => {
      q.markExecutionSetupComplete(execution.id, {
        worktreePath: freshWorktree,
        branchName: 'feat',
        baseSha: 'def',
      });
    });

    const { ensureWorktreeReady } = await import('./dispatch');
    const res = await ensureWorktreeReady('chat1', execution);

    expect(provisionWorktreeForSession).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
    expect(q.getExecution(execution.id)?.worktreePath).toBe(freshWorktree);
  });

  it('git workspace, worktree MISSING and reprovision yields no path → error', async () => {
    const execution = makeExecution(gitWsId, missingWorktree);
    // provision is a no-op → worktreePath stays null after reset.
    provisionWorktreeForSession.mockResolvedValue(undefined);

    const { ensureWorktreeReady } = await import('./dispatch');
    const res = await ensureWorktreeReady('chat1', execution);

    expect(provisionWorktreeForSession).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
  });
});
