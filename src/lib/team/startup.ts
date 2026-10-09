/**
 * What a team space starts with its server (docs/homes-spec.md §9.1, §9.2,
 * P6.3). The personal boot in `instrumentation.ts` stops before any of its
 * own work for a team, so this is the whole list:
 *
 * - The reachable address, when its host chose to keep one open: teammates
 *   reach the team there, and invitations name it. Not AI, no personal data.
 *
 * Nothing else. No harness checks or sessions, schedules, triggers, deck,
 * history import, embeddings, markdown mirror, previews, notifications or
 * app runtimes: a team runs without AI, and those belong to a person's home.
 */

export async function startTeamSpace(): Promise<void> {
  try {
    const { startAutoTunnel } = await import('@/lib/auth/auto-tunnel');
    startAutoTunnel();
  } catch (err) {
    console.warn('[auto-tunnel] init failed', err);
  }
}
