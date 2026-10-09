'use client';

import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDefaultSelection, useSetDefaultSelection } from '@/hooks/use-default-selection';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { apiErrorText } from '@/lib/api/client';
import { findProvider, type ProviderId } from '@/lib/harness/options';
import type { EffortLevel } from '@/db/types';
import { Tip } from '@/components/ui/tip';

/**
 * One quiet line at the top of a model menu, shown only when what's picked
 * here isn't the home's default: what the default is, and a way to make this
 * the default instead. Picking a model for one chat never changes the default
 * on its own (docs/default-selection.md), so this is where that choice is
 * made, in the place the person already is, without asking every time.
 */
export function MakeDefaultRow({
  current,
}: {
  current: { harness: ProviderId; model: string; variant?: string | null; effort?: EffortLevel | null };
}) {
  const saved = useDefaultSelection();
  const setDefault = useSetDefaultSelection();
  const { models: currentModels } = useHarnessModels(current.harness);
  const { models: defaultModels } = useHarnessModels(saved?.harness);

  if (saved && saved.harness === current.harness && saved.model === current.model) return null;

  const currentLabel = currentModels.find((m) => m.id === current.model)?.label ?? current.model;
  const defaultModelLabel = saved?.model ? defaultModels.find((m) => m.id === saved.model)?.label ?? saved.model : null;
  // Name the harness only when the two differ: "Codex GPT-5.5" against a Claude chat.
  const defaultLabel = saved
    ? saved.harness === current.harness
      ? defaultModelLabel
      : [findProvider(saved.harness)?.name, defaultModelLabel].filter(Boolean).join(' ')
    : null;

  const make = () =>
    setDefault.mutate(
      { harness: current.harness, model: current.model, variant: current.variant ?? null, effort: current.effort ?? null },
      {
        onSuccess: () => toast.success(`${currentLabel} is now your default`, { description: 'New chats start on it.' }),
        onError: (err) => toast.error('Couldn’t change the default', { description: apiErrorText(err) }),
      },
    );

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {defaultLabel ? `Your default is ${defaultLabel}` : 'No default yet'}
      </span>
      <Tip label="New chats start on your default">
        <button
          type="button"
          onClick={make}
          disabled={setDefault.isPending}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          {setDefault.isPending && <Loader2 size={10} className="animate-spin" />}
          Make {currentLabel} default
        </button>
      </Tip>
    </div>
  );
}
