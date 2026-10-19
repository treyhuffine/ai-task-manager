'use client';

import { useState } from 'react';
import { DefaultSelectionEditor } from '@/components/settings/default-selection-editor';
import { ProviderIcon } from '@/components/settings/harness-connection-ui';
import { useHarnessModels } from '@/hooks/use-harness-models';
import { useUserState } from '@/hooks/use-user-state';
import { effortOptionsForModel, findProvider, type ProviderId } from '@/lib/harness/options';
import type { EffortLevel } from '@/db/types';
import { useApplyHarness } from './onboarding-harness';
import { Card } from './onboarding-ui';

/**
 * The first run picks the harness, model and effort without asking when it
 * can (`HarnessStep`), so this says what it picked, once, in one quiet line
 * where the pick happened: "Found Claude Code. Default set to Opus 5.5,
 * medium effort." Change opens the same editor as Settings' "Default for new
 * work" (`DefaultSelectionEditor`), inline, and saving makes the pick the
 * default for new work. Never a question to answer: the conversation
 * goes on past it either way.
 */
export function DefaultModelLine({ found }: { found: boolean }) {
  const { data: userState } = useUserState();
  const harness = (userState?.defaultHarness ?? null) as ProviderId | null;
  const model = userState?.defaultModel ?? null;
  const effort = (userState?.defaultEffort ?? null) as EffortLevel | null;
  const { models } = useHarnessModels(harness);
  const apply = useApplyHarness();
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
        <Card>
          <DefaultSelectionEditor
            current={{ harness, model, variant: userState?.defaultVariant ?? null, effort }}
            onSave={apply}
            onClose={() => setOpen(false)}
            note="New chats and executions start on it. You can change it later in Settings."
          />
        </Card>
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
