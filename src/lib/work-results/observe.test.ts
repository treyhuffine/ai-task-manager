import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  session: { userId: 'local', executionId: 'execution' },
  execution: { id: 'execution', userId: 'local', workspaceId: 'agent', worktreePath: '/authorized-work' },
  workspace: { isGit: true },
  open: vi.fn(), worker: vi.fn(),
  placement: null as null | { deviceId: string; generation: number; worktreePath: string },
}));
vi.mock('@/lib/db/queries', () => ({
  getChatSession: () => fixture.session,
  getExecution: () => fixture.execution,
  getWorkspace: () => fixture.workspace,
  placementOf: () => fixture.placement, getHome: () => ({ hostDeviceId: 'home' }),
}));
vi.mock('@/lib/workers/hub', () => ({ requestWorker: fixture.worker }));
vi.mock('@/lib/workspaces', () => ({ openFolderHandle: fixture.open }));

import { observeWorkResultCodeRevision, observeWorkResultExecutionCodeRevision } from './observe';

beforeEach(() => {
  fixture.placement = null;
  fixture.worker.mockReset();
  fixture.session.userId = fixture.execution.userId = 'local';
  fixture.open.mockReset().mockResolvedValue({ kind: 'git', git: {
    raw: async () => ({ stdout: 'verified-head\n' }),
    status: async () => ({ dirty: false }),
  } });
});

it.each(['session', 'execution'] as const)('rejects foreign %s ownership before execution computer access', async (boundary) => {
  fixture[boundary].userId = 'another-owner';
  await expect(observeWorkResultCodeRevision('source', 'local')).rejects.toMatchObject({ code: 'not_found' });
  expect(fixture.open).not.toHaveBeenCalled();
});

it('observes the authorized execution through its existing folder handle', async () => {
  await expect(observeWorkResultCodeRevision('source', 'local')).resolves.toMatchObject({
    commitSha: 'verified-head', workingTreeState: 'clean',
  });
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith('/authorized-work');
});

it('rejects a foreign retained execution before accessing its computer', async () => {
  fixture.execution.userId = 'another-owner';
  await expect(observeWorkResultExecutionCodeRevision('execution', 'local')).rejects.toMatchObject({ code: 'not_found' });
  expect(fixture.open).not.toHaveBeenCalled();
});

it('observes a retained execution directly without depending on a source conversation', async () => {
  fixture.session.userId = 'another-owner';
  await expect(observeWorkResultExecutionCodeRevision('execution', 'local')).resolves.toMatchObject({
    commitSha: 'verified-head', workingTreeState: 'clean',
  });
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith('/authorized-work');
});


it('observes remote code through the owning worker without opening its recorded path at home', async () => {
  fixture.placement = { deviceId: 'laptop', generation: 2, worktreePath: '/authorized-work' };
  fixture.worker.mockResolvedValue({ status: 200, body: { head: 'remote-head', changed: [], untracked: [], localOnly: [] } });
  await expect(observeWorkResultExecutionCodeRevision('execution', 'local')).resolves.toMatchObject({ commitSha: 'remote-head', workingTreeState: 'clean' });
  expect(fixture.open).not.toHaveBeenCalled();
  expect(fixture.worker).toHaveBeenCalledWith('laptop', 'read_execution', expect.objectContaining({ executionId: 'execution', read: { kind: 'working_state' } }));
});

it('does not promote a remote observation after its placement changes or the worker is unavailable', async () => {
  fixture.placement = { deviceId: 'laptop', generation: 2, worktreePath: '/authorized-work' };
  fixture.worker.mockImplementation(async () => { fixture.placement!.generation++; return { status: 200, body: { head: 'old-head', changed: [], untracked: [], localOnly: [] } }; });
  await expect(observeWorkResultExecutionCodeRevision('execution', 'local')).resolves.toMatchObject({ commitSha: null, workingTreeState: 'unknown' });
  fixture.worker.mockRejectedValue(new Error('offline'));
  await expect(observeWorkResultExecutionCodeRevision('execution', 'local')).resolves.toMatchObject({ commitSha: null, workingTreeState: 'unknown' });
  expect(fixture.open).not.toHaveBeenCalled();
});
