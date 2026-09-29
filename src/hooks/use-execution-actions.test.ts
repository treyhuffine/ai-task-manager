import { describe, expect, it } from 'vitest';
import type { ChatSessionWithExecution } from '@/db/types';
import type { WorktreeStatus } from '@/lib/api/sessions';
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
const base = { workspaceIsGit: true, transfer: null, pushNonFastForward: false, pr: null };

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
