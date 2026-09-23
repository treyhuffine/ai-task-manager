import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Safety invariant: the agent must NEVER resolve its cwd to a git
 * workspace's source checkout when the per-execution worktree is missing.
 * Doing so would let a turn read / edit / commit in the user's main tree
 * on whatever branch is checked out there, breaking the isolation the
 * whole app is built on. `resolveCwd` returns null in that case so the
 * caller fails loud (`dispatch` -> invalid_state) or reprovisions first.
 *
 * The `ws.cwd` fallback is correct ONLY for non-git workspaces (no
 * worktree concept) and for live mode (where worktreePath === ws.cwd and
 * the existence check returns it directly).
 */

const getWorkspace = vi.fn();

// adapter.ts eagerly imports these; stub so the module loads node-only.
vi.mock('@agentex/agent', () => ({
  listInstalledSkills: vi.fn(),
  commandInventoryFromEvent: () => null,
  getProvider: () => ({ createSession: () => ({}) }),
}));
vi.mock('@/lib/config/paths', () => ({
  getAppRoot: () => '/tmp/test-app-root',
}));
vi.mock('@/lib/db/queries', () => ({
  getChatSession: () => undefined,
  getAgent: () => undefined,
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  updateChatSession: () => undefined,
}));
vi.mock('@/lib/realtime/bus', () => ({ publishRuntime: () => undefined }));

import { resolveCwd } from './adapter';

// Real on-disk dirs so resolveCwd's `existsSync` runs for real.
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'resolvecwd-'));
const worktreeDir = path.join(tmpBase, 'worktree-abc'); // exists
const sourceCheckout = path.join(tmpBase, 'main-repo'); // exists (== ws.cwd)
const missingWorktree = path.join(tmpBase, 'pruned'); // never created
fs.mkdirSync(worktreeDir, { recursive: true });
fs.mkdirSync(sourceCheckout, { recursive: true });

afterAll(() => fs.rmSync(tmpBase, { recursive: true, force: true }));
beforeEach(() => getWorkspace.mockReset());

const gitWs = { id: 'ws1', cwd: sourceCheckout, isGit: true };
const nonGitWs = { id: 'ws2', cwd: sourceCheckout, isGit: false };

/** An execution chat's pointer fields. */
const exec = (worktreePath: string | null, workspaceId: string | null) =>
  ({ worktreePath, workspaceId, type: 'execution' as const, executionId: 'e1' });

describe('resolveCwd — worktree isolation safety', () => {
  it('git workspace, worktree exists → the worktree path', () => {
    getWorkspace.mockReturnValue(gitWs);
    expect(resolveCwd(exec(worktreeDir, 'ws1'))).toBe(worktreeDir);
  });

  it('git workspace, worktreePath set but dir MISSING → null (never the source checkout)', () => {
    getWorkspace.mockReturnValue(gitWs);
    const cwd = resolveCwd(exec(missingWorktree, 'ws1'));
    expect(cwd).toBeNull();
    expect(cwd).not.toBe(sourceCheckout);
  });

  it('git workspace, worktreePath null (still provisioning) → null', () => {
    getWorkspace.mockReturnValue(gitWs);
    expect(resolveCwd(exec(null, 'ws1'))).toBeNull();
  });

  it('live mode (worktreePath === ws.cwd, exists) → that path', () => {
    // Live mode runs in-place: worktreePath is the source checkout itself.
    getWorkspace.mockReturnValue({ id: 'ws1', cwd: sourceCheckout, isGit: true });
    expect(resolveCwd(exec(sourceCheckout, 'ws1'))).toBe(sourceCheckout);
  });

  it('non-git workspace → the workspace cwd', () => {
    getWorkspace.mockReturnValue(nonGitWs);
    expect(resolveCwd(exec(null, 'ws2'))).toBe(sourceCheckout);
  });

  it('no workspace (orchestrator/content) → the app root', () => {
    expect(resolveCwd({ worktreePath: null, workspaceId: null, type: 'orchestration', executionId: null }))
      .toBe('/tmp/test-app-root');
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it('workspace id set but workspace not found → null', () => {
    getWorkspace.mockReturnValue(undefined);
    expect(resolveCwd(exec(missingWorktree, 'gone'))).toBeNull();
  });
});

describe("resolveCwd — an agent's main chat", () => {
  const mainChat = (workspaceId: string) =>
    ({ worktreePath: null, workspaceId, type: 'orchestration' as const, executionId: null });

  it('runs in the agent folder, git or not (it has no worktree by design)', () => {
    getWorkspace.mockReturnValue(gitWs);
    expect(resolveCwd(mainChat('ws1'))).toBe(sourceCheckout);
    getWorkspace.mockReturnValue(nonGitWs);
    expect(resolveCwd(mainChat('ws2'))).toBe(sourceCheckout);
  });

  it('refuses a folder that has gone away', () => {
    getWorkspace.mockReturnValue({ id: 'ws3', cwd: missingWorktree, isGit: true });
    expect(resolveCwd(mainChat('ws3'))).toBeNull();
  });

  it('never loosens the rule for executions: a git execution with no worktree still gets null', () => {
    getWorkspace.mockReturnValue(gitWs);
    expect(resolveCwd({ worktreePath: null, workspaceId: 'ws1', type: 'execution', executionId: 'e1' })).toBeNull();
  });
});
