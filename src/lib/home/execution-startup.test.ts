import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', stop: vi.fn(), exit: vi.fn(), recover: vi.fn(), capabilities: vi.fn(), reap: vi.fn(), setup: vi.fn(), previews: vi.fn(), idle: vi.fn(), shutdown: vi.fn(), resume: vi.fn(), interrupt: vi.fn() }));
vi.mock('@/lib/config/paths', () => ({ getDbPath: () => fixture.root }));
vi.mock('@/lib/runner/harness-processes', async original => ({ ...await original<typeof import('@/lib/runner/harness-processes')>(), stopOrphanedHarnesses: fixture.stop, installHarnessExitHook: fixture.exit }));
vi.mock('@/lib/work-results/runtime', () => ({ recoverWorkResultOperations: fixture.recover, reconcileWorkResultCapabilities: fixture.capabilities }));
vi.mock('@/lib/db/queries', () => ({ reapStaleRunningRuns: fixture.reap, resetOrphanedSetupScripts: fixture.setup, interruptRunningTeamChatTurns: fixture.interrupt }));
vi.mock('@/lib/preview/pid-store', () => ({ sweepOrphans: fixture.previews }));
vi.mock('@/lib/preview/providers', () => ({}));
vi.mock('@/lib/preview/service', () => ({ startIdleEvictLoop: fixture.idle }));
vi.mock('@/lib/preview/shutdown', () => ({ installShutdownHook: fixture.shutdown }));
vi.mock('@/lib/executor/reconcile', () => ({ reconcileAllSessions: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/auto-tunnel', () => ({ startAutoTunnel: vi.fn() }));
vi.mock('@/lib/team/ai/chat', () => ({ resumeTeamAiAfterStart: fixture.resume, startTeamChatMaintenance: vi.fn() }));
import { executionRecoveryProblem, startHomeExecutionRuntime } from './execution-startup';
import { startTeamSpace } from '@/lib/team/startup';

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); fixture.root = crypto.randomUUID(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['stop', 'exit', 'recover', 'capabilities', 'reap', 'setup', 'previews', 'idle', 'shutdown'] as const)('contains %s cleanup failures for both Home startup paths', async key => {
  fixture[key].mockRejectedValueOnce(new Error('EMFILE'));
  const personal = await startHomeExecutionRuntime();
  expect(fixture.shutdown).toHaveBeenCalled();
  expect(personal.ready).toBe(!['stop', 'exit', 'recover', 'capabilities'].includes(key));
  fixture.root = crypto.randomUUID();
  fixture[key].mockRejectedValueOnce(new Error('EMFILE'));
  await expect(startTeamSpace()).resolves.toBeUndefined();
  expect(fixture.resume).toHaveBeenCalledTimes(personal.ready ? 1 : 0);
  expect(fixture.interrupt).toHaveBeenCalledTimes(personal.ready ? 0 : 1);
  if (!personal.ready) expect(executionRecoveryProblem()).toContain('EMFILE');
});

it('does not wait for a preview process to exit before the Home can serve', async () => {
  const sweep = Promise.withResolvers<void>();
  fixture.previews.mockReturnValueOnce(sweep.promise);
  await expect(startHomeExecutionRuntime()).resolves.toEqual({ ready: true, reason: null });
  expect(fixture.shutdown).toHaveBeenCalled();
  sweep.resolve();
});
