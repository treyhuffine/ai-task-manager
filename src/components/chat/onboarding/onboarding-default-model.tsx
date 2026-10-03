'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { ModelList } from '@/components/settings/model-list';
import { ProviderIcon } from '@/components/settings/harness-connection-ui';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { useUserState } from '@/hooks/use-user-state';
import { apiErrorText } from '@/lib/api/client';
import {
  effortOptionsForModel,
  explicitEffortForModel,
  explicitVariantForModel,
  findProvider,
  harnessSupportsEffort,
  type ModelOption,
  type ProviderId,
} from '@/lib/harness/options';
import { cn } from '@/lib/utils';
import type { EffortLevel } from '@/db/types';
import { useApplyHarness } from './onboarding-harness';
import { Card, PrimaryButton, QuietButton } from './onboarding-ui';

/**
 * The first run picks the harness, model and effort without asking when it
 * can (`HarnessStep`), so this says what it picked, once, in one quiet line
 * where the pick happened: "Found Claude Code. Default set to Opus 5.5,
 * medium effort." Change opens every connected harness's models and the
 * effort for the one picked, inline, and saving makes them the default the
 * way Settings, Models does. Never a question to answer: the conversation
 * goes on past it either way.
 */
export function DefaultModelLine({ found }: { found: boolean }) {
  const { data: userState } = useUserState();
  const harness = (userState?.defaultHarness ?? null) as ProviderId | null;
  const model = userState?.defaultModel ?? null;
  const effort = (userState?.defaultEffort ?? null) as EffortLevel | null;
  const { models } = useHarnessModels(harness);
  const [open, setOpen] = useState(false);
  if (!harness || !model) return null;

  const option = models.find((m) => m.id === model) ?? null;
  const effortLabel = effortOptionsForModel(harness, option).find((o) => o.id === effort)?.label ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <ProviderIcon id={harness} size={12} />
        <span className="min-w-0 truncate">
          {defaultModelSummary({
            found: found ? findProvider(harness)?.name ?? harness : null,
            model: option?.label ?? model,
            effort: effortLabel,
          })}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded px-1 font-medium text-foreground underline-offset-2 hover:underline"
        >
          {open ? 'Close' : 'Change'}
        </button>
      </div>
      {open && (
        <DefaultModelEditor
          // First-run setup saves no variant (`setDefaultSelection`), so none to start from.
          current={{ harness, model, variant: null, effort }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The line's words. "Found" only when the first run found the harness on its
 * own, not when the person just set it up by hand. Effort is left out for a
 * harness without one (Cursor, OpenCode).
 */
export function defaultModelSummary(input: { found: string | null; model: string; effort: string | null }): string {
  const pick = input.effort ? `${input.model}, ${input.effort.toLowerCase()} effort` : input.model;
  return input.found ? `Found ${input.found}. Default set to ${pick}.` : `Default set to ${pick}.`;
}

interface Selection {
  harness: ProviderId;
  model: string;
  variant: string | null;
  effort: EffortLevel | null;
}

/**
 * Harness and model from the same list the model menus use (every harness,
 * each with its sign-in state, so one that isn't signed in can't be picked),
 * then the effort that model offers. Nothing is saved until Save.
 */
function DefaultModelEditor({ current, onClose }: { current: Selection; onClose: () => void }) {
  const apply = useApplyHarness();
  const [draft, setDraft] = useState<Selection>(current);
  const [saving, setSaving] = useState(false);
  const { models } = useHarnessModels(draft.harness);
  const option = models.find((m) => m.id === draft.model) ?? null;
  const efforts = effortOptionsForModel(draft.harness, option);
  const changed =
    draft.harness !== current.harness ||
    draft.model !== current.model ||
    draft.variant !== current.variant ||
    draft.effort !== current.effort;

  const pick = (harness: ProviderId, model: ModelOption) =>
    setDraft((d) => ({
      harness,
      model: model.id,
      variant: explicitVariantForModel(model, d.harness === harness ? d.variant : null),
      // Keep the effort already chosen when the new model has it, else its own.
      effort: harnessSupportsEffort(harness) ? explicitEffortForModel(harness, model, d.effort) : null,
    }));

  const save = async () => {
    setSaving(true);
    try {
      await apply(draft);
      onClose();
    } catch (err) {
      toast.error('Couldn’t change the default', { description: apiErrorText(err) });
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="max-h-72 overflow-y-auto pr-1">
        <ModelList selected={{ harness: draft.harness, model: draft.model }} onPick={pick} />
      </div>
      {efforts.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">Effort</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Effort">
            {efforts.map((o) => {
              const on = draft.effort === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={o.hint}
                  onClick={() => setDraft((d) => ({ ...d, effort: o.id }))}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                    on ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {o.label}
                  {on && <Check size={10} className="text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[10.5px] text-muted-foreground">
          New chats and executions start on it. You can change it later in Settings.
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <QuietButton onClick={onClose}>Cancel</QuietButton>
          <PrimaryButton disabled={!changed} busy={saving} onClick={() => void save()}>
            Save
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}
