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
 * Nothing else. No harness checks or sessions of a person's own, schedules,
 * triggers, deck, history import, embeddings, markdown mirror, previews,
 * notifications or app runtimes: those belong to a person's home.
 */

export async function startTeamSpace(): Promise<void> {
  try {
    const { startAutoTunnel } = await import('@/lib/auth/auto-tunnel');
    startAutoTunnel();
  } catch (err) {
    console.warn('[auto-tunnel] init failed', err);
  }
  try {
    const { resumeTeamAiAfterStart } = await import('@/lib/team/ai/chat');
    resumeTeamAiAfterStart();
  } catch (err) {
    console.warn('[team ai] resume failed', err);
  }
}
