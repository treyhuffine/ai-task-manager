import { api } from '@/lib/api/client';
import { setDefaultSelection } from '@/lib/client/default-selection';
import type { HarnessId } from '@/lib/harness/registry';
import type { EffortLevel } from '@/db/types';

/**
 * Make a harness the one Ri runs on, from first-run setup: its default model
 * (the one picked, else the harness's own) made the home's default the same
 * way the model menus' "Make default" does (`setDefaultSelection`), plus the
 * agent skill installed unless this home already chose (`installAgentSkill`).
 * Returns the tuple it saved, so the caller can start the main chat over on
 * it when the harness changed.
 */
export async function saveHarnessSetup(input: {
  harness: HarnessId;
  model?: string;
}): Promise<{ harness: HarnessId; model: string; effort: EffortLevel | null }> {
  const saved = await setDefaultSelection({ harness: input.harness, model: input.model });
  await installAgentSkill();
  return { harness: saved.harness, model: saved.model, effort: saved.effort };
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
    const skill = await api.get<{ configured: boolean; appOnly?: boolean }>('/harness/skills/global');
    if (skill.configured && !skill.appOnly) return;
    await api.put('/harness/skills/global', { enabled: true });
  } catch (err) {
    console.warn('[onboarding] the agent skill was not installed', err);
  }
}
