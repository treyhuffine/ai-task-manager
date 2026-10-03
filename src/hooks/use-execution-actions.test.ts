import { describe, expect, it } from 'vitest';
import type { ChatSessionWithExecution } from '@/db/types';
import type { DiffStats, PrInfo, WorktreeStatus } from '@/lib/api/sessions';
import { deriveActionState } from './use-execution-actions';

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
