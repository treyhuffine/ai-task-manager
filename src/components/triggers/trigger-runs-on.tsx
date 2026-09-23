'use client';

/**
 * "Runs on" for an existing trigger: provider, model and effort, each change
 * saved as it's picked. Reuses the launcher's controls, so a trigger offers
 * exactly the models and effort ladder a new execution would.
 *
 * Changing provider sends the whole tuple (the picked model plus the effort
 * resolved for it), because `update_trigger` resets model and effort on a
 * provider switch that doesn't restate them. App-managed triggers are editable
 * here too: provider, model and effort sit outside their locked fields.
 */

import { useState } from 'react';
import { useUpdateTrigger } from '@/hooks/use-triggers';
import { useHarnessModels } from '@/hooks/use-harness-models';
import {
  explicitEffortForModel,
  findProvider,
  harnessSupportsEffort,
} from '@/lib/harness/options';
import { readProviderEfforts } from '@/lib/executions/provider-effort';
import { ProviderIcon } from '@/components/settings/harness-connection-ui';
import { EffortControl, ModelControl } from '@/components/workspaces/launcher/launch-controls';
import type { EffortLevel, TriggerView } from '@/db/types';

export function TriggerRunsOn({ trigger }: { trigger: TriggerView }) {
  const update = useUpdateTrigger();
  // Lazy init is safe here: this only renders once the trigger has loaded on
  // the client, so there is no server render for localStorage to disagree with.
  const [efforts] = useState<Record<string, EffortLevel>>(readProviderEfforts);

  // Show the pick while it saves, not the stale row.
  const pending = update.isPending ? update.variables : undefined;
  const provider = pending?.provider ?? trigger.provider;
  const model = pending?.model !== undefined ? pending.model : trigger.model;
  const savedEffort = pending?.effort !== undefined ? pending.effort : trigger.effort;

  const { models } = useHarnessModels(provider);

  if (!provider) {
    return (
      <p className="text-sm text-muted-foreground">
        Runs on an agent this version of Ri doesn&apos;t recognize.
      </p>
    );
  }

  const selectedModelOption = model ? models.find((m) => m.id === model) ?? null : null;
  const harnessKey = provider;
  // A null effort means "the model's default", so show that rather than an
  // empty control.
  const effort: EffortLevel | null =
    savedEffort
    ?? (selectedModelOption && harnessSupportsEffort(harnessKey)
      ? explicitEffortForModel(harnessKey, selectedModelOption, null)
      : null);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 text-sm">
          <ProviderIcon id={provider} size={13} />
          {findProvider(provider)?.name ?? provider}
        </span>
        <ModelControl
          selection={{ harness: provider, model: model ?? '' }}
          label={selectedModelOption?.label ?? model ?? 'Default model'}
          rememberedEfforts={efforts}
          onChange={(next) =>
            update.mutate({
              id: trigger.id,
              provider: next.harness,
              model: next.model,
              effort: next.effort,
            })
          }
          disabled={update.isPending}
        />
        <EffortControl
          harness={provider}
          model={selectedModelOption}
          effort={effort}
          onChange={(next) => update.mutate({ id: trigger.id, effort: next })}
          disabled={update.isPending}
        />
      </div>
      {update.error && (
        <p className="text-[12px] text-destructive">{(update.error as Error).message}</p>
      )}
    </div>
  );
}
