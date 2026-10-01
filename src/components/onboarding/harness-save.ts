import { api } from '@/lib/api/client';
import { DEFAULT_EFFORT, defaultModelFor, harnessSupportsEffort } from '@/lib/harness/options';
import type { HarnessId } from '@/lib/harness/registry';
import type { EffortLevel } from '@/db/types';

interface HarnessListing {
  harnesses: { id: HarnessId; settings: { enabledModels: string[]; defaultModel: string | null } }[];
}

/**
 * Make a harness the one Ri runs on, the way the old wizard's launch did: its
 * default model (the one picked, else the harness's own) enabled and made the
 * default, the harness made active, user state's default tuple to match, and
 * the agent skill installed (every project on the web, the app's own folder in
 * the desktop app, decided by the server).
 *
 * Unlike the wizard, it keeps the models already enabled rather than narrowing
 * the list to one. Returns the tuple it saved, so the caller can start the
 * main chat over on it when the harness changed.
 */
export async function saveHarnessSetup(input: {
  harness: HarnessId;
  model?: string;
}): Promise<{ harness: HarnessId; model: string; effort: EffortLevel | null }> {
  const { harnesses } = await api.get<HarnessListing>('/harness/harnesses');
  const settings = harnesses.find((h) => h.id === input.harness)?.settings;
  const model = input.model ?? settings?.defaultModel ?? defaultModelFor(input.harness);
  const enabled = settings?.enabledModels ?? [];
  const effort: EffortLevel | null = harnessSupportsEffort(input.harness) ? DEFAULT_EFFORT : null;

  await api.put('/harness/models/enabled', {
    harness: input.harness,
    enabledModelIds: enabled.includes(model) ? enabled : [model, ...enabled],
    defaultModel: model,
    defaultEffort: effort,
    makeActive: true,
  });
  await api.patch('/user-state', { defaultHarness: input.harness, defaultModel: model, defaultEffort: effort });
  // The skill lets other agents manage tasks and notes. Ri itself works
  // without it, so a conflict (someone's own skill by that name) or a failed
  // install doesn't hold up setup. Settings, Models shows and retries it.
  await api.put('/harness/skills/global', { enabled: true }).catch((err) => {
    console.warn('[onboarding] the agent skill was not installed', err);
  });
  return { harness: input.harness, model, effort };
}
