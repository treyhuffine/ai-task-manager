import { trpcClient } from '@/lib/trpc/client';

/**
 * Ri's skills (tasks and notes, the agent browser) for a new home, linked
 * into every harness's folder for skills in every project
 * (`src/lib/agent-skills/shipped.ts`). Called as the first-run conversation
 * opens, before any harness is picked, so whichever one gets used, or is
 * switched to later, already has them.
 *
 * Installed only when this home hasn't chosen: the machine-wide links are
 * shared by every Ri on the computer, so a home seeded not to install them
 * (an isolated test home, `pnpm iso --init`) must never take them over from
 * production's. The desktop app's copy is its own folder's, so it's always
 * (re)installed.
 *
 * Ri itself works without them, so a conflict (someone's own skill by that
 * name) or a failed install doesn't hold up setup. Settings shows them, in
 * Get started and External AI, with one-click install and uninstall
 * (`src/components/settings/agent-skill-access.tsx`).
 */
export async function installAgentSkill(): Promise<void> {
  try {
    const skill = await trpcClient.harness.skillsGlobalGet.query({});
    if (skill.configured && !skill.appOnly) return;
    await trpcClient.harness.skillsGlobalPut.mutate({ body: { enabled: true } });
  } catch (err) {
    console.warn('[onboarding] the agent skill was not installed', err);
  }
}
