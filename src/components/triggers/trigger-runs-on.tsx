'use client';

/**
 * "Runs on" for an existing trigger: provider, model and effort, each change
 * saved as it's picked through `update_trigger`. App-managed triggers are
 * editable here too: provider, model and effort sit outside their locked
 * fields. The controls themselves live in `RunsOnPicker`.
 */

import { useUpdateTrigger } from '@/hooks/use-triggers';
import type { TriggerView } from '@/db/types';
import { RunsOnPicker } from './runs-on-picker';

export function TriggerRunsOn({ trigger }: { trigger: TriggerView }) {
  const update = useUpdateTrigger();

  // Show the pick while it saves, not the stale row.
  const pending = update.isPending ? update.variables : undefined;
  return (
    <RunsOnPicker
      value={{
        provider: pending?.provider ?? trigger.provider,
        model: pending?.model !== undefined ? pending.model : trigger.model,
        effort: pending?.effort !== undefined ? pending.effort : trigger.effort,
      }}
      onChange={(change) => update.mutate({ id: trigger.id, ...change })}
      disabled={update.isPending}
      error={update.error ? (update.error as Error).message : null}
    />
  );
}
