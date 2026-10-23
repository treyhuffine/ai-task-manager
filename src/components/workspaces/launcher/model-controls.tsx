'use client';

import { useState } from 'react';
import { Cpu } from 'lucide-react';
import { MakeDefaultRow } from '@/components/settings/make-default-row';
import type { ModelSelection } from '@/components/settings/model-list';
import { VisibleModelOptions } from '@/components/settings/visible-model-options';
import { ModelMenuContent, ModelMenuLabel } from '@/components/chat-ui/model-menu/model-menu';
import { useSettingsLink } from '@/components/settings/settings-destination';
import { useHomeStorageScope } from '@/components/home/home-context';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import type { EffortLevel } from '@/db/types';
import { useDefaultSelection } from '@/hooks/use-default-selection';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { effortOptionsForModel, explicitEffortForModel, explicitVariantForModel, harnessSupportsEffort, type ModelOption, type ProviderId } from '@/lib/harness/options';
import { serviceTierForModel, serviceTierOptions } from '@/lib/harness/service-tiers';
import { readProviderSpeed } from '@/lib/executions/provider-speed';
import { LauncherPopoverContent } from './launcher-popover';

const TRIGGER_CLASS = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none';

export interface LaunchHarnessSelection {
  harness: ProviderId;
  model: string;
  variant: string | null;
  effort: EffortLevel | null;
  serviceTier?: string | null;
}

/**
 * Model picker. Simpler than the composer's equivalent: there's no session
 * to take over yet, so every provider is a plain pick with no "this starts
 * a new chat" confirm.
 */
export function ModelControl({
  selection,
  label,
  rememberedEfforts,
  onChange,
  disabled,
  variant,
  effort,
  serviceTier,
  onEffortChange,
}: {
  selection: ModelSelection;
  label: string;
  /** The launch's variant and effort, carried along if it's made the default. */
  variant?: string | null;
  effort?: EffortLevel | null;
  serviceTier?: string | null;
  onEffortChange: (effort: EffortLevel) => void;
  /** Per-provider effort the user last chose, applied when switching to it. */
  rememberedEfforts?: Record<string, EffortLevel>;
  onChange: (next: LaunchHarnessSelection) => void;
  disabled?: boolean;
}) {
  const manageModels = useSettingsLink('models');
  const storageScope = useHomeStorageScope();
  const [open, setOpen] = useState(false);
  const defaultSelection = useDefaultSelection();
  const { models } = useHarnessModels(selection.harness);
  const currentModel = models.find(model => model.id === selection.model) ?? null;
  const effortOptions = effortOptionsForModel(selection.harness, currentModel);
  const effortLabel = effortOptions.find(option => option.id === effort)?.label;
  const speedOptions = serviceTierOptions(currentModel);
  // An omitted value initializes a new draft. Explicit NULL is a saved
  // legacy selection that still inherits the native provider setting.
  const speed = serviceTier === undefined ? serviceTierForModel(currentModel) : serviceTier;

  const handlePick = (harness: ProviderId, model: ModelOption) => {
    const harnessKey = harness;
    // Resolved here rather than in the caller because this is the only place
    // holding the picked ModelOption — `explicitEffortForModel` needs it to
    // check the remembered value against what this model actually supports,
    // falling back to the model's own default when it doesn't.
    onChange({
      harness,
      model: model.id,
      variant: explicitVariantForModel(model, null),
      serviceTier: serviceTierForModel(model, harness === selection.harness ? speed : readProviderSpeed(harness, storageScope)),
      effort: harnessSupportsEffort(harnessKey)
        ? explicitEffortForModel(harnessKey, model, rememberedEfforts?.[harness] ?? null)
        : null,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Tip label="Choose a model and adjust its settings">
          <button
            type="button"
            aria-label={`Model and settings: ${label}${effortLabel ? `, ${effortLabel} effort` : ''}`}
            disabled={disabled}
            className={TRIGGER_CLASS}
          >
            <Cpu size={11} className="text-primary/70" />
            <ModelMenuLabel model={label} effort={effortLabel} speed={speed ?? undefined} />
          </button>
        </Tip>
      </PopoverTrigger>
      {/* Scrolling + height capping live in LauncherPopoverContent, which also
          renders in-tree so the dialog's scroll lock doesn't eat wheel events. */}
      <LauncherPopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-1rem)] p-0"
      >
        <ModelMenuContent
          key={open ? 'open' : 'closed'}
          effort={effort}
          speed={{
            value: speed,
            modes: speedOptions.map(option => option.id),
            options: speedOptions,
            onChange: tier => {
              onChange({ harness: selection.harness, model: selection.model, variant: variant ?? null, effort: effort ?? null, serviceTier: tier });
              setOpen(false);
            },
          }}
          efforts={effortOptions}
          onEffortChange={(level) => {
            onEffortChange(level);
            setOpen(false);
          }}
          variant={currentModel?.variants?.length ? {
            value: variant ?? null,
            options: currentModel.variants,
            onChange: (id) => {
              onChange({ harness: selection.harness, model: selection.model, variant: id, effort: effort ?? null, serviceTier: speed });
              setOpen(false);
            },
          } : undefined}
          disabled={disabled}
          onManageModels={manageModels ? () => {
            setOpen(false);
            manageModels();
          } : undefined}
          footer={defaultSelection?.harness === selection.harness && defaultSelection.model === selection.model && (defaultSelection.serviceTier ?? null) === (speed ?? null)
            ? undefined
            : <MakeDefaultRow current={{ harness: selection.harness, model: selection.model, variant, effort, serviceTier: speed }} />}
        >
          <VisibleModelOptions
            currentProvider={selection.harness}
            model={selection.model}
            onPick={handlePick}
            defaultSelection={defaultSelection}
            markProviderSwitches={false}
            disabled={disabled}
          />
        </ModelMenuContent>
      </LauncherPopoverContent>
    </Popover>
  );
}
