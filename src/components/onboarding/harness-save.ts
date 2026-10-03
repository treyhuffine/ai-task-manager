import type { EffortLevel } from '@/db/types';
import { setDefaultSelection, type DefaultSelection } from '@/lib/client/default-selection';
import type { HarnessId } from '@/lib/harness/registry';
import { trpcClient } from '@/lib/trpc/client';

/**
 * Make a harness the one Ri runs on, from first-run setup: its default model
 * (the one picked, else the harness's own) and effort (the one picked, else
 * the harness's usual) made the home's default the same way the model menus'
 * "Make default" does (`setDefaultSelection`), plus the agent skill installed
 * unless this home already chose (`installAgentSkill`). Returns the tuple it
 * saved, so the caller can start the main chat over on it when it changed.
 */
export async function saveHarnessSetup(input: {
  harness: HarnessId;
  model?: string;
  variant?: string | null;
  effort?: EffortLevel | null;
}): Promise<DefaultSelection> {
  const saved = await setDefaultSelection(input);
  await installAgentSkill();
  return saved;
}

/**
 * The skill that lets other agents manage tasks and notes. Installed only
 * when this home hasn't chosen: the machine-wide copy is shared by every Ri
 * on the computer, so a home seeded not to install it (an isolated test home,
 * `pnpm iso --init`) must never take it over from production's. The desktop
 * app's copy is its own folder's, so it's always (re)installed.
 *
 * Ri itself works without it, so a conflict (someone's own skill by that
 * name) or a failed install doesn't hold up setup. Settings, Models shows
 * and retries it.
 */
async function installAgentSkill(): Promise<void> {
  try {
    const skill = await trpcClient.harness.skillsGlobalGet.query({});
    if (skill.configured && !skill.appOnly) return;
    await trpcClient.harness.skillsGlobalPut.mutate({body: { enabled: true }});
  } catch (err) {
    console.warn('[onboarding] the agent skill was not installed', err);
  }
}
