'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { ModelList } from '@/components/settings/model-list';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { apiErrorText } from '@/lib/api/client';
import {
  defaultModelFor,
  effortOptionsForModel,
  explicitEffortForModel,
  explicitVariantForModel,
  harnessSupportsEffort,
  type ModelOption,
  type ProviderId,
} from '@/lib/harness/options';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';
import { cn } from '@/lib/utils';
import type { EffortLevel } from '@/db/types';

export interface DefaultSelectionDraft {
  harness: ProviderId;
  model: string;
  variant: string | null;
  effort: EffortLevel | null;
}

/**
 * Pick the default for new work: harness and model from the same list the
 * model menus use (every harness, each with its sign-in state, so one that
 * isn't signed in can't be picked), then the effort that model offers.
 * Nothing is saved until Save. Shared by Settings and first-run setup, which
 * decide what saving does (`onSave`) and where the editor sits.
 */
export function DefaultSelectionEditor({
  current,
  onSave,
  onClose,
  note,
}: {
  /** The saved default, or null when the home hasn't chosen one. */
  current: DefaultSelectionDraft | null;
  onSave: (selection: DefaultSelectionDraft) => Promise<unknown>;
  onClose: () => void;
  /** One line beside the buttons on what the default does. */
  note: string;
}) {
  const [draft, setDraft] = useState<DefaultSelectionDraft>(
    current ?? { harness: DEFAULT_HARNESS, model: defaultModelFor(DEFAULT_HARNESS), variant: null, effort: null },
  );
  const [saving, setSaving] = useState(false);
  const { models } = useHarnessModels(draft.harness);
  const option = models.find((m) => m.id === draft.model) ?? null;
  const efforts = effortOptionsForModel(draft.harness, option);
  const changed =
    !current ||
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
      await onSave(draft);
      onClose();
    } catch (err) {
      toast.error('Couldn’t change the default', { description: apiErrorText(err) });
      setSaving(false);
    }
  };

  return (
    <div>
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
                <Tip key={o.id} label={o.hint}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDraft((d) => ({ ...d, effort: o.id }))}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                      on ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {o.label}
                    {on && <Check size={10} className="text-primary" />}
                  </button>
                </Tip>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="min-w-0 text-[10.5px] text-muted-foreground">{note}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!changed || saving} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
