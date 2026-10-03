import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { describe, expect, it } from 'vitest';

import type { DiffStats, PrInfo, WorktreeStatus } from '@/lib/api/sessions';
import type { BranchSync } from '@/lib/workspaces/branch-sync';
import { baseInfo, deriveActionState } from './use-execution-actions';

const clean: WorktreeStatus = { dirty: false, untracked: [], modified: [], staged: [], ahead: 0, behind: 0 } as unknown as WorktreeStatus;

function session(overrides: Partial<ChatSessionWithExecution>): ChatSessionWithExecution {
  return {
    id: 'chat',
    status: 'active',
    worktreePath: null,
    location: null,
    setupError: null,
    prNumber: null,
    ...overrides,
  } as ChatSessionWithExecution;
}

const here = session({ worktreePath: '/home/worktrees/demo-1', location: { deviceId: 'mini', name: 'Mac Mini', isHome: true, folder: null } });
const elsewhere = session({ location: { deviceId: 'laptop', name: 'MacBook', isHome: false, folder: '/laptop/worktrees/demo-1' } });
const base = { workspaceIsGit: true, transfer: null, pushNonFastForward: false, pr: null, diffStats: null };

describe('the action bar follows the work (P3.3, P4.5)', () => {
  it('offers the controls for work on another device, as it does at home', () => {
    const dirty = { ...clean, modified: ['README.md'] } as WorktreeStatus;
    expect(deriveActionState({ ...base, session: here, status: dirty })).toMatchObject({ kind: 'dirty', unstaged: 1 });
    expect(deriveActionState({ ...base, session: elsewhere, status: dirty })).toMatchObject({ kind: 'dirty', unstaged: 1 });
    const ahead = { ...clean, ahead: 2 } as WorktreeStatus;
    expect(deriveActionState({ ...base, session: elsewhere, status: ahead })).toEqual({ kind: 'aheadNoPr', ahead: 2 });
  });

  it('has nothing to offer with no worktree anywhere, or outside Git', () => {
    expect(deriveActionState({ ...base, session: session({}), status: clean })).toEqual({ kind: 'noWorktree' });
    expect(deriveActionState({ ...base, session: elsewhere, workspaceIsGit: false, status: clean })).toEqual({ kind: 'noWorktree' });
    expect(deriveActionState({ ...base, session: session({ setupError: 'no remote' }), status: null })).toMatchObject({ kind: 'setupFailed' });
  });

  it('gives way to a move until the destination has the work', () => {
    const moving = { state: 'active' as const, ownershipChanged: false, to: { deviceId: 'laptop', name: 'MacBook' } };
    expect(deriveActionState({ ...base, session: here, transfer: moving, status: clean })).toEqual({ kind: 'moving', to: 'MacBook' });
    const arrived = { ...moving, ownershipChanged: true };
    expect(deriveActionState({ ...base, session: elsewhere, transfer: arrived, status: { ...clean, ahead: 1 } as WorktreeStatus })).toEqual({ kind: 'aheadNoPr', ahead: 1 });
  });
});

describe('a branch with work and no PR', () => {
  const changed: DiffStats = { files: 3, additions: 40, deletions: 2 };

  it('offers the push first, while commits sit ahead of the upstream', () => {
    const ahead = { ...clean, ahead: 4 } as WorktreeStatus;
    expect(deriveActionState({ ...base, session: here, status: ahead, diffStats: changed })).toEqual({ kind: 'aheadNoPr', ahead: 4 });
  });

  it('offers the PR once pushed, though the upstream now reads in sync', () => {
    // After the first push the upstream is the branch's own remote copy, so
    // ahead/behind are both zero. Only the diff against the base shows work.
    expect(deriveActionState({ ...base, session: here, status: clean, diffStats: changed })).toEqual({ kind: 'branchNoPr', files: 3 });
    expect(deriveActionState({ ...base, session: elsewhere, status: clean, diffStats: changed })).toEqual({ kind: 'branchNoPr', files: 3 });
  });

  it('stays quiet with nothing against the base, or before the totals arrive', () => {
    const none: DiffStats = { files: 0, additions: 0, deletions: 0 };
    expect(deriveActionState({ ...base, session: here, status: clean, diffStats: none })).toEqual({ kind: 'cleanNoBranch' });
    expect(deriveActionState({ ...base, session: here, status: clean, diffStats: undefined })).toEqual({ kind: 'cleanNoBranch' });
  });

  it('lets a found PR, a dirty tree or a moved base win', () => {
    const pr = { number: 402, url: 'https://github.com/o/r/pull/402', state: 'OPEN', mergeable: 'MERGEABLE' } as PrInfo;
    expect(deriveActionState({ ...base, session: here, status: clean, diffStats: changed, pr })).toMatchObject({ kind: 'prOpenInSync', prNumber: 402 });
    const dirty = { ...clean, modified: ['a.ts'] } as WorktreeStatus;
    expect(deriveActionState({ ...base, session: here, status: dirty, diffStats: changed })).toMatchObject({ kind: 'dirty' });
    const behind = { ...clean, behind: 5 } as WorktreeStatus;
    expect(deriveActionState({ ...base, session: here, status: behind, diffStats: changed })).toEqual({ kind: 'behindBase', behind: 5 });
  });
});

describe('reading the upstream for what it is (BranchSync)', () => {
  // Before the first push the branch tracks the base, after it its own remote copy.
  const unpushed: BranchSync = { upstream: 'origin/main', upstreamIsBase: true, base: 'origin/main', behindBase: 0 };
  const pushed: BranchSync = { upstream: 'origin/feat', upstreamIsBase: false, base: 'origin/main', behindBase: 5 };
  const at = (sync: BranchSync, counts: Partial<WorktreeStatus> = {}) => ({ ...clean, ...counts, sync }) as WorktreeStatus;
  const changed: DiffStats = { files: 3, additions: 40, deletions: 2 };
  const open = (extra: Partial<PrInfo> = {}) =>
    ({ number: 402, url: 'https://github.com/o/r/pull/402', state: 'OPEN', mergeable: 'MERGEABLE', outOfDate: false, ...extra }) as PrInfo;
  const derive = (status: WorktreeStatus, extra: { pr?: PrInfo; diffStats?: DiffStats } = {}) =>
    deriveActionState({ ...base, session: here, status, pr: extra.pr ?? null, diffStats: extra.diffStats ?? null });

  it('offers your push before a pull when the base moved, since being behind never blocks', () => {
    expect(derive(at(unpushed, { ahead: 4, behind: 2 }))).toEqual({ kind: 'aheadNoPr', ahead: 4 });
    expect(baseInfo(at(unpushed, { ahead: 4, behind: 2 }))).toEqual({ name: 'main', behind: 2 });
    // Nothing of its own yet: catching up is the only step.
    expect(derive(at(unpushed, { behind: 3 }))).toEqual({ kind: 'behindBase', behind: 3 });
  });

  it('offers the PR for a pushed branch, and says how far behind the base it is', () => {
    expect(derive(at(pushed), { diffStats: changed })).toEqual({ kind: 'branchNoPr', files: 3 });
    expect(baseInfo(at(pushed))).toEqual({ name: 'main', behind: 5 });
  });

  it("pulls what someone else pushed to the branch before anything else", () => {
    expect(derive(at(pushed, { behind: 2 }), { diffStats: changed })).toEqual({ kind: 'behindRemote', behind: 2, remote: 'origin' });
    // Both sides moved: still the pull first, which merges, then the push.
    expect(derive(at(pushed, { ahead: 1, behind: 2 }))).toMatchObject({ kind: 'behindRemote', behind: 2 });
    expect(derive(at(pushed, { behind: 1 }), { pr: open() })).toEqual({
      kind: 'behindRemote', behind: 1, remote: 'origin', pr: { prNumber: 402, prUrl: 'https://github.com/o/r/pull/402' },
    });
  });

  it('lets an open PR merge while behind the base, unless GitHub requires it up to date', () => {
    expect(derive(at(pushed), { pr: open() })).toMatchObject({ kind: 'prOpenInSync', prNumber: 402 });
    expect(derive(at(pushed), { pr: open({ outOfDate: true }) })).toMatchObject({ kind: 'prOpenBehindBase', behind: 5 });
    // Required update and unpushed work: bring the base in first, then one push carries both.
    expect(derive(at(pushed, { ahead: 2 }), { pr: open({ outOfDate: true }) })).toMatchObject({ kind: 'prOpenBehindBase' });
    expect(derive(at(pushed, { ahead: 2 }), { pr: open() })).toMatchObject({ kind: 'prOpenAhead', ahead: 2 });
    expect(derive(at(pushed), { pr: open({ mergeable: 'CONFLICTING' }) })).toMatchObject({ kind: 'prConflictingWithBase', behind: 5 });
  });

  it('settles a merged or closed PR before anything on the branch', () => {
    expect(derive(at(pushed, { behind: 3 }), { pr: open({ state: 'MERGED' }) })).toMatchObject({ kind: 'prMerged' });
    expect(derive(at(pushed, { ahead: 1 }), { pr: open({ state: 'CLOSED' }) })).toMatchObject({ kind: 'prClosed' });
  });

  it('reads an older device the old way, with the upstream taken as the base', () => {
    // No `sync`: behind wins before a PR, as it always did.
    expect(derive({ ...clean, ahead: 4, behind: 2 } as WorktreeStatus)).toEqual({ kind: 'behindBase', behind: 2 });
    expect(baseInfo({ ...clean, behind: 2 } as WorktreeStatus)).toBeNull();
  });
});
