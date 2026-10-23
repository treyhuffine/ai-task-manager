import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSessionWithExecution } from '@/db/types';
import { sessionFileLocation } from './file-location';

const state = vi.hoisted(() => ({ livesOn: null as unknown }));
vi.mock('@/lib/db/queries', () => ({ getWorkspace: () => ({ id: 'agent', cwd: '/home/agent' }) }));
vi.mock('@/lib/setups/run-on', () => ({ runOnFor: () => ({ livesOn: state.livesOn }) }));
beforeEach(() => { state.livesOn = null; });
const session = (patch: Partial<ChatSessionWithExecution>) => ({ workspaceId: 'agent', executionId: null, worktreePath: null, location: null, ...patch }) as ChatSessionWithExecution;

it('uses the execution folder and device, independently of where its agent lives', () => {
  state.livesOn = { folder: '/elsewhere/agent', name: 'Elsewhere', isHome: false };
  expect(sessionFileLocation(session({ executionId: 'run', worktreePath: '/worktree' }))).toEqual({ folder: '/worktree', elsewhere: null });
  expect(sessionFileLocation(session({ executionId: 'run', location: { deviceId: 'laptop', isHome: false, folder: '/remote/worktree', name: 'Laptop' } }))).toEqual({ folder: '/remote/worktree', elsewhere: 'Laptop' });
});
it('uses an agent main chat folder and keeps remote files on their own device', () => {
  expect(sessionFileLocation(session({}))).toEqual({ folder: '/home/agent', elsewhere: null });
  state.livesOn = { folder: '/laptop/agent', name: 'Laptop', isHome: false };
  expect(sessionFileLocation(session({}))).toEqual({ folder: '/laptop/agent', elsewhere: 'Laptop' });
  expect(sessionFileLocation(session({ workspaceId: null }))).toEqual({ folder: null, elsewhere: null });
});
