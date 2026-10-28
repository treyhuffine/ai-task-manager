/**
 * The folder an execution works in, as the read bridge reports it
 * (`flattenSessionExecution`). A non-git agent never gets a worktree: its
 * executions work in the agent's own folder, and the bridge reports that
 * folder as their `worktreePath` without storing it. A null there read as
 * "still setting up", so the Files view showed loading rows forever.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let q: typeof import('@/lib/db/queries');

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-execution-folder-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  q = await import('@/lib/db/queries');
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

function agent(name: string, isGit: boolean) {
  const cwd = path.join(home.root, name);
  fs.mkdirSync(cwd, { recursive: true });
  return q.createWorkspace({ name, cwd, isGit, baseBranch: isGit ? 'main' : null, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
}

describe('a non-git agent execution', () => {
  it("reports the agent's folder, and stores nothing", () => {
    const ws = agent('plain', false);
    const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Plain work' });

    expect(q.getChatSessionWithExecution(session.id)?.worktreePath).toBe(ws.cwd);
    expect(q.getExecution(execution.id)?.worktreePath).toBeNull();
  });

  it("follows the agent's folder when it moves, so a stale path can never be archived", () => {
    const ws = agent('before', false);
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Plain work' });
    const moved = path.join(home.root, 'after');
    fs.mkdirSync(moved);
    q.updateWorkspace(ws.id, { cwd: moved });

    expect(q.getChatSessionWithExecution(session.id)?.worktreePath).toBe(moved);
  });

  it('reports it in list reads too', () => {
    const ws = agent('listed', false);
    q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Listed work' });

    expect(q.listWorkspaceExecutions(ws.id).map((row) => row.worktreePath)).toEqual([ws.cwd]);
  });

  it('keeps a stored path (an import) as it is', () => {
    const ws = agent('imported', false);
    const elsewhere = path.join(home.root, 'imported-elsewhere');
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Imported', worktreePath: elsewhere });

    expect(q.getChatSessionWithExecution(session.id)?.worktreePath).toBe(elsewhere);
  });

  it('on another device reports no folder here, only the one prepared there', () => {
    const ws = agent('remote', false);
    const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Remote work' });
    const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Laptop', createdByApiKeyId: null });
    const laptop = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).device;
    q.createPlacement({ executionId: execution.id, deviceId: laptop.id, startReason: 'created', worktreePath: '/Users/laptop/remote' });

    const read = q.getChatSessionWithExecution(session.id);
    expect(read?.worktreePath).toBeNull();
    expect(read?.location).toMatchObject({ isHome: false, folder: '/Users/laptop/remote' });
  });
});

describe('a git agent execution', () => {
  it('reports no folder while its worktree is set up', () => {
    const ws = agent('repo', true);
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Git work' });

    expect(q.getChatSessionWithExecution(session.id)?.worktreePath).toBeNull();
  });

  it('reports its worktree once it has one', () => {
    const ws = agent('repo2', true);
    const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Git work' });
    const worktree = path.join(home.root, 'worktrees', 'repo2-a');
    q.updateExecution(execution.id, { worktreePath: worktree });

    expect(q.getChatSessionWithExecution(session.id)?.worktreePath).toBe(worktree);
  });
});
