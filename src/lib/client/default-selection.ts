import type { EffortLevel } from '@/db/types';
import { DEFAULT_EFFORT, defaultModelFor, harnessSupportsEffort } from '@/lib/harness/options';
import type { HarnessId } from '@/lib/harness/registry';
import { trpcClient } from '@/lib/trpc/client';

export interface DefaultSelection {
  harness: HarnessId;
  model: string;
  variant: string | null;
  effort: EffortLevel | null;
}

/**
 * Make a harness, model and effort the home's default: what new chats and
 * executions start on, and what background calls use (docs/default-selection.md).
 * The one way the default changes from the app, shared by first-run setup and
 * the "Make default" line in the model menus. Settings, Models goes through
 * the same route.
 *
 * The model is added to the harness's enabled models (never narrowing them),
 * made that harness's default, and the harness made active, which writes the
 * home's default tuple in the same transaction (`setActiveHarness`).
 */
export async function setDefaultSelection(input: {
  harness: HarnessId;
  model?: string;
  variant?: string | null;
  effort?: EffortLevel | null;
}): Promise<DefaultSelection> {
  const { harnesses } = await trpcClient.harness.harnessesGet.query({});
  const settings = harnesses.find((h) => h.id === input.harness)?.settings;
  const model = input.model ?? settings?.defaultModel ?? defaultModelFor(input.harness);
  const enabled = settings?.enabledModels ?? [];
  const effort: EffortLevel | null =
    input.effort !== undefined ? input.effort : harnessSupportsEffort(input.harness) ? DEFAULT_EFFORT : null;
  const variant = input.variant ?? null;

  await trpcClient.harness.modelsEnabledPut.mutate({body: {
    harness: input.harness,
    enabledModelIds: enabled.includes(model) ? enabled : [model, ...enabled],
    defaultModel: model,
    defaultVariant: variant,
    defaultEffort: effort,
    makeActive: true,
  }});
  return { harness: input.harness, model, variant, effort };
}
