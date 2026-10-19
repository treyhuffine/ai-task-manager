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
 * Make a harness, model and effort the global default model: what new
 * chats and executions start on, and what background calls use
 * (docs/default-selection.md). The one way the default changes from the app,
 * shared by Settings' "Default model", first-run setup and the "Make
 * default" line in the model menus. A harness's own default is a separate
 * setting and stays as it is.
 *
 * Without a model (first-run setup naming only the harness), it starts from
 * that harness's own default.
 */
export async function setDefaultSelection(input: {
  harness: HarnessId;
  model?: string;
  variant?: string | null;
  effort?: EffortLevel | null;
}): Promise<DefaultSelection> {
  let model = input.model;
  if (!model) {
    const { harnesses } = await trpcClient.harness.harnessesGet.query({});
    model = harnesses.find((h) => h.id === input.harness)?.settings.defaultModel ?? defaultModelFor(input.harness);
  }
  const effort: EffortLevel | null =
    input.effort !== undefined ? input.effort : harnessSupportsEffort(input.harness) ? DEFAULT_EFFORT : null;
  return trpcClient.harness.defaultPut.mutate({
    body: { harness: input.harness, model, variant: input.variant ?? null, effort },
  });
}
