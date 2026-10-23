/**
 * What a team space starts with its server (docs/homes-spec.md §9.1, §9.2,
 * §9.9, P6.3, P8.5). The personal boot in `instrumentation.ts` stops before
 * any of its own work for a team, so this is the whole list:
 *
 * - The reachable address, when its host chose to keep one open: teammates
 *   reach the team there, and invitations name it. Not AI, no personal data.
 * - Team AI's chats, when its owner turned it on: a turn left running by a
 *   stop is marked interrupted, never rerun, and turns still waiting go on.
 *   Nothing runs unless a member asked for it.
 *
 * Shared runner recovery and idle cleanup also run here. No personal schedules,
 * triggers, deck, history import, embeddings, markdown mirror,
 * notifications or app runtimes: those belong to a person's home.
 */

export async function startTeamSpace(): Promise<void> {
  try {
    const { startAutoTunnel } = await import('@/lib/auth/auto-tunnel');
    startAutoTunnel();
  } catch (err) {
    console.warn('[auto-tunnel] init failed', err);
  }
  // A failed recovery disables AI, while tasks, notes and history still serve.
  const recovery = await (await import('@/lib/home/execution-startup')).startHomeExecutionRuntime();
  if (!recovery.ready) {
    (await import('@/lib/db/queries')).interruptRunningTeamChatTurns();
    return;
  }
  const { resumeTeamAiAfterStart } = await import('@/lib/team/ai/chat');
  resumeTeamAiAfterStart();
  const { perfScope } = await import('@/lib/perf/recorder');
  void perfScope('startup:team-reconcile', async () => (await import('@/lib/executor/reconcile')).reconcileAllSessions({ redispatchOrphans: false, teamOnly: true }))
    .catch(error => console.warn('[team] transcript recovery failed', error));
  (await import('@/lib/team/ai/chat')).startTeamChatMaintenance();
}
