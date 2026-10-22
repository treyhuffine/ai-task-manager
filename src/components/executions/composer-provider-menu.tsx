'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Cpu, MessageSquarePlus, Loader2 } from 'lucide-react';
import {
  effortOptionsForModel,
  explicitEffortForModel,
  explicitVariantForModel,
  harnessSupportsEffort,
  findProvider,
  type ModelOption,
  type ProviderId,
} from '@/lib/harness/options';
import type { EffortLevel } from '@/db/types';
import { useHarnessModels } from '@/hooks/use-harness-models';
import type { ModelSelection } from '@/components/settings/model-list';
import {
  ModelMenuContent,
  ModelMenuLabel,
} from '@/components/chat-ui/model-menu/model-menu';
import { VisibleModelOptions } from '@/components/settings/visible-model-options';
import { MakeDefaultRow } from '@/components/settings/make-default-row';
import { useDefaultSelection } from '@/hooks/use-default-selection';
import { ProviderIcon } from '@/components/settings/harness-connection-ui';
import { openSettings } from '@/components/settings/settings-store';
import { readProviderEffort } from '@/lib/executions/provider-effort';
import { readProviderSpeed } from '@/lib/executions/provider-speed';
import { serviceTierForModel, serviceTierOptions } from '@/lib/harness/service-tiers';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';

interface ComposerProviderMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This session's provider (composer harness, mapped to provider vocab). */
  currentProvider: ProviderId;
  /** This session's explicit model id. */
  model: string;
  fallbackLabel: string;
  /** Pick a model within the *current* provider — updates this session. */
  onSelectModel: (id: string) => void;
  /** Switch to a *different* provider — starts a fresh chat on it. */
  onSwitchProvider?: (next: {
    harness: ProviderId;
    model: string;
    variant?: string;
    effort?: EffortLevel;
    serviceTier?: string;
  }) => void;
  /** False when this harness requires a fresh chat for model changes. */
  canChangeModel?: boolean;
  /** A provider switch (new chat) is in flight. */
  switching?: boolean;
  disabled?: boolean;
  /** This session's variant and effort, carried along if it's made the default. */
  variant?: string | null;
  effort?: EffortLevel | null;
  serviceTier?: string | null;
  onSelectSpeed?: (tier: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  onSelectVariant: (variant: string) => void;
  /** Changing these controls is paused while a turn or selection save runs. */
  selectionDisabled?: boolean;
  /** Surfaces without a provider-switch action only offer the current harness. */
  currentProviderOnly?: boolean;
}

/**
 * The composer's searchable menu uses the saved visible models from connected
 * harnesses, with effort and variants in the same panel. Picking a model in the current provider pins it on this
 * session immediately. Picking a model in a *different* provider can't change
 * this session mid-stream (the agents can't resume each other), so the list is
 * REPLACED by a focused confirm (provider icon + explanation + Start new chat /
 * Back) that starts a **fresh chat** on that provider — an unmissable takeover
 * rather than a CTA appended below a scrolling list. Other-provider groups are
 * flagged "new chat" in the list so the switch is expected before the click.
 * Settings owns the full catalog, visibility controls and connection setup.
 */
export function ComposerProviderMenu({
  open,
  onOpenChange,
  currentProvider,
  model,
  fallbackLabel,
  onSelectModel,
  onSwitchProvider,
  canChangeModel = true,
  switching,
  disabled,
  variant,
  effort,
  serviceTier,
  onSelectSpeed,
  onSelectEffort,
  onSelectVariant,
  selectionDisabled,
  currentProviderOnly,
}: ComposerProviderMenuProps) {
  const [pending, setPending] = useState<ModelSelection | null>(null);
  const defaultSelection = useDefaultSelection();
  const { models: currentModels } = useHarnessModels(currentProvider);
  const currentModel =
    currentModels.find((option) => option.id === model) ?? null;
  const efforts = effortOptionsForModel(currentProvider, currentModel);
  const speedOptions = serviceTierOptions(currentModel);
  const effortLabel =
    efforts.find((option) => option.id === effort)?.label ?? effort;
  const modelSelectionDisabled = disabled || (selectionDisabled && !onSwitchProvider);

  const reset = (next: boolean) => {
    if (!next) setPending(null);
    onOpenChange(next);
  };

  const handlePick = (harness: ProviderId, modelOption: ModelOption) => {
    if (modelSelectionDisabled) return;
    if (harness === currentProvider && (canChangeModel || !onSwitchProvider)) {
      onSelectModel(modelOption.id);
      reset(false);
    } else {
      // Cross-provider: stage it; confirming starts a fresh chat.
      setPending({ harness, model: modelOption.id });
    }
  };

  const selected: ModelSelection = pending ?? {
    harness: currentProvider,
    model,
  };
  const pendingProvider = pending ? findProvider(pending.harness) : null;
  const { models: pendingModels } = useHarnessModels(pending?.harness);
  const pendingModel = pending
    ? (pendingModels.find((candidate) => candidate.id === pending.model) ??
      null)
    : null;
  const pendingModelLabel = pendingModel?.label ?? pending?.model ?? null;
  const changingWithinProvider = pending?.harness === currentProvider;

  return (
    <Popover open={open} onOpenChange={reset}>
      <PopoverTrigger asChild>
        <Tip label="Choose a model and adjust its settings">
          <button
            type="button"
            aria-label={`Model and settings: ${fallbackLabel}${effortLabel ? `, ${effortLabel} effort` : ''}`}
            disabled={disabled}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
              'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              'disabled:opacity-50',
            )}
          >
            <Cpu size={11} className="text-primary/70" />
            <ModelMenuLabel model={fallbackLabel} effort={effortLabel} speed={serviceTier ?? undefined} />
          </button>
        </Tip>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        {pending && pendingProvider ? (
          // Cross-provider pick can't change this session mid-stream, so the
          // list is REPLACED by a focused confirm — there's nothing else to
          // click, so the action can't be missed or scrolled past (the old
          // design appended this below the list, often below the fold).
          <div className="p-3">
            <div className="flex flex-col items-center gap-2 px-2 pb-3 pt-2 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <ProviderIcon id={pending.harness} size={20} />
              </span>
              <span className="text-[13px] font-semibold text-foreground">
                {changingWithinProvider
                  ? 'Start a new chat?'
                  : `Switch to ${pendingProvider.name}?`}
              </span>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Starts a fresh chat on {pendingProvider.name}
                {pendingModelLabel ? ` with ${pendingModelLabel}` : ''}. Your
                current thread is saved in history.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const modelOption = pendingModel ?? {
                    id: pending.model,
                    label: pending.model,
                  };
                  const harnessKey = pending.harness;
                  const effort = harnessSupportsEffort(harnessKey)
                    ? // Remembered effort for the DESTINATION provider, validated
                      // against the picked model. Passing null here reset you to
                      // the model's default on every switch, which is what made
                      // provider round-trips lose your setting.
                      explicitEffortForModel(
                        harnessKey,
                        modelOption,
                        readProviderEffort(pending.harness),
                      )
                    : null;
                  onSwitchProvider?.({
                    ...pending,
                    ...(explicitVariantForModel(modelOption, null)
                      ? { variant: explicitVariantForModel(modelOption, null)! }
                      : {}),
                    ...(effort ? { effort } : {}),
                    ...(serviceTierForModel(modelOption, readProviderSpeed(pending.harness))
                      ? { serviceTier: serviceTierForModel(modelOption, readProviderSpeed(pending.harness))! } : {}),
                  });
                  reset(false);
                }}
                disabled={switching}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {switching ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <MessageSquarePlus size={13} />
                )}
                Start new chat
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={switching}
                className="rounded-md border border-border px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <ModelMenuContent
            key={open ? 'open' : 'closed'}
            effort={effort}
            speed={onSelectSpeed ? {
              value: serviceTier ?? null,
              modes: speedOptions.map(option => option.id),
              options: speedOptions,
              onChange: tier => { onSelectSpeed(tier); reset(false); },
            } : undefined}
            efforts={efforts}
            onEffortChange={(level) => {
              onSelectEffort(level);
              reset(false);
            }}
            variant={
              currentModel?.variants?.length
                ? {
                    value: variant ?? null,
                    options: currentModel.variants,
                    onChange: (id) => {
                      onSelectVariant(id);
                      reset(false);
                    },
                  }
                : undefined
            }
            disabled={selectionDisabled}
            onManageModels={() => {
              reset(false);
              openSettings('models');
            }}
            footer={
              defaultSelection?.harness === currentProvider &&
              defaultSelection.model === model && (defaultSelection.serviceTier ?? null) === (serviceTier ?? null) ? undefined : (
                <MakeDefaultRow
                  current={{ harness: currentProvider, model, variant, effort, serviceTier }}
                />
              )
            }
          >
            <VisibleModelOptions
              currentProvider={currentProvider}
              model={selected.model}
              onPick={handlePick}
              defaultSelection={defaultSelection}
              currentProviderOnly={currentProviderOnly}
              disabled={modelSelectionDisabled}
            />
          </ModelMenuContent>
        )}
      </PopoverContent>
    </Popover>
  );
}
