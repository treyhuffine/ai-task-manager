/** Recovery and process hygiene shared by both Home kinds. Never replays a send. */
import { getDbPath } from '@/lib/config/paths';
import { processState } from '@/lib/process-state';
import { perfScope } from '@/lib/perf/recorder';

const recovery = processState('runner:startup-recovery', () => new Map<string, string>());
export function executionRecoveryProblem() { return recovery.get(getDbPath()) ?? null; }

/** Optional cleanup never prevents the Home serving content. Known surviving
 * process records quarantine their chats. Unreadable or otherwise unsafe
 * recovery disables AI until a successful startup retry. */
export async function startHomeExecutionRuntime() {
  const root = getDbPath();
  recovery.delete(root);
  async function step(name: string, action: () => unknown | Promise<unknown>, requiredForAi = false) {
    try { await action(); }
    catch (error) {
      console.warn(`[runner] ${name} failed`, error);
      if (requiredForAi && !recovery.has(root)) recovery.set(root, `AI is unavailable because ${name} failed. Restart Ri after fixing the problem. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await step('stopping leftover harnesses', async () => {
    const { stopOrphanedHarnesses, HarnessProcessRecoveryError } = await import('@/lib/runner/harness-processes');
    try { await stopOrphanedHarnesses(); }
    catch (error) {
      if (!(error instanceof HarnessProcessRecoveryError)) throw error;
      const { setCloseUnconfirmed } = await import('@/lib/runner/local-runner');
      for (const problem of error.problems) setCloseUnconfirmed(problem.chatId, true, problem.message);
    }
  }, true);
  await step('installing harness exit cleanup', async () => (await import('@/lib/runner/harness-processes')).installHarnessExitHook(), true);
  await step('recovering result operations', async () => (await import('@/lib/work-results/runtime')).recoverWorkResultOperations(), true);
  await step('reconciling result capabilities', async () => (await import('@/lib/work-results/runtime')).reconcileWorkResultCapabilities(), true);
  await step('settling interrupted runs', async () => (await import('@/lib/db/queries')).reapStaleRunningRuns());
  await step('resetting setup scripts', async () => (await import('@/lib/db/queries')).resetOrphanedSetupScripts());
  void step('stopping leftover previews', async () => (await import('@/lib/preview/pid-store')).sweepOrphans());
  await step('registering preview providers', async () => { await import('@/lib/preview/providers'); });
  await step('starting preview cleanup', async () => (await import('@/lib/preview/service')).startIdleEvictLoop());
  await step('installing preview exit cleanup', async () => (await import('@/lib/preview/shutdown')).installShutdownHook());
  const timers = processState('runner:idle-sweeps', () => new Map<string, ReturnType<typeof setInterval>>());
  if (!timers.has(root)) {
    const timer = setInterval(() => {
      void perfScope('timer:idle-sessions', async () => {
        await (await import('@/lib/executor/adapter')).closeIdleSessions();
      }).catch(error => console.warn('[runner] idle cleanup failed', error));
    }, 60_000);
    timer.unref?.();
    timers.set(root, timer);
  }
  return { ready: !recovery.has(root), reason: recovery.get(root) ?? null };
}
