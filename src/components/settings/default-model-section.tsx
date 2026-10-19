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
 * The global default model, first in Settings, Models: the harness, model and
 * effort new chats, agents and background work start on when they don't pick
 * one (docs/default-selection.md). A different kind of default from each
 * harness's own, set in "Harnesses and models" below and used only when
 * something picks that harness.
 */
export function DefaultModelSection() {
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
    <section className="space-y-3 text-[12px]" data-default-model>
      <header className="space-y-0.5">
        <h3 className="text-[13px] font-semibold text-foreground">Default model</h3>
        <p className="text-[11px] text-muted-foreground/85">
          Global default model for new chats, agents and background work when they don’t pick one. Each
          harness below keeps its own default, used only when something picks that harness.
        </p>
      </header>
      <div className="space-y-3 rounded-lg border border-border bg-card/30 p-3">
        <div className="flex items-center gap-2.5">
          <ProviderIcon id={saved?.harness ?? DEFAULT_HARNESS} />
          <p className="min-w-0 flex-1 text-[12.5px] font-medium text-foreground">{summary}</p>
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
    </section>
  );
}
