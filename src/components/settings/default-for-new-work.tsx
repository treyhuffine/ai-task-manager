'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DefaultSelectionEditor } from '@/components/settings/default-selection-editor';
import { ProviderIcon } from '@/components/settings/harness-connection-ui';
import { useDefaultSelection, useSetDefaultSelection } from '@/hooks/use-default-selection';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { effortOptionsForModel, findProvider } from '@/lib/harness/options';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';

/**
 * The home's default for new work, at the top of Settings, Models: what new
 * chats, agents and background work start on when they don't pick a model
 * (docs/default-selection.md). The only thing Settings calls "the default".
 * Each harness below keeps its own, used only when something picks that
 * harness without a model.
 */
export function DefaultForNewWork() {
  const saved = useDefaultSelection();
  const setDefault = useSetDefaultSelection();
  const { models } = useHarnessModels(saved?.harness);
  const [open, setOpen] = useState(false);

  const option = saved?.model ? models.find((m) => m.id === saved.model) ?? null : null;
  const summary = saved?.model
    ? [
        findProvider(saved.harness)?.name ?? saved.harness,
        option?.label ?? saved.model,
        option?.variants?.find((v) => v.id === saved.variant)?.name,
        effortOptionsForModel(saved.harness, option).find((o) => o.id === saved.effort)?.label,
      ].filter(Boolean).join(' · ')
    : `Not chosen yet. New work starts on ${findProvider(DEFAULT_HARNESS)?.name ?? DEFAULT_HARNESS}.`;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/30 p-3" data-default-for-new-work>
      <div className="flex items-start gap-2.5">
        <ProviderIcon id={saved?.harness ?? DEFAULT_HARNESS} />
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-foreground">Default for new work</h4>
          <p className="mt-0.5 text-[12px] text-foreground">{summary}</p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            New chats, agents and background work start on this unless they pick a model.
          </p>
        </div>
        <Button type="button" size="xs" variant="outline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Change'}
        </Button>
      </div>
      {open && (
        <div className="border-t border-border pt-3">
          <DefaultSelectionEditor
            current={saved?.model ? { harness: saved.harness, model: saved.model, variant: saved.variant, effort: saved.effort } : null}
            onSave={(selection) => setDefault.mutateAsync(selection)}
            onClose={() => setOpen(false)}
            note="Chats already started keep their model."
          />
        </div>
      )}
    </div>
  );
}
