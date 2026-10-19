'use client';

import { useState } from 'react';
import { Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { ModelList } from '@/components/settings/model-list';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUserState } from '@/hooks/use-user-state';
import { useUpdateWorkspace } from '@/hooks/use-workspaces';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { effortOptionsForModel, explicitEffortForModel, explicitVariantForModel, findProvider, type ModelOption } from '@/lib/harness/options';
import { preferredWorkResultReviewerSelection, reviewerPreferenceHarness } from '@/lib/work-results/reviewer-selection-defaults';
import type { ReviewerOverrides } from '@/lib/api/results';
import type { EffortLevel, WorkspaceRecord, WorkspaceReviewDefaults } from '@/db/types';

type AssociatedWorkspace = Pick<WorkspaceRecord, 'id' | 'name' | 'reviewDefaults' | 'reviewBeforeHandoff'>;

export function ReviewerSelection({ value, onChange, associatedWorkspace, inheritedDefaults }: {
  value: ReviewerOverrides;
  onChange: (value: ReviewerOverrides) => void;
  associatedWorkspace?: AssociatedWorkspace | null;
  /** The settings form edits the preference itself, so it inherits normal defaults. */
  inheritedDefaults?: WorkspaceReviewDefaults | null;
}) {
  const { data: defaults } = useUserState();
  const update = useUpdateWorkspace();
  const agentDefaults = inheritedDefaults !== undefined ? inheritedDefaults : associatedWorkspace?.reviewDefaults;
  const harness = reviewerPreferenceHarness(value, agentDefaults, defaults);
  const catalog = useHarnessModels(harness, { catalog: true });
  const preferred = preferredWorkResultReviewerSelection(value, agentDefaults, defaults, {
    defaultModel: catalog.data?.defaultModel ?? null,
    defaultVariant: catalog.data?.defaultVariant ?? null,
    defaultEffort: catalog.data?.defaultEffort ?? null,
  });
  const modelId = preferred.model ?? '';
  const model = catalog.models.find((option) => option.id === modelId) ?? null;
  const effortOptions = effortOptionsForModel(harness, model);
  const effort = preferred.effort ?? (model && effortOptions.length ? explicitEffortForModel(harness, model, null) : null);
  const variant = preferred.variant;
  const variants = model?.variants?.filter((option) => !option.disabled) ?? [];
  const [open, setOpen] = useState(false);
  const unavailable = model?.availability === 'unavailable' || (!!modelId && !!catalog.data && !model);
  const effortUnavailable = !!effort && !!catalog.data && !effortOptions.some((option) => option.id === effort);
  const variantUnavailable = !!variant && !!catalog.data && !variants.some((option) => option.id === variant);

  const pick = (nextHarness: typeof harness, option: ModelOption) => {
    const nextEffort = effortOptionsForModel(nextHarness, option).length ? explicitEffortForModel(nextHarness, option, nextHarness === harness ? effort : null) : null;
    const nextVariant = explicitVariantForModel(option, null);
    onChange({ harness: nextHarness, model: option.id, variant: nextVariant, effort: nextEffort });
    setOpen(false);
  };

  const saveForAgent = () => {
    if (!associatedWorkspace || !modelId || unavailable || effortUnavailable || variantUnavailable) return;
    update.mutate({ id: associatedWorkspace.id, reviewDefaults: { harness, model: modelId, variant: variant ?? null, effort: effort ?? null } }, {
      onSuccess: () => toast.success(`Reviewer saved for ${associatedWorkspace.name}`),
    });
  };
  const resetAgent = () => {
    if (!associatedWorkspace) return;
    update.mutate({ id: associatedWorkspace.id, reviewDefaults: null }, {
      onSuccess: () => { onChange({}); toast.success(`${associatedWorkspace.name} now inherits normal reviewer settings`); },
    });
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <Cpu size={12} />
        <span>{modelId ? `${findProvider(harness)?.name ?? harness} · ${model?.label ?? modelId}${effort ? ` · ${effort}` : ''}` : 'Your normal reviewer settings'}</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild><button type="button" className="text-primary hover:underline">Change</button></PopoverTrigger>
          <PopoverContent align="start" className="w-80 max-h-[65vh] overflow-y-auto">
            <ModelList selectionOnly selected={{ harness, model: modelId }} onPick={pick} />
          </PopoverContent>
        </Popover>
        {Object.keys(value).length > 0 && <button type="button" className="text-primary hover:underline" onClick={() => onChange({})}>Use inherited settings</button>}
      </div>
      {unavailable && <p role="alert" className="text-destructive">{model?.availabilityReason ?? 'This reviewer choice is unavailable. Choose a supported model.'}</p>}
      {effortUnavailable && <p role="alert" className="text-destructive">Saved effort {effort} is unavailable for this reviewer. Choose a compatible effort.</p>}
      {variantUnavailable && <p role="alert" className="text-destructive">Saved variant {variant} is unavailable for this reviewer. Choose a compatible variant.</p>}
      {effortOptions.length > 0 && (
        <label className="inline-flex items-center gap-2 text-muted-foreground">
          Reasoning effort
          <select aria-label="Reviewer reasoning effort" disabled={!modelId} value={effort ?? ''} onChange={(event) => onChange({ ...value, harness, model: modelId, effort: event.target.value as EffortLevel })} className="rounded border bg-background px-2 py-1">
            {effort && !effortOptions.some((option) => option.id === effort) && <option value={effort} disabled>{effort} (unavailable)</option>}
            {effortOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      )}
      {variants.length > 0 && (
        <label className="ml-3 inline-flex items-center gap-2 text-muted-foreground">
          Variant
          <select aria-label="Reviewer model variant" value={variant ?? ''} onChange={(event) => onChange({ ...value, harness, model: modelId, variant: event.target.value || null })} className="rounded border bg-background px-2 py-1">
            <option value="">Default</option>
            {variant && !variants.some((option) => option.id === variant) && <option value={variant} disabled>{variant} (unavailable)</option>}
            {variants.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      )}
      {associatedWorkspace && <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>{Object.keys(value).length ? 'This review uses your current choice.' : associatedWorkspace.reviewDefaults ? `Inherited from ${associatedWorkspace.name}.` : 'Inherited from your normal reviewer settings.'}</span>
        <button type="button" className="text-primary hover:underline disabled:opacity-50" onClick={saveForAgent} disabled={update.isPending || !modelId || unavailable || effortUnavailable || variantUnavailable}>Use for this agent</button>
        {associatedWorkspace.reviewDefaults && <button type="button" className="text-primary hover:underline disabled:opacity-50" onClick={resetAgent} disabled={update.isPending}>Reset agent reviewer</button>}
      </div>}
    </div>
  );
}
