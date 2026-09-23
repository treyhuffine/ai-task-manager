'use client';

/**
 * "Runs on": provider, model and effort for something that runs on a
 * schedule. A controlled picker built from the launcher's controls, so it
 * offers exactly the models and effort ladder a new execution would. Used by
 * a trigger's detail page (`TriggerRunsOn`) and by the heartbeat settings.
 *
 * Changing the model can switch provider, and that change always sends the
 * whole tuple (the picked model plus the effort resolved for it): the server
 * resets model and effort on a provider switch that doesn't restate them.
 */

import { useState } from 'react';
import { useHarnessModels } from '@/hooks/use-harness-models';
import {
  explicitEffortForModel,
  findProvider,
  harnessSupportsEffort,
} from '@/lib/harness/options';
import { readProviderEfforts } from '@/lib/executions/provider-effort';
import { ProviderIcon } from '@/components/settings/harness-connection-ui';
import { EffortControl, ModelControl } from '@/components/workspaces/launcher/launch-controls';
import type { EffortLevel } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';

export interface RunsOnValue {
  provider: HarnessId | null;
  /** Null means the provider's default model. */
  model: string | null;
  /** Null means the model's default effort. */
  effort: EffortLevel | null;
}

export interface RunsOnChange {
  provider?: HarnessId;
  model?: string | null;
  effort?: EffortLevel | null;
}

export function RunsOnPicker({
  value,
  onChange,
  disabled,
  error,
}: {
  value: RunsOnValue;
  onChange: (change: RunsOnChange) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  // Lazy init is safe: this only renders on the client after data loads, so
  // there is no server render for localStorage to disagree with.
  const [efforts] = useState<Record<string, EffortLevel>>(readProviderEfforts);
  const { provider, model, effort: savedEffort } = value;
  const { models } = useHarnessModels(provider ?? undefined);

  if (!provider) {
    return (
      <p className="text-sm text-muted-foreground">
        Runs on a provider this version doesn&apos;t recognize.
      </p>
    );
  }

  const selectedModelOption = model ? models.find((m) => m.id === model) ?? null : null;
  // A null effort means "the model's default", so show that rather than an
  // empty control.
  const effort: EffortLevel | null =
    savedEffort
    ?? (selectedModelOption && harnessSupportsEffort(provider)
      ? explicitEffortForModel(provider, selectedModelOption, null)
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
          onChange={(next) => onChange({ provider: next.harness, model: next.model, effort: next.effort })}
          disabled={disabled}
        />
        <EffortControl
          harness={provider}
          model={selectedModelOption}
          effort={effort}
          onChange={(next) => onChange({ effort: next })}
          disabled={disabled}
        />
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
