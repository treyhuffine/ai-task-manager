import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSessionWithExecution, ExecutionRecord, WorkspaceRecord } from '@/db/types';
const state = vi.hoisted(() => ({ isHome: true, placement: null as null | { deviceId: string; worktreePath: string | null } }));
vi.mock('@/lib/db/queries', () => ({
  chatPlacement: () => ({ isHome: state.isHome }),
  placementOf: () => state.placement,
  getHome: () => ({ hostDeviceId: 'home-device' }),
}));
import { localWorkResultSourceFolder } from './source-location';
beforeEach(() => { state.isHome = true; state.placement = null; });
const session = { id: 'chat', worktreePath: '/same/path', executionId: 'execution' } as ChatSessionWithExecution;
const execution = { id: 'execution', worktreePath: '/same/path' } as ExecutionRecord;
const workspace = { cwd: '/agent-folder' } as WorkspaceRecord;

it('refuses remote source paths even when the same literal path exists on the home', () => {
  state.isHome = false;
  expect(localWorkResultSourceFolder(session, execution, workspace)).toBeNull();
  state.isHome = true;
  state.placement = { deviceId: 'other-device', worktreePath: '/same/path' };
  expect(localWorkResultSourceFolder(session, execution, workspace)).toBeNull();
});

it('uses the local placement, then local source and associated agent fallbacks', () => {
  state.placement = { deviceId: 'home-device', worktreePath: '/placed/path' };
  expect(localWorkResultSourceFolder(session, execution, workspace)).toBe('/placed/path');
  state.placement = null;
  expect(localWorkResultSourceFolder(session, execution, workspace)).toBe('/same/path');
  expect(localWorkResultSourceFolder(undefined, undefined, workspace)).toBe('/agent-folder');
  expect(localWorkResultSourceFolder({ ...session, worktreePath: null }, null, workspace)).toBeNull();
});
